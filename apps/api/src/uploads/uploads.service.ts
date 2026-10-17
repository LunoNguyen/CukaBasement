import { Inject, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { ALLOWED_FILE_TYPES, type createUploadSchema, type FileKind, type FileStatus, kindForMime } from '@cuka/shared'
import { type Model, Types } from 'mongoose'
import type { z } from 'zod'
import { AppError } from '../common/app-error'
import { CONFIG, type Config } from '../config/config'
import { JOBS, type JobsPort } from '../jobs/jobs.port'
import { SettingsService } from '../settings/settings.service'
import { StorageService } from '../storage/storage.service'
import { FILE_MODEL, type FileDoc } from './file.schema'

export type CreateUploadInput = z.infer<typeof createUploadSchema>

export interface FileDto {
  id: string
  kind: FileKind
  mimeType: string
  sizeBytes: number
  status: FileStatus | 'validating'
  originalName: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const HEAD_BYTES = 4100

type FileTypeModule = typeof import('file-type')
let fileTypeModule: Promise<FileTypeModule> | undefined
/** file-type is ESM-only and this package is CommonJS, so it is loaded lazily via dynamic import. */
function loadFileType(): Promise<FileTypeModule> {
  return (fileTypeModule ??= import('file-type'))
}

/** Lowercased extension of the declared name; only a short alphanumeric one is trusted. */
function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name)
  return m ? m[1]!.toLowerCase() : ''
}

/** Where the client's presigned POST writes; never the validated objectKey. */
export function stagingKey(ownerId: string, fileId: string, ext: string): string {
  return `${ownerId}/${fileId}/upload.${ext}`
}

/** Maps equivalent mimes reported by file-type onto the whitelist. */
function normalizeMime(detected: string, declared: string): string {
  switch (detected) {
    case 'video/x-m4v':
      return 'video/mp4'
    case 'video/quicktime':
      return declared === 'video/mp4' ? 'video/mp4' : detected
    case 'audio/x-wav':
    case 'audio/vnd.wave':
      return 'audio/wav'
    case 'application/ogg':
    case 'audio/opus':
      return 'audio/ogg'
    default:
      return detected
  }
}

function toDto(f: FileDoc): FileDto {
  // `validating` is internal; callers see it as still uploading.
  return { id: f._id.toString(), kind: f.kind, mimeType: f.mimeType, sizeBytes: f.sizeBytes, status: f.status === 'validating' ? 'uploading' : f.status, originalName: f.originalName }
}

@Injectable()
export class UploadsService {
  private readonly logger = new Logger('UploadsService')
  /** Test seam: lets a test interleave a request at a precise point of complete(). */
  readonly testHooks: { afterCopy?: () => Promise<void> } = {}

  constructor(
    @InjectModel(FILE_MODEL) private readonly files: Model<FileDoc>,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(JOBS) private readonly jobs: JobsPort,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  async presign(ownerId: string, input: CreateUploadInput) {
    const s = await this.settings.get()
    if (input.size > s.maxFileBytes) throw new AppError('FILE_TOO_LARGE', 413, 'File is too large')
    const mime = input.mime.toLowerCase()
    const kind = kindForMime(mime, extOf(input.name))
    if (!kind) throw new AppError('FILE_TYPE_NOT_ALLOWED', 415, 'File type is not allowed')
    // octet-stream is only whitelisted for .clip (checked by kindForMime); otherwise the mime picks the extension.
    const ext = ALLOWED_FILE_TYPES.find((t) => t.mime === mime && t.kind === kind)!.ext

    const owner = new Types.ObjectId(ownerId)
    const [agg] = await this.files.aggregate<{ total: number }>([
      { $match: { ownerId: owner, createdAt: { $gte: new Date(Date.now() - DAY_MS) } } },
      { $group: { _id: null, total: { $sum: '$sizeBytes' } } },
    ])
    if ((agg?.total ?? 0) + input.size > s.dailyUploadQuotaBytes) {
      throw new AppError('UPLOAD_QUOTA_EXCEEDED', 429, 'Daily upload quota exceeded')
    }

    const _id = new Types.ObjectId()
    const bucket = this.config.minio.bucketOriginals
    await this.files.create({
      _id,
      ownerId: owner,
      bucket,
      objectKey: this.storage.objectKey(ownerId, _id.toString(), 'original', ext),
      originalName: input.name,
      mimeType: mime,
      sizeBytes: input.size,
      kind,
      status: 'uploading',
    })
    // The client may only write the staging key; complete copies it to the server-owned objectKey.
    const { url, fields } = await this.storage.presignPost(bucket, stagingKey(ownerId, _id.toString(), ext), input.size, mime)
    return { fileId: _id.toString(), url, fields, maxBytes: input.size }
  }

  async complete(ownerId: string, fileId: string): Promise<FileDto> {
    const file = Types.ObjectId.isValid(fileId) ? await this.files.findOne({ _id: fileId, ownerId }).lean() : null
    if (!file) throw new AppError('NOT_FOUND', 404, 'File not found')
    if (file.status !== 'uploading') return toDto(file)

    const staging = stagingKey(ownerId, file._id.toString(), file.objectKey.slice(file.objectKey.lastIndexOf('.') + 1))
    if (!(await this.storage.stat(file.bucket, staging))) {
      // A concurrent complete may have finished (and removed staging) after we read the file.
      const now = await this.files.findById(file._id).lean()
      if (now && now.status !== 'uploading') return toDto(now)
      throw new AppError('UPLOAD_NOT_FOUND', 400, 'No uploaded object found for this file')
    }

    // Claim first: only the winner copies and validates; everyone else just sees the current state.
    // A file stuck in 'validating' (process crash mid-way) is left for the cleanup job (Task 18).
    const claim = await this.files.findOneAndUpdate(
      { _id: file._id, ownerId, status: 'uploading' },
      { $set: { status: 'validating' } },
      { returnDocument: 'after' },
    )
    if (!claim) return toDto((await this.files.findById(file._id).lean()) ?? file)

    try {
      return await this.validateClaimed(file, staging)
    } catch (err) {
      // No-op when reject() already marked the file failed; otherwise allow a retry.
      await this.files.updateOne({ _id: file._id, status: 'validating' }, { $set: { status: 'uploading' } })
      throw err
    }
  }

  private async validateClaimed(file: FileDoc, staging: string): Promise<FileDto> {
    // Validate a server-side copy the client cannot overwrite through the presigned POST.
    // Staging stays in place until success so a failed attempt can be retried.
    try {
      await this.storage.copy(file.bucket, staging, file.bucket, file.objectKey)
    } catch {
      throw new AppError('UPLOAD_NOT_FOUND', 400, 'No uploaded object found for this file')
    }
    await this.testHooks.afterCopy?.()

    const stat = await this.storage.stat(file.bucket, file.objectKey)
    if (!stat) throw new AppError('UPLOAD_NOT_FOUND', 400, 'No uploaded object found for this file')
    const s = await this.settings.get()
    if (stat.size > s.maxFileBytes || stat.size > file.sizeBytes) {
      await this.reject(file, staging, 'FILE_TOO_LARGE', 413, 'File is too large')
    }

    const head = await this.storage.readHead(file.bucket, file.objectKey, HEAD_BYTES)
    const found = await (await loadFileType()).fileTypeFromBuffer(head)
    let mimeType: string
    if (file.mimeType === 'application/octet-stream') {
      // Only .clip is whitelisted as octet-stream, and it has no magic signature: accept only when nothing was detected.
      if (found) await this.reject(file, staging, 'FILE_TYPE_NOT_ALLOWED', 415, 'File content does not match its type')
      mimeType = file.mimeType
    } else {
      const detectedMime = found && normalizeMime(found.mime, file.mimeType)
      const allowed = detectedMime && ALLOWED_FILE_TYPES.find((t) => t.ext !== 'clip' && t.mime === detectedMime)
      if (!allowed || allowed.kind !== file.kind) {
        await this.reject(file, staging, 'FILE_TYPE_NOT_ALLOWED', 415, 'File content does not match its type')
      }
      mimeType = detectedMime as string
    }

    const done = await this.files
      .findOneAndUpdate({ _id: file._id, status: 'validating' }, { $set: { mimeType, sizeBytes: stat.size, status: 'processing' } }, { returnDocument: 'after' })
      .lean()
    if (!done) return toDto((await this.files.findById(file._id).lean()) ?? file)
    await this.jobs.enqueue('process-file', { fileId: file._id.toString() })
    // Best-effort: the file is already valid and queued; a leftover staging object is swept by the cleanup job.
    try {
      await this.storage.remove(file.bucket, staging)
    } catch (err) {
      this.logger.warn(`Could not remove staging object ${staging}: ${(err as Error).message}`)
    }
    return toDto(done)
  }

  /** Removes both objects, marks the claimed file failed and throws. */
  private async reject(file: FileDoc, staging: string, code: 'FILE_TOO_LARGE' | 'FILE_TYPE_NOT_ALLOWED', status: number, message: string): Promise<never> {
    await this.storage.remove(file.bucket, file.objectKey)
    await this.storage.remove(file.bucket, staging)
    await this.files.updateOne({ _id: file._id, status: 'validating' }, { $set: { status: 'failed' } })
    throw new AppError(code, status, message)
  }

  /** All files exist, belong to `ownerId` and are `processing` or `ready`; otherwise 400 FILE_NOT_READY. */
  async assertUsableFiles(ownerId: string, fileIds: string[]): Promise<FileDoc[]> {
    const unique = [...new Set(fileIds)]
    if (!unique.every((id) => /^[0-9a-fA-F]{24}$/.test(id))) throw new AppError('FILE_NOT_READY', 400, 'File is not usable')
    const docs = await this.files
      .find({ _id: { $in: unique }, ownerId, status: { $in: ['processing', 'ready'] } })
      .lean()
    if (docs.length !== unique.length) throw new AppError('FILE_NOT_READY', 400, 'File is not usable')
    return docs
  }
}

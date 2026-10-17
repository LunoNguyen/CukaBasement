import { Inject, Injectable } from '@nestjs/common'
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
  status: FileStatus
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

function toDto(f: FileDoc): FileDto {
  return { id: f._id.toString(), kind: f.kind, mimeType: f.mimeType, sizeBytes: f.sizeBytes, status: f.status, originalName: f.originalName }
}

@Injectable()
export class UploadsService {
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
    const ext = extOf(input.name)
    const kind = kindForMime(input.mime, ext)
    if (!kind) throw new AppError('FILE_TYPE_NOT_ALLOWED', 415, 'File type is not allowed')

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
    const objectKey = this.storage.objectKey(ownerId, _id.toString(), 'original', ext || ALLOWED_FILE_TYPES.find((t) => t.mime === input.mime.toLowerCase())!.ext)
    await this.files.create({
      _id,
      ownerId: owner,
      bucket,
      objectKey,
      originalName: input.name,
      mimeType: input.mime.toLowerCase(),
      sizeBytes: input.size,
      kind,
      status: 'uploading',
    })
    const { url, fields } = await this.storage.presignPost(bucket, objectKey, s.maxFileBytes, input.mime.toLowerCase())
    return { fileId: _id.toString(), url, fields, maxBytes: s.maxFileBytes }
  }

  async complete(ownerId: string, fileId: string): Promise<FileDto> {
    const file = Types.ObjectId.isValid(fileId) ? await this.files.findOne({ _id: fileId, ownerId }).lean() : null
    if (!file) throw new AppError('NOT_FOUND', 404, 'File not found')
    if (file.status !== 'uploading') return toDto(file)

    const stat = await this.storage.stat(file.bucket, file.objectKey)
    if (!stat) throw new AppError('UPLOAD_NOT_FOUND', 400, 'No uploaded object found for this file')

    const s = await this.settings.get()
    if (stat.size > s.maxFileBytes) await this.reject(file, 'FILE_TOO_LARGE', 413, 'File is too large')

    const head = await this.storage.readHead(file.bucket, file.objectKey, HEAD_BYTES)
    const found = await (await loadFileType()).fileTypeFromBuffer(head)
    let mimeType: string
    if (file.kind === 'source' && extOf(file.originalName) === 'clip') {
      // .clip has no magic signature: accept only when nothing was detected.
      if (found) await this.reject(file, 'FILE_TYPE_NOT_ALLOWED', 415, 'File content does not match its type')
      mimeType = file.mimeType
    } else {
      const allowed = found && ALLOWED_FILE_TYPES.find((t) => t.ext !== 'clip' && t.mime === found.mime)
      if (!found || !allowed || allowed.kind !== file.kind) {
        await this.reject(file, 'FILE_TYPE_NOT_ALLOWED', 415, 'File content does not match its type')
      }
      mimeType = found!.mime
    }

    const claimed = await this.files
      .findOneAndUpdate({ _id: file._id, status: 'uploading' }, { $set: { mimeType, sizeBytes: stat.size, status: 'processing' } }, { returnDocument: 'after' })
      .lean()
    if (!claimed) return toDto((await this.files.findById(file._id).lean()) ?? file)
    await this.jobs.enqueue('process-file', { fileId: file._id.toString() })
    return toDto(claimed)
  }

  /** Removes the object, marks the file failed and throws. */
  private async reject(file: FileDoc, code: 'FILE_TOO_LARGE' | 'FILE_TYPE_NOT_ALLOWED', status: number, message: string): Promise<never> {
    await this.storage.remove(file.bucket, file.objectKey)
    await this.files.updateOne({ _id: file._id }, { $set: { status: 'failed' } })
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

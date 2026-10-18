import { Inject, Injectable, Logger } from '@nestjs/common'
import { getConnectionToken } from '@nestjs/mongoose'
import type { BackupPhase, BackupRunKind, BackupRunStatus, BackupSchedule } from '@cuka/shared'
import type { Request, Response } from 'express'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { type Connection, Types } from 'mongoose'
import { hashToken, randomToken } from '../auth/tokens'
import type { Viewer } from '../auth/viewer'
import { FeedCache } from '../cache/feed-cache.service'
import { AppError } from '../common/app-error'
import { CONFIG, type Config } from '../config/config'
import { ModerationLogService } from '../moderation/moderation-log.service'
import { SettingsService } from '../settings/settings.service'
import { StorageService } from '../storage/storage.service'
import { applyArchive, type BackupDeps, type BackupFile, backupPath, checkTarget, createBackup, listBackups, newBackupName, verifyArchive } from './backup-archive'
import { startExclusive } from './backup-runner'
import type { ScheduleState } from './backup-schedule'
import { closeOrphanedRuns, currentLock, DOWNLOADS_COLLECTION, type RunDoc, runs } from './backup-state'
import { MaintenanceService } from './maintenance.service'

const DOWNLOAD_TTL_MS = 60_000
/** Uploads in progress; never shown as backups, swept after a day if the server died mid-upload. */
const UPLOAD_PREFIX = '.upload-'
const UPLOAD_STALE_MS = 24 * 60 * 60 * 1000

export interface BackupRunDto {
  id: string
  kind: BackupRunKind
  trigger: RunDoc['trigger']
  status: BackupRunStatus
  file: string
  startedAt: string
  finishedAt: string | null
  error: string | null
  progress: { phase: BackupPhase; done: number; total: number } | null
}

export interface BackupOverviewDto {
  items: BackupFile[]
  /** The newest run (running or finished), for status polling. */
  run: BackupRunDto | null
  busy: boolean
  maintenance: boolean
  schedule: ScheduleState
  maxUploadBytes: number
}

interface DownloadDoc {
  _id: string
  name: string
  actorId: string
  expiresAt: Date
}

function toDto(r: RunDoc): BackupRunDto {
  return {
    id: r._id.toString(),
    kind: r.kind,
    trigger: r.trigger,
    status: r.status,
    file: r.file,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    error: r.error,
    progress: r.progress,
  }
}

function notFound(): AppError {
  return new AppError('BACKUP_NOT_FOUND', 404, 'Backup not found')
}

/**
 * Admin-page backups and restores. Runs happen in this API process in the background, under the global lock
 * in MongoDB (shared with the CLI and the worker's schedule), so only one backup or restore runs at a time.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger('Backup')
  private downloadsIndexed = false
  /** Runs started by this process, so tests (and shutdown) can wait for them. */
  readonly inFlight = new Set<Promise<unknown>>()

  constructor(
    @Inject(getConnectionToken()) private readonly conn: Connection,
    @Inject(CONFIG) private readonly config: Config,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly feed: FeedCache,
    private readonly modLog: ModerationLogService,
    private readonly maintenance: MaintenanceService,
  ) {}

  private get db() {
    return this.conn.db!
  }

  private get deps(): BackupDeps {
    return { conn: this.conn, storage: this.storage, config: this.config, feed: this.feed }
  }

  private get dir(): string {
    return this.config.backup.dir
  }

  async overview(): Promise<BackupOverviewDto> {
    await closeOrphanedRuns(this.db)
    const [items, latest, lock, schedule] = await Promise.all([
      listBackups(this.dir),
      runs(this.db).find().sort({ startedAt: -1 }).limit(1).next(),
      currentLock(this.db),
      this.settings.backupSchedule(),
    ])
    return {
      items,
      run: latest ? toDto(latest) : null,
      busy: lock !== null,
      maintenance: lock?.maintenance === true,
      schedule,
      maxUploadBytes: this.config.backup.maxUploadBytes,
    }
  }

  async run(id: string): Promise<BackupRunDto> {
    await closeOrphanedRuns(this.db)
    if (!/^[0-9a-f]{24}$/i.test(id)) throw new AppError('NOT_FOUND', 404, 'Run not found')
    const doc = await runs(this.db).findOne({ _id: new Types.ObjectId(id) })
    if (!doc) throw new AppError('NOT_FOUND', 404, 'Run not found')
    return toDto(doc)
  }

  private track<T>(p: Promise<T>): void {
    const tracked = p.then(
      () => {},
      () => {},
    )
    this.inFlight.add(tracked)
    void tracked.finally(() => this.inFlight.delete(tracked))
  }

  private async log(actor: Viewer, action: Parameters<ModerationLogService['log']>[1], name: string, note?: string): Promise<void> {
    await this.modLog.log(actor.id, action, 'backup', name, note).catch((e: Error) => this.logger.warn(`Could not log ${action}: ${e.message}`))
  }

  async startBackup(actor: Viewer): Promise<BackupRunDto> {
    const name = newBackupName('manual')
    const started = await startExclusive(this.db, { kind: 'backup', trigger: 'manual', file: name, actorId: actor.id }, (ctx) =>
      createBackup(this.deps, name, ctx.progress),
    )
    this.track(
      started.done.then(
        (r) => this.log(actor, 'backup_create', name, `${r.sizeBytes} bytes`),
        (e: Error) => {
          this.logger.error(`Backup ${name} failed: ${e.message}`)
          return this.log(actor, 'backup_create', name, `failed: ${e.message}`.slice(0, 500))
        },
      ),
    )
    return this.run(started.runId.toString())
  }

  async startRestore(actor: Viewer, name: string): Promise<BackupRunDto> {
    const file = backupPath(this.dir, name)
    if (!(await stat(file).catch(() => null))?.isFile()) throw notFound()
    const started = await startExclusive(this.db, { kind: 'restore', trigger: 'manual', file: name, actorId: actor.id }, async (ctx) => {
      const verified = await verifyArchive(file, ctx.progress)
      checkTarget(this.deps, verified)
      await ctx.enterMaintenance()
      this.maintenance.setLocal(true)
      try {
        await applyArchive(this.deps, file, verified, ctx.progress)
      } finally {
        this.settings.clearCache()
        await this.feed.bump().catch(() => {})
      }
    })
    const finish = () => {
      this.maintenance.setLocal(false)
      this.maintenance.clearCache()
    }
    this.track(
      started.done.then(
        () => {
          finish()
          // Written after the swap, so the entry lands in the restored log.
          return this.log(actor, 'backup_restore', name)
        },
        (e: Error) => {
          finish()
          this.logger.error(`Restore from ${name} failed: ${e.message}`)
          return this.log(actor, 'backup_restore', name, `failed: ${e.message}`.slice(0, 500))
        },
      ),
    )
    return this.run(started.runId.toString())
  }

  async remove(actor: Viewer, name: string): Promise<void> {
    const file = backupPath(this.dir, name)
    if (!(await stat(file).catch(() => null))?.isFile()) throw notFound()
    const lock = await currentLock(this.db)
    if (lock?.runId) {
      const active = await runs(this.db).findOne({ _id: lock.runId })
      if (active?.file === name) throw new AppError('BACKUP_BUSY', 409, 'This backup is in use')
    }
    await unlink(file)
    await this.log(actor, 'backup_delete', name)
  }

  async downloadToken(actor: Viewer, name: string): Promise<{ url: string; expiresAt: string }> {
    const file = backupPath(this.dir, name)
    if (!(await stat(file).catch(() => null))?.isFile()) throw notFound()
    const col = this.db.collection<DownloadDoc>(DOWNLOADS_COLLECTION)
    if (!this.downloadsIndexed) {
      await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      this.downloadsIndexed = true
    }
    const token = randomToken()
    const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_MS)
    await col.insertOne({ _id: hashToken(token), name, actorId: actor.id, expiresAt })
    await this.log(actor, 'backup_download', name)
    return { url: `/api/admin/backups/download/${token}`, expiresAt: expiresAt.toISOString() }
  }

  /** Streams a backup for a one-time token (consumed here, valid DOWNLOAD_TTL_MS). Browsers navigate here directly. */
  async download(token: string, res: Response): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError('TOKEN_INVALID', 403, 'Invalid download link')
    const doc = await this.db
      .collection<DownloadDoc>(DOWNLOADS_COLLECTION)
      .findOneAndDelete({ _id: hashToken(token), expiresAt: { $gt: new Date() } })
    if (!doc) throw new AppError('TOKEN_INVALID', 403, 'Invalid or expired download link')
    const file = backupPath(this.dir, doc.name)
    const s = await stat(file).catch(() => null)
    if (!s?.isFile()) throw notFound()
    res.status(200)
    res.setHeader('Content-Type', 'application/gzip')
    res.setHeader('Content-Length', String(s.size))
    res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    await pipeline(createReadStream(file), res).catch((e: Error) => this.logger.warn(`Download of ${doc.name} interrupted: ${e.message}`))
  }

  /**
   * Stores a raw `application/octet-stream` body as a new backup (server-chosen name). The size limit is enforced
   * on Content-Length up front and on the bytes actually received. Contents are checked fully only on restore.
   */
  async upload(actor: Viewer, req: Request): Promise<BackupFile> {
    const max = this.config.backup.maxUploadBytes
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > max) throw new AppError('BACKUP_TOO_LARGE', 413, 'Backup file is too large')
    await mkdir(this.dir, { recursive: true })
    await this.sweepStaleUploads()
    const tmp = join(this.dir, `${UPLOAD_PREFIX}${randomToken()}`)
    let received = 0
    let tooLarge = false
    try {
      await pipeline(
        req,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            received += chunk.length
            if (received > max) {
              tooLarge = true
              throw new Error('too large')
            }
            yield chunk
          }
        },
        createWriteStream(tmp, { flags: 'wx' }),
      )
      if (received === 0) throw new AppError('BACKUP_INVALID', 400, 'Empty upload')
      const fh = await open(tmp, 'r')
      const head = Buffer.alloc(2)
      try {
        await fh.read(head, 0, 2, 0)
      } finally {
        await fh.close()
      }
      if (head[0] !== 0x1f || head[1] !== 0x8b) throw new AppError('BACKUP_INVALID', 400, 'Not a .tar.gz file')
      const name = newBackupName('upload')
      await rename(tmp, backupPath(this.dir, name))
      await this.log(actor, 'backup_upload', name, `${received} bytes`)
      const s = await stat(backupPath(this.dir, name))
      return { name, sizeBytes: s.size, createdAt: s.mtime.toISOString(), scheduled: false }
    } catch (e) {
      await unlink(tmp).catch(() => {})
      if (tooLarge) throw new AppError('BACKUP_TOO_LARGE', 413, 'Backup file is too large')
      if (e instanceof AppError) throw e
      throw new AppError('BACKUP_INVALID', 400, `Upload failed: ${(e as Error).message}`)
    }
  }

  private async sweepStaleUploads(): Promise<void> {
    for (const n of await readdir(this.dir).catch(() => [] as string[])) {
      if (!n.startsWith(UPLOAD_PREFIX)) continue
      const s = await stat(join(this.dir, n)).catch(() => null)
      if (s && Date.now() - s.mtimeMs > UPLOAD_STALE_MS) await unlink(join(this.dir, n)).catch(() => {})
    }
  }

  async updateSchedule(actor: Viewer, s: BackupSchedule): Promise<ScheduleState> {
    const before = (await this.settings.backupSchedule()).schedule
    const changed = (Object.keys(s) as Array<keyof BackupSchedule>).filter((k) => s[k] !== before[k])
    // Unchanged → no write: saving would move updatedAt and could swallow a slot that is just due.
    if (changed.length === 0) return this.settings.backupSchedule()
    const next = await this.settings.updateBackupSchedule(s)
    await this.modLog.log(actor.id, 'update_setting', 'settings', 'backupSchedule', changed.map((k) => `${k}=${String(s[k])}`).join(', '))
    return next
  }
}

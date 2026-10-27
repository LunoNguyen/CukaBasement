import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { getConnectionToken } from '@nestjs/mongoose'
import type { Job } from 'agenda'
import { type Connection, Types } from 'mongoose'
import { AppModule } from '@cuka/api/app.module'
import { scheduleTick } from '@cuka/api/backup/backup-schedule'
import { maintenanceActive } from '@cuka/api/backup/backup-state'
import { FeedCache } from '@cuka/api/cache/feed-cache.service'
import { CONFIG, type Config } from '@cuka/api/config/config'
import { loadEnvFile } from '@cuka/api/config/env-file'
import type { AgendaJobs } from '@cuka/api/jobs/agenda-jobs'
import type { JobDeps } from '@cuka/api/jobs/handlers/media'
import { cleanupUploads } from '@cuka/api/jobs/handlers/cleanup-uploads'
import { notifyStaffReview, type NotifyStaffReviewData } from '@cuka/api/jobs/handlers/notify-staff-review'
import { processFile } from '@cuka/api/jobs/handlers/process-file'
import { purgeDeletedPosts } from '@cuka/api/jobs/handlers/purge-deleted-posts'
import { reconcileCounters } from '@cuka/api/jobs/handlers/reconcile-counters'
import { relocateFile, relocateVariants } from '@cuka/api/jobs/handlers/relocate-variants'
import { rewatermark } from '@cuka/api/jobs/handlers/rewatermark'
import { youtubeSync, type YouTubeSyncData } from '@cuka/api/jobs/handlers/youtube-sync'
import { JOBS } from '@cuka/api/jobs/jobs.port'
import { ModerationLogService } from '@cuka/api/moderation/moderation-log.service'
import { StorageService } from '@cuka/api/storage/storage.service'

const MAX_FAILS = 3
const logger = new Logger('Worker')

/** Thrown by a job that starts while a restore runs: retried later without counting as a failure. */
const PAUSED = 'paused: site is in maintenance (restore in progress)'

async function bootstrap(): Promise<void> {
  loadEnvFile()

  const app = await NestFactory.createApplicationContext(AppModule)
  const deps: JobDeps = {
    conn: app.get<Connection>(getConnectionToken()),
    storage: app.get(StorageService),
    config: app.get<Config>(CONFIG),
    // Variant jobs that change what list cards show invalidate the API's list cache (see bumpFeedIfListed).
    feed: app.get(FeedCache),
  }
  const jobs = app.get<AgendaJobs>(JOBS)
  const { agenda } = jobs

  // No job touches data while a restore swaps it out from under them.
  const unlessRestoring =
    <T>(fn: (job: Job<T>) => Promise<unknown>) =>
    async (job: Job<T>) => {
      if (await maintenanceActive(deps.conn.db!)) throw new Error(PAUSED)
      await fn(job)
    }
  agenda.define<{ fileId: string }>('process-file', unlessRestoring((job) => processFile(deps, job.attrs.data)), { concurrency: 2 })
  agenda.define<{ postId: string }>('relocate-variants', unlessRestoring((job) => relocateVariants(deps, job.attrs.data)), { concurrency: 2 })
  agenda.define<{ fileId: string }>('relocate-file', unlessRestoring((job) => relocateFile(deps, job.attrs.data)), { concurrency: 2 })
  agenda.define<{ postId: string }>('rewatermark', unlessRestoring((job) => rewatermark(deps, job.attrs.data)), { concurrency: 2 })
  agenda.define<NotifyStaffReviewData>('notify-staff-review', unlessRestoring(async (job) => void (await notifyStaffReview(deps, job.attrs.data))), {
    concurrency: 2,
  })
  agenda.define('cleanup-uploads', unlessRestoring(async () => void (await cleanupUploads({ ...deps, jobs }))), { concurrency: 1 })
  agenda.define('purge-deleted-posts', unlessRestoring(async () => void (await purgeDeletedPosts(deps))), { concurrency: 1 })
  agenda.define('reconcile-counters', unlessRestoring(async () => void (await reconcileCounters(deps))), { concurrency: 1 })
  // The music section's YouTube data (feeds, titles, thumbnails); failures are recorded per feed, never thrown.
  agenda.define<YouTubeSyncData>('youtube-sync', unlessRestoring(async (job) => void (await youtubeSync(deps, job.attrs.data ?? {}))), { concurrency: 1 })

  // Scheduled backups: the tick only decides whether a slot is due (cheap) and starts the backup without
  // waiting for it, so a long backup never holds the Agenda job past its lock lifetime. The slot claim and the
  // global backup lock in MongoDB keep several workers from running it twice.
  const modLog = app.get(ModerationLogService)
  agenda.define(
    'backup-schedule-tick',
    async () => {
      void scheduleTick(deps, new Date(), async (r) => {
        const note = [r.outcome, r.error, r.pruned?.length ? `pruned ${r.pruned.length}` : ''].filter(Boolean).join(': ')
        if (r.outcome === 'failed') logger.error(`scheduled backup failed: ${r.error}`)
        await modLog.log('system', 'backup_scheduled', 'backup', r.name ?? '-', note.slice(0, 500))
      }).catch((e: Error) => logger.error(`backup schedule tick failed: ${e.message}`))
    },
    { concurrency: 1 },
  )

  // Runs synchronously before Agenda persists the job state, so the new nextRunAt is saved with it.
  agenda.on('fail', (err: Error, job: Job) => {
    if (err.message === PAUSED) {
      job.attrs.failCount = Math.max(0, (job.attrs.failCount ?? 1) - 1)
      job.schedule('in 1 minute')
      return
    }
    const fails = job.attrs.failCount ?? 0
    logger.warn(`${job.attrs.name} failed (${fails}/${MAX_FAILS}): ${err.message}`)
    if (fails < MAX_FAILS) {
      job.schedule('in 1 minute')
      return
    }
    if (job.attrs.name === 'process-file') {
      const { fileId } = job.attrs.data as { fileId: string }
      if (!Types.ObjectId.isValid(fileId)) return
      deps.conn
        .collection('files')
        .updateOne({ _id: new Types.ObjectId(fileId) }, { $set: { status: 'failed' } })
        .catch((e: Error) => logger.error(`Could not mark file ${fileId} failed: ${e.message}`))
    }
  })

  const shutdown = async () => {
    await agenda.stop()
    await app.close()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())

  await agenda.start()
  // Cron times are server local time.
  await agenda.every('1 hour', 'cleanup-uploads')
  await agenda.every('1 hour', 'youtube-sync', {})
  await agenda.every('0 3 * * *', 'purge-deleted-posts')
  await agenda.every('30 3 * * *', 'reconcile-counters')
  await agenda.every('1 minute', 'backup-schedule-tick')
  logger.log('worker ready')
}

void bootstrap()

import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { getConnectionToken } from '@nestjs/mongoose'
import type { Job } from 'agenda'
import { type Connection, Types } from 'mongoose'
import { AppModule } from '@cuka/api/app.module'
import { CONFIG, type Config } from '@cuka/api/config/config'
import { loadEnvFile } from '@cuka/api/config/env-file'
import type { AgendaJobs } from '@cuka/api/jobs/agenda-jobs'
import type { JobDeps } from '@cuka/api/jobs/handlers/media'
import { cleanupUploads } from '@cuka/api/jobs/handlers/cleanup-uploads'
import { processFile } from '@cuka/api/jobs/handlers/process-file'
import { purgeDeletedPosts } from '@cuka/api/jobs/handlers/purge-deleted-posts'
import { reconcileCounters } from '@cuka/api/jobs/handlers/reconcile-counters'
import { relocateFile, relocateVariants } from '@cuka/api/jobs/handlers/relocate-variants'
import { rewatermark } from '@cuka/api/jobs/handlers/rewatermark'
import { JOBS } from '@cuka/api/jobs/jobs.port'
import { StorageService } from '@cuka/api/storage/storage.service'

const MAX_FAILS = 3
const logger = new Logger('Worker')

async function bootstrap(): Promise<void> {
  loadEnvFile()

  const app = await NestFactory.createApplicationContext(AppModule)
  const deps: JobDeps = {
    conn: app.get<Connection>(getConnectionToken()),
    storage: app.get(StorageService),
    config: app.get<Config>(CONFIG),
  }
  const jobs = app.get<AgendaJobs>(JOBS)
  const { agenda } = jobs

  agenda.define<{ fileId: string }>('process-file', (job) => processFile(deps, job.attrs.data), { concurrency: 2 })
  agenda.define<{ postId: string }>('relocate-variants', (job) => relocateVariants(deps, job.attrs.data), { concurrency: 2 })
  agenda.define<{ fileId: string }>('relocate-file', (job) => relocateFile(deps, job.attrs.data), { concurrency: 2 })
  agenda.define<{ postId: string }>('rewatermark', (job) => rewatermark(deps, job.attrs.data), { concurrency: 2 })
  agenda.define('cleanup-uploads', async () => void (await cleanupUploads({ ...deps, jobs })), { concurrency: 1 })
  agenda.define('purge-deleted-posts', async () => void (await purgeDeletedPosts(deps)), { concurrency: 1 })
  agenda.define('reconcile-counters', async () => void (await reconcileCounters(deps)), { concurrency: 1 })

  // Runs synchronously before Agenda persists the job state, so the new nextRunAt is saved with it.
  agenda.on('fail', (err: Error, job: Job) => {
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
  await agenda.every('0 3 * * *', 'purge-deleted-posts')
  await agenda.every('30 3 * * *', 'reconcile-counters')
  logger.log('worker ready')
}

void bootstrap()

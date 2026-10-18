import type { BackupPhase, BackupRunKind } from '@cuka/shared'
import type { Db } from 'mongodb'
import type { Types } from 'mongoose'
import { AppError } from '../common/app-error'
import { acquireLock, type BackupTrigger, HEARTBEAT_MS, heartbeat, newRunId, releaseLock, type RunDoc, runs, setMaintenance } from './backup-state'

export interface RunContext {
  runId: Types.ObjectId
  /** Throttled; also proves the run still holds the lock (throws once it was lost). */
  progress(phase: BackupPhase, done: number, total: number): void
  /** Restores only: switches maintenance mode on for the rest of the run. */
  enterMaintenance(): Promise<void>
  /** Throws when the lock was lost, so a run that went stale never keeps writing. */
  assertLock(): void
}

export interface StartedRun<T> {
  runId: Types.ObjectId
  /** Settles when the run finishes; never rejects with anything but the run's own error. */
  done: Promise<T>
}

/**
 * Takes the global backup lock, records a run and runs `fn` with a heartbeat. Throws BACKUP_BUSY (without
 * recording anything) when another backup or restore holds the lock. The lock is released however `fn` ends.
 */
export async function startExclusive<T>(
  db: Db,
  meta: { kind: BackupRunKind; trigger: BackupTrigger; file: string; actorId: string | null },
  fn: (ctx: RunContext) => Promise<T>,
): Promise<StartedRun<T>> {
  const runId = newRunId()
  if (!(await acquireLock(db, runId, meta.kind))) throw new AppError('BACKUP_BUSY', 409, 'Another backup or restore is running')
  const doc: RunDoc = { _id: runId, ...meta, status: 'running', startedAt: new Date(), finishedAt: null, error: null, progress: null }
  try {
    await runs(db).insertOne(doc)
  } catch (e) {
    await releaseLock(db, runId)
    throw e
  }

  let lost = false
  let latest: RunDoc['progress'] = null
  let written: RunDoc['progress'] = null
  const beat = async () => {
    if (!(await heartbeat(db, runId))) lost = true
    if (latest !== written) {
      written = latest
      await runs(db).updateOne({ _id: runId }, { $set: { progress: latest } })
    }
  }
  const timer = setInterval(() => void beat().catch(() => {}), HEARTBEAT_MS)
  timer.unref?.()

  const ctx: RunContext = {
    runId,
    progress(phase, done, total) {
      ctx.assertLock()
      latest = { phase, done, total }
    },
    async enterMaintenance() {
      ctx.assertLock()
      await setMaintenance(db, runId, true)
    },
    assertLock() {
      if (lost) throw new Error('Lost the backup lock (heartbeat went stale)')
    },
  }

  const done = (async () => {
    try {
      const result = await fn(ctx)
      await runs(db).updateOne({ _id: runId }, { $set: { status: 'succeeded', finishedAt: new Date(), progress: latest } })
      return result
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await runs(db)
        .updateOne({ _id: runId }, { $set: { status: 'failed', finishedAt: new Date(), error: message.slice(0, 2000), progress: latest } })
        .catch(() => {})
      throw e
    } finally {
      clearInterval(timer)
      await releaseLock(db, runId).catch(() => {})
    }
  })()
  return { runId, done }
}

import type { BackupPhase, BackupRunKind, BackupRunStatus } from '@cuka/shared'
import type { Db } from 'mongodb'
import { Types } from 'mongoose'

/**
 * Coordination state for backups and restores, shared by the API, the worker and the CLI through MongoDB.
 * These collections are never backed up and survive a restore (see EXCLUDED_COLLECTIONS).
 */
export const LOCK_COLLECTION = 'backupLock'
export const RUNS_COLLECTION = 'backupRuns'
export const DOWNLOADS_COLLECTION = 'backupDownloads'

/** A holder that stops heartbeating (crash, kill) loses the lock, and with it maintenance mode, after this long. */
export const LOCK_STALE_MS = 60_000
/** Also how often a run's progress is written. */
export const HEARTBEAT_MS = 2000

export type BackupTrigger = 'manual' | 'schedule' | 'cli' | 'upload'

export interface LockDoc {
  _id: 'global'
  runId: Types.ObjectId | null
  kind: BackupRunKind | null
  /** Set by a restore once its archive is verified, cleared on release: non-admin API requests get 503 meanwhile. */
  maintenance: boolean
  heartbeatAt: Date
}

export interface RunDoc {
  _id: Types.ObjectId
  kind: BackupRunKind
  trigger: BackupTrigger
  status: BackupRunStatus
  /** Archive name (inside BACKUP_DIR) or, for a CLI restore, the path given. */
  file: string
  actorId: string | null
  startedAt: Date
  finishedAt: Date | null
  error: string | null
  progress: { phase: BackupPhase; done: number; total: number } | null
}

const locks = (db: Db) => db.collection<LockDoc>(LOCK_COLLECTION)
export const runs = (db: Db) => db.collection<RunDoc>(RUNS_COLLECTION)

function isDuplicateKey(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 11000
}

/**
 * Takes the single global lock for `runId`. Fails when another live holder has it; a holder whose heartbeat is
 * older than LOCK_STALE_MS is taken over. The upsert on a non-matching filter collides on `_id`, which is what
 * makes two concurrent callers safe.
 */
export async function acquireLock(db: Db, runId: Types.ObjectId, kind: BackupRunKind): Promise<boolean> {
  try {
    await locks(db).updateOne(
      { _id: 'global', $or: [{ runId: null }, { heartbeatAt: { $lt: new Date(Date.now() - LOCK_STALE_MS) } }] },
      { $set: { runId, kind, maintenance: false, heartbeatAt: new Date() } },
      { upsert: true },
    )
    return true
  } catch (e) {
    if (isDuplicateKey(e)) return false
    throw e
  }
}

/** Refreshes the heartbeat; false means this run no longer holds the lock (it went stale and was taken over). */
export async function heartbeat(db: Db, runId: Types.ObjectId): Promise<boolean> {
  const r = await locks(db).updateOne({ _id: 'global', runId }, { $set: { heartbeatAt: new Date() } })
  return r.matchedCount === 1
}

export async function setMaintenance(db: Db, runId: Types.ObjectId, on: boolean): Promise<void> {
  await locks(db).updateOne({ _id: 'global', runId }, { $set: { maintenance: on, heartbeatAt: new Date() } })
}

export async function releaseLock(db: Db, runId: Types.ObjectId): Promise<void> {
  await locks(db).updateOne({ _id: 'global', runId }, { $set: { runId: null, kind: null, maintenance: false } })
}

/** The live lock, or null when free or stale. */
export async function currentLock(db: Db): Promise<LockDoc | null> {
  const doc = await locks(db).findOne({ _id: 'global' })
  if (!doc?.runId || doc.heartbeatAt.getTime() < Date.now() - LOCK_STALE_MS) return null
  return doc
}

export async function maintenanceActive(db: Db): Promise<boolean> {
  return (await currentLock(db))?.maintenance === true
}

/** Runs still marked running whose lock is gone (the process died) are closed as failed. */
export async function closeOrphanedRuns(db: Db): Promise<void> {
  const lock = await currentLock(db)
  await runs(db).updateMany(
    { status: 'running', ...(lock?.runId ? { _id: { $ne: lock.runId } } : {}) },
    { $set: { status: 'failed', error: 'Interrupted (the process running it stopped)', finishedAt: new Date() } },
  )
}

export function newRunId(): Types.ObjectId {
  return new Types.ObjectId()
}

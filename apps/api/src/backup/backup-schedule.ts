import { type BackupSchedule, type BackupScheduleOutcome, backupScheduleSchema, DEFAULT_BACKUP_SCHEDULE } from '@cuka/shared'
import type { Db } from 'mongodb'
import { AppError } from '../common/app-error'
import { type BackupDeps, createBackup, newBackupName, pruneScheduledBackups, SCHEDULE_DOC_ID } from './backup-archive'
import { startExclusive } from './backup-runner'

/** Stored in the `settings` collection next to the global settings document. */
export interface ScheduleDoc extends BackupSchedule {
  _id: typeof SCHEDULE_DOC_ID
  /** Last change by an admin: slots at or before it never fire (changing the time does not trigger a run). */
  updatedAt: Date
  /** Latest slot claimed by a worker: each slot fires at most once, however many workers tick. */
  lastSlotAt: Date | null
  lastRun: { at: Date; slotAt: Date; outcome: BackupScheduleOutcome; name: string | null; error: string | null } | null
}

export interface ScheduleState {
  schedule: BackupSchedule
  timeZone: string
  nextRunAt: string | null
  lastRun: { at: string; outcome: BackupScheduleOutcome; name: string | null; error: string | null } | null
}

const col = (db: Db) => db.collection<ScheduleDoc>('settings')

/** Offset of `tz` from UTC at instant `t`, in ms (positive east of Greenwich). */
function tzOffset(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t))
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(t / 1000) * 1000
}

/** The instant the wall-clock time y-m-d hh:mm happens in `tz` (for a DST gap, the moment just after it). */
function zonedInstant(y: number, m: number, d: number, hh: number, mm: number, tz: string): number {
  const guess = Date.UTC(y, m, d, hh, mm)
  let t = guess - tzOffset(guess, tz)
  t = guess - tzOffset(t, tz)
  return t
}

/** The calendar date (in `tz`) of instant `t`, shifted by `days`. */
function zonedDate(t: number, tz: string, days: number): { y: number; m: number; d: number; weekday: number } {
  const local = new Date(t + tzOffset(t, tz))
  const shifted = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days))
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate(), weekday: shifted.getUTCDay() }
}

function slotsAround(s: BackupSchedule, now: Date, tz: string, from: number, to: number): number[] {
  const [hh, mm] = s.time.split(':').map(Number) as [number, number]
  const out: number[] = []
  for (let days = from; days <= to; days++) {
    const day = zonedDate(now.getTime(), tz, days)
    if (s.frequency === 'weekly' && day.weekday !== s.weekday) continue
    out.push(zonedInstant(day.y, day.m, day.d, hh, mm, tz))
  }
  return out
}

/** The latest scheduled instant at or before `now`. */
export function previousSlot(s: BackupSchedule, now: Date, tz: string): Date | null {
  const past = slotsAround(s, now, tz, -8, 1).filter((t) => t <= now.getTime())
  return past.length ? new Date(Math.max(...past)) : null
}

/** The first scheduled instant after `now`. */
export function nextSlot(s: BackupSchedule, now: Date, tz: string): Date | null {
  const future = slotsAround(s, now, tz, -1, 8).filter((t) => t > now.getTime())
  return future.length ? new Date(Math.min(...future)) : null
}

function pick(doc: Partial<BackupSchedule> | null): BackupSchedule {
  // The schema strips the bookkeeping fields (_id, updatedAt, ...).
  const parsed = backupScheduleSchema.safeParse({ ...DEFAULT_BACKUP_SCHEDULE, ...doc })
  return parsed.success ? parsed.data : DEFAULT_BACKUP_SCHEDULE
}

export async function readSchedule(db: Db, tz: string, now = new Date()): Promise<ScheduleState> {
  const doc = await col(db).findOne({ _id: SCHEDULE_DOC_ID })
  const schedule = pick(doc)
  const next = schedule.enabled ? nextSlot(schedule, now, tz) : null
  const r = doc?.lastRun
  return {
    schedule,
    timeZone: tz,
    nextRunAt: next ? next.toISOString() : null,
    lastRun: r ? { at: r.at.toISOString(), outcome: r.outcome, name: r.name, error: r.error } : null,
  }
}

export async function writeSchedule(db: Db, s: BackupSchedule, now = new Date()): Promise<void> {
  const value = backupScheduleSchema.parse(s)
  await col(db).updateOne({ _id: SCHEDULE_DOC_ID }, { $set: { ...value, updatedAt: now }, $setOnInsert: { lastSlotAt: null, lastRun: null } }, { upsert: true })
}

export interface TickResult {
  outcome: BackupScheduleOutcome | 'not_due'
  name?: string
  error?: string
  pruned?: string[]
}

/**
 * Called every minute by the worker. Fires when a slot has passed that is newer than both the last claimed slot
 * and the last admin change; a slot missed while the worker was down fires once on its return (no backlog).
 * The slot is claimed with a compare-and-set, so several workers cannot fire it twice; the backup itself also
 * takes the global backup lock, and a slot that finds a backup or restore already running is recorded as skipped.
 * `onFinish` runs after the backup ends (logging); the returned promise waits for it too.
 */
export async function scheduleTick(deps: BackupDeps, now = new Date(), onFinish: (r: TickResult) => Promise<void> = async () => {}): Promise<TickResult> {
  const db = deps.conn.db!
  const doc = await col(db).findOne({ _id: SCHEDULE_DOC_ID })
  if (!doc) return { outcome: 'not_due' }
  const schedule = pick(doc)
  if (!schedule.enabled) return { outcome: 'not_due' }
  const slot = previousSlot(schedule, now, deps.config.backup.tz)
  if (!slot || slot <= doc.updatedAt || (doc.lastSlotAt && slot <= doc.lastSlotAt)) return { outcome: 'not_due' }
  const claimed = await col(db).updateOne(
    { _id: SCHEDULE_DOC_ID, updatedAt: { $lt: slot }, $or: [{ lastSlotAt: null }, { lastSlotAt: { $lt: slot } }] },
    { $set: { lastSlotAt: slot } },
  )
  if (claimed.modifiedCount !== 1) return { outcome: 'not_due' }

  const record = async (r: TickResult) => {
    await col(db).updateOne(
      { _id: SCHEDULE_DOC_ID },
      { $set: { lastRun: { at: new Date(), slotAt: slot, outcome: r.outcome as BackupScheduleOutcome, name: r.name ?? null, error: r.error ?? null } } },
    )
    await onFinish(r)
    return r
  }

  const name = newBackupName('schedule', now)
  let started
  try {
    // Pruning happens inside the locked run, so it can never delete an archive a restore is reading.
    started = await startExclusive(db, { kind: 'backup', trigger: 'schedule', file: name, actorId: null }, async (ctx) => {
      await createBackup(deps, name, ctx.progress)
      return pruneScheduledBackups(deps.config.backup.dir, schedule.keep)
    })
  } catch (e) {
    if (e instanceof AppError && e.code === 'BACKUP_BUSY') return record({ outcome: 'skipped', error: 'Another backup or restore was running' })
    return record({ outcome: 'failed', error: (e as Error).message })
  }
  let pruned: string[]
  try {
    pruned = await started.done
  } catch (e) {
    return record({ outcome: 'failed', name, error: (e as Error).message })
  }
  return record({ outcome: 'succeeded', name, pruned })
}

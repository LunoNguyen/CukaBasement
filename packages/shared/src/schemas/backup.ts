import { z } from 'zod'

/**
 * Backup file names the API accepts: letters, digits, `_` and `-`, then `.tar.gz`. No dots, slashes or
 * backslashes, so a name can never leave the backup folder (`..`, absolute paths, drive letters).
 */
export const BACKUP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}\.tar\.gz$/

/** Scheduled backups carry this prefix; retention only ever deletes files named like this. */
export const SCHEDULED_BACKUP_PREFIX = 'cuka-backup-sched-'

export const backupNameSchema = z.string().regex(BACKUP_NAME_RE, 'Invalid backup name')

/** What an admin types to confirm a restore from the admin page (the site name). */
export const BACKUP_RESTORE_CONFIRM = 'CukaBasement'

export const restoreBackupSchema = z.object({ confirm: z.literal(BACKUP_RESTORE_CONFIRM) })

export const BACKUP_RUN_KINDS = ['backup', 'restore'] as const
export type BackupRunKind = (typeof BACKUP_RUN_KINDS)[number]

export const BACKUP_RUN_STATUSES = ['running', 'succeeded', 'failed'] as const
export type BackupRunStatus = (typeof BACKUP_RUN_STATUSES)[number]

export const BACKUP_PHASES = ['verify', 'database', 'files', 'finalize'] as const
export type BackupPhase = (typeof BACKUP_PHASES)[number]

export const BACKUP_FREQUENCIES = ['daily', 'weekly'] as const
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number]

export const BACKUP_KEEP_MAX = 100

/** Admin-editable schedule. `time` is `HH:MM` in the server's BACKUP_TZ; `weekday` 0 = Sunday (weekly only). */
export const backupScheduleSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(BACKUP_FREQUENCIES),
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM'),
  keep: z.number().int().min(1).max(BACKUP_KEEP_MAX),
})
export type BackupSchedule = z.infer<typeof backupScheduleSchema>

export const DEFAULT_BACKUP_SCHEDULE: BackupSchedule = { enabled: false, frequency: 'daily', weekday: 0, time: '03:00', keep: 7 }

export const BACKUP_SCHEDULE_OUTCOMES = ['succeeded', 'failed', 'skipped'] as const
export type BackupScheduleOutcome = (typeof BACKUP_SCHEDULE_OUTCOMES)[number]

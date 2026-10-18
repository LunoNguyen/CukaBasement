import { describe, expect, it } from 'vitest'
import {
  BACKUP_RESTORE_CONFIRM,
  backupNameSchema,
  backupScheduleSchema,
  DEFAULT_BACKUP_SCHEDULE,
  ERROR_CODES,
  MOD_ACTIONS,
  restoreBackupSchema,
} from '../src'

describe('backup schemas', () => {
  it('accepts plain backup names and rejects anything that could leave the folder', () => {
    for (const ok of ['cuka-backup-20260101-030000-ab12.tar.gz', 'my_backup.tar.gz', 'A.tar.gz']) {
      expect(backupNameSchema.safeParse(ok).success, ok).toBe(true)
    }
    for (const bad of [
      '../x.tar.gz',
      '..\\x.tar.gz',
      '/etc/passwd',
      'C:evil.tar.gz',
      'a/b.tar.gz',
      'a.b.tar.gz',
      '.hidden.tar.gz',
      'x.tar.gz\0',
      'x.zip',
      '-x.tar.gz',
      `${'a'.repeat(121)}.tar.gz`,
      '',
    ]) {
      expect(backupNameSchema.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('restore needs the exact confirmation text', () => {
    expect(restoreBackupSchema.safeParse({ confirm: BACKUP_RESTORE_CONFIRM }).success).toBe(true)
    expect(restoreBackupSchema.safeParse({ confirm: 'cukabasement' }).success).toBe(false)
    expect(restoreBackupSchema.safeParse({}).success).toBe(false)
  })

  it('validates the schedule', () => {
    expect(backupScheduleSchema.parse(DEFAULT_BACKUP_SCHEDULE)).toEqual(DEFAULT_BACKUP_SCHEDULE)
    expect(DEFAULT_BACKUP_SCHEDULE.enabled).toBe(false)
    expect(DEFAULT_BACKUP_SCHEDULE.keep).toBe(7)
    const ok = { enabled: true, frequency: 'weekly', weekday: 6, time: '23:59', keep: 1 }
    expect(backupScheduleSchema.safeParse(ok).success).toBe(true)
    for (const patch of [
      { time: '24:00' },
      { time: '3:00' },
      { time: '03:60' },
      { weekday: 7 },
      { weekday: -1 },
      { weekday: 1.5 },
      { keep: 0 },
      { keep: 101 },
      { frequency: 'hourly' },
      { enabled: 'yes' },
    ]) {
      expect(backupScheduleSchema.safeParse({ ...ok, ...patch }).success, JSON.stringify(patch)).toBe(false)
    }
  })

  it('exposes the backup error codes and log actions', () => {
    for (const c of ['MAINTENANCE', 'BACKUP_BUSY', 'BACKUP_NOT_FOUND', 'BACKUP_INVALID', 'BACKUP_TOO_LARGE']) expect(ERROR_CODES).toContain(c)
    for (const a of ['backup_create', 'backup_scheduled', 'backup_restore', 'backup_delete', 'backup_upload', 'backup_download']) expect(MOD_ACTIONS).toContain(a)
  })
})

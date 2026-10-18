import { Inject, Injectable } from '@nestjs/common'
import { getConnectionToken } from '@nestjs/mongoose'
import { type BackupSchedule, DEFAULT_SETTINGS, type GlobalSettings } from '@cuka/shared'
import type { Connection } from 'mongoose'
import { readSchedule, type ScheduleState, writeSchedule } from '../backup/backup-schedule'
import { CONFIG, type Config } from '../config/config'

const CACHE_MS = 30_000

@Injectable()
export class SettingsService {
  private cache?: { value: GlobalSettings; at: number }

  constructor(
    @Inject(getConnectionToken()) private readonly conn: Connection,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  private col() {
    // `_id` is the string 'global', so the default ObjectId-typed collection does not fit.
    return this.conn.collection<any>('settings')
  }

  clearCache(): void {
    this.cache = undefined
  }

  async get(): Promise<GlobalSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value
    const doc = await this.col().findOne({ _id: 'global' })
    const value = { ...DEFAULT_SETTINGS } as GlobalSettings
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof GlobalSettings>) {
      const v = doc?.[key]
      if (typeof v === 'number') value[key] = v
    }
    this.cache = { value, at: Date.now() }
    return value
  }

  async update(patch: Partial<GlobalSettings>): Promise<GlobalSettings> {
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    if (Object.keys(set).length > 0) {
      await this.col().updateOne({ _id: 'global' }, { $set: set }, { upsert: true })
    }
    this.cache = undefined
    return this.get()
  }

  /** The backup schedule: a separate `backupSchedule` document in the same collection (read by the worker each minute). */
  backupSchedule(): Promise<ScheduleState> {
    return readSchedule(this.conn.db!, this.config.backup.tz)
  }

  async updateBackupSchedule(s: BackupSchedule): Promise<ScheduleState> {
    await writeSchedule(this.conn.db!, s)
    return this.backupSchedule()
  }
}

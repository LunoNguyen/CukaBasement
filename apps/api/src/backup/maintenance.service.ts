import { Global, Inject, Injectable, Module } from '@nestjs/common'
import { getConnectionToken } from '@nestjs/mongoose'
import type { Connection } from 'mongoose'
import { maintenanceActive } from './backup-state'

const CACHE_MS = 1000

/**
 * Whether a restore is in progress (from this process or another: the CLI, a second API). While it is, the
 * AuthGuard answers 503 MAINTENANCE to everyone but admins, except for the routes in MAINTENANCE_OPEN_PATHS.
 */
@Injectable()
export class MaintenanceService {
  private cache?: { value: boolean; at: number }
  private local = false

  constructor(@Inject(getConnectionToken()) private readonly conn: Connection) {}

  /** Set by a restore running in this process, so maintenance applies without waiting for the cache. */
  setLocal(on: boolean): void {
    this.local = on
    this.cache = undefined
  }

  clearCache(): void {
    this.cache = undefined
  }

  async active(): Promise<boolean> {
    if (this.local) return true
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value
    let value = false
    try {
      value = await maintenanceActive(this.conn.db!)
    } catch {
      // The database being unreachable is not maintenance; the request fails on its own.
    }
    this.cache = { value, at: Date.now() }
    return value
  }
}

/** Reachable during maintenance by anyone: health (the web polls it), signing in, and one-time backup downloads. */
export const MAINTENANCE_OPEN_PATHS = /^\/api\/(health|auth\/(login|refresh|logout)|admin\/backups\/download\/[^/]+)\/?$/

@Global()
@Module({ providers: [MaintenanceService], exports: [MaintenanceService] })
export class MaintenanceModule {}

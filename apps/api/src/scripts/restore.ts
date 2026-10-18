import 'reflect-metadata'
import { getConnectionToken } from '@nestjs/mongoose'
import type mongoose from 'mongoose'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { BACKUP_NAME_RE } from '@cuka/shared'
import { createAppContext } from '../app.module'
import { applyArchive, checkTarget, verifyArchive, type Verified } from '../backup/backup-archive'
import { startExclusive } from '../backup/backup-runner'
import { FeedCache } from '../cache/feed-cache.service'
import { type Config, loadConfig } from '../config/config'
import { loadEnvFile } from '../config/env-file'
import { ModerationLogService } from '../moderation/moderation-log.service'
import { StorageService } from '../storage/storage.service'
import { formatBytes } from './backup'

export interface RestoreCliOptions {
  forceDb?: boolean
  allowNoAdmin?: boolean
  /** Asked after verification, before anything changes; resolve false to cancel. */
  confirm: (summary: string) => Promise<boolean>
}

/** A bare backup name is looked up in BACKUP_DIR; anything else is a path relative to where npm was run. */
export function resolveArchive(cfg: Config, arg: string): string {
  if (BACKUP_NAME_RE.test(arg) && existsSync(join(cfg.backup.dir, arg))) return join(cfg.backup.dir, arg)
  return resolve(process.env.INIT_CWD ?? process.cwd(), arg)
}

function summarize(v: Verified): string {
  const m = v.manifest
  const docs = m.collections.reduce((n, c) => n + c.count, 0)
  const bytes = m.objects.reduce((n, o) => n + o.size, 0)
  return [
    `backup of "${m.dbName}" taken ${m.createdAt} (app ${m.appVersion})`,
    `${m.collections.length} collections, ${docs} documents; ${m.objects.length} files, ${formatBytes(bytes)}`,
    `${v.activeAdmins} active admin account(s)`,
  ].join('\n')
}

/**
 * `npm run restore -- <file> [--yes] [--force-db]`: verifies the whole archive (format, names, checksums) before
 * touching anything, asks, then replaces the database and both buckets. Returns false when cancelled.
 */
export async function runRestoreCli(cfg: Config, file: string, opts: RestoreCliOptions, log: (line: string) => void = () => {}): Promise<boolean> {
  if (!existsSync(file)) throw new Error(`No such file: ${file}`)
  const app = await createAppContext(cfg)
  try {
    const conn = app.get<mongoose.Connection>(getConnectionToken())
    const deps = { conn, storage: app.get(StorageService), config: cfg, feed: app.get(FeedCache) }
    let lastPhase = ''
    const started = await startExclusive(conn.db!, { kind: 'restore', trigger: 'cli', file, actorId: null }, async (ctx) => {
      const progress = (phase: Parameters<typeof ctx.progress>[0], done: number, total: number) => {
        ctx.progress(phase, done, total)
        if (phase !== lastPhase) log(`${phase}…`)
        lastPhase = phase
      }
      const verified = await verifyArchive(file, progress)
      checkTarget(deps, verified, opts)
      if (verified.activeAdmins === 0) log('warning: the backup has no active admin; use `npm run create-admin` afterwards')
      if (!(await opts.confirm(summarize(verified)))) return false
      await ctx.enterMaintenance()
      await applyArchive(deps, file, verified, progress, log)
      await deps.feed.bump().catch(() => {})
      await app.get(ModerationLogService).log('system', 'backup_restore', 'backup', file.slice(-200), 'cli')
      return true
    })
    return await started.done
  } finally {
    await app.close()
  }
}

if (require.main === module) {
  loadEnvFile()
  const args = process.argv.slice(2)
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  const positional = args.filter((a) => !a.startsWith('--'))
  const unknown = [...flags].filter((f) => !['--yes', '--force-db', '--allow-no-admin'].includes(f))
  if (positional.length !== 1 || unknown.length) {
    console.error('Usage: npm run restore -- <backup file> [--yes] [--force-db] [--allow-no-admin]')
    process.exit(1)
  }
  const cfg = loadConfig(process.env)
  const file = resolveArchive(cfg, positional[0]!)
  const confirm = async (summary: string) => {
    console.log(summary)
    console.log('This REPLACES the whole database and all stored files. Everyone will have to log in again.')
    if (flags.has('--yes')) return true
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      return (await rl.question('Type "yes" to restore: ')).trim().toLowerCase() === 'yes'
    } finally {
      rl.close()
    }
  }
  runRestoreCli(cfg, file, { forceDb: flags.has('--force-db'), allowNoAdmin: flags.has('--allow-no-admin'), confirm }, (l) => console.log(l))
    .then((done) => console.log(done ? 'restore complete; everyone must log in again' : 'cancelled, nothing changed'))
    .catch((err: Error) => {
      console.error(`restore failed: ${err.message}`)
      process.exit(1)
    })
}

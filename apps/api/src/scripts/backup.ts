import 'reflect-metadata'
import { getConnectionToken } from '@nestjs/mongoose'
import type mongoose from 'mongoose'
import { createAppContext } from '../app.module'
import { createBackup, newBackupName } from '../backup/backup-archive'
import { startExclusive } from '../backup/backup-runner'
import { FeedCache } from '../cache/feed-cache.service'
import { type Config, loadConfig } from '../config/config'
import { loadEnvFile } from '../config/env-file'
import { StorageService } from '../storage/storage.service'

/** `npm run backup`: writes a new archive into BACKUP_DIR (waiting for no other backup or restore). */
export async function runBackupCli(cfg: Config, log: (line: string) => void = () => {}): Promise<{ path: string; sizeBytes: number }> {
  const app = await createAppContext(cfg)
  try {
    const conn = app.get<mongoose.Connection>(getConnectionToken())
    const deps = { conn, storage: app.get(StorageService), config: cfg, feed: app.get(FeedCache) }
    const name = newBackupName('manual')
    let lastPhase = ''
    const started = await startExclusive(conn.db!, { kind: 'backup', trigger: 'cli', file: name, actorId: null }, (ctx) =>
      createBackup(deps, name, (phase, done, total) => {
        ctx.progress(phase, done, total)
        if (phase !== lastPhase) log(`${phase}…`)
        lastPhase = phase
      }),
    )
    const r = await started.done
    return { path: `${cfg.backup.dir}/${r.name}`, sizeBytes: r.sizeBytes }
  } finally {
    await app.close()
  }
}

export function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`
}

if (require.main === module) {
  loadEnvFile()
  runBackupCli(loadConfig(process.env), (l) => console.log(l))
    .then((r) => console.log(`backup written: ${r.path} (${formatBytes(r.sizeBytes)})`))
    .catch((err: Error) => {
      console.error(`backup failed: ${err.message}`)
      process.exit(1)
    })
}

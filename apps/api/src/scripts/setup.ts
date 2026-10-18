import 'reflect-metadata'
import { DEFAULT_SETTINGS } from '@cuka/shared'
import { Client } from 'minio'
import { getConnectionToken } from '@nestjs/mongoose'
import type mongoose from 'mongoose'
import { createAppContext } from '../app.module'
import { type Config, loadConfig } from '../config/config'
import { loadEnvFile } from '../config/env-file'
import { ensureIndexes } from '../database/indexes'
import { migrateLegacyLinks } from '../users/social-links'

async function ensureBucket(client: Client, bucket: string): Promise<boolean> {
  if (await client.bucketExists(bucket)) return false
  await client.makeBucket(bucket)
  return true
}

export async function runSetup(cfg: Config, log: (line: string) => void = () => {}): Promise<void> {
  const app = await createAppContext(cfg)
  try {
    const conn = app.get<mongoose.Connection>(getConnectionToken())
    await ensureIndexes(conn)
    log(`indexes: synced ${Object.keys(conn.models).length} models`)
    const res = await conn
      .collection<any>('settings')
      .updateOne({ _id: 'global' }, { $setOnInsert: { ...DEFAULT_SETTINGS } }, { upsert: true })
    log(`settings: ${res.upsertedCount ? 'created with defaults' : 'kept existing'}`)
    log(`profile links: migrated ${await migrateLegacyLinks(conn)} legacy profiles`)
  } finally {
    await app.close()
  }

  const m = cfg.minio
  const client = new Client({ endPoint: m.endPoint, port: m.port, useSSL: m.useSSL, accessKey: m.accessKey, secretKey: m.secretKey })
  for (const bucket of [m.bucketOriginals, m.bucketPublic]) {
    log(`bucket ${bucket}: ${(await ensureBucket(client, bucket)) ? 'created' : 'exists'}`)
  }
  await client.setBucketPolicy(
    m.bucketPublic,
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${m.bucketPublic}/*`],
        },
      ],
    }),
  )
  log(`bucket ${m.bucketPublic}: anonymous read-only policy set`)
}

if (require.main === module) {
  loadEnvFile()
  runSetup(loadConfig(process.env), (l) => console.log(l))
    .then(() => console.log('setup complete'))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}

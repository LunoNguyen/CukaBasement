import { DEFAULT_SETTINGS } from '@cuka/shared'
import type { Client } from 'minio'
import type mongoose from 'mongoose'
import type { Config } from '../config/config'
import { ensureSitePages } from '../site/home-seed'
import { migrateLegacyLinks } from '../users/social-links'
import { ensureIndexes } from './indexes'

/** The database half of `npm run setup`, also run after every restore: indexes, default settings and site pages, data migrations. */
export async function prepareDatabase(conn: mongoose.Connection, log: (line: string) => void = () => {}): Promise<void> {
  await ensureIndexes(conn)
  log(`indexes: synced ${Object.keys(conn.models).length} models`)
  const res = await conn
    .collection<any>('settings')
    .updateOne({ _id: 'global' }, { $setOnInsert: { ...DEFAULT_SETTINGS } }, { upsert: true })
  log(`settings: ${res.upsertedCount ? 'created with defaults' : 'kept existing'}`)
  const pages = await ensureSitePages(conn, log)
  const said = { created: 'created with the default content', migrated: 'upgraded to the landing page (it was the untouched first version)', kept: 'kept existing' }
  log(`homepage: ${said[pages.home]}; introduction page: ${said[pages.intro]}`)
  if (pages.moved) log(`introduction page: moved ${pages.moved} section${pages.moved === 1 ? '' : 's'} of the old landing page into it`)
  log(`profile links: migrated ${await migrateLegacyLinks(conn)} legacy profiles`)
}

/** The storage half of `npm run setup`: both buckets exist and the public one allows anonymous reads. */
export async function ensureBuckets(client: Client, m: Config['minio'], log: (line: string) => void = () => {}): Promise<void> {
  for (const bucket of [m.bucketOriginals, m.bucketPublic]) {
    const created = !(await client.bucketExists(bucket))
    if (created) await client.makeBucket(bucket)
    log(`bucket ${bucket}: ${created ? 'created' : 'exists'}`)
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

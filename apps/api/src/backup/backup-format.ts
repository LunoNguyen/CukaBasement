import { z } from 'zod'
import { DOWNLOADS_COLLECTION, LOCK_COLLECTION, RUNS_COLLECTION } from './backup-state'

/**
 * Archive layout (`.tar.gz`, entries in this order):
 *   db/<collection>.jsonl        one MongoDB Extended JSON (canonical) document per line
 *   minio/<role>/<object key>    raw object bytes; role is `originals` or `public`, not the bucket name,
 *                                so an archive restores into whatever buckets the target is configured with
 *   manifest.json                last, because object checksums are only known after streaming them
 * Indexes and collection options are not stored: restore rebuilds them from the models (the same step as
 * `npm run setup`).
 */
export const FORMAT = 'cukabasement-backup'
export const FORMAT_VERSION = 1
export const MANIFEST_ENTRY = 'manifest.json'
export const MANIFEST_MAX_BYTES = 256 * 1024 * 1024

/**
 * Never backed up, and kept as they are by a restore:
 * - jobs: Agenda's queue. Pending one-off jobs refer to the pre-restore data, so a restore deletes them;
 *   the recurring schedules (type 'single') are kept so the worker carries on without a restart.
 * - authTokens: sessions, email-verify and reset tokens. A restore deletes them all: everyone logs in again.
 * - backup coordination state (lock, runs, one-time download tokens).
 */
export const EXCLUDED_COLLECTIONS = new Set(['jobs', 'authTokens', LOCK_COLLECTION, RUNS_COLLECTION, DOWNLOADS_COLLECTION])

/** Restore stages each collection here first and renames it into place only once everything has loaded. */
export const STAGING_PREFIX = '__restore__'

export const BUCKET_ROLES = ['originals', 'public'] as const
export type BucketRole = (typeof BUCKET_ROLES)[number]

const COLLECTION_RE = /^[A-Za-z][A-Za-z0-9_-]{0,100}$/

export function isBackupCollection(name: string): boolean {
  return COLLECTION_RE.test(name) && !EXCLUDED_COLLECTIONS.has(name)
}

/**
 * Object keys allowed in an archive: no empty, `.` or `..` segments, no leading slash, no backslash or control
 * characters. Restored objects go to MinIO (never the filesystem), but the check keeps archive entry names sane.
 */
export function isSafeObjectKey(key: string): boolean {
  if (key.length === 0 || key.length > 1024) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(key)) return false
  return key.split('/').every((s) => s !== '' && s !== '.' && s !== '..')
}

export type EntryRef = { kind: 'manifest' } | { kind: 'db'; collection: string } | { kind: 'object'; role: BucketRole; key: string }

/** Classifies an archive entry name; null for anything not part of the format. */
export function classifyEntry(name: string): EntryRef | null {
  if (name === MANIFEST_ENTRY) return { kind: 'manifest' }
  const db = /^db\/([^/]+)\.jsonl$/.exec(name)
  if (db) return isBackupCollection(db[1]!) ? { kind: 'db', collection: db[1]! } : null
  const obj = /^minio\/([^/]+)\/(.+)$/s.exec(name)
  if (obj && (BUCKET_ROLES as readonly string[]).includes(obj[1]!) && isSafeObjectKey(obj[2]!)) {
    return { kind: 'object', role: obj[1] as BucketRole, key: obj[2]! }
  }
  return null
}

export const dbEntryName = (collection: string) => `db/${collection}.jsonl`
export const objectEntryName = (role: BucketRole, key: string) => `minio/${role}/${key}`

const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const size = z.number().int().nonnegative()

export const manifestSchema = z
  .object({
    format: z.literal(FORMAT),
    formatVersion: z.number().int(),
    appVersion: z.string().max(100),
    createdAt: z.iso.datetime(),
    dbName: z.string().min(1).max(64),
    collections: z.array(z.strictObject({ name: z.string().refine(isBackupCollection), count: size, bytes: size, sha256 })),
    buckets: z.array(z.strictObject({ role: z.enum(BUCKET_ROLES), name: z.string().max(63), objectCount: size, bytes: size })),
    objects: z.array(
      z.strictObject({
        role: z.enum(BUCKET_ROLES),
        key: z.string().refine(isSafeObjectKey),
        size,
        sha256,
        contentType: z.string().max(255),
        metadata: z.record(z.string().max(128), z.string().max(2048)),
      }),
    ),
  })
  .strict()

export type Manifest = z.infer<typeof manifestSchema>

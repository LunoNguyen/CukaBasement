import { BACKUP_NAME_RE, type BackupPhase, SCHEDULED_BACKUP_PREFIX } from '@cuka/shared'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import mongoose from 'mongoose'
import * as tar from 'tar-stream'
import { AppError } from '../common/app-error'
import { REPO_ROOT } from '../config/config'
import { ensureBuckets, prepareDatabase } from '../database/prepare'
import type { JobDeps } from '../jobs/handlers/media'
import {
  BUCKET_ROLES,
  type BucketRole,
  classifyEntry,
  dbEntryName,
  EXCLUDED_COLLECTIONS,
  FORMAT,
  FORMAT_VERSION,
  isBackupCollection,
  isSafeObjectKey,
  MANIFEST_ENTRY,
  MANIFEST_MAX_BYTES,
  type Manifest,
  manifestSchema,
  objectEntryName,
  STAGING_PREFIX,
} from './backup-format'

const { EJSON } = mongoose.mongo.BSON

export type BackupDeps = JobDeps

/** Progress sink; RunContext.progress fits. Throwing from it aborts the operation (e.g. lost lock). */
export type Progress = (phase: BackupPhase, done: number, total: number) => void

const MAX_LINE_BYTES = 64 * 1024 * 1024
const INSERT_BATCH_DOCS = 1000
const INSERT_BATCH_BYTES = 8 * 1024 * 1024
/** The schedule lives in `settings` but describes this installation, not the data: a restore keeps the current one. */
export const SCHEDULE_DOC_ID = 'backupSchedule'

const STD_HEADERS = new Set(['cache-control', 'content-disposition', 'content-encoding', 'content-language', 'expires'])

function invalid(message: string): AppError {
  return new AppError('BACKUP_INVALID', 400, message)
}

function appVersion(): string {
  try {
    return String(JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version ?? 'unknown')
  } catch {
    return 'unknown'
  }
}

function bucketOf(deps: BackupDeps, role: BucketRole): string {
  return role === 'originals' ? deps.config.minio.bucketOriginals : deps.config.minio.bucketPublic
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

/** `cuka-backup-20261018-030000-a1b2.tar.gz`; scheduled ones get SCHEDULED_BACKUP_PREFIX so retention can tell them apart. */
export function newBackupName(origin: 'manual' | 'schedule' | 'upload', now = new Date()): string {
  const prefix = origin === 'schedule' ? SCHEDULED_BACKUP_PREFIX : origin === 'upload' ? 'cuka-upload-' : 'cuka-backup-'
  return `${prefix}${stamp(now)}-${randomBytes(2).toString('hex')}.tar.gz`
}

/** Resolves a backup name inside BACKUP_DIR; anything but a plain BACKUP_NAME_RE name is refused. */
export function backupPath(dir: string, name: string): string {
  if (!BACKUP_NAME_RE.test(name)) throw invalid('Invalid backup name')
  return join(dir, name)
}

export interface BackupFile {
  name: string
  sizeBytes: number
  createdAt: string
  scheduled: boolean
}

export async function listBackups(dir: string): Promise<BackupFile[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  const out: BackupFile[] = []
  for (const name of names) {
    if (!BACKUP_NAME_RE.test(name)) continue
    const s = await stat(join(dir, name)).catch(() => null)
    if (!s?.isFile()) continue
    out.push({ name, sizeBytes: s.size, createdAt: s.mtime.toISOString(), scheduled: name.startsWith(SCHEDULED_BACKUP_PREFIX) })
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name))
}

/**
 * Deletes the oldest scheduled backups beyond `keep`. Manual and uploaded backups are never touched.
 * Call under the backup lock, so no restore can be reading a file being deleted.
 */
export async function pruneScheduledBackups(dir: string, keep: number): Promise<string[]> {
  const scheduled = (await listBackups(dir)).filter((b) => b.name.startsWith(SCHEDULED_BACKUP_PREFIX))
  // Names embed a sortable UTC timestamp; newest first.
  scheduled.sort((a, b) => b.name.localeCompare(a.name))
  const removed: string[] = []
  for (const b of scheduled.slice(keep)) {
    try {
      await unlink(join(dir, b.name))
      removed.push(b.name)
    } catch {
      // Gone already, or locked by another program (Windows): tried again after the next scheduled backup.
    }
  }
  return removed
}

/** Writes `source` as one tar entry of exactly `size` bytes and returns its sha256 (tar-stream rejects a size mismatch). */
function writeEntry(pack: tar.Pack, name: string, size: number, source: AsyncIterable<Buffer | string> | Iterable<Buffer>): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const entry = pack.entry({ name, size, mode: 0o644, mtime: new Date() }, (err) => (err ? reject(err) : resolve(hash.digest('hex'))))
    entry.on('error', reject)
    ;(async () => {
      for await (const raw of source) {
        const c = typeof raw === 'string' ? Buffer.from(raw) : raw
        hash.update(c)
        if (!entry.write(c)) await new Promise<void>((r) => entry.once('drain', () => r()))
      }
      ;(entry as unknown as { end(): void }).end()
    })().catch((e: Error) => {
      entry.destroy(e)
      reject(e)
    })
  })
}

async function dumpCollection(deps: BackupDeps, name: string, file: string): Promise<{ count: number; bytes: number; sha256: string }> {
  const out = createWriteStream(file)
  const hash = createHash('sha256')
  let count = 0
  let bytes = 0
  const done = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve)
    out.on('error', reject)
  })
  for await (const doc of deps.conn.db!.collection(name).find({}, { batchSize: 1000 })) {
    const line = Buffer.from(EJSON.stringify(doc, { relaxed: false }) + '\n')
    hash.update(line)
    bytes += line.length
    count++
    if (!out.write(line)) await new Promise<void>((r) => out.once('drain', () => r()))
  }
  out.end()
  await done
  return { count, bytes, sha256: hash.digest('hex') }
}

/** Removes leftovers of a backup or upload that was killed midway. Only call while holding the backup lock. */
async function sweepPartials(dir: string): Promise<void> {
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (name.startsWith('.partial-') || name.startsWith('.work-')) await rm(join(dir, name), { recursive: true, force: true })
  }
}

/**
 * Streams the database and both buckets into `<BACKUP_DIR>/<name>`. The archive is written under a hidden
 * temporary name and renamed at the end, so the folder never lists a half-written backup.
 * Consistency is best-effort (the site keeps running): the database is read first, then the files.
 */
export async function createBackup(deps: BackupDeps, name: string, progress: Progress = () => {}): Promise<{ name: string; sizeBytes: number; manifest: Manifest }> {
  const dir = deps.config.backup.dir
  const final = backupPath(dir, name)
  await mkdir(dir, { recursive: true })
  await sweepPartials(dir)
  const partial = join(dir, `.partial-${name}`)
  const work = await mkdtemp(join(dir, '.work-'))
  const pack = tar.pack()
  const writing = pipeline(pack, createGzip({ level: 6 }), createWriteStream(partial))
  writing.catch(() => {})
  try {
    const db = deps.conn.db!
    const all = (await db.listCollections({}, { nameOnly: false }).toArray())
      .filter((c) => c.type === 'collection' && !c.name.startsWith('system.') && !c.name.startsWith(STAGING_PREFIX) && !EXCLUDED_COLLECTIONS.has(c.name))
      .map((c) => c.name)
    // Never skip data silently: a collection the format cannot name fails the backup instead.
    const unsupported = all.filter((n) => !isBackupCollection(n))
    if (unsupported.length) throw new Error(`Collection name not supported by the backup format: ${unsupported.join(', ').slice(0, 300)}`)
    const collections = all.sort()
    const manifest: Manifest = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      appVersion: appVersion(),
      createdAt: new Date().toISOString(),
      dbName: db.databaseName,
      collections: [],
      buckets: [],
      objects: [],
    }
    for (const [i, coll] of collections.entries()) {
      progress('database', i, collections.length)
      const tmp = join(work, `${i}.jsonl`)
      const dumped = await dumpCollection(deps, coll, tmp)
      const sha = await writeEntry(pack, dbEntryName(coll), dumped.bytes, createReadStream(tmp))
      if (sha !== dumped.sha256) throw new Error(`Temporary dump of ${coll} changed while archiving`)
      await unlink(tmp)
      manifest.collections.push({ name: coll, count: dumped.count, bytes: dumped.bytes, sha256: sha })
    }

    const client = deps.storage.client
    const listed: Array<{ role: BucketRole; key: string }> = []
    for (const role of BUCKET_ROLES) {
      const bucket = bucketOf(deps, role)
      if (!(await client.bucketExists(bucket))) continue
      for await (const o of client.listObjectsV2(bucket, '', true)) {
        if (!o.name) continue
        if (!isSafeObjectKey(o.name)) throw new Error(`Object key not supported by the backup format: ${JSON.stringify(o.name.slice(0, 200))}`)
        listed.push({ role, key: o.name })
      }
    }
    const totals = new Map<BucketRole, { objectCount: number; bytes: number }>(BUCKET_ROLES.map((r) => [r, { objectCount: 0, bytes: 0 }]))
    for (const [i, { role, key }] of listed.entries()) {
      progress('files', i, listed.length)
      const bucket = bucketOf(deps, role)
      let st: Awaited<ReturnType<typeof client.statObject>>
      try {
        st = await client.statObject(bucket, key)
      } catch (e) {
        // Deleted since the listing (e.g. an upload cleaned up): nothing to keep.
        const code = (e as { code?: string }).code
        if (code === 'NotFound' || code === 'NoSuchKey') continue
        throw e
      }
      const metadata: Record<string, string> = {}
      for (const [k, v] of Object.entries(st.metaData ?? {})) {
        if (k.toLowerCase() !== 'content-type' && v != null) metadata[k.toLowerCase()] = String(v)
      }
      const contentType = String(st.metaData?.['content-type'] ?? 'application/octet-stream')
      const sha256 = await writeEntry(pack, objectEntryName(role, key), st.size, await client.getObject(bucket, key))
      manifest.objects.push({ role, key, size: st.size, sha256, contentType, metadata })
      const t = totals.get(role)!
      t.objectCount++
      t.bytes += st.size
    }
    manifest.buckets = BUCKET_ROLES.map((role) => ({ role, name: bucketOf(deps, role), ...totals.get(role)! }))

    progress('finalize', 0, 1)
    // Same check a restore makes, so an archive that could not be restored is never produced.
    manifestSchema.parse(manifest)
    const body = Buffer.from(JSON.stringify(manifest))
    if (body.length > MANIFEST_MAX_BYTES) throw new Error('Too many objects for one backup manifest')
    await writeEntry(pack, MANIFEST_ENTRY, body.length, [body])
    pack.finalize()
    await writing
    await rename(partial, final)
    const { size } = await stat(final)
    progress('finalize', 1, 1)
    return { name, sizeBytes: size, manifest }
  } catch (e) {
    pack.destroy(e as Error)
    await writing.catch(() => {})
    await unlink(partial).catch(() => {})
    throw e
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

async function* lines(source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let pending: Buffer[] = []
  let pendingLen = 0
  for await (const chunk of source) {
    let start = 0
    for (let i = chunk.indexOf(10); i !== -1; i = chunk.indexOf(10, start)) {
      const part = chunk.subarray(start, i)
      yield pendingLen ? Buffer.concat([...pending, part]) : part
      pending = []
      pendingLen = 0
      start = i + 1
    }
    if (start < chunk.length) {
      pending.push(chunk.subarray(start))
      pendingLen += chunk.length - start
      if (pendingLen > MAX_LINE_BYTES) throw invalid('A database line is too long')
    }
  }
  if (pendingLen) throw invalid('Database dump does not end with a newline')
}

function parseDoc(line: Buffer, collection: string): Record<string, unknown> {
  let doc: unknown
  try {
    doc = EJSON.parse(line.toString('utf8'), { relaxed: false })
  } catch {
    throw invalid(`Malformed document in ${collection}`)
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc) || !('_id' in doc)) throw invalid(`Malformed document in ${collection}`)
  return doc as Record<string, unknown>
}

/** Hashes what flows through, re-yielding it unchanged. */
async function* hashing(source: AsyncIterable<Buffer>, hash: ReturnType<typeof createHash>, counter: { bytes: number }): AsyncGenerator<Buffer> {
  for await (const c of source) {
    hash.update(c)
    counter.bytes += c.length
    yield c
  }
}

/**
 * Passes `source` through but holds back its last chunk until `hash` (fed by `source`) matches `expected`. On a
 * mismatch it throws instead, so the upload is cut short and the object already in the bucket is not replaced.
 */
async function* verifiedBody(source: AsyncIterable<Buffer>, hash: ReturnType<typeof createHash>, expected: string): AsyncGenerator<Buffer> {
  let held: Buffer | null = null
  for await (const c of source) {
    if (held) yield held
    held = c
  }
  if (hash.copy().digest('hex') !== expected) throw invalid('Archive changed since it was verified')
  if (held) yield held
}

type Visit = (ref: NonNullable<ReturnType<typeof classifyEntry>>, name: string, body: AsyncIterable<Buffer>) => Promise<void>

/**
 * Streams the archive entry by entry. Every entry must be a regular file with a name the format allows and must
 * appear once; anything else (links, directories, `../` names, unknown paths) rejects the whole archive.
 */
async function readArchive(file: string, onBytes: (read: number, total: number) => void, visit: Visit): Promise<void> {
  const total = (await stat(file)).size
  const src = createReadStream(file)
  let read = 0
  // Only counted here: onBytes may throw (lost lock), which must happen inside the async flow, not an event handler.
  src.on('data', (c) => {
    read += c.length
  })
  async function* reporting(body: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
    for await (const c of body) {
      onBytes(read, total)
      yield c
    }
  }
  const extract = tar.extract()
  const piping = pipeline(src, createGunzip(), extract)
  piping.catch(() => {})
  const seen = new Set<string>()
  try {
    for await (const entry of extract) {
      const { name, type } = entry.header
      if (type !== 'file') throw invalid(`Unexpected ${type} entry`)
      const ref = classifyEntry(name)
      if (!ref) throw invalid(`Unexpected entry ${JSON.stringify(name.slice(0, 200))}`)
      if (seen.has(name)) throw invalid(`Duplicate entry ${JSON.stringify(name.slice(0, 200))}`)
      seen.add(name)
      onBytes(read, total)
      await visit(ref, name, reporting(entry as AsyncIterable<Buffer>))
      for await (const _ of entry) void _
    }
    await piping
  } catch (e) {
    src.destroy()
    if (e instanceof AppError) throw e
    throw invalid(`Archive is damaged or not a backup: ${(e as Error).message}`)
  }
}

interface Seen {
  sha256: string
  bytes: number
  count?: number
}

export interface Verified {
  manifest: Manifest
  manifestSha256: string
  /** Users with role admin and status active in the archive: someone must be able to log in afterwards. */
  activeAdmins: number
  /** Size and mtime when verified; applying refuses a file that changed since. */
  fileStamp: string
}

async function fileStamp(file: string): Promise<string> {
  const s = await stat(file)
  return `${s.size}:${s.mtimeMs}`
}

function compareWithManifest(manifest: Manifest, seen: Map<string, Seen>): void {
  const expected = new Map<string, Seen>()
  for (const c of manifest.collections) expected.set(dbEntryName(c.name), { sha256: c.sha256, bytes: c.bytes, count: c.count })
  for (const o of manifest.objects) expected.set(objectEntryName(o.role, o.key), { sha256: o.sha256, bytes: o.size })
  if (expected.size !== manifest.collections.length + manifest.objects.length) throw invalid('Manifest lists an entry twice')
  for (const [name, exp] of expected) {
    const got = seen.get(name)
    if (!got) throw invalid(`Missing entry ${JSON.stringify(name.slice(0, 200))}`)
    if (got.sha256 !== exp.sha256 || got.bytes !== exp.bytes) throw invalid(`Checksum mismatch for ${JSON.stringify(name.slice(0, 200))}`)
    if (exp.count !== undefined && got.count !== exp.count) throw invalid(`Document count mismatch for ${JSON.stringify(name.slice(0, 200))}`)
  }
  for (const name of seen.keys()) if (!expected.has(name)) throw invalid(`Entry not in manifest ${JSON.stringify(name.slice(0, 200))}`)
}

/**
 * Reads the whole archive without changing anything: format and version, every entry name, every checksum and
 * document count against the manifest, and that every database line parses.
 */
export async function verifyArchive(file: string, progress: Progress = () => {}): Promise<Verified> {
  const stampBefore = await fileStamp(file)
  const seen = new Map<string, Seen>()
  let manifestBody: Buffer | null = null
  let manifestSha256 = ''
  let activeAdmins = 0
  await readArchive(file, (done, total) => progress('verify', done, total), async (ref, name, body) => {
    if (manifestBody) throw invalid('manifest.json must be the last entry')
    const hash = createHash('sha256')
    const counter = { bytes: 0 }
    if (ref.kind === 'manifest') {
      const chunks: Buffer[] = []
      for await (const c of hashing(body, hash, counter)) {
        if (counter.bytes > MANIFEST_MAX_BYTES) throw invalid('Manifest is too large')
        chunks.push(c)
      }
      manifestBody = Buffer.concat(chunks)
      manifestSha256 = hash.digest('hex')
      return
    }
    if (ref.kind === 'db') {
      let count = 0
      for await (const line of lines(hashing(body, hash, counter))) {
        if (line.length === 0) throw invalid(`Empty line in ${ref.collection}`)
        const doc = parseDoc(line, ref.collection)
        count++
        if (ref.collection === 'users' && doc.role === 'admin' && doc.status === 'active') activeAdmins++
      }
      seen.set(name, { sha256: hash.digest('hex'), bytes: counter.bytes, count })
      return
    }
    for await (const _ of hashing(body, hash, counter)) void _
    seen.set(name, { sha256: hash.digest('hex'), bytes: counter.bytes })
  })
  if (!manifestBody) throw invalid('Archive has no manifest.json')
  let raw: unknown
  try {
    raw = JSON.parse((manifestBody as Buffer).toString('utf8'))
  } catch {
    throw invalid('manifest.json is not valid JSON')
  }
  const head = raw as { format?: unknown; formatVersion?: unknown }
  if (head?.format !== FORMAT) throw invalid('Not a CukaBasement backup')
  if (head.formatVersion !== FORMAT_VERSION) throw invalid(`Unsupported backup format version ${String(head.formatVersion)} (this app reads ${FORMAT_VERSION})`)
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) throw invalid('manifest.json does not match the backup format')
  compareWithManifest(parsed.data, seen)
  if ((await fileStamp(file)) !== stampBefore) throw invalid('The file changed while it was being verified')
  return { manifest: parsed.data, manifestSha256, activeAdmins, fileStamp: stampBefore }
}

export interface TargetOptions {
  /** Allow restoring a backup taken from a database with another name. */
  forceDb?: boolean
  /** Allow a backup without any active admin (nobody could use the admin page afterwards). */
  allowNoAdmin?: boolean
}

/** Checks a verified archive against this installation before anything is changed. */
export function checkTarget(deps: BackupDeps, v: Verified, opts: TargetOptions = {}): void {
  const dbName = deps.conn.db!.databaseName
  if (v.manifest.dbName !== dbName && !opts.forceDb) {
    throw invalid(`Backup is of database "${v.manifest.dbName}", this server uses "${dbName}"`)
  }
  if (v.activeAdmins === 0 && !opts.allowNoAdmin) throw invalid('Backup has no active admin account')
}

function putHeaders(contentType: string, metadata: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': contentType || 'application/octet-stream' }
  for (const [k, v] of Object.entries(metadata)) h[STD_HEADERS.has(k) ? k : `X-Amz-Meta-${k}`] = v
  return h
}

async function dropStaging(db: mongoose.mongo.Db): Promise<void> {
  for (const c of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (c.name.startsWith(STAGING_PREFIX)) await db.dropCollection(c.name).catch(() => {})
  }
}

async function insertBatch(db: mongoose.mongo.Db, collection: string, docs: Record<string, unknown>[]): Promise<void> {
  if (docs.length) await db.collection(collection).insertMany(docs, { ordered: true, bypassDocumentValidation: true })
}

/**
 * Replaces the database and both buckets with a verified archive. Call verifyArchive + checkTarget first, under
 * the backup lock, with maintenance on.
 *
 * Safety: collections are loaded into `__restore__*` staging collections and objects are written into the live
 * buckets (adding or overwriting, never deleting). Only after the whole archive streamed in again with matching
 * checksums are the staging collections renamed into place and the objects the backup does not have deleted.
 * A failure before that point leaves the database exactly as it was (staging is dropped); the buckets may hold
 * extra or overwritten objects from the backup but lose nothing.
 */
export async function applyArchive(deps: BackupDeps, file: string, v: Verified, progress: Progress = () => {}, log: (line: string) => void = () => {}): Promise<void> {
  const db = deps.conn.db!
  const client = deps.storage.client
  if ((await fileStamp(file)) !== v.fileStamp) throw invalid('The file changed since it was verified')
  await ensureBuckets(client, deps.config.minio)
  await dropStaging(db)

  const seen = new Map<string, Seen>()
  const objects = new Map(v.manifest.objects.map((o) => [objectEntryName(o.role, o.key), o]))
  let phase: BackupPhase = 'database'
  try {
    await readArchive(file, (done, total) => progress(phase, done, total), async (ref, name, body) => {
      const hash = createHash('sha256')
      const counter = { bytes: 0 }
      if (ref.kind === 'manifest') {
        for await (const _ of hashing(body, hash, counter)) void _
        if (hash.digest('hex') !== v.manifestSha256) throw invalid('Archive changed since it was verified')
        return
      }
      if (ref.kind === 'db') {
        phase = 'database'
        const staging = STAGING_PREFIX + ref.collection
        await db.createCollection(staging)
        let batch: Record<string, unknown>[] = []
        let batchBytes = 0
        let count = 0
        for await (const line of lines(hashing(body, hash, counter))) {
          batch.push(parseDoc(line, ref.collection))
          batchBytes += line.length
          count++
          if (batch.length >= INSERT_BATCH_DOCS || batchBytes >= INSERT_BATCH_BYTES) {
            await insertBatch(db, staging, batch)
            batch = []
            batchBytes = 0
          }
        }
        await insertBatch(db, staging, batch)
        seen.set(name, { sha256: hash.digest('hex'), bytes: counter.bytes, count })
        return
      }
      phase = 'files'
      const meta = objects.get(name)
      if (!meta) throw invalid('Archive changed since it was verified')
      const checked = verifiedBody(hashing(body, hash, counter), hash, meta.sha256)
      await client.putObject(bucketOf(deps, ref.role), ref.key, Readable.from(checked), meta.size, putHeaders(meta.contentType, meta.metadata))
      seen.set(name, { sha256: hash.digest('hex'), bytes: counter.bytes })
    })
    compareWithManifest(v.manifest, seen)
    // Last lock check before the point of no return (throws if another process took the lock over).
    progress('finalize', 0, 1)
  } catch (e) {
    await dropStaging(db)
    const msg = e instanceof Error ? e.message : String(e)
    throw new AppError(e instanceof AppError ? e.code : 'INTERNAL', e instanceof AppError ? e.status : 500, `Restore failed before the database was changed (nothing was deleted): ${msg}`)
  }

  // Point of no return: swap the staged collections in and delete what the backup does not have.
  try {
    const settings = db.collection<{ _id: string }>('settings')
    const schedule = await settings.findOne({ _id: SCHEDULE_DOC_ID })
    const restored = new Set(v.manifest.collections.map((c) => c.name))
    for (const name of restored) await db.renameCollection(STAGING_PREFIX + name, name, { dropTarget: true })
    for (const c of await db.listCollections({}, { nameOnly: true }).toArray()) {
      if (isBackupCollection(c.name) && !restored.has(c.name)) await db.dropCollection(c.name)
    }
    if (schedule) await settings.replaceOne({ _id: SCHEDULE_DOC_ID }, schedule, { upsert: true })
    else await settings.deleteOne({ _id: SCHEDULE_DOC_ID })
    await db.collection('authTokens').deleteMany({})
    await db.collection('jobs').deleteMany({ type: { $ne: 'single' } })

    const keep = new Set(v.manifest.objects.map((o) => `${o.role}/${o.key}`))
    for (const role of BUCKET_ROLES) {
      const bucket = bucketOf(deps, role)
      let extra: string[] = []
      for await (const o of client.listObjectsV2(bucket, '', true)) {
        if (!o.name || keep.has(`${role}/${o.name}`)) continue
        extra.push(o.name)
        if (extra.length === 1000) {
          await client.removeObjects(bucket, extra)
          extra = []
        }
      }
      if (extra.length) await client.removeObjects(bucket, extra)
    }
    await prepareDatabase(deps.conn, log)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Restore failed while switching to the restored data; the site may be inconsistent, run the restore again: ${msg}`)
  }
  progress('finalize', 1, 1)
}

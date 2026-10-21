import { BACKUP_RESTORE_CONFIRM, DEFAULT_BACKUP_SCHEDULE } from '@cuka/shared'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { Types } from 'mongoose'
import * as tar from 'tar-stream'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { applyArchive, pruneScheduledBackups, verifyArchive } from '../src/backup/backup-archive'
import { nextSlot, previousSlot, scheduleTick } from '../src/backup/backup-schedule'
import { acquireLock, LOCK_STALE_MS, releaseLock } from '../src/backup/backup-state'
import { BackupService } from '../src/backup/backup.service'
import { MaintenanceService } from '../src/backup/maintenance.service'
import { CONFIG, type Config } from '../src/config/config'
import { runBackupCli } from '../src/scripts/backup'
import { runRestoreCli } from '../src/scripts/restore'
import { StorageService } from '../src/storage/storage.service'
import { createPost, createTestHarness, createUser, type Harness, jobDeps, testConfig } from './harness'
import { ensureHomepage } from '../src/site/home-seed'

const PASSWORD = 'correct horse battery'

describe('backup & restore', () => {
  let h: Harness
  let config: Config
  let storage: StorageService
  let svc: BackupService

  beforeAll(async () => {
    h = await createTestHarness()
    config = h.app.get(CONFIG)
    storage = h.app.get(StorageService)
    svc = h.app.get(BackupService)
  })
  beforeEach(async () => {
    await h.reset()
    await rm(config.backup.dir, { recursive: true, force: true })
    h.app.get(MaintenanceService).setLocal(false)
  })
  afterAll(async () => {
    await rm(config.backup.dir, { recursive: true, force: true })
    await h.close()
  })

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
  const settle = async () => {
    while (svc.inFlight.size) await Promise.all([...svc.inFlight])
  }
  const admin = () => createUser(h, { role: 'admin', password: PASSWORD })
  const oid = (s: string) => new Types.ObjectId(s)
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

  async function backupNow(token: string): Promise<string> {
    const r = await h.http().post('/api/admin/backups').set(auth(token)).expect(202)
    expect(r.body.status).toBe('running')
    await settle()
    const run = await h.http().get(`/api/admin/backups/runs/${r.body.id}`).set(auth(token)).expect(200)
    expect(run.body).toMatchObject({ status: 'succeeded', kind: 'backup', error: null })
    return r.body.file as string
  }

  async function restoreNow(token: string, name: string) {
    const r = await h.http().post(`/api/admin/backups/${name}/restore`).set(auth(token)).send({ confirm: BACKUP_RESTORE_CONFIRM }).expect(202)
    await settle()
    return (await h.http().get(`/api/admin/backups/runs/${r.body.id}`).set(auth(token)).expect(200)).body
  }

  /** Everything restore could change: every app collection's documents and every object's bytes. */
  async function fingerprint(): Promise<string> {
    const parts: string[] = []
    for (const c of (await h.db.db!.listCollections().toArray()).map((c) => c.name).sort()) {
      if (['backupLock', 'backupRuns', 'moderationLogs'].includes(c)) continue
      const docs = await h.db.collection(c).find().sort({ _id: 1 }).toArray()
      parts.push(`${c}:${JSON.stringify(docs)}`)
    }
    for (const bucket of [config.minio.bucketOriginals, config.minio.bucketPublic]) {
      const keys: string[] = []
      for await (const o of storage.client.listObjectsV2(bucket, '', true)) if (o.name) keys.push(o.name)
      for (const k of keys.sort()) parts.push(`${bucket}/${k}:${sha(await storage.getBuffer(bucket, k))}`)
    }
    return sha(Buffer.from(parts.join('\n')))
  }

  type Entry = { name: string; body: Buffer }
  async function readEntries(file: string): Promise<Entry[]> {
    const ex = tar.extract()
    const out: Entry[] = []
    const done = (async () => {
      for await (const e of ex) {
        const chunks: Buffer[] = []
        for await (const c of e) chunks.push(c as Buffer)
        out.push({ name: e.header.name, body: Buffer.concat(chunks) })
      }
    })()
    ex.end(gunzipSync(readFileSync(file)))
    await done
    return out
  }
  async function writeEntries(file: string, entries: Array<Entry & { type?: 'file' | 'symlink' | 'directory' }>): Promise<void> {
    const pack = tar.pack()
    const chunks: Buffer[] = []
    const collected = (async () => {
      for await (const c of pack) chunks.push(c as Buffer)
    })()
    for (const e of entries) {
      if (e.type && e.type !== 'file') pack.entry({ name: e.name, type: e.type, linkname: e.type === 'symlink' ? '/etc/passwd' : undefined })
      else pack.entry({ name: e.name }, e.body)
    }
    pack.finalize()
    await collected
    writeFileSync(file, gzipSync(Buffer.concat(chunks)))
  }
  const dirFile = (name: string) => join(config.backup.dir, name)

  it('non-admins cannot reach any backup route', async () => {
    const user = await createUser(h)
    const mod = await createUser(h, { role: 'moderator' })
    for (const who of [user, mod]) {
      await h.http().get('/api/admin/backups').set(auth(who.token)).expect(403)
      await h.http().post('/api/admin/backups').set(auth(who.token)).expect(403)
      await h.http().post('/api/admin/backups/x.tar.gz/restore').set(auth(who.token)).send({ confirm: BACKUP_RESTORE_CONFIRM }).expect(403)
      await h.http().post('/api/admin/backups/upload').set(auth(who.token)).set('Content-Type', 'application/octet-stream').send(Buffer.from([0x1f, 0x8b])).expect(403)
      await h.http().put('/api/admin/backups/schedule').set(auth(who.token)).send(DEFAULT_BACKUP_SCHEDULE).expect(403)
      await h.http().delete('/api/admin/backups/x.tar.gz').set(auth(who.token)).expect(403)
    }
    await h.http().get('/api/admin/backups').expect(401)
    await h.http().post('/api/admin/backups').expect(401)
  })

  it('backup → change data and files → restore brings the original back', async () => {
    const a = await admin()
    const author = await createUser(h)
    const postId = await createPost(h, author, { title: 'Keep me' })
    const pub = config.minio.bucketPublic
    await storage.client.putObject(pub, 'misc/hello.txt', Buffer.from('hello'), 5, { 'Content-Type': 'text/plain', 'Cache-Control': 'max-age=60' })
    await h.db.collection('settings').updateOne({ _id: 'global' as never }, { $set: { reportHideThreshold: 9 } }, { upsert: true })
    // As `npm run setup` leaves it: the homepage exists, so the archive carries it (a restore seeds it only when missing).
    await ensureHomepage(h.db)
    // A recurring Agenda schedule and a one-off job: only the recurring one should survive the restore.
    await h.db.collection('jobs').insertMany([
      { name: 'cleanup-uploads', type: 'single', nextRunAt: new Date() },
      { name: 'process-file', type: 'normal', nextRunAt: new Date() },
    ])
    const before = await fingerprint()
    const objectsBefore = new Map<string, string>()
    for (const bucket of [config.minio.bucketOriginals, pub]) {
      for await (const o of storage.client.listObjectsV2(bucket, '', true)) objectsBefore.set(`${bucket}/${o.name}`, sha(await storage.getBuffer(bucket, o.name!)))
    }
    expect(objectsBefore.size).toBeGreaterThan(2)

    const name = await backupNow(a.token)
    const list = await h.http().get('/api/admin/backups').set(auth(a.token)).expect(200)
    expect(list.body.items).toEqual([expect.objectContaining({ name, scheduled: false, sizeBytes: expect.any(Number) })])
    expect(list.body).toMatchObject({ busy: false, maintenance: false, run: { status: 'succeeded' } })
    expect(await fingerprint()).toBe(before)

    // Mutations: delete the post, add a user, change a setting, drop and add objects, add a collection.
    await h.db.collection('posts').deleteOne({ _id: oid(postId) })
    await createUser(h)
    await h.db.collection('settings').updateOne({ _id: 'global' as never }, { $set: { reportHideThreshold: 2 } })
    await storage.remove(pub, 'misc/hello.txt')
    await storage.put(pub, 'misc/new.txt', Buffer.from('new'), 'text/plain')
    await h.db.collection('junk').insertOne({ x: 1 })
    await h.http().post('/api/auth/login').send({ email: a.email, password: PASSWORD }).expect(200)
    expect(await h.db.collection('authTokens').countDocuments()).toBe(1)
    // The schedule is installation config, not data: the one in place when restoring is kept.
    await h.http().put('/api/admin/backups/schedule').set(auth(a.token)).send({ ...DEFAULT_BACKUP_SCHEDULE, enabled: true, keep: 3 }).expect(200)
    await h.db.collection('users').dropIndexes()

    const run = await restoreNow(a.token, name)
    expect(run).toMatchObject({ status: 'succeeded', kind: 'restore', error: null })

    expect(await h.db.collection('posts').findOne({ _id: oid(postId) })).toMatchObject({ title: 'Keep me' })
    expect(await h.db.collection('users').countDocuments()).toBe(2)
    expect((await h.db.collection('settings').findOne({ _id: 'global' as never }))!.reportHideThreshold).toBe(9)
    expect(await h.db.db!.listCollections({ name: 'junk' }).toArray()).toEqual([])
    expect((await h.db.db!.listCollections().toArray()).filter((c) => c.name.startsWith('__restore__'))).toEqual([])
    expect(await h.db.collection('authTokens').countDocuments()).toBe(0)
    expect((await h.db.collection('jobs').find().toArray()).map((j) => j.name)).toEqual(['cleanup-uploads'])
    expect((await h.db.collection('settings').findOne({ _id: 'backupSchedule' as never }))).toMatchObject({ enabled: true, keep: 3 })
    // Indexes come back from the models (the same step as `npm run setup`).
    expect((await h.db.collection('users').indexes()).find((i) => JSON.stringify(i.key) === '{"email":1}')?.unique).toBe(true)

    const objectsAfter = new Map<string, string>()
    for (const bucket of [config.minio.bucketOriginals, pub]) {
      for await (const o of storage.client.listObjectsV2(bucket, '', true)) objectsAfter.set(`${bucket}/${o.name}`, sha(await storage.getBuffer(bucket, o.name!)))
    }
    expect(objectsAfter).toEqual(objectsBefore)
    const st = await storage.client.statObject(pub, 'misc/hello.txt')
    expect(st.metaData['content-type']).toBe('text/plain')
    expect(st.metaData['cache-control']).toBe('max-age=60')

    const logs = await h.http().get('/api/admin/logs').set(auth(a.token)).query({ action: 'backup_restore' }).expect(200)
    expect(logs.body.items).toEqual([expect.objectContaining({ action: 'backup_restore', targetType: 'backup', targetId: name })])
    // Restoring the same archive again changes nothing.
    await h.db.collection('jobs').deleteMany({})
    const once = await fingerprint()
    expect((await restoreNow(a.token, name)).status).toBe('succeeded')
    expect(await fingerprint()).toBe(once)
    // Everyone logs in again; the admin from the backup can.
    await h.http().post('/api/auth/login').send({ email: a.email, password: PASSWORD }).expect(200)
  })

  it('a tampered or damaged archive is rejected before anything changes', async () => {
    const a = await admin()
    const author = await createUser(h)
    await createPost(h, author)
    const name = await backupNow(a.token)
    const entries = await readEntries(dirFile(name))
    const manifest = JSON.parse(entries.at(-1)!.body.toString())
    expect(entries.at(-1)!.name).toBe('manifest.json')
    expect(manifest).toMatchObject({ format: 'cukabasement-backup', formatVersion: 1, dbName: 'CukaDB_test' })
    expect(manifest.collections.map((c: { name: string }) => c.name)).toContain('users')
    expect(manifest.collections.map((c: { name: string }) => c.name)).not.toContain('authTokens')
    // Make the live state differ from the backup so a partial restore would show.
    await createUser(h)
    await storage.put(config.minio.bucketPublic, 'live/only.txt', Buffer.from('live'), 'text/plain')
    const before = await fingerprint()

    const users = entries.findIndex((e) => e.name === 'db/users.jsonl')
    const obj = entries.findIndex((e) => e.name.startsWith('minio/'))
    const swap = (pred: (e: Entry, i: number) => boolean, f: (e: Entry) => Entry) => entries.map((e, i) => (pred(e, i) ? f(e) : e))
    const withManifest = (m: object) => swap((e) => e.name === 'manifest.json', (e) => ({ ...e, body: Buffer.from(JSON.stringify(m)) }))
    const raw = readFileSync(dirFile(name))
    const cases: Array<[string, (file: string) => Promise<void>]> = [
      ['changed document', (f) => writeEntries(f, swap((_, i) => i === users, (e) => ({ ...e, body: Buffer.from(e.body.toString().replace('"admin"', '"user"')) })))],
      ['changed file bytes', (f) => writeEntries(f, swap((_, i) => i === obj, (e) => ({ ...e, body: Buffer.concat([e.body, Buffer.from('x')]) })))],
      ['missing entry', (f) => writeEntries(f, entries.filter((_, i) => i !== obj))],
      ['path traversal entry', (f) => writeEntries(f, [{ name: '../../evil.txt', body: Buffer.from('x') }, ...entries])],
      ['traversal object key', (f) => writeEntries(f, [{ name: 'minio/public/a/../../x', body: Buffer.from('x') }, ...entries])],
      ['absolute entry', (f) => writeEntries(f, [{ name: '/db/users.jsonl', body: Buffer.from('') }, ...entries])],
      ['unknown entry', (f) => writeEntries(f, [{ name: 'db/../x.jsonl', body: Buffer.from('') }, ...entries])],
      ['duplicate entry', (f) => writeEntries(f, [entries[users]!, ...entries])],
      ['symlink', (f) => writeEntries(f, [{ name: 'minio/public/link', body: Buffer.alloc(0), type: 'symlink' }, ...entries])],
      ['newer format', (f) => writeEntries(f, withManifest({ ...manifest, formatVersion: 2 }))],
      ['other database', (f) => writeEntries(f, withManifest({ ...manifest, dbName: 'OtherDB' }))],
      ['truncated', (f) => writeFile(f, raw.subarray(0, Math.floor(raw.length * 0.6)))],
      ['not gzip', (f) => writeFile(f, Buffer.from('not an archive at all'))],
    ]
    for (const [i, [label, make]] of cases.entries()) {
      const file = `tampered-${i}.tar.gz`
      await make(dirFile(file))
      const run = await restoreNow(a.token, file)
      expect(run.status, label).toBe('failed')
      expect(run.error, label).toBeTruthy()
      expect(await fingerprint(), label).toBe(before)
      await rm(dirFile(file))
    }
    // The good archive still restores.
    expect((await restoreNow(a.token, name)).status).toBe('succeeded')
  })

  it('an archive that changes between verification and loading leaves the database untouched', async () => {
    const a = await admin()
    await createPost(h, await createUser(h))
    const name = await backupNow(a.token)
    const entries = await readEntries(dirFile(name))
    await createUser(h)
    const before = await fingerprint()
    const verified = await verifyArchive(dirFile(name))
    // Same manifest, last file's bytes changed: every collection is already staged when the mismatch shows.
    const last = entries.length - 2
    expect(entries[last]!.name).toMatch(/^minio\//)
    await writeEntries(dirFile(name), entries.map((e, i) => (i === last ? { ...e, body: Buffer.from(e.body.map((b) => b ^ 1)) } : e)))
    await expect(applyArchive(jobDeps(h), dirFile(name), verified)).rejects.toThrow(/changed since it was verified/)
    // Even if the change went unnoticed (same size and mtime), the per-entry checksums catch it while loading,
    // and the bad file is never written over the live object.
    const st = statSync(dirFile(name))
    await expect(applyArchive(jobDeps(h), dirFile(name), { ...verified, fileStamp: `${st.size}:${st.mtimeMs}` })).rejects.toThrow(
      /before the database was changed/,
    )
    expect((await h.db.db!.listCollections().toArray()).filter((c) => c.name.startsWith('__restore__'))).toEqual([])
    expect(await fingerprint()).toBe(before)
  })

  it('rejects backup names that could leave the backup folder', async () => {
    const a = await admin()
    await mkdir(config.backup.dir, { recursive: true })
    writeFileSync(join(config.backup.dir, '..', 'outside.tar.gz'), 'x')
    try {
      for (const bad of ['..%2Foutside.tar.gz', '..%5Coutside.tar.gz', '.hidden.tar.gz', 'a.b.tar.gz', '%2Fetc%2Fpasswd', 'x.zip']) {
        await h.http().delete(`/api/admin/backups/${bad}`).set(auth(a.token)).expect(400)
        await h.http().post(`/api/admin/backups/${bad}/restore`).set(auth(a.token)).send({ confirm: BACKUP_RESTORE_CONFIRM }).expect(400)
        await h.http().post(`/api/admin/backups/${bad}/download`).set(auth(a.token)).expect(400)
      }
      expect(existsSync(join(config.backup.dir, '..', 'outside.tar.gz'))).toBe(true)
      await h.http().delete('/api/admin/backups/missing.tar.gz').set(auth(a.token)).expect(404)
      await h.http().post('/api/admin/backups/missing.tar.gz/restore').set(auth(a.token)).send({ confirm: BACKUP_RESTORE_CONFIRM }).expect(404)
      await h.http().post('/api/admin/backups/missing.tar.gz/restore').set(auth(a.token)).send({ confirm: 'yes' }).expect(400)
    } finally {
      await rm(join(config.backup.dir, '..', 'outside.tar.gz'), { force: true })
    }
  })

  it('one-time download link, upload with size limit, delete', async () => {
    const a = await admin()
    const name = await backupNow(a.token)
    const link = await h.http().post(`/api/admin/backups/${name}/download`).set(auth(a.token)).expect(200)
    expect(link.body.url).toMatch(/^\/api\/admin\/backups\/download\/[A-Za-z0-9_-]{43}$/)
    const dl = await h.http().get(link.body.url).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(dl.status).toBe(200)
    expect(dl.headers['content-disposition']).toBe(`attachment; filename="${name}"`)
    expect(sha(dl.body as Buffer)).toBe(sha(readFileSync(dirFile(name))))
    await h.http().get(link.body.url).expect(403)
    await h.http().get('/api/admin/backups/download/not-a-token').expect(403)

    const up = await h
      .http()
      .post('/api/admin/backups/upload')
      .set(auth(a.token))
      .set('Content-Type', 'application/octet-stream')
      .send(readFileSync(dirFile(name)))
      .expect(201)
    expect(up.body.name).toMatch(/^cuka-upload-\d{8}-\d{6}-[0-9a-f]{4}\.tar\.gz$/)
    expect(sha(readFileSync(dirFile(up.body.name)))).toBe(sha(readFileSync(dirFile(name))))
    await h.http().post('/api/admin/backups/upload').set(auth(a.token)).set('Content-Type', 'application/octet-stream').send(Buffer.from('plain text')).expect(400)
    await h.http().post('/api/admin/backups/upload').set(auth(a.token)).set('Content-Type', 'application/json').send({}).expect(415)
    const max = config.backup.maxUploadBytes
    config.backup.maxUploadBytes = 10
    try {
      const r = await h.http().post('/api/admin/backups/upload').set(auth(a.token)).set('Content-Type', 'application/octet-stream').send(readFileSync(dirFile(name)))
      expect(r.status).toBe(413)
      expect(r.body.error.code).toBe('BACKUP_TOO_LARGE')
    } finally {
      config.backup.maxUploadBytes = max
    }
    expect((await readdir(config.backup.dir)).filter((n) => !n.startsWith('.')).sort()).toEqual([name, up.body.name].sort())
    expect((await readdir(config.backup.dir)).filter((n) => n.startsWith('.upload-'))).toEqual([])

    await h.http().delete(`/api/admin/backups/${up.body.name}`).set(auth(a.token)).expect(204)
    expect(existsSync(dirFile(up.body.name))).toBe(false)
    const logs = await h.http().get('/api/admin/logs').set(auth(a.token)).expect(200)
    expect(logs.body.items.map((l: { action: string }) => l.action)).toEqual(expect.arrayContaining(['backup_create', 'backup_download', 'backup_upload', 'backup_delete']))
  })

  it('only one backup or restore at a time', async () => {
    const a = await admin()
    const other = new Types.ObjectId()
    expect(await acquireLock(h.db.db!, other, 'backup')).toBe(true)
    const r = await h.http().post('/api/admin/backups').set(auth(a.token)).expect(409)
    expect(r.body.error.code).toBe('BACKUP_BUSY')
    expect((await h.http().get('/api/admin/backups').set(auth(a.token))).body.busy).toBe(true)
    await releaseLock(h.db.db!, other)
    await backupNow(a.token)
  })

  it('maintenance mode: 503 for everyone but admins, health and sign-in', async () => {
    const a = await admin()
    const user = await createUser(h, { password: PASSWORD })
    const runId = new Types.ObjectId()
    await acquireLock(h.db.db!, runId, 'restore')
    await h.db.collection('backupLock').updateOne({ _id: 'global' as never }, { $set: { maintenance: true } })
    const m = h.app.get(MaintenanceService)
    m.clearCache()

    const r = await h.http().get('/api/feed/home').expect(503)
    expect(r.body.error.code).toBe('MAINTENANCE')
    await h.http().get('/api/feed/home').set(auth(user.token)).expect(503)
    await h.http().get('/api/me').set(auth(user.token)).expect(503)
    await h.http().get('/api/health').expect(200, { ok: true, maintenance: true })
    await h.http().post('/api/auth/login').send({ email: user.email, password: PASSWORD }).expect(200)
    await h.http().get('/api/feed/home').set(auth(a.token)).expect(200)
    await h.http().get('/api/admin/backups').set(auth(a.token)).expect(200)

    // A holder that stopped heartbeating (crashed restore) no longer keeps the site down.
    await h.db.collection('backupLock').updateOne({ _id: 'global' as never }, { $set: { heartbeatAt: new Date(Date.now() - LOCK_STALE_MS - 1000) } })
    m.clearCache()
    await h.http().get('/api/feed/home').expect(200)
    await h.http().get('/api/health').expect(200, { ok: true, maintenance: false })
  })

  it('CLI: backup, cancelled restore changes nothing, restore needs a matching database unless forced', async () => {
    const a = await admin()
    await createPost(h, await createUser(h))
    const cfg = { ...testConfig(), backup: config.backup }
    const { path, sizeBytes } = await runBackupCli(cfg)
    expect(sizeBytes).toBeGreaterThan(0)
    expect(existsSync(path)).toBe(true)
    await createUser(h)
    const before = await fingerprint()
    expect(await runRestoreCli(cfg, path, { confirm: async () => false })).toBe(false)
    expect(await fingerprint()).toBe(before)

    const entries = await readEntries(path)
    const other = dirFile('other-db.tar.gz')
    const manifest = JSON.parse(entries.at(-1)!.body.toString())
    await writeEntries(other, entries.map((e) => (e.name === 'manifest.json' ? { ...e, body: Buffer.from(JSON.stringify({ ...manifest, dbName: 'CukaDB' })) } : e)))
    await expect(runRestoreCli(cfg, other, { confirm: async () => true })).rejects.toThrow(/database "CukaDB"/)
    expect(await fingerprint()).toBe(before)
    expect(await runRestoreCli(cfg, other, { confirm: async () => true, forceDb: true })).toBe(true)
    expect(await h.db.collection('users').countDocuments()).toBe(2)
    await h.http().post('/api/auth/login').send({ email: a.email, password: PASSWORD }).expect(200)
  })

  it('refuses a backup without an active admin (nobody could sign in to the admin page)', async () => {
    const a = await admin()
    const name = await backupNow(a.token)
    const entries = await readEntries(dirFile(name))
    const users = entries.find((e) => e.name === 'db/users.jsonl')!
    users.body = Buffer.from(users.body.toString().replace('"role":"admin"', '"role":"user"'))
    const manifest = JSON.parse(entries.at(-1)!.body.toString())
    for (const c of manifest.collections) if (c.name === 'users') Object.assign(c, { sha256: sha(users.body), bytes: users.body.length })
    entries[entries.length - 1] = { name: 'manifest.json', body: Buffer.from(JSON.stringify(manifest)) }
    await writeEntries(dirFile('no-admin.tar.gz'), entries)
    const run = await restoreNow(a.token, 'no-admin.tar.gz')
    expect(run.status).toBe('failed')
    expect(run.error).toMatch(/no active admin/)
  })

  describe('schedule', () => {
    const TZ = 'Asia/Ho_Chi_Minh'
    const daily = { ...DEFAULT_BACKUP_SCHEDULE, enabled: true, time: '03:00' }

    it('computes slots in the configured time zone', () => {
      const now = new Date('2026-10-18T12:00:00Z') // 19:00 in Ho Chi Minh, a Sunday
      expect(previousSlot(daily, now, TZ)!.toISOString()).toBe('2026-10-17T20:00:00.000Z')
      expect(nextSlot(daily, now, TZ)!.toISOString()).toBe('2026-10-18T20:00:00.000Z')
      const weekly = { ...daily, frequency: 'weekly' as const, weekday: 3, time: '23:30' }
      expect(nextSlot(weekly, now, TZ)!.toISOString()).toBe('2026-10-21T16:30:00.000Z')
      expect(previousSlot(weekly, now, TZ)!.toISOString()).toBe('2026-10-14T16:30:00.000Z')
      expect(nextSlot(daily, now, 'UTC')!.toISOString()).toBe('2026-10-19T03:00:00.000Z')
      // DST zone: 02:30 local on a normal day in New York (UTC-4 in October).
      expect(nextSlot({ ...daily, time: '02:30' }, now, 'America/New_York')!.toISOString()).toBe('2026-10-19T06:30:00.000Z')
    })

    it('validates and toggles the schedule from the admin page', async () => {
      const a = await admin()
      const s0 = await h.http().get('/api/admin/backups').set(auth(a.token)).expect(200)
      expect(s0.body.schedule).toMatchObject({ schedule: DEFAULT_BACKUP_SCHEDULE, timeZone: TZ, nextRunAt: null, lastRun: null })
      for (const bad of [{ time: '25:00' }, { weekday: 9 }, { keep: 0 }, { frequency: 'monthly' }, { enabled: 'on' }]) {
        await h.http().put('/api/admin/backups/schedule').set(auth(a.token)).send({ ...DEFAULT_BACKUP_SCHEDULE, ...bad }).expect(400)
      }
      const on = await h.http().put('/api/admin/backups/schedule').set(auth(a.token)).send({ ...daily, keep: 5 }).expect(200)
      expect(on.body.schedule).toMatchObject({ enabled: true, keep: 5 })
      expect(new Date(on.body.nextRunAt).getTime()).toBeGreaterThan(Date.now())
      const off = await h.http().put('/api/admin/backups/schedule').set(auth(a.token)).send({ ...daily, enabled: false, keep: 5 }).expect(200)
      expect(off.body.nextRunAt).toBeNull()
      const logs = await h.http().get('/api/admin/logs').set(auth(a.token)).query({ action: 'update_setting' }).expect(200)
      expect(logs.body.items).toHaveLength(2)
      expect(logs.body.items[0]).toMatchObject({ targetId: 'backupSchedule', note: 'enabled=false' })
    })

    async function scheduleAt(s: typeof daily, updatedAt: Date) {
      await h.db
        .collection('settings')
        .updateOne({ _id: 'backupSchedule' as never }, { $set: { ...s, updatedAt }, $setOnInsert: { lastSlotAt: null, lastRun: null } }, { upsert: true })
    }

    it('fires once per slot, not for slots before the last change, and not when off', async () => {
      const deps = jobDeps(h)
      const now = new Date('2026-10-18T21:00:00Z') // 04:00 local, an hour after the 03:00 slot
      await scheduleAt({ ...daily, enabled: false }, new Date('2026-10-01T00:00:00Z'))
      expect((await scheduleTick(deps, now)).outcome).toBe('not_due')
      // Changed after today's slot: waits for tomorrow.
      await scheduleAt(daily, new Date('2026-10-18T20:30:00Z'))
      expect((await scheduleTick(deps, now)).outcome).toBe('not_due')
      await scheduleAt(daily, new Date('2026-10-01T00:00:00Z'))
      const [first, second] = await Promise.all([scheduleTick(deps, now), scheduleTick(deps, now)])
      expect([first.outcome, second.outcome].sort()).toEqual(['not_due', 'succeeded'])
      const fired = first.outcome === 'succeeded' ? first : second
      expect(fired.name).toMatch(/^cuka-backup-sched-20261018-210000-[0-9a-f]{4}\.tar\.gz$/)
      expect(existsSync(dirFile(fired.name!))).toBe(true)
      expect((await scheduleTick(deps, new Date('2026-10-18T22:00:00Z'))).outcome).toBe('not_due')
      const state = await h.http().get('/api/admin/backups').set(auth((await admin()).token)).expect(200)
      expect(state.body.schedule.lastRun).toMatchObject({ outcome: 'succeeded', name: fired.name })
      expect(state.body.items[0]).toMatchObject({ name: fired.name, scheduled: true })
    })

    it('skips a slot while another backup or restore runs', async () => {
      await scheduleAt(daily, new Date('2026-10-01T00:00:00Z'))
      const other = new Types.ObjectId()
      await acquireLock(h.db.db!, other, 'restore')
      const r = await scheduleTick(jobDeps(h), new Date('2026-10-18T21:00:00Z'))
      expect(r.outcome).toBe('skipped')
      expect((await h.db.collection('settings').findOne({ _id: 'backupSchedule' as never }))!.lastRun).toMatchObject({ outcome: 'skipped' })
      expect(existsSync(config.backup.dir) ? (await readdir(config.backup.dir)).filter((n) => n.endsWith('.tar.gz')) : []).toEqual([])
      await releaseLock(h.db.db!, other)
      // The skipped slot is not retried; the next one runs.
      expect((await scheduleTick(jobDeps(h), new Date('2026-10-18T22:00:00Z'))).outcome).toBe('not_due')
      expect((await scheduleTick(jobDeps(h), new Date('2026-10-19T21:00:00Z'))).outcome).toBe('succeeded')
    })

    it('retention deletes only the oldest scheduled backups', async () => {
      await mkdir(config.backup.dir, { recursive: true })
      const sched = ['20261010', '20261011', '20261012', '20261013'].map((d) => `cuka-backup-sched-${d}-030000-abcd.tar.gz`)
      const manual = ['cuka-backup-20261001-030000-abcd.tar.gz', 'cuka-upload-20261001-030000-abcd.tar.gz', 'my-own.tar.gz']
      for (const n of [...sched, ...manual]) await writeFile(dirFile(n), 'x')
      expect((await pruneScheduledBackups(config.backup.dir, 2)).sort()).toEqual(sched.slice(0, 2))
      expect((await readdir(config.backup.dir)).sort()).toEqual([...sched.slice(2), ...manual].sort())

      // Through a scheduled run: keep 1 leaves just the new backup plus the manual ones.
      await scheduleAt({ ...daily, keep: 1 }, new Date('2026-10-01T00:00:00Z'))
      const r = await scheduleTick(jobDeps(h), new Date('2026-10-18T21:00:00Z'))
      expect(r.outcome).toBe('succeeded')
      expect(r.pruned!.sort()).toEqual(sched.slice(2))
      expect((await readdir(config.backup.dir)).sort()).toEqual([r.name!, ...manual].sort())
    })
  })
})

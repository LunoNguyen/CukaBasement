import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Logger } from '@nestjs/common'
import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { processFile } from '../src/jobs/handlers/process-file'
import { UploadsService } from '../src/uploads/uploads.service'
import { SettingsService } from '../src/settings/settings.service'
import { StorageService } from '../src/storage/storage.service'
import { createTestHarness, createUser, type Harness, jobDeps, postMultipart, uploadFixture } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
const ORIGINALS = 'test-cuka-originals'

describe('uploads', () => {
  let h: Harness
  let storage: StorageService
  beforeAll(async () => {
    h = await createTestHarness()
    storage = h.app.get(StorageService)
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const presign = (token: string, body: object) => h.http().post('/api/uploads').set(auth(token)).send(body)
  const complete = (token: string, id: string) => h.http().post(`/api/uploads/${id}/complete`).set(auth(token))

  it('presign: size 52428801 → 413 FILE_TOO_LARGE', async () => {
    const u = await createUser(h)
    const res = await presign(u.token, { name: 'a.png', size: 52428801, mime: 'image/png' })
    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('FILE_TOO_LARGE')
  })

  it('presign: application/x-msdownload → 415 FILE_TYPE_NOT_ALLOWED', async () => {
    const u = await createUser(h)
    const res = await presign(u.token, { name: 'a.exe', size: 10, mime: 'application/x-msdownload' })
    expect(res.status).toBe(415)
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED')
  })

  it('presign: quota exceeded → 429 UPLOAD_QUOTA_EXCEEDED', async () => {
    const u = await createUser(h)
    await h.app.get(SettingsService).update({ dailyUploadQuotaBytes: 100 })
    expect((await presign(u.token, { name: 'a.png', size: 60, mime: 'image/png' })).status).toBe(201)
    const res = await presign(u.token, { name: 'b.png', size: 60, mime: 'image/png' })
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('UPLOAD_QUOTA_EXCEEDED')
  })

  it('presign requires a verified email', async () => {
    const u = await createUser(h, { verified: false })
    const res = await presign(u.token, { name: 'a.png', size: 10, mime: 'image/png' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('presign + upload tiny.png + complete → processing and process-file enqueued', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'tiny.png')
    const png = readFileSync(join(__dirname, 'fixtures', 'tiny.png'))
    const doc = await h.db.collection('files').findOne({ _id: new Types.ObjectId(fileId) })
    expect(doc).toMatchObject({ status: 'processing', kind: 'image', mimeType: 'image/png', sizeBytes: png.length })
    expect(doc!.objectKey).toBe(`${u.id}/${fileId}/original.png`)
    expect(h.jobs.enqueued).toContainEqual({ name: 'process-file', data: { fileId } })
  })

  it('accepts tiny.jpg and returns the FileDto', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'tiny.jpg')
    const again = await complete(u.token, fileId)
    expect(again.status).toBe(200)
    expect(again.body).toEqual({
      id: fileId,
      kind: 'image',
      mimeType: 'image/jpeg',
      sizeBytes: readFileSync(join(__dirname, 'fixtures', 'tiny.jpg')).length,
      status: 'processing',
      originalName: 'tiny.jpg',
    })
  })

  it('zip declared as image/png → complete 415 and object removed', async () => {
    const u = await createUser(h)
    const body = readFileSync(join(__dirname, 'fixtures', 'fake.zip'))
    const p = await presign(u.token, { name: 'evil.png', size: body.length, mime: 'image/png' })
    expect((await postMultipart(p.body.url, p.body.fields, body)).ok).toBe(true)
    const res = await complete(u.token, p.body.fileId)
    expect(res.status).toBe(415)
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED')
    const doc = await h.db.collection('files').findOne({ originalName: 'evil.png' })
    expect(doc!.status).toBe('failed')
    expect(await storage.stat(ORIGINALS, doc!.objectKey)).toBeNull()
    expect(h.jobs.enqueued).toHaveLength(0)
  })

  it('complete without uploading the object → 400 UPLOAD_NOT_FOUND', async () => {
    const u = await createUser(h)
    const p = await presign(u.token, { name: 'a.png', size: 10, mime: 'image/png' })
    const res = await complete(u.token, p.body.fileId)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('UPLOAD_NOT_FOUND')
  })

  it('complete by another user → 404 NOT_FOUND', async () => {
    const a = await createUser(h)
    const b = await createUser(h)
    const p = await presign(a.token, { name: 'a.png', size: 10, mime: 'image/png' })
    const res = await complete(b.token, p.body.fileId)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('complete twice returns same state, enqueues once', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'tiny.png')
    const again = await complete(u.token, fileId)
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ id: fileId, status: 'processing' })
    expect(h.jobs.enqueued.filter((j) => j.name === 'process-file')).toHaveLength(1)
  })

  it('accepts a .clip upload with no recognisable signature and rejects a clip that is really a zip', async () => {
    const u = await createUser(h)
    const clip = Buffer.from('CSFCHUNK-not-a-known-signature')
    const p = await presign(u.token, { name: 'art.clip', size: clip.length, mime: 'application/octet-stream' })
    expect((await postMultipart(p.body.url, p.body.fields, clip)).ok).toBe(true)
    const ok = await complete(u.token, p.body.fileId)
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ kind: 'source', status: 'processing' })
    await expect(uploadFixture(h, u, 'fake.zip', { mime: 'application/octet-stream', name: 'x.clip' })).rejects.toThrow(/415/)
  })

  describe('hardening', () => {
    const fixture = (n: string) => readFileSync(join(__dirname, 'fixtures', n))

    it('re-POSTing to the presigned URL after complete cannot change the stored original', async () => {
      const u = await createUser(h)
      const png = fixture('tiny.png')
      const p = await presign(u.token, { name: 'tiny.png', size: png.length, mime: 'image/png' })
      expect((await postMultipart(p.body.url, p.body.fields, png)).ok).toBe(true)
      expect((await complete(u.token, p.body.fileId)).status).toBe(200)
      // the policy only bounds size, so a same-size payload is accepted by MinIO
      const zip = Buffer.concat([fixture('fake.zip'), Buffer.alloc(Math.max(0, png.length - fixture('fake.zip').length))])
      await postMultipart(p.body.url, p.body.fields, zip)
      const doc = await h.db.collection('files').findOne({ _id: new Types.ObjectId(p.body.fileId) })
      const head = await storage.readHead(ORIGINALS, doc!.objectKey, 8)
      expect(head.equals(png.subarray(0, 8))).toBe(true)
      expect((await complete(u.token, p.body.fileId)).body.status).toBe('processing')
      expect(h.jobs.enqueued.filter((j) => j.name === 'process-file')).toHaveLength(1)
    })

    it('.clip name with a non-octet-stream mime must still pass magic-byte detection', async () => {
      const u = await createUser(h)
      const junk = Buffer.from('definitely not a psd')
      const p = await presign(u.token, { name: 'x.clip', size: junk.length, mime: 'image/vnd.adobe.photoshop' })
      expect(p.status).toBe(201)
      expect((await postMultipart(p.body.url, p.body.fields, junk)).ok).toBe(true)
      const res = await complete(u.token, p.body.fileId)
      expect(res.status).toBe(415)
      expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED')
    })

    it('uploading more bytes than declared is rejected by the storage policy', async () => {
      const u = await createUser(h)
      const png = fixture('tiny.png')
      const p = await presign(u.token, { name: 'tiny.png', size: 10, mime: 'image/png' })
      const up = await postMultipart(p.body.url, p.body.fields, png)
      expect(up.status).toBe(400)
    })

    it('object key extension comes from the mime whitelist, not the declared name', async () => {
      const u = await createUser(h)
      const p = await presign(u.token, { name: 'x.html', size: 10, mime: 'image/png' })
      const doc = await h.db.collection('files').findOne({ _id: new Types.ObjectId(p.body.fileId) })
      expect(doc!.objectKey).toBe(`${u.id}/${p.body.fileId}/original.png`)
    })

    it('legit mp4 and mp3 complete → processing', async () => {
      const u = await createUser(h)
      const mp4 = await uploadFixture(h, u, 'one-second.mp4', { mime: 'video/mp4', name: 'one-second.mp4' })
      const mp3 = await uploadFixture(h, u, 'tone.mp3', { mime: 'audio/mpeg', name: 'tone.mp3' })
      for (const id of [mp4, mp3]) {
        const doc = await h.db.collection('files').findOne({ _id: new Types.ObjectId(id) })
        expect(doc!.status).toBe('processing')
      }
    })

    it('a complete racing the winner returns 200 without copying, so the validated original stays intact', async () => {
      const u = await createUser(h)
      const png = fixture('tiny.png')
      const p = await presign(u.token, { name: 'tiny.png', size: png.length, mime: 'image/png' })
      expect((await postMultipart(p.body.url, p.body.fields, png)).ok).toBe(true)
      const svc = h.app.get(UploadsService)
      let loser: Awaited<ReturnType<typeof complete>> | undefined
      svc.testHooks.afterCopy = async () => {
        svc.testHooks.afterCopy = undefined
        const zip = Buffer.concat([fixture('fake.zip'), Buffer.alloc(png.length - fixture('fake.zip').length)])
        expect((await postMultipart(p.body.url, p.body.fields, zip)).ok).toBe(true)
        loser = await complete(u.token, p.body.fileId)
      }
      const winner = await complete(u.token, p.body.fileId)
      expect(loser?.status).toBe(200)
      expect(winner.status).toBe(200)
      const doc = await h.db.collection('files').findOne({ _id: new Types.ObjectId(p.body.fileId) })
      expect((await storage.readHead(ORIGINALS, doc!.objectKey, 8)).equals(png.subarray(0, 8))).toBe(true)
      expect(h.jobs.enqueued.filter((j) => j.name === 'process-file')).toHaveLength(1)
    })

    it('an unexpected error after the claim reverts the file to uploading and a retry succeeds', async () => {
      const u = await createUser(h)
      const png = fixture('tiny.png')
      const p = await presign(u.token, { name: 'tiny.png', size: png.length, mime: 'image/png' })
      expect((await postMultipart(p.body.url, p.body.fields, png)).ok).toBe(true)
      h.app.get(UploadsService).testHooks.afterCopy = async () => {
        h.app.get(UploadsService).testHooks.afterCopy = undefined
        throw new Error('boom')
      }
      const quiet = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
      expect((await complete(u.token, p.body.fileId)).status).toBe(500)
      quiet.mockRestore()
      const doc = await h.db.collection('files').findOne({ _id: new Types.ObjectId(p.body.fileId) })
      expect(doc!.status).toBe('uploading')
      expect(h.jobs.enqueued).toHaveLength(0)
      const retry = await complete(u.token, p.body.fileId)
      expect(retry.status).toBe(200)
      expect(retry.body.status).toBe('processing')
    })

    it('a failing staging cleanup after success still returns processing and enqueues once', async () => {
      const u = await createUser(h)
      const png = fixture('tiny.png')
      const p = await presign(u.token, { name: 'tiny.png', size: png.length, mime: 'image/png' })
      expect((await postMultipart(p.body.url, p.body.fields, png)).ok).toBe(true)
      const original = storage.remove.bind(storage)
      const spy = vi.spyOn(storage, 'remove').mockImplementation(async (bucket, key) => {
        if (key.endsWith('/upload.png')) throw new Error('transient storage error')
        return original(bucket, key)
      })
      const quiet = [vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {}), vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})]
      const res = await complete(u.token, p.body.fileId)
      spy.mockRestore()
      quiet.forEach((q) => q.mockRestore())
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('processing')
      const doc = await h.db.collection('files').findOne({ _id: new Types.ObjectId(p.body.fileId) })
      expect(doc!.status).toBe('processing')
      expect(h.jobs.enqueued.filter((j) => j.name === 'process-file')).toEqual([{ name: 'process-file', data: { fileId: p.body.fileId } }])
    })

    it('staging missing because a concurrent complete already finished → current state, not 400', async () => {
      const u = await createUser(h)
      const p = await presign(u.token, { name: 'a.png', size: 10, mime: 'image/png' })
      const spy = vi.spyOn(storage, 'stat').mockImplementationOnce(async () => {
        await h.db.collection('files').updateOne({ _id: new Types.ObjectId(p.body.fileId) }, { $set: { status: 'validating' } })
        return null
      })
      const res = await complete(u.token, p.body.fileId)
      spy.mockRestore()
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('uploading')
    })

    it('presign reports maxBytes equal to the declared size', async () => {
      const u = await createUser(h)
      const p = await presign(u.token, { name: 'a.png', size: 1234, mime: 'image/png' })
      expect(p.body.maxBytes).toBe(1234)
    })

    it('two concurrent completes enqueue once', async () => {
      const u = await createUser(h)
      const png = fixture('tiny.png')
      const p = await presign(u.token, { name: 'tiny.png', size: png.length, mime: 'image/png' })
      expect((await postMultipart(p.body.url, p.body.fields, png)).ok).toBe(true)
      const [a, b] = await Promise.all([complete(u.token, p.body.fileId), complete(u.token, p.body.fileId)])
      expect([a.status, b.status]).toEqual([200, 200])
      expect(h.jobs.enqueued.filter((j) => j.name === 'process-file')).toHaveLength(1)
    })
  })

  describe('avatar/banner via PATCH /me', () => {
    it('avatarFileId of someone else’s file → 400 FILE_NOT_READY', async () => {
      const a = await createUser(h)
      const b = await createUser(h)
      const fileId = await uploadFixture(h, a, 'tiny.png')
      const res = await h.http().patch('/api/me').set(auth(b.token)).send({ avatarFileId: fileId })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('FILE_NOT_READY')
    })

    it('a non-image own file → 400 FILE_NOT_READY; an own image is accepted', async () => {
      const u = await createUser(h)
      const zip = await uploadFixture(h, u, 'fake.zip')
      const bad = await h.http().patch('/api/me').set(auth(u.token)).send({ bannerFileId: zip })
      expect(bad.status).toBe(400)
      expect(bad.body.error.code).toBe('FILE_NOT_READY')
      const png = await uploadFixture(h, u, 'tiny.png')
      const ok = await h.http().patch('/api/me').set(auth(u.token)).send({ avatarFileId: png })
      expect(ok.status).toBe(200)
      expect(ok.body.profile.avatarFileId).toBe(png)
    })

    it('setting an avatar or banner enqueues relocate-file so its variants become public', async () => {
      const u = await createUser(h)
      const fileId = await uploadFixture(h, u, 'tiny.png')
      h.jobs.clear()
      expect((await h.http().patch('/api/me').set(auth(u.token)).send({ avatarFileId: fileId, bannerFileId: fileId })).status).toBe(200)
      expect(h.jobs.enqueued).toEqual([{ name: 'relocate-file', data: { fileId } }])
      await processFile(jobDeps(h), { fileId })
      const res = await h.http().get(`/api/users/${u.username}`)
      expect(res.body.avatarUrl).toBe(storage.publicUrl(`${u.id}/${fileId}/thumb_md.webp`))
    })

    it('a file attached to a post cannot become an avatar or banner → 400 FILE_NOT_READY, nothing published', async () => {
      const u = await createUser(h)
      const fileId = await uploadFixture(h, u, 'tiny.png')
      await processFile(jobDeps(h), { fileId })
      const credit = { isOwnWork: false, artistName: 'Ruri', artistHandle: '@r', platform: 'x', sourceUrl: 'https://x.com/r/status/1' }
      const post = await h.http().post('/api/posts').set(auth(u.token)).send({
        type: 'illustration', title: 't', rating: 'all', tags: [], aiDeclaration: true, credit, files: [{ fileId, position: 0, isCover: true }],
      })
      expect(post.status).toBe(201)
      h.jobs.clear()
      for (const key of ['avatarFileId', 'bannerFileId']) {
        const res = await h.http().patch('/api/me').set(auth(u.token)).send({ [key]: fileId })
        expect(res.status, key).toBe(400)
        expect(res.body.error.code).toBe('FILE_NOT_READY')
      }
      expect(h.jobs.enqueued).toEqual([])
      expect(await storage.stat('test-cuka-public', `${u.id}/${fileId}/thumb_md.webp`)).toBeNull()
      expect((await h.db.collection('users').findOne({ _id: new Types.ObjectId(u.id) }))!.profile.avatarFileId ?? null).toBeNull()
    })

    it('GET /users/:username returns the public URL of the thumb_md variant', async () => {
      const u = await createUser(h)
      const fileId = await uploadFixture(h, u, 'tiny.png')
      const objectKey = `${u.id}/${fileId}/thumb_md.webp`
      await h.db.collection('files').updateOne(
        { _id: new Types.ObjectId(fileId) },
        { $set: { status: 'ready', variants: [{ name: 'thumb_md', bucket: 'test-cuka-public', objectKey, width: 64, height: 48 }] } },
      )
      expect((await h.http().patch('/api/me').set(auth(u.token)).send({ avatarFileId: fileId })).status).toBe(200)
      const res = await h.http().get(`/api/users/${u.username}`)
      expect(res.status).toBe(200)
      expect(res.body.avatarUrl).toBe(storage.publicUrl(objectKey))
    })
  })
})

import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CONFIG, type Config } from '../src/config/config'
import { processFile } from '../src/jobs/handlers/process-file'
import { relocateFile } from '../src/jobs/handlers/relocate-variants'
import { StorageService } from '../src/storage/storage.service'
import { createTestHarness, createUser, type Harness, jobDeps, uploadFixture } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

function yearsAgo(n: number, extraDays = 0): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  d.setUTCDate(d.getUTCDate() + extraDays)
  return d.toISOString().slice(0, 10)
}

describe('me and user endpoints', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  it('PATCH /me updates displayName and bio; bio of 501 chars → 400 VALIDATION_FAILED', async () => {
    const u = await createUser(h)
    const ok = await h.http().patch('/api/me').set(auth(u.token)).send({ displayName: 'New Name', bio: 'hello', socialLinks: { x: 'https://x.com/a' } })
    expect(ok.status).toBe(200)
    expect(ok.body.profile).toMatchObject({ displayName: 'New Name', bio: 'hello', socialLinks: { x: 'https://x.com/a', pixiv: '' } })
    const bad = await h.http().patch('/api/me').set(auth(u.token)).send({ bio: 'a'.repeat(501) })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('VALIDATION_FAILED')
  })

  it('showR18 without birthDate → 400 AGE_REQUIRED', async () => {
    const u = await createUser(h)
    const res = await h.http().patch('/api/me/settings').set(auth(u.token)).send({ showR18: true })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('AGE_REQUIRED')
    expect((await h.http().get('/api/me').set(auth(u.token))).body.showR18).toBe(false)
  })

  it('showR18 with birthDate making user 17 → 400 AGE_REQUIRED', async () => {
    const u = await createUser(h)
    const res = await h.http().patch('/api/me/settings').set(auth(u.token)).send({ birthDate: yearsAgo(18, 1), showR18: true })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('AGE_REQUIRED')
    expect((await h.http().get('/api/me').set(auth(u.token))).body.birthDate).toBeNull()
  })

  it('birthDate + showR18 in one request for adult → 200 and /me shows showR18 true', async () => {
    const u = await createUser(h)
    const res = await h.http().patch('/api/me/settings').set(auth(u.token)).send({ birthDate: yearsAgo(20), showR18: true, locale: 'en' })
    expect(res.status).toBe(200)
    const me = await h.http().get('/api/me').set(auth(u.token))
    expect(me.body).toMatchObject({ showR18: true, locale: 'en', birthDate: yearsAgo(20) })
  })

  it('GET /users/:username returns public profile; banned user → 404', async () => {
    const u = await createUser(h)
    const b = await createUser(h, { status: 'banned' })
    const ok = await h.http().get(`/api/users/${u.username}`)
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ id: u.id, username: u.username, avatarUrl: null, bannerUrl: null, isFollowing: false })
    expect(ok.body.email).toBeUndefined()
    expect((await h.http().get(`/api/users/${b.username}`)).status).toBe(404)
    expect((await h.http().get('/api/users/nobody')).status).toBe(404)
  })

  it('change password with wrong current → 400 INVALID_CREDENTIALS', async () => {
    const u = await createUser(h, { password: 'old password 1' })
    const res = await h.http().post('/api/me/password').set(auth(u.token)).send({ currentPassword: 'wrong wrong', newPassword: 'new password 1' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('change password succeeds and revokes other refresh tokens but keeps the current one', async () => {
    const u = await createUser(h, { password: 'old password 1' })
    const cookieOf = (r: { headers: Record<string, any> }) =>
      (r.headers['set-cookie'] as string[]).find((s) => s.startsWith('cuka_rt='))!.split(';')[0]!
    const a = await h.http().post('/api/auth/login').send({ email: u.email, password: 'old password 1' })
    const b = await h.http().post('/api/auth/login').send({ email: u.email, password: 'old password 1' })
    const res = await h
      .http()
      .post('/api/me/password')
      .set(auth(u.token))
      .set('Cookie', cookieOf(a))
      .send({ currentPassword: 'old password 1', newPassword: 'new password 1' })
    expect(res.status).toBe(204)
    expect((await h.http().post('/api/auth/refresh').set('Cookie', cookieOf(b))).status).toBe(401)
    expect((await h.http().post('/api/auth/refresh').set('Cookie', cookieOf(a))).status).toBe(200)
    expect((await h.http().post('/api/auth/login').send({ email: u.email, password: 'new password 1' })).status).toBe(200)
  })

  it('/me requires authentication', async () => {
    expect((await h.http().get('/api/me')).status).toBe(401)
  })

  it('avatarUrl is the public thumb_md URL only when that variant is in the public bucket; otherwise null', async () => {
    const config = h.app.get<Config>(CONFIG)
    const u = await createUser(h)
    const seedAvatar = async (bucket: string) => {
      const _id = new Types.ObjectId()
      await h.db.collection('files').insertOne({
        _id,
        ownerId: new Types.ObjectId(u.id),
        bucket: config.minio.bucketOriginals,
        objectKey: `${u.id}/${_id}/original.png`,
        originalName: 'a.png',
        mimeType: 'image/png',
        sizeBytes: 1,
        kind: 'image',
        status: 'ready',
        variants: [{ name: 'thumb_md', bucket, objectKey: `${u.id}/${_id}/thumb_md.webp`, width: 1, height: 1 }],
        createdAt: new Date(),
      })
      await h.db.collection('users').updateOne({ _id: new Types.ObjectId(u.id) }, { $set: { 'profile.avatarFileId': _id } })
      return _id.toString()
    }
    const avatarUrl = async () => (await h.http().get(`/api/users/${u.username}`)).body.avatarUrl

    const pub = await seedAvatar(config.minio.bucketPublic)
    expect(await avatarUrl()).toEqual(expect.stringContaining(`${pub}/thumb_md.webp`))
    await seedAvatar(config.minio.bucketOriginals)
    expect(await avatarUrl()).toBeNull()
  })

  it('MeDto carries avatarUrl/bannerUrl: null before publishing, the public thumb_md URL after relocate-file (me, PATCH, settings, login, refresh)', async () => {
    const storage = h.app.get(StorageService)
    const u = await createUser(h, { password: 'pw-123456789' })
    const before = await h.http().get('/api/me').set(auth(u.token))
    expect(before.body).toMatchObject({ avatarUrl: null, bannerUrl: null })

    const avatar = await uploadFixture(h, u, 'tiny.png')
    const banner = await uploadFixture(h, u, 'tiny.jpg')
    await processFile(jobDeps(h), { fileId: avatar })
    await processFile(jobDeps(h), { fileId: banner })
    const patched = await h.http().patch('/api/me').set(auth(u.token)).send({ avatarFileId: avatar, bannerFileId: banner })
    expect(patched.status).toBe(200)
    // Variants are still private until relocate-file runs in the worker.
    expect(patched.body).toMatchObject({ avatarUrl: null, bannerUrl: null })
    await relocateFile(jobDeps(h), { fileId: avatar })
    await relocateFile(jobDeps(h), { fileId: banner })

    // The public thumb_md URL, versioned by its render time.
    const versioned = (fileId: string) => expect.stringMatching(new RegExp(`^${storage.publicUrl(`${u.id}/${fileId}/thumb_md.webp`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?v=\\d+$`))
    const want = {
      avatarUrl: versioned(avatar),
      bannerUrl: versioned(banner),
    }
    expect((await h.http().get('/api/me').set(auth(u.token))).body).toMatchObject(want)
    expect((await h.http().patch('/api/me').set(auth(u.token)).send({ bio: 'x' })).body).toMatchObject(want)
    expect((await h.http().patch('/api/me/settings').set(auth(u.token)).send({ locale: 'en' })).body).toMatchObject(want)
    const li = await h.http().post('/api/auth/login').send({ email: u.email, password: 'pw-123456789' })
    expect(li.status).toBe(200)
    expect(li.body.user).toMatchObject(want)
    const rt = (li.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('cuka_rt='))!.split(';')[0]!
    const rf = await h.http().post('/api/auth/refresh').set('Cookie', rt)
    expect(rf.status).toBe(200)
    expect(rf.body.user).toMatchObject(want)
  })
})

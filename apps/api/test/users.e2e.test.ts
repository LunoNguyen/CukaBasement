import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestHarness, createUser, type Harness } from './harness'

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
})

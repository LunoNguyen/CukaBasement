import type { Response } from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestHarness, createUser, type Harness, testConfig } from './harness'

const PASSWORD = 'correct horse battery'
const NEW_PASSWORD = 'another long passphrase'
const EMAIL = 'user1@example.com'

function refreshCookie(res: Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  return raw?.find((s) => s.startsWith('cuka_rt='))?.slice('cuka_rt='.length).split(';')[0]
}

const tokenOf = (link: string) => new URL(link).searchParams.get('token')!

describe('auth email flows', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const register = () =>
    h.http().post('/api/auth/register').send({ email: EMAIL, password: PASSWORD, username: 'user_1', displayName: 'User 1' })
  const login = (password = PASSWORD) => h.http().post('/api/auth/login').send({ email: EMAIL, password })
  const verify = (token: string) => h.http().post('/api/auth/verify-email').send({ token })
  const forgot = (email: string) => h.http().post('/api/auth/forgot-password').send({ email })
  const reset = (token: string, password = NEW_PASSWORD) =>
    h.http().post('/api/auth/reset-password').send({ token, password })

  it('verify link from email marks user verified; reusing token → 400 TOKEN_INVALID', async () => {
    await register().expect(201)
    const token = tokenOf(h.mail.lastLinkFor(EMAIL))
    await verify(token).expect(204)
    const user = await h.db.collection('users').findOne({ email: EMAIL })
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date)
    expect((await login().expect(200)).body.user.emailVerified).toBe(true)

    const again = await verify(token).expect(400)
    expect(again.body).toEqual({ error: { code: 'TOKEN_INVALID', message: expect.any(String) } })
    expect((await verify('garbage').expect(400)).body.error.code).toBe('TOKEN_INVALID')
  })

  it('resend-verification sends a working link; already verified → 204 and nothing sent', async () => {
    await h.http().post('/api/auth/resend-verification').expect(401)
    const u = await createUser(h, { verified: false })
    const auth = { Authorization: `Bearer ${u.token}` }
    await h.http().post('/api/auth/resend-verification').set(auth).expect(204)
    await verify(tokenOf(h.mail.lastLinkFor(u.email))).expect(204)
    expect((await h.db.collection('users').findOne({ email: u.email }))?.emailVerifiedAt).toBeInstanceOf(Date)

    const count = h.mail.sent.length
    await h.http().post('/api/auth/resend-verification').set(auth).expect(204)
    expect(h.mail.sent.length).toBe(count)
  })

  it('resend-verification: 4th request in an hour → 429', async () => {
    h.enableThrottling()
    const u = await createUser(h, { verified: false })
    const auth = { Authorization: `Bearer ${u.token}` }
    for (let i = 0; i < 3; i++) await h.http().post('/api/auth/resend-verification').set(auth).expect(204)
    const r = await h.http().post('/api/auth/resend-verification').set(auth).expect(429)
    expect(r.body.error.code).toBe('RATE_LIMITED')
  })

  it('forgot-password for unknown email still 204 and sends nothing', async () => {
    await forgot('nobody@example.com').expect(204)
    expect(h.mail.sent).toHaveLength(0)
  })

  it('forgot-password: 4th request in an hour from one IP → 429', async () => {
    h.enableThrottling()
    for (let i = 0; i < 3; i++) await forgot(`nobody${i}@example.com`).expect(204)
    expect((await forgot('nobody9@example.com').expect(429)).body.error.code).toBe('RATE_LIMITED')
  })

  it('reset-password changes password and revokes existing refresh cookies', async () => {
    await register().expect(201)
    const rt = refreshCookie(await login().expect(200))!
    await forgot('User1@Example.com').expect(204)
    const link = h.mail.lastLinkFor(EMAIL)
    expect(link).toMatch(new RegExp(`^${testConfig().appUrl}/reset-password\\?token=[A-Za-z0-9_-]{43}$`))
    const stored = await h.db.collection('authTokens').findOne({ type: 'reset_password' })
    expect(stored!.expiresAt.getTime() - Date.now()).toBeGreaterThan(3600_000 - 60_000)
    expect(stored!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600_000)

    await reset(tokenOf(link)).expect(204)
    expect((await login(PASSWORD).expect(401)).body.error.code).toBe('INVALID_CREDENTIALS')
    await login(NEW_PASSWORD).expect(200)
    const r = await h.http().post('/api/auth/refresh').set('Cookie', `cuka_rt=${rt}`).expect(401)
    expect(r.body.error.code).toBe('TOKEN_INVALID')

    const reuse = await reset(tokenOf(link), 'yet another passphrase').expect(400)
    expect(reuse.body).toEqual({ error: { code: 'TOKEN_INVALID', message: expect.any(String) } })
  })

  it('expired token (2 h old) for reset → 400 TOKEN_INVALID', async () => {
    await register().expect(201)
    await forgot(EMAIL).expect(204)
    const token = tokenOf(h.mail.lastLinkFor(EMAIL))
    await h.db
      .collection('authTokens')
      .updateOne({ type: 'reset_password' }, { $set: { expiresAt: new Date(Date.now() - 3600_000) } })
    const r = await reset(token).expect(400)
    expect(r.body).toEqual({ error: { code: 'TOKEN_INVALID', message: expect.any(String) } })
    await login(PASSWORD).expect(200)
  })

  it('expired verify token → 400 TOKEN_INVALID', async () => {
    await register().expect(201)
    const token = tokenOf(h.mail.lastLinkFor(EMAIL))
    await h.db
      .collection('authTokens')
      .updateOne({ type: 'verify_email' }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await verify(token).expect(400)).body.error.code).toBe('TOKEN_INVALID')
  })
})

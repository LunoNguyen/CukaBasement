import { createHash } from 'node:crypto'
import type { Response } from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestHarness, type Harness, testConfig } from './harness'

const PASSWORD = 'correct horse battery'

function newUser(n = 1) {
  return { email: `User${n}@Example.com`, password: PASSWORD, username: `user_${n}`, displayName: `User ${n}` }
}

/** Returns the raw `cuka_rt` value set by the response, or undefined. */
function refreshCookie(res: Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined
  const c = raw?.find((s) => s.startsWith('cuka_rt='))
  return c?.slice('cuka_rt='.length).split(';')[0]
}

describe('auth', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const register = (body: ReturnType<typeof newUser>) => h.http().post('/api/auth/register').send(body)
  const login = (email: string, password = PASSWORD) => h.http().post('/api/auth/login').send({ email, password })
  const refresh = (cookie?: string) => {
    const req = h.http().post('/api/auth/refresh')
    return cookie === undefined ? req : req.set('Cookie', `cuka_rt=${cookie}`)
  }

  it('register → login → refresh rotates → old refresh rejected and family revoked', async () => {
    const u = newUser()
    const reg = await register(u).expect(201)
    expect(reg.body).toEqual({ userId: expect.stringMatching(/^[0-9a-f]{24}$/) })

    const link = h.mail.lastLinkFor('user1@example.com')
    expect(link).toMatch(new RegExp(`^${testConfig().appUrl}/verify-email\\?token=[A-Za-z0-9_-]{43}$`))
    const token = new URL(link).searchParams.get('token')!
    const vt = await h.db.collection('authTokens').findOne({ type: 'verify_email' })
    expect(vt?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(vt?.userId.toString()).toBe(reg.body.userId)
    expect(vt?.expiresAt.getTime() - Date.now()).toBeGreaterThan(24 * 3600_000 - 60_000)
    expect(vt?.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3600_000)

    const li = await login(u.email).expect(200)
    expect(li.body).toEqual({
      accessToken: expect.any(String),
      user: {
        id: reg.body.userId,
        email: 'user1@example.com',
        role: 'user',
        status: 'active',
        emailVerified: false,
        locale: 'vi',
        showR18: false,
        birthDate: null,
        profile: {
          username: 'user_1',
          displayName: 'User 1',
          bio: '',
          avatarFileId: null,
          bannerFileId: null,
          socialLinks: { x: '', facebook: '', youtube: '', pixiv: '' },
        },
      },
    })
    const setCookie = (li.headers['set-cookie'] as unknown as string[]).find((s) => s.startsWith('cuka_rt='))!
    expect(setCookie).toMatch(/; Path=\/api\/auth/)
    expect(setCookie).toMatch(/; HttpOnly/)
    expect(setCookie).toMatch(/; SameSite=Lax/)
    expect(setCookie).toMatch(/; Max-Age=2592000/)
    expect(setCookie).not.toMatch(/Secure/)
    const a = refreshCookie(li)!
    const stored = await h.db.collection('authTokens').findOne({ type: 'refresh' })
    expect(stored?.tokenHash).toBe(createHash('sha256').update(a).digest('hex'))
    expect(stored?.familyId).toEqual(expect.any(String))
    expect((await h.db.collection('users').findOne({}))?.lastLoginAt).toBeInstanceOf(Date)

    const r1 = await refresh(a).expect(200)
    expect(r1.body).toEqual({ accessToken: expect.any(String), user: li.body.user })
    const b = refreshCookie(r1)!
    expect(b).toBeTruthy()
    expect(b).not.toBe(a)
    const family = await h.db.collection('authTokens').find({ type: 'refresh' }).toArray()
    expect(family).toHaveLength(2)
    expect(new Set(family.map((t) => t.familyId)).size).toBe(1)

    const reuse = await refresh(a).expect(401)
    expect(reuse.body).toEqual({ error: { code: 'TOKEN_INVALID', message: expect.any(String) } })
    const revoked = await refresh(b).expect(401)
    expect(revoked.body.error.code).toBe('TOKEN_INVALID')
    expect(await h.db.collection('authTokens').countDocuments({ type: 'refresh' })).toBe(0)
  })

  it('duplicate email → 409 EMAIL_TAKEN; duplicate username → 409 USERNAME_TAKEN', async () => {
    await register(newUser(1)).expect(201)
    const dupEmail = await register({ ...newUser(2), email: 'user1@EXAMPLE.com' }).expect(409)
    expect(dupEmail.body).toEqual({ error: { code: 'EMAIL_TAKEN', message: expect.any(String) } })
    const dupName = await register({ ...newUser(3), username: 'user_1' }).expect(409)
    expect(dupName.body).toEqual({ error: { code: 'USERNAME_TAKEN', message: expect.any(String) } })
  })

  it('wrong password and unknown email give identical 401 INVALID_CREDENTIALS bodies', async () => {
    await register(newUser()).expect(201)
    const wrong = await login('user1@example.com', 'not the password').expect(401)
    const unknown = await login('nobody@example.com').expect(401)
    expect(wrong.body).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: expect.any(String) } })
    expect(unknown.body).toEqual(wrong.body)
    expect(refreshCookie(wrong)).toBeUndefined()
  })

  it('banned user cannot log in → 403 ACCOUNT_BANNED', async () => {
    await register(newUser()).expect(201)
    await h.db.collection('users').updateOne({ email: 'user1@example.com' }, { $set: { status: 'banned' } })
    const r = await login('user1@example.com').expect(403)
    expect(r.body).toEqual({ error: { code: 'ACCOUNT_BANNED', message: expect.any(String) } })
  })

  it('logout clears cookie and refresh afterwards → 401', async () => {
    await register(newUser()).expect(201)
    const a = refreshCookie(await login('user1@example.com').expect(200))!
    const out = await h.http().post('/api/auth/logout').set('Cookie', `cuka_rt=${a}`).expect(204)
    const cleared = (out.headers['set-cookie'] as unknown as string[]).find((s) => s.startsWith('cuka_rt='))!
    expect(cleared).toMatch(/^cuka_rt=;/)
    expect(cleared).toMatch(/; Path=\/api\/auth/)
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/)
    expect((await refresh(a).expect(401)).body.error.code).toBe('TOKEN_INVALID')
    await h.http().post('/api/auth/logout').set('Cookie', `cuka_rt=${a}`).expect(204)
    await h.http().post('/api/auth/logout').expect(204)
    expect((await refresh().expect(401)).body.error.code).toBe('TOKEN_INVALID')
  })

  it('6th login attempt in a minute → 429 RATE_LIMITED', async () => {
    h.enableThrottling()
    for (let i = 0; i < 5; i++) await login('flood@example.com', 'wrong-password').expect(401)
    const r = await login('flood@example.com', 'wrong-password').expect(429)
    expect(r.body).toEqual({ error: { code: 'RATE_LIMITED', message: expect.any(String) } })
    // keyed by ip + email: another email from the same IP is still allowed
    await login('other@example.com', 'wrong-password').expect(401)
  })

  it('password is stored as argon2id hash', async () => {
    await register(newUser()).expect(201)
    const user = (await h.db.collection('users').findOne({ email: 'user1@example.com' }))!
    expect(user.passwordHash).toMatch(/^\$argon2id\$/)
  })
})

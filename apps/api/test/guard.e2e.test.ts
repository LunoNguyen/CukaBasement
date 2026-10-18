import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { canSeeR18, isAdult } from '../src/auth/viewer'
import { createTestHarness, createUser, type Harness } from './harness'

describe('auth guard', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

  it('public route with garbage bearer token behaves as anonymous (200)', async () => {
    await h.http().get('/api/health').set(bearer('garbage')).expect(200, { ok: true, maintenance: false })
    const r = await h.http().get('/api/__test/public').set(bearer('garbage')).expect(200)
    expect(r.body).toEqual({ viewer: null })
  })

  it('public route with a valid token exposes the viewer loaded from the DB', async () => {
    const u = await createUser(h, { role: 'moderator', birthDate: '2000-01-01', showR18: true })
    const r = await h.http().get('/api/__test/public').set(bearer(u.token)).expect(200)
    expect(r.body).toEqual({
      viewer: { id: u.id, role: 'moderator', status: 'active', emailVerified: true, isAdult: true, showR18: true },
    })
  })

  it('@Auth route with garbage token → 401 UNAUTHENTICATED', async () => {
    const r = await h.http().get('/api/__test/auth').set(bearer('garbage')).expect(401)
    expect(r.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } })
    expect((await h.http().get('/api/__test/auth').expect(401)).body.error.code).toBe('UNAUTHENTICATED')
  })

  it('banned user is anonymous', async () => {
    const u = await createUser(h, { status: 'banned' })
    expect((await h.http().get('/api/__test/public').set(bearer(u.token)).expect(200)).body).toEqual({ viewer: null })
    expect((await h.http().get('/api/__test/auth').set(bearer(u.token)).expect(401)).body.error.code).toBe(
      'UNAUTHENTICATED',
    )
  })

  it('@Auth({verified:true}) with unverified user → 403 EMAIL_NOT_VERIFIED', async () => {
    const u = await createUser(h, { verified: false })
    await h.http().get('/api/__test/auth').set(bearer(u.token)).expect(200)
    const r = await h.http().get('/api/__test/verified').set(bearer(u.token)).expect(403)
    expect(r.body).toEqual({ error: { code: 'EMAIL_NOT_VERIFIED', message: expect.any(String) } })
    const v = await createUser(h)
    await h.http().get('/api/__test/verified').set(bearer(v.token)).expect(200)
  })

  it('@Auth({write:true}) with suspended user → 403 ACCOUNT_SUSPENDED', async () => {
    const u = await createUser(h, { status: 'suspended' })
    await h.http().get('/api/__test/auth').set(bearer(u.token)).expect(200)
    const r = await h.http().post('/api/__test/write').set(bearer(u.token)).expect(403)
    expect(r.body).toEqual({ error: { code: 'ACCOUNT_SUSPENDED', message: expect.any(String) } })
    const v = await createUser(h)
    await h.http().post('/api/__test/write').set(bearer(v.token)).expect(201)
  })

  it('@Auth({roles}) with another role → 403 FORBIDDEN; role is read fresh from the DB', async () => {
    const u = await createUser(h)
    const r = await h.http().get('/api/__test/admin').set(bearer(u.token)).expect(403)
    expect(r.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } })
    await h.db.collection('users').updateOne({ email: u.email }, { $set: { role: 'admin' } })
    await h.http().get('/api/__test/admin').set(bearer(u.token)).expect(200)
  })

  it('isAdult boundary', () => {
    expect(isAdult(new Date('2008-10-17'), new Date('2026-10-17'))).toBe(true)
    expect(isAdult(new Date('2008-10-18'), new Date('2026-10-17'))).toBe(false)
    expect(isAdult(null)).toBe(false)
  })

  it('canSeeR18 requires adult and showR18', () => {
    const v = { id: 'x', role: 'user', status: 'active', emailVerified: true, isAdult: true, showR18: true } as const
    expect(canSeeR18(v)).toBe(true)
    expect(canSeeR18({ ...v, showR18: false })).toBe(false)
    expect(canSeeR18({ ...v, isAdult: false })).toBe(false)
    expect(canSeeR18(null)).toBe(false)
  })
})

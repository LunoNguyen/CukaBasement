import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { ApiError, refreshOnce, request } from '@/api/client'
import { useAuth } from '@/stores/auth'
import { installFakeFetch, makeMe, type FakeFetch } from './fakeApi'

let fake: FakeFetch | undefined

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  fake?.restore()
  fake = undefined
  vi.restoreAllMocks()
})

const ok = (body: unknown = { ok: true }) => ({ status: 200, body })
const unauth = { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'expired' } } }

describe('api client', () => {
  it('serializes refresh: 3 parallel 401s → 1 refresh call, 3 retried successes', async () => {
    const auth = useAuth()
    auth.token = 'old'
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    fake = installFakeFetch({
      'GET /api/thing': (req) => (req.headers.authorization === 'Bearer new' ? ok({ n: 1 }) : unauth),
      'POST /api/auth/refresh': async () => {
        await gate
        return ok({ accessToken: 'new', user: makeMe() })
      },
    })

    const all = Promise.all([request('/thing'), request('/thing'), request('/thing')])
    await vi.waitFor(() => expect(fake!.callsTo('GET /api/thing')).toHaveLength(3))
    release()
    const results = await all

    expect(results).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }])
    expect(fake.callsTo('POST /api/auth/refresh')).toHaveLength(1)
    expect(fake.callsTo('GET /api/thing')).toHaveLength(6)
    expect(auth.token).toBe('new')
    expect(auth.user?.id).toBe('u1')
  })

  it('refresh failure clears auth and rejects with UNAUTHENTICATED', async () => {
    const auth = useAuth()
    auth.token = 'old'
    auth.user = makeMe()
    fake = installFakeFetch({
      'GET /api/thing': unauth,
      'POST /api/auth/refresh': { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'no session' } } },
    })

    const err = await request('/thing').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    expect(auth.token).toBeNull()
    expect(auth.user).toBeNull()
    expect(fake.callsTo('GET /api/thing')).toHaveLength(1)
  })

  it('does not try refresh for /auth/login 401 (INVALID_CREDENTIALS surfaces)', async () => {
    fake = installFakeFetch({
      'POST /api/auth/login': { status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'bad' } } },
    })
    const err = await request('/auth/login', { method: 'POST', body: { email: 'a@b.c', password: 'x' } }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 })
    expect(fake.callsTo('POST /api/auth/refresh')).toHaveLength(0)
    expect(fake.calls[0]!.body).toEqual({ email: 'a@b.c', password: 'x' })
    expect(fake.calls[0]!.headers['content-type']).toBe('application/json')
  })

  it('network failure → ApiError code NETWORK, status 0', async () => {
    fake = installFakeFetch({
      'GET /api/thing': () => {
        throw new TypeError('Failed to fetch')
      },
    })
    const err = await request('/thing').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ code: 'NETWORK', status: 0 })
  })

  it('error envelope → ApiError with code/status/details', async () => {
    const details = [{ path: ['title'], message: 'Required' }]
    fake = installFakeFetch({
      'POST /api/posts': { status: 400, body: { error: { code: 'VALIDATION_FAILED', message: 'Validation failed', details } } },
    })
    const err = await request('/posts', { method: 'POST', body: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ code: 'VALIDATION_FAILED', status: 400, details })
  })

  it('sends bearer token, credentials include and query; 204 → undefined', async () => {
    const auth = useAuth()
    auth.token = 'tok'
    const fetchSpy = vi.fn()
    fake = installFakeFetch({
      'GET /api/posts': (req) => {
        fetchSpy(req.query.toString())
        return ok({ items: [], nextCursor: null })
      },
      'DELETE /api/posts/p1': { status: 204 },
    })
    await request('/posts', { query: { sort: 'new', limit: 20, r18: false, cursor: undefined } })
    expect(fetchSpy).toHaveBeenCalledWith('sort=new&limit=20&r18=false')
    expect(fake.calls[0]!.headers.authorization).toBe('Bearer tok')
    expect(vi.mocked(fetch).mock.calls[0]![1]).toMatchObject({ credentials: 'include' })

    await expect(request('/posts/p1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('auth: false omits the Authorization header', async () => {
    useAuth().token = 'tok'
    fake = installFakeFetch({ 'GET /api/public': ok() })
    await request('/public', { auth: false })
    expect(fake.calls[0]!.headers.authorization).toBeUndefined()
  })
})

describe('api client — refresh edge cases', () => {
  it('a stale-token 401 arriving after a completed refresh retries with the new token, no second refresh', async () => {
    const auth = useAuth()
    auth.token = 'old'
    let releaseB!: () => void
    const gateB = new Promise<void>((r) => (releaseB = r))
    fake = installFakeFetch({
      'GET /api/a': (req) => (req.headers.authorization === 'Bearer new' ? ok({ a: 1 }) : unauth),
      'GET /api/b': async (req) => {
        if (req.headers.authorization === 'Bearer new') return ok({ b: 1 })
        await gateB
        return unauth
      },
      'POST /api/auth/refresh': ok({ accessToken: 'new', user: makeMe() }),
    })

    const b = request('/b')
    await expect(request('/a')).resolves.toEqual({ a: 1 })
    releaseB()
    await expect(b).resolves.toEqual({ b: 1 })

    expect(fake.callsTo('POST /api/auth/refresh')).toHaveLength(1)
    expect(fake.callsTo('GET /api/b').map((c) => c.headers.authorization)).toEqual(['Bearer old', 'Bearer new'])
  })

  it('a throwing store access does not poison later refreshOnce calls', async () => {
    const pinia = createPinia()
    fake = installFakeFetch({ 'POST /api/auth/refresh': ok({ accessToken: 'new', user: makeMe() }) })
    setActivePinia(undefined as unknown as Pinia) // useAuth() now throws
    await expect(refreshOnce()).resolves.toBe(false)
    setActivePinia(pinia)
    await expect(refreshOnce()).resolves.toBe(true)
    expect(useAuth().token).toBe('new')
  })

  it('/auth/resend-verification refreshes on 401 like a normal request', async () => {
    useAuth().token = 'old'
    fake = installFakeFetch({
      'POST /api/auth/resend-verification': (req) => (req.headers.authorization === 'Bearer new' ? { status: 204 } : unauth),
      'POST /api/auth/refresh': ok({ accessToken: 'new', user: makeMe() }),
    })
    await expect(request('/auth/resend-verification', { method: 'POST' })).resolves.toBeUndefined()
    expect(fake.callsTo('POST /api/auth/refresh')).toHaveLength(1)
    expect(fake.callsTo('POST /api/auth/resend-verification')).toHaveLength(2)
  })

  it.each(['/auth/refresh', '/auth/login', '/auth/register', '/auth/logout', '/auth/verify-email', '/auth/forgot-password', '/auth/reset-password'])(
    '%s 401 does not refresh',
    async (path) => {
      fake = installFakeFetch({ [`POST /api${path}`]: unauth, 'POST /api/auth/refresh': unauth })
      await expect(request(path, { method: 'POST' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
      expect(fake.calls).toHaveLength(1)
    },
  )

  it('refresh network error keeps auth state and the request rejects with NETWORK', async () => {
    const auth = useAuth()
    auth.token = 'old'
    auth.user = makeMe()
    fake = installFakeFetch({
      'GET /api/thing': unauth,
      'POST /api/auth/refresh': () => {
        throw new TypeError('offline')
      },
    })
    await expect(request('/thing')).rejects.toMatchObject({ code: 'NETWORK', status: 0 })
    expect(auth.token).toBe('old')
    expect(auth.user?.id).toBe('u1')
  })

  it('refresh 5xx keeps auth state and the request rejects with the server error', async () => {
    const auth = useAuth()
    auth.token = 'old'
    auth.user = makeMe()
    fake = installFakeFetch({
      'GET /api/thing': unauth,
      'POST /api/auth/refresh': { status: 503, body: { error: { code: 'INTERNAL', message: 'down' } } },
    })
    await expect(request('/thing')).rejects.toMatchObject({ code: 'INTERNAL', status: 503 })
    expect(auth.token).toBe('old')
    expect(auth.user?.id).toBe('u1')
  })

  it('refresh 403 TOKEN_INVALID clears the session', async () => {
    const auth = useAuth()
    auth.token = 'old'
    auth.user = makeMe()
    fake = installFakeFetch({
      'GET /api/thing': unauth,
      'POST /api/auth/refresh': { status: 403, body: { error: { code: 'TOKEN_INVALID', message: 'reused' } } },
    })
    await expect(request('/thing')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    expect(auth.token).toBeNull()
    expect(auth.user).toBeNull()
  })
})

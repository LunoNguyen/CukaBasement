import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ApiError, request } from '@/api/client'
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuth } from '@/stores/auth'
import { i18n, setLocale } from '@/i18n'
import { installFakeFetch, makeMe, type FakeFetch } from './fakeApi'

let fake: FakeFetch | undefined

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  fake?.restore()
  fake = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const session = (user = makeMe()) => ({ status: 200, body: { accessToken: 'secret-token-123', user } })

describe('auth store', () => {
  it('token never written to localStorage/sessionStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    fake = installFakeFetch({ 'POST /api/auth/login': session() })
    const auth = useAuth()
    await auth.login('cuka@example.com', 'pw')
    expect(auth.token).toBe('secret-token-123')
    expect(auth.isLoggedIn).toBe(true)
    const leaked = setItem.mock.calls.some((args) => args.some((a) => String(a).includes('secret-token-123')))
    expect(leaked).toBe(false)
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-token-123')
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-token-123')
  })

  it('init(): refresh 200 → ready true + user; refresh 401 → ready true + logged out', async () => {
    fake = installFakeFetch({ 'POST /api/auth/refresh': session() })
    const a = useAuth()
    expect(a.ready).toBe(false)
    await a.init()
    expect(a.ready).toBe(true)
    expect(a.user?.id).toBe('u1')
    expect(a.isLoggedIn).toBe(true)
    fake.restore()

    setActivePinia(createPinia())
    fake = installFakeFetch({ 'POST /api/auth/refresh': { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } } })
    const b = useAuth()
    await b.init()
    expect(b.ready).toBe(true)
    expect(b.user).toBeNull()
    expect(b.token).toBeNull()
    expect(b.isLoggedIn).toBe(false)
  })

  it('init(): a restored user with another locale switches the UI language', async () => {
    fake = installFakeFetch({ 'POST /api/auth/refresh': session(makeMe({ locale: 'en' })) })
    setLocale('vi')
    await useAuth().init()
    expect(i18n.global.locale.value).toBe('en')
    setLocale('vi')
  })

  it('register posts the input and does not log in', async () => {
    fake = installFakeFetch({ 'POST /api/auth/register': { status: 201, body: { userId: 'u9' } } })
    const auth = useAuth()
    const input = { email: 'n@example.com', password: 'longpassword', username: 'newbie', displayName: 'New' }
    await expect(auth.register(input)).resolves.toEqual({ userId: 'u9' })
    expect(fake.calls[0]!.body).toEqual(input)
    expect(auth.isLoggedIn).toBe(false)
  })

  it('logout posts logout and clears state even when the call fails', async () => {
    fake = installFakeFetch({ 'POST /api/auth/login': session(), 'POST /api/auth/logout': { status: 204 } })
    const auth = useAuth()
    await auth.login('cuka@example.com', 'pw')
    await auth.logout()
    expect(fake.callsTo('POST /api/auth/logout')).toHaveLength(1)
    expect(auth.token).toBeNull()
    expect(auth.user).toBeNull()

    fake.restore()
    fake = installFakeFetch({ 'POST /api/auth/login': session(), 'POST /api/auth/logout': () => { throw new TypeError('offline') } })
    await auth.login('cuka@example.com', 'pw')
    await auth.logout()
    expect(auth.isLoggedIn).toBe(false)
  })

  it('role getters and setUser', () => {
    const auth = useAuth()
    expect(auth.isStaff).toBe(false)
    auth.setUser(makeMe({ role: 'user' }))
    expect([auth.isStaff, auth.isAdmin]).toEqual([false, false])
    auth.setUser(makeMe({ role: 'moderator' }))
    expect([auth.isStaff, auth.isAdmin]).toEqual([true, false])
    auth.setUser(makeMe({ role: 'admin' }))
    expect([auth.isStaff, auth.isAdmin]).toEqual([true, true])
  })

  it('canSeeR18 requires showR18 and an 18th birthday reached on the local date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 17, 12, 0, 0)) // local 2026-10-17
    const auth = useAuth()
    expect(auth.canSeeR18).toBe(false)
    auth.setUser(makeMe({ showR18: true, birthDate: '2008-10-17' }))
    expect(auth.canSeeR18).toBe(true)
    auth.setUser(makeMe({ showR18: true, birthDate: '2008-10-18' }))
    expect(auth.canSeeR18).toBe(false)
    auth.setUser(makeMe({ showR18: false, birthDate: '1990-01-01' }))
    expect(auth.canSeeR18).toBe(false)
    auth.setUser(makeMe({ showR18: true, birthDate: null }))
    expect(auth.canSeeR18).toBe(false)
  })

  // A re-render of the same file (new crop) keeps the URL apart from its ?v=: non-null is not enough.
  it('pollUntilPublished waits for a URL other than the replaced one, not just a non-null one', async () => {
    vi.useFakeTimers()
    const me = (bannerUrl: string) => makeMe({ bannerUrl, profile: { ...makeMe().profile, bannerFileId: 'F1' } })
    fake = installFakeFetch({ 'GET /api/me': [{ status: 200, body: me('http://cdn/b.webp?v=1') }, { status: 200, body: me('http://cdn/b.webp?v=2') }] })
    const auth = useAuth()
    auth.ready = true
    auth.setSession({ accessToken: 't', user: me('http://cdn/b.webp?v=1') })
    auth.pollUntilPublished({ bannerUrl: 'http://cdn/b.webp?v=1' })
    await vi.advanceTimersByTimeAsync(3000)
    expect(fake.callsTo('GET /api/me')).toHaveLength(1)
    expect(auth.user!.bannerUrl).toBe('http://cdn/b.webp?v=1')
    await vi.advanceTimersByTimeAsync(3000)
    expect(fake.callsTo('GET /api/me')).toHaveLength(2)
    expect(auth.user!.bannerUrl).toBe('http://cdn/b.webp?v=2')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fake.callsTo('GET /api/me')).toHaveLength(2)
    // Without a replaced URL a published image needs no poll.
    auth.pollUntilPublished()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fake.callsTo('GET /api/me')).toHaveLength(2)
  })
})

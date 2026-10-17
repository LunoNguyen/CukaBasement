import { vi } from 'vitest'
import type { MeDto } from '@/api/types'

export interface FakeRequest {
  method: string
  /** Pathname without the query string, e.g. `/api/auth/refresh`. */
  path: string
  query: URLSearchParams
  body: unknown
  headers: Record<string, string>
}

export interface FakeResponse {
  status: number
  body?: unknown
}

export type FakeHandler = (req: FakeRequest) => FakeResponse | Promise<FakeResponse>

/**
 * A route is a handler, a fixed response, or a sequence of either: the sequence is
 * consumed one per call and its last entry repeats. A handler that throws makes fetch reject.
 */
export type FakeRoute = FakeHandler | FakeResponse | Array<FakeHandler | FakeResponse>

export interface FakeFetch {
  calls: FakeRequest[]
  /** Calls whose `METHOD /path` key matches. */
  callsTo(key: string): FakeRequest[]
  restore(): void
}

function headersOf(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {}
  new Headers(init?.headers).forEach((v, k) => (out[k] = v))
  return out
}

/**
 * Stubs global fetch. Keys are `'POST /api/auth/refresh'`; a key with a query
 * (`'GET /api/posts?sort=new'`) is matched before the bare path. Unknown routes answer 404 NOT_FOUND.
 */
export function installFakeFetch(routes: Record<string, FakeRoute>): FakeFetch {
  const calls: FakeRequest[] = []
  const seen = new Map<string, number>()

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const raw = init?.body
    const req: FakeRequest = {
      method,
      path: url.pathname,
      query: url.searchParams,
      body: typeof raw === 'string' ? JSON.parse(raw) : raw,
      headers: headersOf(init),
    }
    calls.push(req)

    const withQuery = `${method} ${url.pathname}${url.search}`
    const key = url.search && withQuery in routes ? withQuery : `${method} ${url.pathname}`
    const route = routes[key]
    let res: FakeResponse
    if (route === undefined) {
      res = { status: 404, body: { error: { code: 'NOT_FOUND', message: `No fake route for ${key}` } } }
    } else {
      let entry: FakeHandler | FakeResponse
      if (Array.isArray(route)) {
        const n = seen.get(key) ?? 0
        seen.set(key, n + 1)
        entry = route[Math.min(n, route.length - 1)]!
      } else entry = route
      res = typeof entry === 'function' ? await entry(req) : entry
    }

    const empty = res.body === undefined || res.status === 204
    return new Response(empty ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: empty ? {} : { 'content-type': 'application/json' },
    })
  })

  vi.stubGlobal('fetch', fetchMock)
  return {
    calls,
    callsTo: (key) => calls.filter((c) => `${c.method} ${c.path}` === key),
    restore: () => vi.unstubAllGlobals(),
  }
}

/** A logged-in user fixture; override any field. */
export function makeMe(overrides: Partial<MeDto> = {}): MeDto {
  return {
    id: 'u1',
    email: 'cuka@example.com',
    role: 'user',
    status: 'active',
    emailVerified: true,
    locale: 'vi',
    showR18: false,
    birthDate: null,
    profile: {
      username: 'cuka',
      displayName: 'Cuka',
      bio: '',
      avatarFileId: null,
      bannerFileId: null,
      socialLinks: { x: '', facebook: '', youtube: '', pixiv: '' },
    },
    ...overrides,
  }
}

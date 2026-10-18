import type { ErrorCode } from '@cuka/shared'
import { useAuth } from '@/stores/auth'
import { useMaintenance } from '@/stores/maintenance'
import type { SessionDto } from './types'

const BASE = '/api'

export class ApiError extends Error {
  constructor(
    public code: ErrorCode | 'NETWORK',
    public status: number,
    message: string = code,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  /** Send the bearer token and refresh on 401. Default true. */
  auth?: boolean
  /** Retry once after a refresh on 401. Default true. */
  retry?: boolean
}

function urlOf(path: string, query?: RequestOptions['query']): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.append(k, String(v))
  const s = qs.toString()
  return `${BASE}${path}${s ? `?${s}` : ''}`
}

async function errorOf(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as { error?: { code?: ErrorCode; message?: string; details?: unknown } } | null
  const e = data?.error
  return e?.code ? new ApiError(e.code, res.status, e.message, e.details) : new ApiError('INTERNAL', res.status)
}

/** Unauthenticated endpoints: a 401 from these is the answer, not an expired token. */
const NO_REFRESH = new Set([
  '/auth/refresh',
  '/auth/login',
  '/auth/register',
  '/auth/logout',
  '/auth/verify-email',
  '/auth/forgot-password',
  '/auth/reset-password',
])

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, retry = true } = opts
  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  // Until the start-up refresh settles we do not know who is asking: wait so the
  // request carries the restored token. The refresh itself is `auth: false`, so this cannot deadlock.
  if (auth && !useAuth().ready) await useAuth().whenReady()
  const sentToken = auth ? useAuth().token : null
  if (sentToken) headers.authorization = `Bearer ${sentToken}`

  let res: Response
  try {
    res = await fetch(urlOf(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    })
  } catch {
    throw new ApiError('NETWORK', 0)
  }

  if (res.status === 401 && auth && retry && !NO_REFRESH.has(path)) {
    const current = useAuth().token
    // A refresh already replaced the token this request carried: reusing the old
    // refresh cookie would look like token theft and revoke every session.
    if (!current || current === sentToken) {
      const r = await refreshShared()
      if (!r.ok) throw r.error
    }
    return request<T>(path, { ...opts, retry: false })
  }
  if (!res.ok) {
    const err = await errorOf(res)
    if (err.code === 'MAINTENANCE') useMaintenance().enter()
    throw err
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

type RefreshResult = { ok: true } | { ok: false; error: ApiError }

/** The server rejected the session itself (as opposed to being unreachable or failing). */
function isSessionRejected(e: ApiError): boolean {
  return e.status === 401 || (e.status === 403 && (e.code === 'TOKEN_INVALID' || e.code === 'UNAUTHENTICATED'))
}

let inflight: Promise<RefreshResult> | null = null

function refreshShared(): Promise<RefreshResult> {
  if (inflight) return inflight
  inflight = (async (): Promise<RefreshResult> => {
    try {
      const auth = useAuth()
      try {
        auth.setSession(await request<SessionDto>('/auth/refresh', { method: 'POST', auth: false }))
        return { ok: true }
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError('INTERNAL', 0)
        if (!isSessionRejected(err)) return { ok: false, error: err }
        auth.clear()
        return { ok: false, error: new ApiError('UNAUTHENTICATED', 401) }
      }
    } catch {
      return { ok: false, error: new ApiError('INTERNAL', 0) }
    }
  })()
  // Cleared after assignment: a body that settles synchronously must not leave a stale promise behind.
  const p = inflight
  void p.then(() => {
    if (inflight === p) inflight = null
  })
  return p
}

/**
 * Exchanges the refresh cookie for a new session; concurrent callers share one call.
 * Only a rejected session clears auth; a network or server failure leaves it untouched.
 * Never rejects.
 */
export function refreshOnce(): Promise<boolean> {
  return refreshShared().then((r) => r.ok)
}

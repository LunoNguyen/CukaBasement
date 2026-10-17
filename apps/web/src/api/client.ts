import type { ErrorCode } from '@cuka/shared'
import { useAuth } from '@/stores/auth'
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

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, auth = true, retry = true } = opts
  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const token = auth ? useAuth().token : null
  if (token) headers.authorization = `Bearer ${token}`

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

  if (res.status === 401 && auth && retry && !path.startsWith('/auth/')) {
    if (!(await refreshOnce())) throw new ApiError('UNAUTHENTICATED', 401)
    return request<T>(path, { ...opts, retry: false })
  }
  if (!res.ok) throw await errorOf(res)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

let inflight: Promise<boolean> | null = null

/** Exchanges the refresh cookie for a new session; concurrent callers share one call. */
export function refreshOnce(): Promise<boolean> {
  inflight ??= (async () => {
    const auth = useAuth()
    try {
      const s = await request<SessionDto>('/auth/refresh', { method: 'POST', auth: false })
      auth.setSession(s)
      return true
    } catch {
      auth.clear()
      return false
    } finally {
      inflight = null
    }
  })()
  return inflight
}

import { BACKUP_RESTORE_CONFIRM, type BackupSchedule, type ErrorCode } from '@cuka/shared'
import { useAuth } from '@/stores/auth'
import { ApiError, refreshOnce, request } from '../client'
import type { BackupFileDto, BackupOverviewDto, BackupRunDto, BackupScheduleStateDto } from '../types'

const path = (name: string) => `/admin/backups/${encodeURIComponent(name)}`

export const overview = () => request<BackupOverviewDto>('/admin/backups')
export const run = (id: string) => request<BackupRunDto>(`/admin/backups/runs/${encodeURIComponent(id)}`)
export const create = () => request<BackupRunDto>('/admin/backups', { method: 'POST' })
export const restore = (name: string) => request<BackupRunDto>(`${path(name)}/restore`, { method: 'POST', body: { confirm: BACKUP_RESTORE_CONFIRM } })
export const remove = (name: string) => request<void>(path(name), { method: 'DELETE' })
export const updateSchedule = (s: BackupSchedule) => request<BackupScheduleStateDto>('/admin/backups/schedule', { method: 'PUT', body: s })

/**
 * Starts a download: asks for a one-time link (valid 60 s) and lets the browser fetch it, so a multi-GB archive
 * streams to disk rather than through memory as a blob.
 */
export async function download(name: string): Promise<void> {
  const { url } = await request<{ url: string }>(`${path(name)}/download`, { method: 'POST' })
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function sendUpload(file: File, token: string | null, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/backups/upload')
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = null
      }
      resolve({ status: xhr.status, body })
    }
    xhr.onerror = () => reject(new ApiError('NETWORK', 0))
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'))
    if (signal) {
      if (signal.aborted) return xhr.abort()
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(file)
  })
}

/** Uploads an archive as a raw body (XMLHttpRequest for progress); refreshes the session once on 401. */
export async function upload(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<BackupFileDto> {
  let res = await sendUpload(file, useAuth().token, onProgress, signal)
  if (res.status === 401 && (await refreshOnce())) res = await sendUpload(file, useAuth().token, onProgress, signal)
  if (res.status >= 200 && res.status < 300) return res.body as BackupFileDto
  const e = (res.body as { error?: { code?: ErrorCode; message?: string } } | null)?.error
  throw new ApiError(e?.code ?? 'INTERNAL', res.status, e?.message)
}

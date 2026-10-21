import type { UploadPurpose } from '@cuka/shared'
import { ApiError, request } from '../client'
import type { FileDto, PresignDto } from '../types'

export const presignUpload = (body: { name: string; size: number; mime: string; purpose?: UploadPurpose }) =>
  request<PresignDto>('/uploads', { method: 'POST', body })

export const completeUpload = (fileId: string) =>
  request<FileDto>(`/uploads/${encodeURIComponent(fileId)}/complete`, { method: 'POST' })

/**
 * Sends the presigned POST straight to the object store (cross-origin, no credentials).
 * XMLHttpRequest rather than fetch for upload progress. Policy fields go first, the file last.
 */
export function postToStorage(
  url: string,
  fields: Record<string, string>,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    form.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError('INTERNAL', xhr.status)))
    xhr.onerror = () => reject(new ApiError('NETWORK', 0))
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'))
    if (signal) {
      if (signal.aborted) return xhr.abort()
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(form)
  })
}

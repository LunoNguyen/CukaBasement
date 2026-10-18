import { computed, getCurrentScope, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'
import { ALLOWED_FILE_TYPES, DEFAULT_SETTINGS, type FileKind, kindForMime } from '@cuka/shared'
import { ApiError } from '@/api/client'
import { completeUpload, postToStorage, presignUpload } from '@/api/endpoints/uploads'

const MAX_CONCURRENT = 3

export type QueueStatus = 'invalid' | 'queued' | 'uploading' | 'processing' | 'ready' | 'failed'

export interface QueueItem {
  id: string
  /** Null for a file already attached to the post being edited. */
  file: File | null
  name: string
  kind: FileKind
  /** 0..1 */
  progress: number
  status: QueueStatus
  fileId?: string
  /** `too_large`, `type`, `too_many`, or an API error code. */
  error?: string
  isCover: boolean
  /** Already part of the post being edited. */
  existing?: boolean
  thumbUrl?: string | null
}

function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name)
  return m ? m[1]!.toLowerCase() : ''
}

/**
 * The mime declared to the API: the browser's type when the whitelist accepts it, else the whitelist
 * mime for the extension (.psd/.clip often come with an empty or vendor type).
 */
export function mimeOf(f: File): string {
  const ext = extOf(f.name)
  if (f.type && kindForMime(f.type, ext)) return f.type.toLowerCase()
  return ALLOWED_FILE_TYPES.find((t) => t.ext === ext)?.mime ?? f.type
}

export function validateFile(
  f: File,
  maxBytes: number = DEFAULT_SETTINGS.maxFileBytes,
): { ok: true; kind: FileKind } | { ok: false; reason: 'too_large' | 'type' } {
  const kind = kindForMime(mimeOf(f), extOf(f.name))
  if (!kind) return { ok: false, reason: 'type' }
  if (f.size > maxBytes) return { ok: false, reason: 'too_large' }
  return { ok: true, kind }
}

let seq = 0

export function useUploader(initial: QueueItem[] = []): {
  queue: Ref<QueueItem[]>
  add(files: File[]): void
  remove(id: string): void
  move(id: string, dir: -1 | 1): void
  setCover(id: string): void
  allDone: ComputedRef<boolean>
} {
  const queue = ref<QueueItem[]>(initial)
  const controllers = new Map<string, AbortController>()
  let active = 0
  /** Set when the owning component goes away: nothing new is sent after that. */
  let disposed = false

  /** Updates the item if it is still queued (it may have been removed meanwhile). */
  function patch(id: string, p: Partial<QueueItem>) {
    const item = queue.value.find((q) => q.id === id)
    if (item) Object.assign(item, p)
  }

  async function run(id: string) {
    const item = queue.value.find((q) => q.id === id)
    if (!item?.file) return
    const file = item.file
    const ac = new AbortController()
    controllers.set(id, ac)
    patch(id, { status: 'uploading', progress: 0 })
    try {
      // The declared size is the exact size: the storage policy rejects anything bigger.
      const p = await presignUpload({ name: file.name, size: file.size, mime: mimeOf(file) })
      if (ac.signal.aborted || disposed) return
      patch(id, { fileId: p.fileId })
      await postToStorage(p.url, p.fields, file, (progress) => patch(id, { progress }), ac.signal)
      if (ac.signal.aborted || disposed) return
      patch(id, { progress: 1 })
      const dto = await completeUpload(p.fileId)
      if (dto.status === 'failed') patch(id, { status: 'failed', error: 'INTERNAL' })
      else patch(id, { status: dto.status === 'ready' ? 'ready' : 'processing' })
    } catch (e) {
      if (!ac.signal.aborted) patch(id, { status: 'failed', error: e instanceof ApiError ? e.code : 'INTERNAL' })
    } finally {
      controllers.delete(id)
    }
  }

  function pump() {
    while (!disposed && active < MAX_CONCURRENT) {
      const next = queue.value.find((q) => q.status === 'queued')
      if (!next) return
      active++
      next.status = 'uploading'
      void run(next.id).finally(() => {
        active--
        pump()
      })
    }
  }

  function add(files: File[]) {
    if (disposed) return
    let count = queue.value.filter((q) => q.status !== 'invalid').length
    for (const file of files) {
      const v = validateFile(file)
      // The server rejects a post with more files than this (TOO_MANY_FILES).
      const error = !v.ok ? v.reason : count >= DEFAULT_SETTINGS.maxFilesPerPost ? 'too_many' : undefined
      if (!error) count++
      queue.value.push({
        id: `up${++seq}`,
        file,
        name: file.name,
        kind: v.ok ? v.kind : 'archive',
        progress: 0,
        status: error ? 'invalid' : 'queued',
        error,
        isCover: false,
      })
    }
    pump()
  }

  function remove(id: string) {
    controllers.get(id)?.abort()
    queue.value = queue.value.filter((q) => q.id !== id)
  }

  function move(id: string, dir: -1 | 1) {
    const i = queue.value.findIndex((q) => q.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= queue.value.length) return
    const next = [...queue.value]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    queue.value = next
  }

  function setCover(id: string) {
    for (const q of queue.value) q.isCover = q.id === id
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      for (const ac of controllers.values()) ac.abort()
      controllers.clear()
    })
  }

  const allDone = computed(() => queue.value.every((q) => q.status !== 'queued' && q.status !== 'uploading'))

  return { queue, add, remove, move, setCover, allDone }
}

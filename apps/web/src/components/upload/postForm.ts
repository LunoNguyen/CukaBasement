import type { Credit, CreditPlatform } from '@cuka/shared'
import type { CreatePostBody, PostFileInput, UpdatePostBody } from '@/api/endpoints/posts'
import type { PostDto } from '@/api/types'
import type { QueueItem } from '@/composables/useUploader'

/** The credit as edited: a repost starts with no platform chosen. */
export type CreditForm = Omit<Credit, 'platform'> & { platform: CreditPlatform | '' }

export const OWN_WORK: Credit = { isOwnWork: true, artistName: '', artistHandle: '', platform: 'other', sourceUrl: '', permissionNote: '' }

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Mirrors `creditSchema`: a repost names the artist, the platform and an http(s) source. */
export function creditValid(c: CreditForm): boolean {
  if (c.isOwnWork) return true
  return !!c.artistName.trim() && !!c.platform && isHttpUrl(c.sourceUrl)
}

export function toCredit(c: CreditForm): Credit {
  if (c.isOwnWork) return { ...OWN_WORK }
  return {
    isOwnWork: false,
    artistName: c.artistName.trim(),
    artistHandle: c.artistHandle.trim(),
    platform: c.platform || 'other',
    sourceUrl: c.sourceUrl.trim(),
    permissionNote: c.permissionNote.trim(),
  }
}

const MEDIA_KINDS = new Set(['image', 'video', 'audio'])

/** Queue items that belong in the post: attached files and fresh uploads the server accepted. */
export function attachable(q: QueueItem): boolean {
  if (!q.fileId) return false
  return q.existing || q.status === 'ready' || q.status === 'processing'
}

export function hasMedia(queue: QueueItem[]): boolean {
  return queue.some((q) => attachable(q) && MEDIA_KINDS.has(q.kind) && q.status !== 'failed')
}

/** The cover: the one chosen if it is attached, else the first image/video/audio file, else the first file. */
export function coverId(queue: QueueItem[]): string | undefined {
  const files = queue.filter(attachable)
  return (files.find((q) => q.isCover) ?? files.find((q) => MEDIA_KINDS.has(q.kind)) ?? files[0])?.id
}

export function filesOf(queue: QueueItem[]): PostFileInput[] {
  const cover = coverId(queue)
  return queue.filter(attachable).map((q, i) => ({ fileId: q.fileId!, position: i, isCover: q.id === cover }))
}

/** Queue entries for the files already attached to a post, in position order. */
export function queueOf(post: PostDto): QueueItem[] {
  const media = [...post.media].sort((a, b) => a.position - b.position)
  const cover = (media.find((m) => m.isCover) ?? media[0])?.fileId
  return media.map((m) => ({
    id: `m-${m.fileId}`,
    file: null,
    name: '',
    kind: m.kind,
    progress: 1,
    status: m.status === 'ready' ? 'ready' : m.status === 'failed' ? 'failed' : 'processing',
    fileId: m.fileId,
    isCover: m.fileId === cover,
    existing: true,
    thumbUrl: m.thumbSmUrl,
  }))
}

function originalFiles(post: PostDto): PostFileInput[] {
  return filesOf(queueOf(post))
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** New or removed files (not a reorder or a new cover): the server sends the post back to review. */
export function fileSetChanged(post: PostDto, files: PostFileInput[]): boolean {
  return !sameList(originalFiles(post).map((f) => f.fileId).sort(), files.map((f) => f.fileId).sort())
}

const CREDIT_KEYS = ['isOwnWork', 'artistName', 'artistHandle', 'platform', 'sourceUrl', 'permissionNote'] as const

/** The PATCH body: only the fields that differ from the post as loaded. */
export function buildPatch(post: PostDto, next: CreatePostBody): UpdatePostBody {
  const out: UpdatePostBody = {}
  if (next.type !== post.type) out.type = next.type
  if (next.title !== post.title) out.title = next.title
  if (next.description !== post.description) out.description = next.description
  if (next.rating !== post.rating) out.rating = next.rating
  if (!sameList(next.tags, post.tags)) out.tags = next.tags
  if (CREDIT_KEYS.some((k) => next.credit[k] !== post.credit[k])) out.credit = next.credit
  const before = originalFiles(post)
  const same = before.length === next.files.length && before.every((f, i) => f.fileId === next.files[i]!.fileId && f.isCover === next.files[i]!.isCover)
  if (!same) out.files = next.files
  return out
}

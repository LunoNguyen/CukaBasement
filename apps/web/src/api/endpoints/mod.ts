import type { Credit, Visibility } from '@cuka/shared'
import { request } from '../client'
import type { HiddenCommentDto, Page, PostCardDto, ReportGroupDto } from '../types'

/** What hide/restore return: the post's moderation state. */
export interface ModPostResult {
  id: string
  visibility: Visibility
}

const post = (id: string) => `/mod/posts/${encodeURIComponent(id)}`

export const queue = (cursor: string | null) => request<Page<PostCardDto>>('/mod/queue', { query: { status: 'pending', cursor: cursor ?? undefined } })
export const approve = (id: string) => request<unknown>(`${post(id)}/approve`, { method: 'POST' })
export const reject = (id: string, reason: string) => request<unknown>(`${post(id)}/reject`, { method: 'POST', body: { reason } })
export const hide = (id: string) => request<ModPostResult>(`${post(id)}/hide`, { method: 'POST' })
export const restore = (id: string) => request<ModPostResult>(`${post(id)}/restore`, { method: 'POST' })
export const updateCredit = (id: string, credit: Credit) => request<unknown>(`${post(id)}/credit`, { method: 'PATCH', body: credit })

/** Top groups only: the API has no cursor here. */
export const reports = () => request<{ items: ReportGroupDto[] }>('/mod/reports')
export const resolve = (postId: string, decision: 'keep' | 'remove') =>
  request<unknown>(`/mod/reports/posts/${encodeURIComponent(postId)}/resolve`, { method: 'POST', body: { decision } })

export const hiddenComments = (cursor: string | null) =>
  request<Page<HiddenCommentDto>>('/mod/comments', { query: { status: 'hidden', cursor: cursor ?? undefined } })
export const hideComment = (id: string) => request<unknown>(`/mod/comments/${encodeURIComponent(id)}/hide`, { method: 'POST' })
export const restoreComment = (id: string) => request<unknown>(`/mod/comments/${encodeURIComponent(id)}/restore`, { method: 'POST' })

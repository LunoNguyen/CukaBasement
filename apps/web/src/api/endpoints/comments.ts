import { request } from '../client'
import type { CommentDto, Page } from '../types'

export const listComments = (postId: string, cursor: string | null) =>
  request<Page<CommentDto>>(`/posts/${encodeURIComponent(postId)}/comments`, { query: { cursor: cursor ?? undefined } })

/** Mirrors `createCommentSchema` in @cuka/shared. */
export const createComment = (postId: string, body: string, parentId?: string) =>
  request<CommentDto>(`/posts/${encodeURIComponent(postId)}/comments`, { method: 'POST', body: parentId ? { body, parentId } : { body } })

export const deleteComment = (id: string) => request<void>(`/comments/${encodeURIComponent(id)}`, { method: 'DELETE' })

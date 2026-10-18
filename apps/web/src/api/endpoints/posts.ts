import { request } from '../client'
import type { Page, PostCardDto, PostDto } from '../types'

export const getPost = (id: string) => request<PostDto>(`/posts/${encodeURIComponent(id)}`)

export const deletePost = (id: string) => request<void>(`/posts/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** Presigned URL of an original file; 404 when the viewer may not have it (e.g. a repost's image). */
export const fileUrl = (id: string, fileId: string) =>
  request<{ url: string }>(`/posts/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}/url`)

export const userPosts = (username: string, cursor: string | null, limit?: number) =>
  request<Page<PostCardDto>>(`/users/${encodeURIComponent(username)}/posts`, { query: { cursor: cursor ?? undefined, limit } })

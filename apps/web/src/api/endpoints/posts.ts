import { request } from '../client'
import type { Credit, PostType, Rating } from '@cuka/shared'
import type { Page, PostCardDto, PostDto } from '../types'

export const getPost = (id: string) => request<PostDto>(`/posts/${encodeURIComponent(id)}`)

export const deletePost = (id: string) => request<void>(`/posts/${encodeURIComponent(id)}`, { method: 'DELETE' })

/** Presigned URL of an original file; 404 when the viewer may not have it (e.g. a repost's image). */
export const fileUrl = (id: string, fileId: string) =>
  request<{ url: string }>(`/posts/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}/url`)

export const userPosts = (username: string, cursor: string | null, limit?: number) =>
  request<Page<PostCardDto>>(`/users/${encodeURIComponent(username)}/posts`, { query: { cursor: cursor ?? undefined, limit } })

export interface PostFileInput {
  fileId: string
  position: number
  isCover: boolean
}

/** `POST /api/posts` body (`createPostSchema` in @cuka/shared). */
export interface CreatePostBody {
  type: PostType
  title: string
  description: string
  rating: Rating
  tags: string[]
  credit: Credit
  aiDeclaration: true
  files: PostFileInput[]
}

/** `PATCH /api/posts/:id` body: only the fields that changed. */
export type UpdatePostBody = Partial<Omit<CreatePostBody, 'aiDeclaration'>>

export const createPost = (body: CreatePostBody) => request<PostDto>('/posts', { method: 'POST', body })

export const updatePost = (id: string, body: UpdatePostBody) =>
  request<PostDto>(`/posts/${encodeURIComponent(id)}`, { method: 'PATCH', body })

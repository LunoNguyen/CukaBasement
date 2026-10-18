import { request } from '../client'
import type { Page, PostCardDto, PublicUserDto } from '../types'

export const getUser = (username: string) => request<PublicUserDto>(`/users/${encodeURIComponent(username)}`)

const PAGE_SIZE = 24
const listOf = (username: string, what: 'posts' | 'bookmarks', cursor: string | null) =>
  request<Page<PostCardDto>>(`/users/${encodeURIComponent(username)}/${what}`, { query: { cursor: cursor ?? undefined, limit: PAGE_SIZE } })

export const getUserPosts = (username: string, cursor: string | null) => listOf(username, 'posts', cursor)
/** The owner also gets their private bookmarks; the API decides. */
export const getUserBookmarks = (username: string, cursor: string | null) => listOf(username, 'bookmarks', cursor)

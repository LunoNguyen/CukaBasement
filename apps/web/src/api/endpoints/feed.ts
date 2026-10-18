import { request } from '../client'
import type { Page, PostCardDto } from '../types'
import type { PostType } from '@cuka/shared'

const PAGE_SIZE = 24

export const homeFeed = (cursor: string | null) =>
  request<Page<PostCardDto>>('/feed/home', { query: { cursor: cursor ?? undefined, limit: PAGE_SIZE } })

export const followingFeed = (cursor: string | null) =>
  request<Page<PostCardDto>>('/feed/following', { query: { cursor: cursor ?? undefined, limit: PAGE_SIZE } })

export interface SearchParams {
  q?: string
  tag?: string
  type?: PostType
}

export const search = (params: SearchParams, cursor: string | null) =>
  request<Page<PostCardDto>>('/search', { query: { ...params, cursor: cursor ?? undefined, limit: PAGE_SIZE } })

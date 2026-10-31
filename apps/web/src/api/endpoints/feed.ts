import { request } from '../client'
import type { Page, PostCardDto } from '../types'
import type { PostType, RankingPeriod } from '@cuka/shared'

const PAGE_SIZE = 24

export const homeFeed = (cursor: string | null, type?: PostType) =>
  request<Page<PostCardDto>>('/feed/home', { query: { cursor: cursor ?? undefined, limit: PAGE_SIZE, type } })

export const followingFeed = (cursor: string | null, type?: PostType) =>
  request<Page<PostCardDto>>('/feed/following', { query: { cursor: cursor ?? undefined, limit: PAGE_SIZE, type } })

/** A card of the fanart ranking: its place (1-based) and score (likes + bookmarks in the period). */
export type RankedCardDto = PostCardDto & { rank: number; score: number }

export const ranking = (params: { period: RankingPeriod; type?: PostType; limit: number }) =>
  request<{ items: RankedCardDto[] }>('/feed/ranking', { query: params })

export interface SearchParams {
  q?: string
  tag?: string
  type?: PostType
}

export const search = (params: SearchParams, cursor: string | null) =>
  request<Page<PostCardDto>>('/search', { query: { ...params, cursor: cursor ?? undefined, limit: PAGE_SIZE } })

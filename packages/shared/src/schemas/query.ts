import { z } from 'zod'
import { LIMITS } from '../limits'
import { POST_TYPES } from '../enums'

export const cursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(LIMITS.pageSizeDefault),
})

export const searchQuerySchema = cursorQuerySchema.extend({
  q: z.string().min(1).max(100).optional(),
  tag: z.string().min(1).max(LIMITS.tagMax + 1).optional(),
  type: z.enum(POST_TYPES).optional(),
})

/** Home and following feeds: a page, optionally of one post type. */
export const feedQuerySchema = cursorQuerySchema.extend({
  type: z.enum(POST_TYPES).optional(),
})

/** The fanart ranking's periods: likes and bookmarks of the last 1, 7 or 30 days. */
export const RANKING_PERIODS = ['day', 'week', 'month'] as const
export type RankingPeriod = (typeof RANKING_PERIODS)[number]

export const rankingQuerySchema = z.object({
  period: z.enum(RANKING_PERIODS).default('day'),
  type: z.enum(POST_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

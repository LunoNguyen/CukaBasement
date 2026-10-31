import { describe, expect, it } from 'vitest'
import { feedQuerySchema, RANKING_PERIODS, rankingQuerySchema } from '../src'

describe('feed and ranking queries', () => {
  it('feed queries take an optional post type and refuse unknown ones', () => {
    expect(feedQuerySchema.parse({ type: 'video' })).toMatchObject({ type: 'video', limit: 30 })
    expect(feedQuerySchema.parse({}).type).toBeUndefined()
    expect(feedQuerySchema.safeParse({ type: 'painting' }).success).toBe(false)
  })

  it('ranking: day, week or month (default day), 1–50 items (default 10), optional type', () => {
    expect(RANKING_PERIODS).toEqual(['day', 'week', 'month'])
    expect(rankingQuerySchema.parse({})).toEqual({ period: 'day', limit: 10 })
    expect(rankingQuerySchema.parse({ period: 'month', type: 'manga', limit: '50' })).toEqual({ period: 'month', type: 'manga', limit: 50 })
    expect(rankingQuerySchema.safeParse({ period: 'year' }).success).toBe(false)
    expect(rankingQuerySchema.safeParse({ limit: '51' }).success).toBe(false)
    expect(rankingQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
  })
})

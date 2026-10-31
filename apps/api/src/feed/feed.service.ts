import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { type feedQuerySchema, normalizeTag, type RankingPeriod, type rankingQuerySchema, type searchQuerySchema } from '@cuka/shared'
import { type Model, Types, type QueryFilter } from 'mongoose'
import type { z } from 'zod'
import { canSeeR18, type Viewer } from '../auth/viewer'
import { FeedCache } from '../cache/feed-cache.service'
import { cursorFilter, decodeCursor, pageOf } from '../common/cursor'
import { BOOKMARK_MODEL, type Bookmark, FOLLOW_MODEL, type Follow, LIKE_MODEL, type Like } from '../interactions/interaction.schemas'
import { POST_MODEL, type Post } from '../posts/post.schema'
import { type CursorQuery, type PostCardDto, PostsService } from '../posts/posts.service'
import { visiblePostsFilter } from '../posts/visibility'

export type SearchQuery = z.infer<typeof searchQuerySchema>
export type FeedQuery = z.infer<typeof feedQuerySchema>
export type RankingQuery = z.infer<typeof rankingQuerySchema>
const MAX_FOLLOWEES = 5000
type Page = { items: PostCardDto[]; nextCursor: string | null }
export type RankedCardDto = PostCardDto & { rank: number; score: number }

const PERIOD_DAYS: Record<RankingPeriod, number> = { day: 1, week: 7, month: 30 }
/** Rankings move slowly; bumps (moderation, edits, deletes) still drop them at once. */
export const RANKING_CACHE_TTL_SEC = 600

/** `filter` (a flat posts query, as visiblePostsFilter's feed context returns) with its keys under `prefix.`. */
function prefixed(filter: Record<string, unknown>, prefix: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(filter).map(([k, v]) => [k.startsWith('$') ? k : `${prefix}.${k}`, v]))
}

/**
 * Feed lists depend on the viewer only through canSeeR18 (the filter and the card media). Cached lists are built for
 * one of these two stand-ins instead of the real viewer, so no per-user data can ever end up in a shared entry.
 */
const ANON: Viewer | null = null
const R18_VIEWER: Viewer = { id: '000000000000000000000000', role: 'user', status: 'active', emailVerified: true, isAdult: true, showR18: true }
function publicViewer(viewer: Viewer | null): Viewer | null {
  return canSeeR18(viewer) ? R18_VIEWER : ANON
}

@Injectable()
export class FeedService {
  constructor(
    @InjectModel(POST_MODEL) private readonly posts: Model<Post>,
    @InjectModel(FOLLOW_MODEL) private readonly follows: Model<Follow>,
    @InjectModel(LIKE_MODEL) private readonly likes: Model<Like>,
    @InjectModel(BOOKMARK_MODEL) private readonly bookmarks: Model<Bookmark>,
    private readonly postsService: PostsService,
    private readonly cache: FeedCache,
  ) {}

  /** Cached per (r18 visibility, cursor, limit, type). */
  home(viewer: Viewer | null, q: FeedQuery): Promise<Page> {
    const v = publicViewer(viewer)
    const extra: QueryFilter<Post>[] = q.type ? [{ type: q.type }] : []
    return this.cache.wrap('home', { r18: !!v, cursor: q.cursor ?? null, limit: q.limit, type: q.type ?? null }, () => this.page(v, q, extra))
  }

  /**
   * The fanart ranking: score = likes + bookmarks made in the last day / week / month, over the posts the feeds
   * list (approved, public, not deleted; R18 only for viewers who may see it, so never blurred here), optionally of
   * one type. Ties go to the newer post. Cached per (r18 visibility, period, type, limit) for 10 minutes.
   */
  ranking(viewer: Viewer | null, q: RankingQuery): Promise<{ items: RankedCardDto[] }> {
    const v = publicViewer(viewer)
    const key = { r18: !!v, period: q.period, type: q.type ?? null, limit: q.limit }
    return this.cache.wrap('ranking', key, () => this.computeRanking(v, q), RANKING_CACHE_TTL_SEC)
  }

  private async computeRanking(viewer: Viewer | null, q: RankingQuery): Promise<{ items: RankedCardDto[] }> {
    const since = new Date(Date.now() - PERIOD_DAYS[q.period] * 86_400_000)
    const inPeriod = [{ $match: { createdAt: { $gte: since } } }, { $project: { _id: 0, postId: 1 } }]
    const listed = { ...visiblePostsFilter(viewer, 'feed'), ...(q.type ? { type: q.type } : {}) } as Record<string, unknown>
    const rows = await this.likes.aggregate<{ _id: Types.ObjectId; score: number; post: Post }>([
      ...inPeriod,
      { $unionWith: { coll: this.bookmarks.collection.collectionName, pipeline: inPeriod } },
      { $group: { _id: '$postId', score: { $sum: 1 } } },
      { $lookup: { from: this.posts.collection.collectionName, localField: '_id', foreignField: '_id', as: 'post' } },
      { $unwind: '$post' },
      { $match: prefixed(listed, 'post') },
      { $sort: { score: -1, 'post.createdAt': -1, _id: -1 } },
      { $limit: q.limit },
    ])
    const cards = await this.postsService.toCards(rows.map((r) => r.post), viewer)
    return { items: cards.map((c, i) => ({ ...c, rank: i + 1, score: rows[i]!.score })) }
  }

  /**
   * The newest approved, all-ages posts for the homepage fanart strip. R18 posts never appear here, whoever asks
   * (the landing page is the site's front door), so one cached list serves everyone.
   */
  showcase(limit: number): Promise<Page> {
    return this.cache.wrap('showcase', { limit }, () => this.page(ANON, { limit }, [{ rating: 'all' }]))
  }

  /** Posts by the viewer's followees (the newest 5000 follows), optionally of one type. */
  async following(viewer: Viewer, q: FeedQuery): Promise<Page> {
    const follows = await this.follows
      .find({ followerId: new Types.ObjectId(viewer.id) }, { followeeId: 1 })
      .sort({ createdAt: -1, _id: -1 })
      .limit(MAX_FOLLOWEES)
      .lean()
    if (follows.length === 0) return { items: [], nextCursor: null }
    return this.page(viewer, q, [{ authorId: { $in: follows.map((f) => f.followeeId) } }, ...(q.type ? [{ type: q.type }] : [])])
  }

  /** Search and tag pages; cached per (r18 visibility, cursor, limit, q, normalized tag, type). */
  async search(viewer: Viewer | null, q: SearchQuery): Promise<Page> {
    const extra: QueryFilter<Post>[] = []
    let tag: string | null = null
    if (q.tag) {
      tag = normalizeTag(q.tag)
      if (!tag) return { items: [], nextCursor: null }
      extra.push({ tags: tag })
    }
    if (q.type) extra.push({ type: q.type })
    if (q.q) extra.push({ $text: { $search: q.q } })
    const v = publicViewer(viewer)
    const key = { r18: !!v, cursor: q.cursor ?? null, limit: q.limit, q: q.q ?? null, tag, type: q.type ?? null }
    return this.cache.wrap('search', key, () => this.page(v, q, extra))
  }

  private async page(viewer: Viewer | null, q: CursorQuery, extra: QueryFilter<Post>[]): Promise<Page> {
    const cursor = decodeCursor(q.cursor)
    const docs = await this.posts
      .find({ $and: [visiblePostsFilter(viewer, 'feed'), ...extra, ...(cursor ? [cursorFilter(cursor)] : [])] })
      .sort({ createdAt: -1, _id: -1 })
      .limit(q.limit + 1)
      .lean()
    const page = pageOf(docs, q.limit)
    return { items: await this.postsService.toCards(page.items, viewer), nextCursor: page.nextCursor }
  }
}

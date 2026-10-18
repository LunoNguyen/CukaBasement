import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { normalizeTag, type searchQuerySchema } from '@cuka/shared'
import { type Model, Types, type QueryFilter } from 'mongoose'
import type { z } from 'zod'
import { canSeeR18, type Viewer } from '../auth/viewer'
import { FeedCache } from '../cache/feed-cache.service'
import { cursorFilter, decodeCursor, pageOf } from '../common/cursor'
import { FOLLOW_MODEL, type Follow } from '../interactions/interaction.schemas'
import { POST_MODEL, type Post } from '../posts/post.schema'
import { type CursorQuery, type PostCardDto, PostsService } from '../posts/posts.service'
import { visiblePostsFilter } from '../posts/visibility'

export type SearchQuery = z.infer<typeof searchQuerySchema>
const MAX_FOLLOWEES = 5000
type Page = { items: PostCardDto[]; nextCursor: string | null }

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
    private readonly postsService: PostsService,
    private readonly cache: FeedCache,
  ) {}

  /** Cached per (r18 visibility, cursor, limit). */
  home(viewer: Viewer | null, q: CursorQuery): Promise<Page> {
    const v = publicViewer(viewer)
    return this.cache.wrap('home', { r18: !!v, cursor: q.cursor ?? null, limit: q.limit }, () => this.page(v, q, []))
  }

  /** Posts by the viewer's followees (the newest 5000 follows). */
  async following(viewer: Viewer, q: CursorQuery): Promise<Page> {
    const follows = await this.follows
      .find({ followerId: new Types.ObjectId(viewer.id) }, { followeeId: 1 })
      .sort({ createdAt: -1, _id: -1 })
      .limit(MAX_FOLLOWEES)
      .lean()
    if (follows.length === 0) return { items: [], nextCursor: null }
    return this.page(viewer, q, [{ authorId: { $in: follows.map((f) => f.followeeId) } }])
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

import { Injectable } from '@nestjs/common'
import { InjectConnection, InjectModel } from '@nestjs/mongoose'
import { normalizeTag, type searchQuerySchema } from '@cuka/shared'
import { type Connection, type Model, Types, type QueryFilter } from 'mongoose'
import type { z } from 'zod'
import type { Viewer } from '../auth/viewer'
import { cursorFilter, decodeCursor, pageOf } from '../common/cursor'
import { POST_MODEL, type Post } from '../posts/post.schema'
import { type CursorQuery, type PostCardDto, PostsService } from '../posts/posts.service'
import { visiblePostsFilter } from '../posts/visibility'

export type SearchQuery = z.infer<typeof searchQuerySchema>
type Page = { items: PostCardDto[]; nextCursor: string | null }

@Injectable()
export class FeedService {
  constructor(
    @InjectModel(POST_MODEL) private readonly posts: Model<Post>,
    @InjectConnection() private readonly conn: Connection,
    private readonly postsService: PostsService,
  ) {}

  home(viewer: Viewer | null, q: CursorQuery): Promise<Page> {
    return this.page(viewer, q, [])
  }

  /** Posts by the viewer's followees. The `follows` collection is created by the follow feature; empty until then. */
  async following(viewer: Viewer, q: CursorQuery): Promise<Page> {
    const follows = await this.conn
      .collection<{ followerId: Types.ObjectId; followeeId: Types.ObjectId }>('follows')
      .find({ followerId: new Types.ObjectId(viewer.id) })
      .toArray()
    if (follows.length === 0) return { items: [], nextCursor: null }
    return this.page(viewer, q, [{ authorId: { $in: follows.map((f) => f.followeeId) } }])
  }

  async search(viewer: Viewer | null, q: SearchQuery): Promise<Page> {
    const extra: QueryFilter<Post>[] = []
    if (q.tag) {
      const tag = normalizeTag(q.tag)
      if (!tag) return { items: [], nextCursor: null }
      extra.push({ tags: tag })
    }
    if (q.type) extra.push({ type: q.type })
    if (q.q) extra.push({ $text: { $search: q.q } })
    return this.page(viewer, q, extra)
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

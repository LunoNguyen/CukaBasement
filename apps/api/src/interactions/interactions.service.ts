import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { type Model, Types, type QueryFilter } from 'mongoose'
import type { Viewer } from '../auth/viewer'
import { AppError } from '../common/app-error'
import { type Cursor, cursorFilter, decodeCursor, encodeCursor, pageOf } from '../common/cursor'
import { NotificationsService } from '../notifications/notifications.service'
import { POST_MODEL, type Post } from '../posts/post.schema'
import { type CursorQuery, type PostCardDto, PostsService } from '../posts/posts.service'
import { canViewPost, visiblePostsFilter } from '../posts/visibility'
import { USER_MODEL, type User } from '../users/user.schema'
import { type PublicUserItemDto, UsersService } from '../users/users.service'
import { BOOKMARK_MODEL, type Bookmark, FOLLOW_MODEL, type Follow, LIKE_MODEL, type Like } from './interaction.schemas'

/** Bounds the work of one bookmark page when most bookmarked posts are not visible to the viewer. */
const MAX_BOOKMARK_BATCHES = 5

type Page<T> = { items: T[]; nextCursor: string | null }

/** MongoDB duplicate key: the unique index already holds this row, so the action was done before. */
function isDuplicate(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 11000
}

function postNotFound(): AppError {
  return new AppError('POST_NOT_FOUND', 404, 'Post not found')
}

function userNotFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'User not found')
}

/**
 * Spec §3.4: the row itself is written first and is the source of truth; counters follow, and only
 * when this request actually inserted or deleted the row, so retries and races never double count.
 */
@Injectable()
export class InteractionsService {
  constructor(
    @InjectModel(LIKE_MODEL) private readonly likes: Model<Like>,
    @InjectModel(BOOKMARK_MODEL) private readonly bookmarks: Model<Bookmark>,
    @InjectModel(FOLLOW_MODEL) private readonly follows: Model<Follow>,
    @InjectModel(POST_MODEL) private readonly posts: Model<Post>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    private readonly notifications: NotificationsService,
    private readonly postsService: PostsService,
    private readonly usersService: UsersService,
  ) {}

  async like(viewer: Viewer, postId: string): Promise<{ liked: boolean; likes: number }> {
    const post = await this.viewablePost(viewer, postId)
    const userId = new Types.ObjectId(viewer.id)
    let inserted = false
    try {
      await this.likes.create({ userId, postId: post._id })
      inserted = true
    } catch (err) {
      if (!isDuplicate(err)) throw err
    }
    if (!inserted) return { liked: true, likes: await this.countOf(post._id, 'likes') }
    const likes = await this.bumpPostCount(post._id, 'likes', 1)
    await this.notifications.notify({ userId: post.authorId.toString(), type: 'like', actorId: viewer.id, postId: post._id.toString() })
    return { liked: true, likes }
  }

  async unlike(viewer: Viewer, postId: string): Promise<{ liked: boolean; likes: number }> {
    const post = await this.existingPost(postId)
    const res = await this.likes.deleteOne({ userId: new Types.ObjectId(viewer.id), postId: post._id })
    const likes = res.deletedCount === 1 ? await this.bumpPostCount(post._id, 'likes', -1) : await this.countOf(post._id, 'likes')
    return { liked: false, likes }
  }

  async bookmark(viewer: Viewer, postId: string, isPrivate: boolean): Promise<{ bookmarked: boolean; bookmarks: number }> {
    const post = await this.viewablePost(viewer, postId)
    const userId = new Types.ObjectId(viewer.id)
    try {
      await this.bookmarks.create({ userId, postId: post._id, isPrivate })
    } catch (err) {
      if (!isDuplicate(err)) throw err
      // Already bookmarked: only the privacy flag changes, the counter stays.
      await this.bookmarks.updateOne({ userId, postId: post._id }, { $set: { isPrivate } })
      return { bookmarked: true, bookmarks: await this.countOf(post._id, 'bookmarks') }
    }
    return { bookmarked: true, bookmarks: await this.bumpPostCount(post._id, 'bookmarks', 1) }
  }

  async unbookmark(viewer: Viewer, postId: string): Promise<{ bookmarked: boolean; bookmarks: number }> {
    const post = await this.existingPost(postId)
    const res = await this.bookmarks.deleteOne({ userId: new Types.ObjectId(viewer.id), postId: post._id })
    const bookmarks = res.deletedCount === 1 ? await this.bumpPostCount(post._id, 'bookmarks', -1) : await this.countOf(post._id, 'bookmarks')
    return { bookmarked: false, bookmarks }
  }

  async follow(viewer: Viewer, username: string): Promise<{ following: boolean; followerCount: number }> {
    const target = await this.activeUser(username)
    if (target._id.toString() === viewer.id) throw new AppError('CANNOT_FOLLOW_SELF', 400, 'You cannot follow yourself')
    const followerId = new Types.ObjectId(viewer.id)
    try {
      await this.follows.create({ followerId, followeeId: target._id })
    } catch (err) {
      if (!isDuplicate(err)) throw err
      return { following: true, followerCount: await this.followerCountOf(target._id) }
    }
    await this.users.updateOne({ _id: followerId }, { $inc: { 'stats.followingCount': 1 } })
    const followerCount = await this.bumpFollowerCount(target._id, 1)
    await this.notifications.notify({ userId: target._id.toString(), type: 'follow', actorId: viewer.id })
    return { following: true, followerCount }
  }

  async unfollow(viewer: Viewer, username: string): Promise<{ following: boolean; followerCount: number }> {
    const target = await this.activeUser(username)
    if (target._id.toString() === viewer.id) throw new AppError('CANNOT_FOLLOW_SELF', 400, 'You cannot follow yourself')
    const followerId = new Types.ObjectId(viewer.id)
    const res = await this.follows.deleteOne({ followerId, followeeId: target._id })
    if (res.deletedCount !== 1) return { following: false, followerCount: await this.followerCountOf(target._id) }
    await this.users.updateOne({ _id: followerId, 'stats.followingCount': { $gt: 0 } }, { $inc: { 'stats.followingCount': -1 } })
    return { following: false, followerCount: await this.bumpFollowerCount(target._id, -1) }
  }

  followers(viewer: Viewer | null, username: string, q: CursorQuery): Promise<Page<PublicUserItemDto>> {
    return this.followPage(viewer, username, q, 'followeeId', 'followerId')
  }

  following(viewer: Viewer | null, username: string, q: CursorQuery): Promise<Page<PublicUserItemDto>> {
    return this.followPage(viewer, username, q, 'followerId', 'followeeId')
  }

  /**
   * Bookmarked posts, newest bookmark first. The owner sees every bookmark whose post they may open;
   * anyone else only public bookmarks of posts that would show in a feed. Bookmarks of posts the
   * viewer cannot see are skipped while filling the page, so a page is full unless the list ends.
   */
  async listBookmarks(viewer: Viewer | null, username: string, q: CursorQuery): Promise<Page<PostCardDto>> {
    const owner = await this.activeUser(username)
    const isOwner = viewer?.id === owner._id.toString()
    const postFilter = visiblePostsFilter(viewer, isOwner ? 'direct' : 'feed')
    const want = q.limit + 1
    const kept: Array<{ _id: Types.ObjectId; createdAt: Date; post: Post }> = []
    let cursor: Cursor | null = decodeCursor(q.cursor)
    let exhausted = false
    let scanned = 0
    while (kept.length < want) {
      if (scanned++ >= MAX_BOOKMARK_BATCHES) break
      const base: QueryFilter<Bookmark>[] = [{ userId: owner._id }, ...(isOwner ? [] : [{ isPrivate: false }]), ...(cursor ? [cursorFilter(cursor)] : [])]
      const batch = await this.bookmarks.find({ $and: base }).sort({ createdAt: -1, _id: -1 }).limit(want).lean()
      if (batch.length === 0) {
        exhausted = true
        break
      }
      const posts = await this.posts.find({ $and: [{ _id: { $in: batch.map((b) => b.postId) } }, postFilter] }).lean()
      const byId = new Map(posts.map((p) => [p._id.toString(), p]))
      for (const b of batch) {
        const post = byId.get(b.postId.toString())
        if (post) kept.push({ _id: b._id, createdAt: b.createdAt, post })
      }
      const last = batch[batch.length - 1]!
      cursor = { createdAt: last.createdAt, id: last._id }
      if (batch.length < want) {
        exhausted = true
        break
      }
    }
    const page = pageOf(kept.slice(0, want), q.limit)
    // The scan gave up before the end: hand back where it stopped so the client can continue.
    if (!exhausted && page.nextCursor === null && cursor) page.nextCursor = encodeCursor({ createdAt: cursor.createdAt, id: cursor.id.toString() })
    return { items: await this.postsService.toCards(page.items.map((k) => k.post), viewer), nextCursor: page.nextCursor }
  }

  /** Users on the other side of `userField` follow rows, newest follow first; banned users are dropped before paging. */
  private async followPage(
    viewer: Viewer | null,
    username: string,
    q: CursorQuery,
    userField: 'followerId' | 'followeeId',
    otherField: 'followerId' | 'followeeId',
  ): Promise<Page<PublicUserItemDto>> {
    const target = await this.activeUser(username)
    const cursor = decodeCursor(q.cursor)
    const rows = await this.follows
      .aggregate<{ _id: Types.ObjectId; createdAt: Date; user: User }>([
        { $match: { $and: [{ [userField]: target._id }, ...(cursor ? [cursorFilter(cursor)] : [])] } },
        { $sort: { createdAt: -1, _id: -1 } },
        { $lookup: { from: this.users.collection.name, localField: otherField, foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $match: { 'user.status': { $ne: 'banned' } } },
        { $limit: q.limit + 1 },
        { $project: { createdAt: 1, user: 1 } },
      ])
      .exec()
    const page = pageOf(rows, q.limit)
    return { items: await this.usersService.toPublicItems(page.items.map((r) => r.user), viewer), nextCursor: page.nextCursor }
  }

  private async viewablePost(viewer: Viewer, id: string): Promise<Post> {
    const post = /^[0-9a-fA-F]{24}$/.test(id) ? await this.posts.findById(id).lean() : null
    if (!post || !canViewPost(viewer, post)) throw postNotFound()
    return post
  }

  /** Undoing needs only the post row, so users can still remove their like/bookmark after a post is hidden or deleted. */
  private async existingPost(id: string): Promise<Pick<Post, '_id'>> {
    const post = /^[0-9a-fA-F]{24}$/.test(id) ? await this.posts.findById(id, { _id: 1 }).lean() : null
    if (!post) throw postNotFound()
    return post
  }

  private async activeUser(username: string): Promise<User> {
    const user = await this.users.findOne({ 'profile.username': username }).lean()
    if (!user || user.status === 'banned') throw userNotFound()
    return user
  }

  /** `$inc` that never takes a counter below zero; returns the stored value afterwards. */
  private async bumpPostCount(postId: Types.ObjectId, field: 'likes' | 'bookmarks', by: 1 | -1): Promise<number> {
    const path = `counts.${field}`
    const filter = by === -1 ? { _id: postId, [path]: { $gt: 0 } } : { _id: postId }
    // timestamps: false keeps `updatedAt` for real edits.
    await this.posts.updateOne(filter, { $inc: { [path]: by } }, { timestamps: false })
    return this.countOf(postId, field)
  }

  private async countOf(postId: Types.ObjectId, field: 'likes' | 'bookmarks'): Promise<number> {
    const post = await this.posts.findById(postId, { counts: 1 }).lean()
    return post?.counts[field] ?? 0
  }

  private async bumpFollowerCount(userId: Types.ObjectId, by: 1 | -1): Promise<number> {
    const filter = by === -1 ? { _id: userId, 'stats.followerCount': { $gt: 0 } } : { _id: userId }
    await this.users.updateOne(filter, { $inc: { 'stats.followerCount': by } })
    return this.followerCountOf(userId)
  }

  private async followerCountOf(userId: Types.ObjectId): Promise<number> {
    const user = await this.users.findById(userId, { stats: 1 }).lean()
    return user?.stats.followerCount ?? 0
  }
}

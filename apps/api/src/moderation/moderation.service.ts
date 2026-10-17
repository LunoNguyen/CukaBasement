import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { REPORT_REASONS, type ReportReason, type ReviewStatus, type Role, type Visibility } from '@cuka/shared'
import { type Model, type QueryFilter, Types } from 'mongoose'
import type { Viewer } from '../auth/viewer'
import { AppError } from '../common/app-error'
import { cursorFilter, decodeCursor, pageOf } from '../common/cursor'
import { COMMENT_MODEL, type Comment, type CommentStatus } from '../comments/comment.schema'
import { NotificationsService } from '../notifications/notifications.service'
import { POST_MODEL, type Post } from '../posts/post.schema'
import { type AuthorDto, type CursorQuery, type PostCardDto, PostsService } from '../posts/posts.service'
import { REPORT_MODEL, type Report } from '../reports/report.schema'
import { ReportsService } from '../reports/reports.service'
import { USER_MODEL, type User } from '../users/user.schema'
import { UsersService } from '../users/users.service'
import { ModerationLogService } from './moderation-log.service'

export type QueueQuery = CursorQuery & { status: 'pending' | 'rejected' }

export interface ModPostResult {
  id: string
  review: { status: ReviewStatus; reason?: string; by: string | null; at: string | null }
  visibility: Visibility
}

export interface ReportGroupDto {
  post: PostCardDto
  total: number
  aiArt: number
  reasons: Record<ReportReason, number>
  latest: Array<{ reason: ReportReason; detail: string; reporter: { username: string }; createdAt: string }>
}

export interface HiddenCommentDto {
  id: string
  body: string
  status: 'hidden'
  parentId: string | null
  post: { id: string; title: string }
  author: AuthorDto
  createdAt: string
}

/** Spec §5.2: a moderator may not act on content or accounts of another moderator or an admin; admins may. */
export function assertCanModerate(actor: Viewer, targetUserRole: Role): void {
  if (actor.role !== 'admin' && targetUserRole !== 'user') {
    throw new AppError('CANNOT_MODERATE_PEER', 403, 'Moderators cannot act on staff content')
  }
}

function oid(id: string): Types.ObjectId | null {
  return /^[0-9a-fA-F]{24}$/.test(id) ? new Types.ObjectId(id) : null
}

function postNotFound(): AppError {
  return new AppError('POST_NOT_FOUND', 404, 'Post not found')
}

const LATEST_REPORTS = 5

/** No `updatedAt` bump: moderation is not an edit by the author. */
const NO_TIMESTAMPS = { returnDocument: 'after', timestamps: false } as const

@Injectable()
export class ModerationService {
  constructor(
    @InjectModel(POST_MODEL) private readonly posts: Model<Post>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectModel(REPORT_MODEL) private readonly reports: Model<Report>,
    @InjectModel(COMMENT_MODEL) private readonly comments: Model<Comment>,
    private readonly postsService: PostsService,
    private readonly reportsService: ReportsService,
    private readonly modLog: ModerationLogService,
    private readonly notifications: NotificationsService,
    private readonly usersService: UsersService,
  ) {}

  /** FIFO over (createdAt asc, _id asc). Staff viewers get full media, r18 included. */
  async queue(actor: Viewer, q: QueueQuery): Promise<{ items: PostCardDto[]; nextCursor: string | null }> {
    const cursor = decodeCursor(q.cursor)
    const filter: QueryFilter<Post> = { 'review.status': q.status, deletedAt: null }
    if (cursor) filter.$or = [{ createdAt: { $gt: cursor.createdAt } }, { createdAt: cursor.createdAt, _id: { $gt: cursor.id } }]
    const docs = await this.posts.find(filter).sort({ createdAt: 1, _id: 1 }).limit(q.limit + 1).lean()
    const page = pageOf(docs, q.limit)
    return { items: await this.postsService.toCards(page.items, actor), nextCursor: page.nextCursor }
  }

  approve(actor: Viewer, id: string): Promise<ModPostResult> {
    return this.review(actor, id, 'approved', ['pending', 'rejected'], null)
  }

  reject(actor: Viewer, id: string, reason: string): Promise<ModPostResult> {
    return this.review(actor, id, 'rejected', ['pending', 'approved'], reason)
  }

  async hide(actor: Viewer, id: string, note?: string): Promise<ModPostResult> {
    const post = await this.moderatablePost(actor, id)
    const changed = await this.setVisibility(post._id, ['public', 'hidden_by_reports'], 'removed')
    if (changed) {
      await this.modLog.log(actor.id, 'hide', 'post', id, note)
      await this.notifications.notify({ userId: post.authorId.toString(), type: 'post_hidden', postId: id })
    }
    return this.result(changed ?? post)
  }

  /** Visibility only: open or resolved reports are left untouched (resolve `keep` handles those). */
  async restore(actor: Viewer, id: string): Promise<ModPostResult> {
    const post = await this.moderatablePost(actor, id)
    const changed = await this.setVisibility(post._id, ['removed', 'hidden_by_reports'], 'public')
    if (changed) await this.modLog.log(actor.id, 'restore', 'post', id)
    return this.result(changed ?? post)
  }

  /**
   * Open reports grouped by post, `ai_art`-reported posts first, then by report count, then the oldest open report.
   * Returns the top `limit` groups only; resolving a group removes it, so the next call shows the next ones.
   */
  async reportQueue(actor: Viewer, limit: number): Promise<{ items: ReportGroupDto[]; nextCursor: null }> {
    type Row = {
      _id: Types.ObjectId
      total: number
      aiArt: number
      reasons: ReportReason[]
      latest: Array<{ reason: ReportReason; detail: string; reporterId: Types.ObjectId; createdAt: Date }>
    }
    const rows = await this.reports.aggregate<Row>([
      { $match: { status: 'open' } },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: '$postId',
          total: { $sum: 1 },
          aiArt: { $sum: { $cond: [{ $eq: ['$reason', 'ai_art'] }, 1, 0] } },
          reasons: { $push: '$reason' },
          oldest: { $min: '$createdAt' },
          latest: { $push: { reason: '$reason', detail: '$detail', reporterId: '$reporterId', createdAt: '$createdAt' } },
        },
      },
      { $lookup: { from: 'posts', localField: '_id', foreignField: '_id', pipeline: [{ $match: { deletedAt: null } }, { $project: { _id: 1 } }], as: 'live' } },
      { $match: { 'live.0': { $exists: true } } },
      { $addFields: { hasAi: { $cond: [{ $gt: ['$aiArt', 0] }, 1, 0] }, latest: { $slice: ['$latest', LATEST_REPORTS] } } },
      { $sort: { hasAi: -1, total: -1, oldest: 1, _id: 1 } },
      { $limit: limit },
    ])

    const posts = await this.posts.find({ _id: { $in: rows.map((r) => r._id) } }).lean()
    const cards = new Map((await this.postsService.toCards(posts, actor)).map((c) => [c.id, c]))
    const reporterIds = [...new Set(rows.flatMap((r) => r.latest.map((l) => l.reporterId.toString())))].map((s) => new Types.ObjectId(s))
    const reporters = await this.users.find({ _id: { $in: reporterIds } }, { profile: 1 }).lean()
    const usernames = new Map(reporters.map((u) => [u._id.toString(), u.profile.username]))

    const items = rows.flatMap((r) => {
      const post = cards.get(r._id.toString())
      if (!post) return []
      const reasons = Object.fromEntries(REPORT_REASONS.map((x) => [x, 0])) as Record<ReportReason, number>
      for (const x of r.reasons) reasons[x]++
      return [
        {
          post,
          total: r.total,
          aiArt: r.aiArt,
          reasons,
          latest: r.latest.map((l) => ({
            reason: l.reason,
            detail: l.detail,
            reporter: { username: usernames.get(l.reporterId.toString()) ?? '' },
            createdAt: l.createdAt.toISOString(),
          })),
        },
      ]
    })
    return { items, nextCursor: null }
  }

  /** Spec §5.5. `keep` dismisses open reports and undoes an auto-hide; `remove` actions them and removes the post. */
  async resolve(actor: Viewer, postId: string, decision: 'keep' | 'remove', note?: string): Promise<ModPostResult & { resolved: number }> {
    const post = await this.moderatablePost(actor, postId)
    const status = decision === 'keep' ? 'dismissed' : 'actioned'
    const res = await this.reports.updateMany(
      { postId: post._id, status: 'open' },
      { $set: { status, resolvedBy: new Types.ObjectId(actor.id), resolvedAt: new Date() } },
    )
    await this.reportsService.recountOpen(postId)
    const changed =
      decision === 'keep'
        ? await this.setVisibility(post._id, ['hidden_by_reports'], 'public')
        : await this.setVisibility(post._id, ['public', 'hidden_by_reports'], 'removed')
    if (res.modifiedCount > 0 || changed) await this.modLog.log(actor.id, decision === 'keep' ? 'restore' : 'remove', 'post', postId, note)
    if (decision === 'remove' && changed) {
      await this.notifications.notify({ userId: post.authorId.toString(), type: 'post_hidden', postId })
    }
    const current = changed ?? (await this.posts.findById(post._id).lean()) ?? post
    return { ...this.result(current), resolved: res.modifiedCount }
  }

  hideComment(actor: Viewer, id: string): Promise<{ id: string; status: 'hidden' }> {
    return this.setCommentStatus(actor, id, 'visible', 'hidden', 'hide_comment')
  }

  restoreComment(actor: Viewer, id: string): Promise<{ id: string; status: 'visible' }> {
    return this.setCommentStatus(actor, id, 'hidden', 'visible', 'restore')
  }

  /** Hidden, non-deleted comments, newest first, with their post (deleted posts included) and author. */
  async hiddenComments(q: CursorQuery): Promise<{ items: HiddenCommentDto[]; nextCursor: string | null }> {
    const cursor = decodeCursor(q.cursor)
    const docs = await this.comments
      .find({ status: 'hidden', deletedAt: null, ...(cursor ? cursorFilter(cursor) : {}) })
      .sort({ createdAt: -1, _id: -1 })
      .limit(q.limit + 1)
      .lean()
    const page = pageOf(docs, q.limit)
    const [posts, users] = await Promise.all([
      this.posts.find({ _id: { $in: page.items.map((c) => c.postId) } }, { title: 1 }).lean(),
      this.users.find({ _id: { $in: page.items.map((c) => c.authorId) } }, { profile: 1 }).lean(),
    ])
    const titles = new Map(posts.map((p) => [p._id.toString(), p.title]))
    const authors = new Map<string, AuthorDto>()
    for (const u of users) {
      const avatarUrl = u.profile.avatarFileId ? await this.usersService.publicAvatarUrl(u.profile.avatarFileId.toString()) : null
      authors.set(u._id.toString(), { id: u._id.toString(), username: u.profile.username, displayName: u.profile.displayName, avatarUrl })
    }
    const items = page.items.map((c) => {
      const postId = c.postId.toString()
      const authorId = c.authorId.toString()
      return {
        id: c._id.toString(),
        body: c.body,
        status: 'hidden' as const,
        parentId: c.parentId?.toString() ?? null,
        post: { id: postId, title: titles.get(postId) ?? '' },
        author: authors.get(authorId) ?? { id: authorId, username: '', displayName: '', avatarUrl: null },
        createdAt: c.createdAt.toISOString(),
      }
    })
    return { items, nextCursor: page.nextCursor }
  }

  /** One conditional update, so a repeated or concurrent request logs once; already in `to` → unchanged (idempotent). */
  private async setCommentStatus<T extends CommentStatus>(
    actor: Viewer,
    id: string,
    from: CommentStatus,
    to: T,
    action: 'hide_comment' | 'restore',
  ): Promise<{ id: string; status: T }> {
    const _id = oid(id)
    const comment = _id ? await this.comments.findOne({ _id, deletedAt: null }).lean() : null
    if (!comment) throw new AppError('COMMENT_NOT_FOUND', 404, 'Comment not found')
    assertCanModerate(actor, await this.roleOf(comment.authorId))
    const res = await this.comments.updateOne({ _id, status: from, deletedAt: null }, { $set: { status: to } })
    if (res.modifiedCount > 0) await this.modLog.log(actor.id, action, 'comment', id)
    return { id, status: to }
  }

  /**
   * Moves the review to `to` only from one of `from`, in one conditional update, so concurrent requests log and
   * notify once. A post already in `to` is returned unchanged (idempotent).
   */
  private async review(actor: Viewer, id: string, to: 'approved' | 'rejected', from: ReviewStatus[], reason: string | null): Promise<ModPostResult> {
    const post = await this.moderatablePost(actor, id)
    const updated = await this.posts
      .findOneAndUpdate(
        { _id: post._id, deletedAt: null, 'review.status': { $in: from } },
        { $set: { 'review.status': to, 'review.reason': reason, 'review.by': new Types.ObjectId(actor.id), 'review.at': new Date() } },
        NO_TIMESTAMPS,
      )
      .lean()
    if (updated) {
      await this.modLog.log(actor.id, to === 'approved' ? 'approve' : 'reject', 'post', id, reason ?? undefined)
      await this.notifications.notify({ userId: post.authorId.toString(), type: to === 'approved' ? 'post_approved' : 'post_rejected', postId: id })
      return this.result(updated)
    }
    const current = await this.posts.findOne({ _id: post._id, deletedAt: null }).lean()
    if (!current) throw postNotFound()
    return this.result(current)
  }

  /** Returns the updated post when the visibility actually changed, otherwise null. */
  private setVisibility(_id: Types.ObjectId, from: Visibility[], to: Visibility): Promise<Post | null> {
    return this.posts.findOneAndUpdate({ _id, deletedAt: null, visibility: { $in: from } }, { $set: { visibility: to } }, NO_TIMESTAMPS).lean()
  }

  private async moderatablePost(actor: Viewer, id: string): Promise<Post> {
    const _id = oid(id)
    const post = _id ? await this.posts.findOne({ _id, deletedAt: null }).lean() : null
    if (!post) throw postNotFound()
    assertCanModerate(actor, await this.roleOf(post.authorId))
    return post
  }

  /** A missing author counts as a plain user. */
  private async roleOf(userId: Types.ObjectId): Promise<Role> {
    const user = await this.users.findById(userId, { role: 1 }).lean()
    return user?.role ?? 'user'
  }

  private result(post: Post): ModPostResult {
    const r = post.review
    return {
      id: post._id.toString(),
      review: { status: r.status, ...(r.reason ? { reason: r.reason } : {}), by: r.by ? r.by.toString() : null, at: r.at ? r.at.toISOString() : null },
      visibility: post.visibility,
    }
  }
}

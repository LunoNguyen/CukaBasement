import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import type { NotificationType } from '@cuka/shared'
import { type Model, Types } from 'mongoose'
import { cursorFilter, decodeCursor, pageOf } from '../common/cursor'
import { POST_MODEL, type Post } from '../posts/post.schema'
import type { CursorQuery } from '../posts/posts.service'
import { USER_MODEL, type User } from '../users/user.schema'
import { UsersService } from '../users/users.service'
import { NOTIFICATION_MODEL, type Notification } from './notification.schema'

export interface NotificationDto {
  id: string
  type: NotificationType
  actor: { username: string; displayName: string; avatarUrl: string | null } | null
  post: { id: string; title: string } | null
  commentId: string | null
  reason?: string
  readAt: string | null
  createdAt: string
}

export interface NotifyInput {
  userId: string
  type: NotificationType
  actorId?: string
  postId?: string
  commentId?: string
}

/** Types that mean "this actor did this once": repeating the action must not notify again. */
const ONCE_PER_ACTOR: NotificationType[] = ['like', 'follow']

function oid(id: string | undefined): Types.ObjectId | null {
  return id ? new Types.ObjectId(id) : null
}


@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService')

  constructor(
    @InjectModel(NOTIFICATION_MODEL) private readonly notifications: Model<Notification>,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectModel(POST_MODEL) private readonly posts: Model<Post>,
    private readonly usersService: UsersService,
  ) {}

  async list(viewerId: string, q: CursorQuery): Promise<{ items: NotificationDto[]; nextCursor: string | null }> {
    const cursor = decodeCursor(q.cursor)
    const filter = { userId: new Types.ObjectId(viewerId), ...(cursor ? cursorFilter(cursor) : {}) }
    const docs = await this.notifications.find(filter).sort({ createdAt: -1, _id: -1 }).limit(q.limit + 1).lean()
    const { items, nextCursor } = pageOf(docs, q.limit)

    const actorIds = [...new Set(items.flatMap((n) => (n.actorId ? [n.actorId.toString()] : [])))].map((id) => new Types.ObjectId(id))
    const postIds = [...new Set(items.flatMap((n) => (n.postId ? [n.postId.toString()] : [])))].map((id) => new Types.ObjectId(id))
    const [actors, posts] = await Promise.all([
      actorIds.length ? this.users.find({ _id: { $in: actorIds }, status: { $ne: 'banned' } }, { profile: 1 }).lean() : [],
      postIds.length ? this.posts.find({ _id: { $in: postIds }, deletedAt: null }, { title: 1, review: 1 }).lean() : [],
    ])
    const actorById = new Map(
      await Promise.all(
        actors.map(async (u) => {
          const p = u.profile
          const avatarUrl = p.avatarFileId ? await this.usersService.publicAvatarUrl(p.avatarFileId.toString()) : null
          return [u._id.toString(), { username: p.username, displayName: p.displayName, avatarUrl }] as const
        }),
      ),
    )
    const postById = new Map(posts.map((p) => [p._id.toString(), p]))

    return {
      items: items.map((n) => {
        const post = n.postId ? postById.get(n.postId.toString()) : undefined
        const dto: NotificationDto = {
          id: n._id.toString(),
          type: n.type,
          actor: n.actorId ? (actorById.get(n.actorId.toString()) ?? null) : null,
          post: post ? { id: post._id.toString(), title: post.title } : null,
          commentId: n.commentId ? n.commentId.toString() : null,
          readAt: n.readAt ? n.readAt.toISOString() : null,
          createdAt: n.createdAt.toISOString(),
        }
        if (n.type === 'post_rejected' && post?.review.reason) dto.reason = post.review.reason
        return dto
      }),
      nextCursor,
    }
  }

  async unreadCount(viewerId: string): Promise<{ count: number }> {
    return { count: await this.notifications.countDocuments({ userId: new Types.ObjectId(viewerId), readAt: null }) }
  }

  async markRead(viewerId: string, input: { ids?: string[]; all?: boolean }): Promise<void> {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(viewerId), readAt: null }
    if (!input.all) filter._id = { $in: (input.ids ?? []).map((id) => new Types.ObjectId(id)) }
    await this.notifications.updateMany(filter, { $set: { readAt: new Date() } })
  }

  /** Best effort: a failed notification never fails the action that caused it. */
  async notify(n: NotifyInput): Promise<void> {
    if (n.actorId && n.actorId === n.userId) return
    const doc = { userId: new Types.ObjectId(n.userId), type: n.type, actorId: oid(n.actorId), postId: oid(n.postId), commentId: oid(n.commentId) }
    try {
      if (ONCE_PER_ACTOR.includes(n.type)) {
        // Upsert on the identity of the event: like, unlike, like again leaves a single notification.
        await this.notifications.updateOne(
          { userId: doc.userId, type: doc.type, actorId: doc.actorId, postId: doc.postId },
          { $setOnInsert: { ...doc, commentId: null, readAt: null } },
          { upsert: true },
        )
      } else {
        await this.notifications.create({ ...doc, readAt: null })
      }
    } catch (err) {
      this.logger.warn(`Could not notify user ${n.userId} (${n.type}): ${(err as Error).message}`)
    }
  }
}

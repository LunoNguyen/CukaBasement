import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import type { NotificationType } from '@cuka/shared'
import { type Model, Types } from 'mongoose'
import { NOTIFICATION_MODEL, type Notification } from './notification.schema'

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

  constructor(@InjectModel(NOTIFICATION_MODEL) private readonly notifications: Model<Notification>) {}

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

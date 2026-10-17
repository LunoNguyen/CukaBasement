import { NOTIFICATION_TYPES, type NotificationType } from '@cuka/shared'
import { type HydratedDocument, Schema, Types } from 'mongoose'

export interface Notification {
  _id: Types.ObjectId
  userId: Types.ObjectId
  type: NotificationType
  actorId: Types.ObjectId | null
  postId: Types.ObjectId | null
  commentId: Types.ObjectId | null
  readAt: Date | null
  createdAt: Date
}

export type NotificationDocument = HydratedDocument<Notification>

export const NOTIFICATION_MODEL = 'Notification'

const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60

export const NotificationSchema = new Schema<Notification>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    actorId: { type: Schema.Types.ObjectId, default: null },
    postId: { type: Schema.Types.ObjectId, default: null },
    commentId: { type: Schema.Types.ObjectId, default: null },
    readAt: { type: Date, default: null },
  },
  { collection: 'notifications', timestamps: { createdAt: true, updatedAt: false } },
)

NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 })
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: NINETY_DAYS_SECONDS })
// The purge job removes a post's notifications.
NotificationSchema.index({ postId: 1 }, { partialFilterExpression: { postId: { $type: 'objectId' } } })

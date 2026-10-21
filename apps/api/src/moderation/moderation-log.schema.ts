import { MOD_ACTIONS, type ModAction } from '@cuka/shared'
import { type HydratedDocument, Schema, Types } from 'mongoose'

export type ModTargetType = 'post' | 'user' | 'comment' | 'settings' | 'backup' | 'site'

export interface ModerationLog {
  _id: Types.ObjectId
  /** The staff user, or 'system' for automatic actions such as auto_hide. */
  actorId: Types.ObjectId | 'system'
  action: ModAction
  targetType: ModTargetType
  targetId: string
  note: string
  createdAt: Date
}

export type ModerationLogDocument = HydratedDocument<ModerationLog>

export const MODERATION_LOG_MODEL = 'ModerationLog'

export const ModerationLogSchema = new Schema<ModerationLog>(
  {
    actorId: { type: Schema.Types.Mixed, required: true },
    action: { type: String, enum: MOD_ACTIONS, required: true },
    targetType: { type: String, enum: ['post', 'user', 'comment', 'settings', 'backup', 'site'], required: true },
    // A string so non-ObjectId targets (the 'global' settings document) fit too.
    targetId: { type: String, required: true },
    note: { type: String, default: '' },
  },
  { collection: 'moderationLogs', timestamps: { createdAt: true, updatedAt: false } },
)

import { type HydratedDocument, Schema, Types } from 'mongoose'

export const AUTH_TOKEN_TYPES = ['verify_email', 'reset_password', 'refresh'] as const
export type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[number]

export interface AuthToken {
  _id: Types.ObjectId
  userId: Types.ObjectId
  type: AuthTokenType
  /** sha256 hex of the raw token; the raw value is never stored. */
  tokenHash: string
  expiresAt: Date
  usedAt: Date | null
  /** Refresh tokens only: shared by every token rotated from the same login. */
  familyId: string | null
}

export type AuthTokenDocument = HydratedDocument<AuthToken>

export const AUTH_TOKEN_MODEL = 'AuthToken'

export const AuthTokenSchema = new Schema<AuthToken>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, enum: AUTH_TOKEN_TYPES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, expires: 0 },
    usedAt: { type: Date, default: null },
    familyId: { type: String, default: null },
  },
  { collection: 'authTokens' },
)
AuthTokenSchema.index({ userId: 1, type: 1 })

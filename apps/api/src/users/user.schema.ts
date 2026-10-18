import { type LegacySocialLinks, LOCALES, type Locale, ROLES, type Role, SOCIAL_PLATFORMS, type SocialPlatform, USER_STATUSES, type UserStatus } from '@cuka/shared'
import { type HydratedDocument, Schema, Types } from 'mongoose'

/** A stored profile link; `label` is '' except for platform `other`. */
export interface StoredSocialLink {
  platform: SocialPlatform
  label: string
  url: string
}

export interface User {
  _id: Types.ObjectId
  email: string
  passwordHash: string
  role: Role
  status: UserStatus
  emailVerifiedAt: Date | null
  birthDate: Date | null
  showR18: boolean
  locale: Locale
  profile: {
    username: string
    displayName: string
    bio: string
    avatarFileId: Types.ObjectId | null
    bannerFileId: Types.ObjectId | null
    links: StoredSocialLink[]
    /**
     * Legacy fixed links (before the list). Read only while `links` is empty and unset on the first save of `links`
     * or by the setup migration (see effectiveLinks).
     */
    socialLinks?: LegacySocialLinks
  }
  stats: { followerCount: number; followingCount: number; postCount: number }
  createdAt: Date
  lastLoginAt: Date | null
}

export type UserDocument = HydratedDocument<User>

export const USER_MODEL = 'User'

const SocialLinkSchema = new Schema<StoredSocialLink>(
  {
    platform: { type: String, enum: SOCIAL_PLATFORMS, required: true },
    label: { type: String, default: '' },
    url: { type: String, required: true },
  },
  { _id: false },
)

export const UserSchema = new Schema<User>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, default: 'user' },
    status: { type: String, enum: USER_STATUSES, default: 'active' },
    emailVerifiedAt: { type: Date, default: null },
    birthDate: { type: Date, default: null },
    showR18: { type: Boolean, default: false },
    locale: { type: String, enum: LOCALES, default: 'vi' },
    profile: {
      username: { type: String, required: true, unique: true },
      displayName: { type: String, required: true },
      bio: { type: String, default: '' },
      avatarFileId: { type: Schema.Types.ObjectId, default: null },
      bannerFileId: { type: Schema.Types.ObjectId, default: null },
      links: { type: [SocialLinkSchema], default: [] },
      // No defaults: new users get no legacy fields, so nothing is ever migrated for them.
      socialLinks: { x: String, facebook: String, youtube: String, pixiv: String },
    },
    stats: {
      followerCount: { type: Number, default: 0 },
      followingCount: { type: Number, default: 0 },
      postCount: { type: Number, default: 0 },
    },
    lastLoginAt: { type: Date, default: null },
  },
  { collection: 'users', timestamps: { createdAt: true, updatedAt: false } },
)

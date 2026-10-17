import { Injectable } from '@nestjs/common'
import { InjectConnection, InjectModel } from '@nestjs/mongoose'
import type { Locale, Role, updateProfileSchema, updateSettingsSchema, UserStatus } from '@cuka/shared'
import * as argon2 from 'argon2'
import { type Connection, type Model, Types } from 'mongoose'
import type { z } from 'zod'
import { AUTH_TOKEN_MODEL, type AuthToken } from '../auth/auth-token.schema'
import { hashToken } from '../auth/tokens'
import { isAdult } from '../auth/viewer'
import { AppError } from '../common/app-error'
import { StorageService } from '../storage/storage.service'
import { USER_MODEL, type SocialLinks, type User } from './user.schema'

export interface MeDto {
  id: string
  email: string
  role: Role
  status: UserStatus
  emailVerified: boolean
  locale: Locale
  showR18: boolean
  /** `YYYY-MM-DD` */
  birthDate: string | null
  profile: {
    username: string
    displayName: string
    bio: string
    avatarFileId: string | null
    bannerFileId: string | null
    socialLinks: SocialLinks
  }
}

export interface PublicUserDto {
  id: string
  username: string
  displayName: string
  bio: string
  avatarUrl: string | null
  bannerUrl: string | null
  socialLinks: SocialLinks
  stats: User['stats']
  createdAt: string
  isFollowing: boolean
}

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>

function objectId(id: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectModel(AUTH_TOKEN_MODEL) private readonly authTokens: Model<AuthToken>,
    @InjectConnection() private readonly conn: Connection,
    private readonly storage: StorageService,
  ) {}

  private async getUser(id: string): Promise<User> {
    const user = await this.users.findById(id).lean()
    if (!user) throw new AppError('UNAUTHENTICATED', 401, 'Authentication required')
    return user
  }

  async me(id: string): Promise<MeDto> {
    return this.toMe(await this.getUser(id))
  }

  async updateProfile(id: string, input: UpdateProfileInput): Promise<MeDto> {
    const $set: Record<string, unknown> = {}
    if (input.displayName !== undefined) $set['profile.displayName'] = input.displayName
    if (input.bio !== undefined) $set['profile.bio'] = input.bio
    // File ownership/readiness is validated once the files model exists.
    for (const key of ['avatarFileId', 'bannerFileId'] as const) {
      const v = input[key]
      if (v === undefined) continue
      const oid = objectId(v)
      if (!oid) throw new AppError('VALIDATION_FAILED', 400, `Invalid ${key}`)
      $set[`profile.${key}`] = oid
    }
    for (const [k, v] of Object.entries(input.socialLinks ?? {})) {
      if (v !== undefined) $set[`profile.socialLinks.${k}`] = v
    }
    if (Object.keys($set).length) await this.users.updateOne({ _id: id }, { $set })
    return this.me(id)
  }

  async updateSettings(id: string, input: UpdateSettingsInput): Promise<MeDto> {
    const user = await this.getUser(id)
    const birthDate = input.birthDate !== undefined ? new Date(`${input.birthDate}T00:00:00Z`) : user.birthDate
    const showR18 = input.showR18 ?? user.showR18
    if (showR18 && !isAdult(birthDate)) {
      throw new AppError('AGE_REQUIRED', 400, 'You must be 18 or older to show R18 content')
    }
    const $set: Record<string, unknown> = {}
    if (input.locale !== undefined) $set.locale = input.locale
    if (input.birthDate !== undefined) $set.birthDate = birthDate
    if (input.showR18 !== undefined) $set.showR18 = input.showR18
    if (Object.keys($set).length) await this.users.updateOne({ _id: id }, { $set })
    return this.me(id)
  }

  /** Changes the password and revokes every refresh token except the one in `keepRefreshToken`. */
  async changePassword(id: string, currentPassword: string, newPassword: string, keepRefreshToken?: string): Promise<void> {
    const user = await this.getUser(id)
    const ok = await argon2.verify(user.passwordHash, currentPassword).catch(() => false)
    if (!ok) throw new AppError('INVALID_CREDENTIALS', 400, 'Current password is incorrect')
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id })
    await this.users.updateOne({ _id: id }, { $set: { passwordHash } })
    await this.authTokens.deleteMany({
      userId: user._id,
      type: 'refresh',
      ...(keepRefreshToken ? { tokenHash: { $ne: hashToken(keepRefreshToken) } } : {}),
    })
  }

  async getPublic(username: string): Promise<PublicUserDto> {
    const user = await this.users.findOne({ 'profile.username': username }).lean()
    if (!user || user.status === 'banned') throw new AppError('NOT_FOUND', 404, 'User not found')
    const p = user.profile
    const s = p.socialLinks
    return {
      id: user._id.toString(),
      username: p.username,
      displayName: p.displayName,
      bio: p.bio,
      avatarUrl: p.avatarFileId ? await this.publicAvatarUrl(p.avatarFileId.toString()) : null,
      bannerUrl: p.bannerFileId ? await this.publicAvatarUrl(p.bannerFileId.toString()) : null,
      socialLinks: { x: s.x, facebook: s.facebook, youtube: s.youtube, pixiv: s.pixiv },
      stats: user.stats,
      createdAt: user.createdAt.toISOString(),
      isFollowing: false,
    }
  }

  /** Public URL of the file's `thumb_md` variant; null when the file or variant does not exist. */
  async publicAvatarUrl(fileId: string): Promise<string | null> {
    const oid = objectId(fileId)
    if (!oid) return null
    const file = await this.conn.collection<any>('files').findOne({ _id: oid })
    const variants: unknown = file?.variants
    const list: Array<{ name?: string; objectKey?: string }> = Array.isArray(variants)
      ? variants
      : variants && typeof variants === 'object'
        ? Object.entries(variants).map(([name, v]) => ({ name, ...(v as object) }))
        : []
    const key = list.find((v) => v.name === 'thumb_md')?.objectKey
    return key ? this.storage.publicUrl(key) : null
  }

  toMe(user: User): MeDto {
    const p = user.profile
    const s = p.socialLinks
    return {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerifiedAt != null,
      locale: user.locale,
      showR18: user.showR18,
      birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : null,
      profile: {
        username: p.username,
        displayName: p.displayName,
        bio: p.bio,
        avatarFileId: p.avatarFileId?.toString() ?? null,
        bannerFileId: p.bannerFileId?.toString() ?? null,
        socialLinks: { x: s.x, facebook: s.facebook, youtube: s.youtube, pixiv: s.pixiv },
      },
    }
  }
}

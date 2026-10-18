import { Inject, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import type { Locale, Role, SocialLink, updateProfileSchema, updateSettingsSchema, UserStatus } from '@cuka/shared'
import * as argon2 from 'argon2'
import { type Model, Types } from 'mongoose'
import type { z } from 'zod'
import { AUTH_TOKEN_MODEL, type AuthToken } from '../auth/auth-token.schema'
import { hashToken } from '../auth/tokens'
import { isAdult, type Viewer } from '../auth/viewer'
import { FeedCache } from '../cache/feed-cache.service'
import { AppError } from '../common/app-error'
import { CONFIG, type Config } from '../config/config'
import { FOLLOW_MODEL, type Follow } from '../interactions/interaction.schemas'
import { JOBS, type JobsPort } from '../jobs/jobs.port'
import { StorageService } from '../storage/storage.service'
import { FILE_MODEL, type FileDoc } from '../uploads/file.schema'
import { UploadsService } from '../uploads/uploads.service'
import { effectiveLinks, MIGRATED_LEGACY, toStoredLinks } from './social-links'
import { USER_MODEL, type User } from './user.schema'

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
  /** Public URL of the avatar's `thumb_md`; null until the worker has published it (see publicAvatarUrl). */
  avatarUrl: string | null
  bannerUrl: string | null
  profile: {
    username: string
    displayName: string
    bio: string
    avatarFileId: string | null
    bannerFileId: string | null
    /** In display order (legacy fixed links converted, see effectiveLinks). */
    links: SocialLink[]
  }
}

export interface PublicUserDto {
  id: string
  username: string
  displayName: string
  bio: string
  avatarUrl: string | null
  bannerUrl: string | null
  links: SocialLink[]
  stats: User['stats']
  createdAt: string
  isFollowing: boolean
}

/** A user as listed in followers/following: the public profile without counters. */
export type PublicUserItemDto = Omit<PublicUserDto, 'stats'>

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
    @InjectModel(FILE_MODEL) private readonly files: Model<FileDoc>,
    @InjectModel(FOLLOW_MODEL) private readonly follows: Model<Follow>,
    private readonly uploads: UploadsService,
    private readonly storage: StorageService,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(JOBS) private readonly jobs: JobsPort,
    private readonly feedCache: FeedCache,
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
    const crops = { avatarFileId: 'avatarCrop', bannerFileId: 'bannerCrop' } as const
    const touchesImages = (['avatarFileId', 'bannerFileId'] as const).some((k) => input[k] !== undefined || input[crops[k]] !== undefined)
    const current = touchesImages ? (await this.getUser(id)).profile : null
    if (current && (input.avatarFileId !== undefined || input.bannerFileId !== undefined)) {
      // One file cannot be both: each role has its own crop (avatar 1:1, banner 4:1) under the same variant keys.
      const avatar = input.avatarFileId ?? current.avatarFileId?.toString()
      const banner = input.bannerFileId ?? current.bannerFileId?.toString()
      if (avatar && avatar === banner) throw new AppError('VALIDATION_FAILED', 400, 'avatarFileId and bannerFileId must be different files')
    }
    /** Profile files whose render changes (new file or new crop): relocate-file re-renders them. */
    const rerender = new Set<string>()
    for (const key of ['avatarFileId', 'bannerFileId'] as const) {
      const v = input[key]
      const crop = input[crops[key]]
      if (v === undefined) {
        if (crop === undefined) continue
        // A crop alone applies to the current image.
        const fileId = current?.[key]
        if (!fileId) throw new AppError('VALIDATION_FAILED', 400, `${crops[key]} needs a ${key}`)
        $set[`profile.${crops[key]}`] = crop
        rerender.add(fileId.toString())
        continue
      }
      const oid = objectId(v)
      if (!oid) throw new AppError('VALIDATION_FAILED', 400, `Invalid ${key}`)
      const [file] = await this.uploads.assertUsableFiles(id, [v])
      if (file!.kind !== 'image') throw new AppError('FILE_NOT_READY', 400, `${key} must be an image`)
      // Profile images and post files are exclusive: publishing a post file as an avatar could leak a clean render.
      if (await this.users.db.collection('posts').findOne({ 'files.fileId': oid }, { projection: { _id: 1 } })) {
        throw new AppError('FILE_NOT_READY', 400, `${key} is attached to a post`)
      }
      $set[`profile.${key}`] = oid
      // A file without a crop is centre-cropped, also when it replaces one that had a crop.
      $set[`profile.${crops[key]}`] = crop ?? null
      rerender.add(v)
    }
    // The list is replaced whole; moving the legacy fields aside marks the profile migrated (see effectiveLinks).
    if (input.links !== undefined) $set['profile.links'] = toStoredLinks(input.links)
    if (Object.keys($set).length) await this.users.updateOne({ _id: id }, { $set, ...(input.links !== undefined ? { $rename: MIGRATED_LEGACY } : {}) })
    // Post cards show the author's name and avatar (a new avatar appears once relocate-file publishes it, which bumps again).
    if (input.displayName !== undefined || input.avatarFileId !== undefined) await this.feedCache.bump()
    // Variants of a file in no post stay private; a new profile image must be published to the public bucket, and a
    // new crop re-rendered. Either way the render time (variantsAt, the URL's `?v=`) changes once it is done.
    for (const fileId of rerender) await this.jobs.enqueue('relocate-file', { fileId })
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

  async getPublic(username: string, viewer: Viewer | null = null): Promise<PublicUserDto> {
    const user = await this.users.findOne({ 'profile.username': username }).lean()
    if (!user || user.status === 'banned') throw new AppError('NOT_FOUND', 404, 'User not found')
    const [item] = await this.toPublicItems([user], viewer)
    return { ...item!, stats: user.stats }
  }

  /** Public profiles without stats; `isFollowing` for all of them comes from one query. */
  async toPublicItems(users: User[], viewer: Viewer | null): Promise<PublicUserItemDto[]> {
    const following = new Set<string>()
    if (viewer && users.length) {
      const rows = await this.follows
        .find({ followerId: new Types.ObjectId(viewer.id), followeeId: { $in: users.map((u) => u._id) } }, { followeeId: 1 })
        .lean()
      for (const r of rows) following.add(r.followeeId.toString())
    }
    return Promise.all(
      users.map(async (user) => {
        const p = user.profile
        return {
          id: user._id.toString(),
          username: p.username,
          displayName: p.displayName,
          bio: p.bio,
          avatarUrl: p.avatarFileId ? await this.publicAvatarUrl(p.avatarFileId.toString()) : null,
          bannerUrl: p.bannerFileId ? await this.publicAvatarUrl(p.bannerFileId.toString()) : null,
          links: effectiveLinks(p),
          createdAt: user.createdAt.toISOString(),
          isFollowing: following.has(user._id.toString()),
        }
      }),
    )
  }

  /**
   * Public URL of the file's `thumb_md` variant; null when the file or variant does not exist, or the variant is
   * not in the public bucket (e.g. a file of an r18 post), where a public URL would not resolve. A re-render (e.g. the
   * profile crop) reuses the object key, so `?v=` carries the render time and browsers fetch the new image.
   */
  async publicAvatarUrl(fileId: string): Promise<string | null> {
    const oid = objectId(fileId)
    if (!oid) return null
    const file = await this.files.findById(oid).lean()
    const variant = file?.variants.find((v) => v.name === 'thumb_md')
    if (!variant || variant.bucket !== this.config.minio.bucketPublic) return null
    const url = this.storage.publicUrl(variant.objectKey)
    return file?.variantsAt ? `${url}?v=${file.variantsAt.getTime()}` : url
  }

  async toMe(user: User): Promise<MeDto> {
    const p = user.profile
    const [avatarUrl, bannerUrl] = await Promise.all([
      p.avatarFileId ? this.publicAvatarUrl(p.avatarFileId.toString()) : null,
      p.bannerFileId ? this.publicAvatarUrl(p.bannerFileId.toString()) : null,
    ])
    return {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerifiedAt != null,
      locale: user.locale,
      showR18: user.showR18,
      birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : null,
      avatarUrl,
      bannerUrl,
      profile: {
        username: p.username,
        displayName: p.displayName,
        bio: p.bio,
        avatarFileId: p.avatarFileId?.toString() ?? null,
        bannerFileId: p.bannerFileId?.toString() ?? null,
        links: effectiveLinks(p),
      },
    }
  }
}

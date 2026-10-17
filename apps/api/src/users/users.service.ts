import { Injectable } from '@nestjs/common'
import type { Locale, Role, UserStatus } from '@cuka/shared'
import type { SocialLinks, User } from './user.schema'

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

@Injectable()
export class UsersService {
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

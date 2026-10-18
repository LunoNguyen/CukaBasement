/**
 * Response shapes copied from apps/api (field names kept exactly). Not imported:
 * the API package pulls in server-only dependencies.
 */
import type {
  Credit,
  FileKind,
  FileStatus,
  Locale,
  ModAction,
  NotificationType,
  PostType,
  Rating,
  ReportReason,
  ReviewStatus,
  Role,
  SocialLink,
  UserStatus,
  Visibility,
} from '@cuka/shared'

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface UserStats {
  followerCount: number
  followingCount: number
  postCount: number
}

export interface PostCounts {
  likes: number
  bookmarks: number
  comments: number
  views: number
}

// apps/api/src/users/users.service.ts
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
  /** Public URL of the avatar's display render; null until the worker has published it. */
  avatarUrl: string | null
  bannerUrl: string | null
  profile: {
    username: string
    displayName: string
    bio: string
    avatarFileId: string | null
    bannerFileId: string | null
    /** In display order. */
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
  stats: UserStats
  createdAt: string
  isFollowing: boolean
}

/** A user as listed in followers/following: the public profile without counters. */
export type PublicUserItemDto = Omit<PublicUserDto, 'stats'>

// apps/api/src/posts/posts.service.ts, file-urls.ts
export interface AuthorDto {
  id: string
  username: string
  displayName: string
  avatarUrl: string | null
}

export interface PostMediaDto {
  fileId: string
  kind: FileKind
  position: number
  isCover: boolean
  status: FileStatus
  width?: number
  height?: number
  durationSec?: number
  thumbSmUrl: string | null
  thumbMdUrl: string | null
  previewUrl: string | null
  blurred: boolean
}

export interface PostDto {
  id: string
  type: PostType
  title: string
  description: string
  rating: Rating
  tags: string[]
  credit: Credit
  review: { status: ReviewStatus; reason?: string }
  visibility: Visibility
  counts: PostCounts
  author: AuthorDto
  media: PostMediaDto[]
  viewerState: { liked: boolean; bookmarked: boolean }
  createdAt: string
  updatedAt: string
}

export interface PostCardDto {
  id: string
  type: PostType
  title: string
  rating: Rating
  cover: PostMediaDto | null
  pageCount: number
  counts: PostCounts
  author: AuthorDto
  credit: Credit
  createdAt: string
}

// apps/api/src/uploads/uploads.service.ts
export interface FileDto {
  id: string
  kind: FileKind
  mimeType: string
  sizeBytes: number
  status: FileStatus | 'validating'
  originalName: string
}

/** `POST /api/uploads` response: a presigned POST to the object store. */
export interface PresignDto {
  fileId: string
  url: string
  fields: Record<string, string>
  maxBytes: number
}

// apps/api/src/comments/comments.service.ts
export type CommentStatus = 'visible' | 'hidden'

export interface CommentDto {
  id: string
  body: string
  author: AuthorDto
  parentId: string | null
  status: CommentStatus
  createdAt: string
  replies?: CommentDto[]
}

// apps/api/src/notifications/notifications.service.ts
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

// apps/api/src/moderation/moderation.service.ts
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

// apps/api/src/admin/admin.service.ts
export interface AdminUserDto {
  id: string
  email: string
  username: string
  displayName: string
  role: Role
  status: UserStatus
  emailVerified: boolean
  createdAt: string
  lastLoginAt: string | null
  stats: UserStats
}

export interface AdminLogDto {
  id: string
  actor: { username: string } | 'system'
  action: ModAction
  targetType: string
  targetId: string
  note: string
  createdAt: string
}

/** `POST /api/auth/login` and `/api/auth/refresh` response. */
export interface SessionDto {
  accessToken: string
  user: MeDto
}

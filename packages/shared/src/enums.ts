export const ROLES = ['user', 'moderator', 'admin'] as const
export type Role = (typeof ROLES)[number]

export const USER_STATUSES = ['active', 'suspended', 'banned'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export const POST_TYPES = ['illustration', 'manga', 'video', 'audio', 'other'] as const
export type PostType = (typeof POST_TYPES)[number]

export const RATINGS = ['all', 'r18'] as const
export type Rating = (typeof RATINGS)[number]

export const VISIBILITIES = ['public', 'hidden_by_reports', 'removed'] as const
export type Visibility = (typeof VISIBILITIES)[number]

export const REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const FILE_KINDS = ['image', 'video', 'audio', 'source', 'archive'] as const
export type FileKind = (typeof FILE_KINDS)[number]

export const FILE_STATUSES = ['uploading', 'processing', 'ready', 'failed'] as const
export type FileStatus = (typeof FILE_STATUSES)[number]

export const VARIANT_NAMES = ['thumb_sm', 'thumb_md', 'preview', 'blurred'] as const
export type VariantName = (typeof VARIANT_NAMES)[number]

export const REPORT_REASONS = ['ai_art', 'stolen_art', 'unmarked_r18', 'spam', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export const REPORT_STATUSES = ['open', 'dismissed', 'actioned'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const NOTIFICATION_TYPES = [
  'post_approved',
  'post_rejected',
  'post_hidden',
  'like',
  'comment',
  'reply',
  'follow',
  /** Staff only: a new post waits in the review queue. */
  'post_pending_review',
  /** Staff only: an edited post went back to pending and needs review again. */
  'post_resubmitted',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const MOD_ACTIONS = [
  'approve',
  'reject',
  'hide',
  'restore',
  'remove',
  'suspend',
  'ban',
  'unban',
  'change_role',
  'hide_comment',
  'delete_comment',
  'update_setting',
  'auto_hide',
  'update_credit',
] as const
export type ModAction = (typeof MOD_ACTIONS)[number]

export const LOCALES = ['vi', 'en'] as const
export type Locale = (typeof LOCALES)[number]

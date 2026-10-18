import { SOCIAL_PLATFORM_LABELS } from './social'

/** Values are only ever added (stored credits keep validating); `other` stays last for the select. */
export const CREDIT_PLATFORMS = [
  'x',
  'facebook',
  'pixiv',
  'deviantart',
  'instagram',
  'youtube',
  'tiktok',
  'threads',
  'vgen',
  'bluesky',
  'twitch',
  'kofi',
  'other',
] as const
export type CreditPlatform = (typeof CREDIT_PLATFORMS)[number]

/** Display names for the watermark and OG text; `other` has no label. */
export const PLATFORM_LABELS: Record<CreditPlatform, string> = Object.fromEntries(
  CREDIT_PLATFORMS.map((p) => [p, SOCIAL_PLATFORM_LABELS[p]]),
) as Record<CreditPlatform, string>

export interface CreditInfo {
  isOwnWork: boolean
  artistName: string
  artistHandle: string
  platform: CreditPlatform
}

/** `@handle` (a leading `@` in the stored handle is not doubled); falls back to the artist's name. */
export function artistTag(credit: Pick<CreditInfo, 'artistName' | 'artistHandle'>): string {
  const handle = credit.artistHandle.trim().replace(/^@+/, '')
  return handle ? `@${handle}` : credit.artistName.trim()
}

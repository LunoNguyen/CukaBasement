/** Platforms a profile link can point at, in the order the settings select lists them; `other` takes a label. */
export const SOCIAL_PLATFORMS = [
  'x',
  'facebook',
  'youtube',
  'pixiv',
  'tiktok',
  'threads',
  'vgen',
  'instagram',
  'bluesky',
  'twitch',
  'kofi',
  'deviantart',
  'other',
] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

/** Display names shared by profile links and credits; `other` has none (the link's own label is shown). */
export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  x: 'X',
  facebook: 'Facebook',
  youtube: 'YouTube',
  pixiv: 'pixiv',
  tiktok: 'TikTok',
  threads: 'Threads',
  vgen: 'VGen',
  instagram: 'Instagram',
  bluesky: 'Bluesky',
  twitch: 'Twitch',
  kofi: 'Ko-fi',
  deviantart: 'DeviantArt',
  other: '',
}

/** One profile link; `label` is set only for `other`. */
export interface SocialLink {
  platform: SocialPlatform
  url: string
  label?: string
}

/** The fixed fields profiles had before the link list, in their old display order. */
export const LEGACY_SOCIAL_KEYS = ['x', 'facebook', 'youtube', 'pixiv'] as const
export type LegacySocialLinks = Partial<Record<(typeof LEGACY_SOCIAL_KEYS)[number], string | null>>

/** Converts the old fixed fields to the link list, keeping their order and skipping empty or non-http(s) values. */
export function legacySocialLinks(old: LegacySocialLinks | null | undefined): SocialLink[] {
  if (!old) return []
  const out: SocialLink[] = []
  for (const platform of LEGACY_SOCIAL_KEYS) {
    const url = (old[platform] ?? '').trim()
    if (/^https?:\/\//i.test(url)) out.push({ platform, url })
  }
  return out
}

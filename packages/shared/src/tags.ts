import { LIMITS } from './limits'

/** Normalized tags that may only be used on `r18` posts (spec §9: `#ameoDuCa`). */
export const R18_REQUIRED_TAGS: readonly string[] = ['ameoduca']

export function normalizeTag(raw: string): string | null {
  const tag = raw
    .replace(/^#+/, '')
    .trim()
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, '_')
  if (tag.length === 0 || tag.length > LIMITS.tagMax) return null
  return tag
}

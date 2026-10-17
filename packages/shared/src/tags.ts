import { LIMITS } from './limits'

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

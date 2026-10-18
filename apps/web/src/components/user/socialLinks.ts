import { LIMITS, type SocialLink, type SocialPlatform } from '@cuka/shared'

/** One editable row of the profile links list; `id` keys the row across reorders. */
export interface LinkRow {
  id: number
  platform: SocialPlatform
  label: string
  url: string
}

/** i18n keys of a row's problems (mirrors `socialLinkSchema` in @cuka/shared). */
export interface LinkErrors {
  url?: 'settings.linkInvalid' | 'settings.linkTooLong'
  label?: 'settings.linkLabelRequired'
}

let nextId = 0

export function toRows(links: SocialLink[]): LinkRow[] {
  return links.map((l) => ({ id: nextId++, platform: l.platform, label: l.label ?? '', url: l.url }))
}

export function newRow(): LinkRow {
  return { id: nextId++, platform: 'x', label: '', url: '' }
}

/** A row the user added but left empty: not an error, dropped on save. */
export function isBlank(row: LinkRow): boolean {
  // The label is only shown (and kept) for `other`; a stale one left from switching platforms does not count.
  return !row.url.trim() && (row.platform !== 'other' || !row.label.trim())
}

function isHttpUrl(v: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol)
  } catch {
    return false
  }
}

export function rowErrors(row: LinkRow): LinkErrors {
  if (isBlank(row)) return {}
  const url = row.url.trim()
  const out: LinkErrors = {}
  if (!isHttpUrl(url)) out.url = 'settings.linkInvalid'
  else if (url.length > LIMITS.socialLinkUrlMax) out.url = 'settings.linkTooLong'
  if (row.platform === 'other' && !row.label.trim()) out.label = 'settings.linkLabelRequired'
  return out
}

/** The list to save: blank rows dropped, values trimmed, a label only for `other`. */
export function toLinks(rows: LinkRow[]): SocialLink[] {
  return rows
    .filter((r) => !isBlank(r))
    .map((r) => (r.platform === 'other' ? { platform: r.platform, label: r.label.trim(), url: r.url.trim() } : { platform: r.platform, url: r.url.trim() }))
}

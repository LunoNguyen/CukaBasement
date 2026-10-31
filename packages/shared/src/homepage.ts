/** Helpers for the homepage CMS shared by the API (validation) and the web (rendering). Pure functions only. */

/** WHATWG URL, available in Node and browsers (this package compiles without the DOM or Node typings). */
declare const URL: new (url: string) => { protocol: string; hostname: string; pathname: string; searchParams: { get(name: string): string | null } }

/**
 * Sections of the old full-screen landing page: background video, new releases, music videos, spotlight, brand
 * statement, footer. The first four are now blocks of the Introduction page; `vibe` and `footer` only parse old data.
 */
export const LANDING_SECTION_TYPES = ['heroVideo', 'releases', 'music', 'spotlight', 'vibe', 'footer'] as const
/** Long-form sections (the Introduction page "/gioi-thieu" and the first homepage). */
export const LONGFORM_SECTION_TYPES = ['hero', 'about', 'profile', 'timeline', 'gallery', 'videos', 'links', 'fanart', 'banner'] as const

/** Section types of the site pages, in the order the admin "add section" menu lists them. */
export const HOME_SECTION_TYPES = [...LANDING_SECTION_TYPES, ...LONGFORM_SECTION_TYPES] as const
export type HomeSectionType = (typeof HOME_SECTION_TYPES)[number]

/** The CMS pages: `intro` is the Introduction page at "/gioi-thieu"; `home` the old landing page, kept read-only. */
export const SITE_PAGES = ['home', 'intro'] as const
export type SitePage = (typeof SITE_PAGES)[number]


/** Pages admins can still edit: "/" is now the fanart gallery, so the old landing page (`home`) is read-only. */
export const EDITABLE_SITE_PAGES = ['intro'] as const satisfies readonly SitePage[]
export type EditableSitePage = (typeof EDITABLE_SITE_PAGES)[number]

/**
 * The section types the editor offers to add, per editable page: the former landing sections that became blocks
 * of the Introduction page first, then the long-form ones. `vibe` and `footer` only render on old data.
 */
export const ADDABLE_SECTION_TYPES: Record<EditableSitePage, readonly HomeSectionType[]> = {
  intro: ['heroVideo', 'music', 'releases', 'spotlight', ...LONGFORM_SECTION_TYPES],
}

export const RELEASE_SOURCES = ['manual', 'latestFanart'] as const
export type ReleaseSource = (typeof RELEASE_SOURCES)[number]

/** The tabs of the music section: newest MV, most popular MVs, channel videos. */
export const MUSIC_GROUPS = ['newest', 'popular', 'channel'] as const
export type MusicGroup = (typeof MUSIC_GROUPS)[number]

/** Hibiki Du Ca's YouTube channel, the music section's default source of channel videos. */
export const DU_CA_CHANNEL_ID = 'UC5RSxmHP5c4pU9Og1Pxx4wg'

/**
 * Where the server keeps the videos it found for an automatic music tab: `channel:<id>` (the channel's feed),
 * `popular:<id>`, `newest:<id>:<keyword in lower case>`. The admin status lists feeds under these keys.
 */
export function musicFeedKey(group: MusicGroup, channelId: string, keyword = ''): string {
  return group === 'newest' ? `newest:${channelId}:${keyword.trim().toLocaleLowerCase()}` : `${group}:${channelId}`
}

export const GALLERY_LAYOUTS = ['grid', 'masonry', 'carousel'] as const
export type GalleryLayout = (typeof GALLERY_LAYOUTS)[number]

export const HOME_LIMITS = {
  sectionsMax: 30,
  sectionIdMax: 40,
  eyebrowMax: 60,
  headingMax: 140,
  subtitleMax: 400,
  bodyMax: 4000,
  shortTextMax: 600,
  labelMax: 60,
  factValueMax: 240,
  altMax: 250,
  urlMax: 500,
  dateMax: 40,
  heroImagesMax: 8,
  ctasMax: 2,
  factsMax: 20,
  timelineMax: 40,
  galleryMax: 60,
  videosMax: 12,
  linksMax: 16,
  fanartMin: 3,
  fanartMax: 24,
  /** A visible hand-picked "New release" row shows 3–8 covers. */
  releasesMin: 3,
  releasesMax: 8,
  spotlightMax: 8,
  spotlightIntervalMin: 3,
  spotlightIntervalMax: 15,
  emailMax: 120,
  /** Videos per music tab (hand-picked, and shown in all). */
  musicItemsMax: 12,
  musicKeywordMax: 40,
  musicViewsMax: 1e13,
} as const

/** Text in both UI languages; `en` may be empty, then the Vietnamese text is shown. */
export interface LocalizedText {
  vi: string
  en: string
}

/** The text for `locale`: English when asked for and present, else Vietnamese. */
export function pickText(t: LocalizedText | null | undefined, locale: string): string {
  if (!t) return ''
  return locale === 'en' && t.en.trim() ? t.en : t.vi
}

/**
 * A link target the homepage may point at: an http(s) URL, or a site path that starts with a single `/`
 * (no `//host`, no backslash, no whitespace or control characters). Anything else (javascript:, data:, mailto:…) is refused.
 */
export function isSafeHref(href: string): boolean {
  if (typeof href !== 'string' || !href || href.length > 500) return false
  if (/[\s\u0000-\u001f\u007f\\]/.test(href)) return false
  if (href.startsWith('/')) return !href.startsWith('//')
  try {
    const u = new URL(href)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname
  } catch {
    return false
  }
}

/** Whether `href` leaves the site (opened in a new tab by the web). */
export function isExternalHref(href: string): boolean {
  return !href.startsWith('/')
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const YT_CHANNEL = /^UC[A-Za-z0-9_-]{22}$/

/** Whether `id` is a well-formed YouTube video id (11 characters of [A-Za-z0-9_-]). */
export function isYouTubeVideoId(id: unknown): id is string {
  return typeof id === 'string' && YT_ID.test(id)
}

/** Whether `id` is a well-formed YouTube channel id (`UC` + 22 characters of [A-Za-z0-9_-]). */
export function isYouTubeChannelId(id: unknown): id is string {
  return typeof id === 'string' && YT_CHANNEL.test(id)
}
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])

/**
 * The 11-character video id of a YouTube link: youtube.com/watch?v=…, youtu.be/…, /shorts/…, /embed/…, /live/…;
 * null for anything else (channels, playlists, other sites, non-http(s) URLs).
 */
export function parseYouTubeId(url: string): string | null {
  let u: InstanceType<typeof URL>
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  let id: string | null = null
  if (host === 'youtu.be' || host === 'www.youtu.be') id = u.pathname.split('/')[1] ?? null
  else if (YT_HOSTS.has(host)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else {
      const m = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname)
      id = m ? m[1]! : null
    }
  }
  return id && YT_ID.test(id) ? id : null
}

// ---------------------------------------------------------------------------------------------------------------
// Limited Markdown: paragraphs (blank line), line breaks, **bold**, *italic* / _italic_, [text](href).
// Parsed into a tree the web renders with createElement (never v-html); a link with an unsafe href is plain text.
// ---------------------------------------------------------------------------------------------------------------

export type MdInline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'strong'; c: MdInline[] }
  | { t: 'em'; c: MdInline[] }
  | { t: 'link'; href: string; c: MdInline[] }

export type MdBlock = { t: 'p'; c: MdInline[] }

const LINK_RE = /^\[([^\]\n]{1,300})\]\(([^()\s]{1,500})\)/

function pushText(out: MdInline[], v: string): void {
  if (!v) return
  const last = out[out.length - 1]
  if (last && last.t === 'text') last.v += v
  else out.push({ t: 'text', v })
}

function parseInline(src: string, depth = 0): MdInline[] {
  const out: MdInline[] = []
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    if (rest[0] === '\n') {
      out.push({ t: 'br' })
      i++
      continue
    }
    if (depth < 4 && rest.startsWith('**')) {
      const end = src.indexOf('**', i + 2)
      if (end > i + 2) {
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end), depth + 1) })
        i = end + 2
        continue
      }
    }
    if (depth < 4 && (rest[0] === '*' || rest[0] === '_') && rest[1] && rest[1] !== ' ' && rest[1] !== rest[0]) {
      const end = src.indexOf(rest[0], i + 1)
      if (end > i + 1 && src[end - 1] !== ' ') {
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, end), depth + 1) })
        i = end + 1
        continue
      }
    }
    if (rest[0] === '[') {
      const m = LINK_RE.exec(rest)
      if (m) {
        const children = parseInline(m[1]!, depth + 1)
        if (depth < 4 && isSafeHref(m[2]!)) out.push({ t: 'link', href: m[2]!, c: children })
        else for (const c of children) c.t === 'text' ? pushText(out, c.v) : out.push(c)
        i += m[0].length
        continue
      }
    }
    pushText(out, rest[0]!)
    i++
  }
  return out
}

/** Parses the limited Markdown above. Unknown syntax stays literal text; nothing is ever interpreted as HTML. */
export function parseMarkdown(src: string): MdBlock[] {
  return src
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ t: 'p' as const, c: parseInline(p) }))
}

/** Every link-looking target (`](target`) in `src` that is not a safe href (see isSafeHref); such links render as text. */
export function unsafeMarkdownLinks(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/\]\(\s*([^)\s]*)/g)) if (!isSafeHref(m[1]!)) out.push(m[1]!)
  return out
}

/** Plain text of parsed Markdown (for meta descriptions and alt fallbacks). */
export function markdownToText(src: string): string {
  const walk = (n: MdInline[]): string => n.map((x) => (x.t === 'text' ? x.v : x.t === 'br' ? ' ' : walk(x.c))).join('')
  return parseMarkdown(src)
    .map((b) => walk(b.c))
    .join(' ')
}

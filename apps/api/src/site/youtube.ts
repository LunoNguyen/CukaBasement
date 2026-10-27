import { isYouTubeChannelId, isYouTubeVideoId } from '@cuka/shared'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

/**
 * Talking to YouTube from the worker, never on a visitor's request: the channel's public RSS feed, oEmbed titles,
 * thumbnails and (with an API key) the Data API. Every request goes to a fixed https host built from a validated id,
 * follows no redirect, has a timeout and a size cap, so nothing here can be steered at another server.
 */

/** `fetch`, injectable so tests answer for YouTube (this server cannot always reach it). */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** The only hosts ever contacted. */
export const YOUTUBE_HOSTS: ReadonlySet<string> = new Set(['www.youtube.com', 'i.ytimg.com', 'www.googleapis.com'])

export const YT_TIMEOUT_MS = 8000
export const YT_MAX_BYTES = {
  feed: 1024 * 1024,
  oembed: 64 * 1024,
  api: 2 * 1024 * 1024,
  thumb: 2 * 1024 * 1024,
} as const

/** Longest title kept from YouTube. */
export const YT_TITLE_MAX = 200
/** Entries read from one feed (YouTube's has 15). */
export const FEED_ENTRIES_MAX = 50

export class YouTubeError extends Error {}

/**
 * GETs `url`: https on an allow-listed host only, no redirects, aborted after `timeoutMs`, refused once the body
 * passes `maxBytes`. Error messages never contain the URL (it may carry the API key).
 */
export async function fetchCapped(fetcher: Fetcher, url: string, maxBytes: number, timeoutMs = YT_TIMEOUT_MS): Promise<{ body: Buffer; contentType: string }> {
  const u = new URL(url)
  if (u.protocol !== 'https:' || !YOUTUBE_HOSTS.has(u.hostname) || u.port || u.username || u.password) throw new YouTubeError(`refused to fetch from ${u.hostname}`)
  let res: Response
  try {
    res = await fetcher(u.toString(), { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { accept: '*/*' } })
  } catch (e) {
    throw new YouTubeError(`${u.hostname}: ${(e as Error).name === 'TimeoutError' ? 'timed out' : 'request failed'}`)
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    throw new YouTubeError(`${u.hostname}: HTTP ${res.status}`)
  }
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {})
    throw new YouTubeError(`${u.hostname}: response too large`)
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    const reader = res.body?.getReader()
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) {
          await reader.cancel().catch(() => {})
          throw new YouTubeError(`${u.hostname}: response too large`)
        }
        chunks.push(value)
      }
    }
  } catch (e) {
    if (e instanceof YouTubeError) throw e
    throw new YouTubeError(`${u.hostname}: ${(e as Error).name === 'TimeoutError' ? 'timed out' : 'read failed'}`)
  }
  return { body: Buffer.concat(chunks), contentType: res.headers.get('content-type') ?? '' }
}

/** What the server learns about a video from YouTube. */
export interface FetchedVideo {
  id: string
  title: string | null
  publishedAt: Date | null
  views: number | null
}

/** A title from YouTube: control characters dropped, whitespace collapsed, at most YT_TITLE_MAX characters; null if empty. */
export function cleanTitle(v: unknown): string | null {
  if (typeof v !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, YT_TITLE_MAX) : null
}

function cleanDate(v: unknown): Date | null {
  if (typeof v !== 'string' || v.length > 40) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function cleanViews(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : v
  return typeof s === 'string' && /^\d{1,15}$/.test(s) ? Number(s) : null
}

const textOf = (v: unknown): unknown => (v && typeof v === 'object' && '#text' in v ? (v as { '#text': unknown })['#text'] : v)

/** Numeric character references (`&#8211;`, `&#x2013;`) the parser leaves as they are. */
function decodeNumericRefs(v: unknown): unknown {
  if (typeof v !== 'string') return v
  return v.replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/gi, (m, hex: string | undefined, dec: string | undefined) => {
    const cp = hex ? Number.parseInt(hex, 16) : Number(dec)
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m
  })
}

/**
 * The videos of a channel's Atom feed (youtube.com/feeds/videos.xml?channel_id=…), newest first: id, title, date
 * and the view count from media:statistics. Strict: a body that is too big, has a DOCTYPE or entity declarations,
 * is not well-formed or is not an Atom feed throws; entries with a bad id (or of another channel) are skipped.
 */
export function parseChannelFeed(xml: string, channelId: string): FetchedVideo[] {
  if (xml.length > YT_MAX_BYTES.feed) throw new YouTubeError('feed too large')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new YouTubeError('feed declares a DOCTYPE')
  if (XMLValidator.validate(xml) !== true) throw new YouTubeError('feed is not well-formed XML')
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: true,
    htmlEntities: false,
    isArray: (name) => name === 'entry',
  })
  const doc = parser.parse(xml) as { feed?: { entry?: unknown[] } }
  if (!doc || typeof doc !== 'object' || !doc.feed || typeof doc.feed !== 'object') throw new YouTubeError('not an Atom feed')
  const entries = Array.isArray(doc.feed.entry) ? doc.feed.entry.slice(0, FEED_ENTRIES_MAX) : []
  const out: FetchedVideo[] = []
  const seen = new Set<string>()
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    const id = textOf(e['yt:videoId'])
    if (!isYouTubeVideoId(id) || seen.has(id)) continue
    const owner = textOf(e['yt:channelId'])
    // Entries name their channel with or without the "UC" prefix; another channel's entry is skipped.
    if (owner !== undefined && owner !== channelId && owner !== channelId.slice(2)) continue
    const group = e['media:group'] as Record<string, unknown> | undefined
    const community = group && typeof group === 'object' ? (group['media:community'] as Record<string, unknown> | undefined) : undefined
    const stats = community && typeof community === 'object' ? (community['media:statistics'] as Record<string, unknown> | undefined) : undefined
    seen.add(id)
    out.push({
      id,
      title: cleanTitle(decodeNumericRefs(textOf(e.title))),
      publishedAt: cleanDate(textOf(e.published)),
      views: stats && typeof stats === 'object' ? cleanViews(stats['@_views']) : null,
    })
  }
  return out
}

/** Reads a channel's public feed (no API key). */
export async function fetchChannelFeed(fetcher: Fetcher, channelId: string): Promise<FetchedVideo[]> {
  if (!isYouTubeChannelId(channelId)) throw new YouTubeError('invalid channel id')
  const { body } = await fetchCapped(fetcher, `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, YT_MAX_BYTES.feed)
  return parseChannelFeed(body.toString('utf8'), channelId)
}

/** A video's title from YouTube oEmbed (no API key), or null when YouTube has none. */
export async function fetchOEmbedTitle(fetcher: Fetcher, id: string): Promise<string | null> {
  if (!isYouTubeVideoId(id)) throw new YouTubeError('invalid video id')
  const watch = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)
  const { body } = await fetchCapped(fetcher, `https://www.youtube.com/oembed?url=${watch}&format=json`, YT_MAX_BYTES.oembed)
  let json: unknown
  try {
    json = JSON.parse(body.toString('utf8'))
  } catch {
    throw new YouTubeError('oEmbed answer is not JSON')
  }
  return json && typeof json === 'object' ? cleanTitle((json as { title?: unknown }).title) : null
}

/** The thumbnail image of a video: the 1280×720 render when YouTube has one, else the 480×360 one. */
export async function fetchThumbnail(fetcher: Fetcher, id: string): Promise<Buffer> {
  if (!isYouTubeVideoId(id)) throw new YouTubeError('invalid video id')
  let last: unknown
  for (const name of ['maxresdefault', 'hqdefault']) {
    try {
      const { body, contentType } = await fetchCapped(fetcher, `https://i.ytimg.com/vi/${id}/${name}.jpg`, YT_MAX_BYTES.thumb)
      if (!/^image\//i.test(contentType)) throw new YouTubeError('i.ytimg.com: not an image')
      if (!body.length) throw new YouTubeError('i.ytimg.com: empty image')
      return body
    } catch (e) {
      last = e
    }
  }
  throw last instanceof Error ? last : new YouTubeError('no thumbnail')
}

// --- YouTube Data API v3 (only with YOUTUBE_API_KEY) ----------------------------------------------------------------

/** Uploads scanned for the automatic tabs (4 pages of 50). */
export const API_UPLOADS_MAX = 200

async function apiGet(fetcher: Fetcher, key: string, path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const q = new URLSearchParams({ ...params, key })
  const { body } = await fetchCapped(fetcher, `https://www.googleapis.com/youtube/v3/${path}?${q.toString()}`, YT_MAX_BYTES.api)
  try {
    const json = JSON.parse(body.toString('utf8')) as unknown
    if (json && typeof json === 'object') return json as Record<string, unknown>
  } catch {
    /* fall through */
  }
  throw new YouTubeError(`YouTube API ${path}: answer is not JSON`)
}

/**
 * The channel's latest uploads with title, date and view count (YouTube Data API: playlistItems of the uploads
 * playlist, then videos.list with statistics), newest first.
 */
export async function fetchChannelUploads(fetcher: Fetcher, key: string, channelId: string): Promise<FetchedVideo[]> {
  if (!isYouTubeChannelId(channelId)) throw new YouTubeError('invalid channel id')
  const playlistId = `UU${channelId.slice(2)}`
  const ids: string[] = []
  let pageToken = ''
  while (ids.length < API_UPLOADS_MAX) {
    const page = await apiGet(fetcher, key, 'playlistItems', { part: 'contentDetails', playlistId, maxResults: '50', ...(pageToken ? { pageToken } : {}) })
    const items = Array.isArray(page.items) ? page.items : []
    for (const it of items) {
      const id = (it as { contentDetails?: { videoId?: unknown } })?.contentDetails?.videoId
      if (isYouTubeVideoId(id) && !ids.includes(id)) ids.push(id)
    }
    const next = page.nextPageToken
    if (typeof next !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(next) || !items.length) break
    pageToken = next
  }
  const out: FetchedVideo[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const page = await apiGet(fetcher, key, 'videos', { part: 'snippet,statistics', id: ids.slice(i, i + 50).join(','), maxResults: '50' })
    for (const it of Array.isArray(page.items) ? page.items : []) {
      const v = it as { id?: unknown; snippet?: { title?: unknown; publishedAt?: unknown }; statistics?: { viewCount?: unknown } }
      if (!isYouTubeVideoId(v?.id)) continue
      out.push({ id: v.id, title: cleanTitle(v.snippet?.title), publishedAt: cleanDate(v.snippet?.publishedAt), views: cleanViews(v.statistics?.viewCount) })
    }
  }
  return out.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
}

/** The `max` most watched of `videos`. */
export function mostPopular(videos: FetchedVideo[], max: number): FetchedVideo[] {
  return [...videos].sort((a, b) => (b.views ?? -1) - (a.views ?? -1)).slice(0, max)
}

/** The `max` newest of `videos` whose title contains `keyword` (any case; every video when it is empty). */
export function newestMatching(videos: FetchedVideo[], keyword: string, max: number): FetchedVideo[] {
  const k = keyword.trim().toLocaleLowerCase()
  return videos
    .filter((v) => !k || (v.title ?? '').toLocaleLowerCase().includes(k))
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, max)
}

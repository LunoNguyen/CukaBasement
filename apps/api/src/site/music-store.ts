import { HOME_LIMITS, type HomeSection, homeSectionSchema, type MusicData, type MusicGroup, musicFeedKey, parseYouTubeId } from '@cuka/shared'
import type { Connection } from 'mongoose'

// Kept free of Nest services: the worker's youtube-sync job imports it.

/** What the server knows about one YouTube video (`_id`: the video id), filled by the youtube-sync job. */
export interface YouTubeVideoDoc {
  _id: string
  title: string | null
  publishedAt: Date | null
  views: number | null
  /** Our own copy of the thumbnail in the public bucket (webp renders); null until downloaded. */
  thumb: { renders: Array<{ key: string; width: number; height: number }>; at: Date } | null
  thumbTries: number
  thumbTriedAt: Date | null
  /** Last oEmbed attempt for a video whose title is unknown. */
  oembedTriedAt: Date | null
  /** Last time a site page referenced the video (unreferenced ones are pruned after a while). */
  seenAt: Date
  updatedAt: Date
}

/** The videos found for one automatic tab (`_id`: see musicFeedKey). A failed fetch keeps the last good `ids`. */
export interface YouTubeFeedDoc {
  _id: string
  ids: string[]
  /** Last successful fetch. */
  fetchedAt: Date | null
  /** Last attempt, successful or not. */
  attemptAt: Date
  error: string | null
  errorAt: Date | null
}

export const YT_VIDEOS = 'youtubeVideos'
export const YT_FEEDS = 'youtubeFeeds'

export const videosCol = (conn: Connection) => conn.collection<YouTubeVideoDoc>(YT_VIDEOS)
export const feedsCol = (conn: Connection) => conn.collection<YouTubeFeedDoc>(YT_FEEDS)

/** Public bucket key of a thumbnail render. */
export const thumbKey = (id: string, width: number) => `youtube/${id}/w${width}.webp`

/** Valid music sections among stored ones. */
export function musicSections(list: unknown): Array<{ id: string; data: MusicData }> {
  if (!Array.isArray(list)) return []
  return list.flatMap((s) => {
    const r = homeSectionSchema.safeParse(s)
    return r.success && r.data.type === 'music' ? [{ id: r.data.id, data: r.data.data }] : []
  })
}

/** Hand-picked video ids of a tab, in order, without repeats. */
export function manualIds(data: MusicData, group: MusicGroup): string[] {
  const ids: string[] = []
  for (const it of data[group].items) {
    const id = parseYouTubeId(it.url)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** The feed an automatic tab follows, or null when the tab is hand-picked only (popular/newest need an API key). */
export function autoFeedKey(data: MusicData, group: MusicGroup, apiKey: boolean): string | null {
  if (!data[group].auto) return null
  if (group !== 'channel' && !apiKey) return null
  return musicFeedKey(group, data.channelId, group === 'newest' ? data.newest.keyword : '')
}

/** Ids of the automatic tabs, by section id and tab, as visitors get them. */
export type MusicFeedsDto = Record<string, Record<MusicGroup, string[]>>

/** A video as the page draws it: YouTube's title/date/views (each section's overrides win on the web) and our thumbnail. */
export interface YouTubeVideoDto {
  title: string | null
  /** ISO date-time of publication, when known. */
  publishedAt: string | null
  views: number | null
  thumb: { src: string; srcset: string; width: number; height: number } | null
}

export interface PageYouTubeDto {
  /** Per music section: the video ids its automatic tabs add after the hand-picked ones. */
  feeds: MusicFeedsDto
  /** Every video those sections show, by id. */
  videos: Record<string, YouTubeVideoDto>
}

/**
 * The stored YouTube data the music sections of a page need: the automatic tabs' ids (each capped at
 * HOME_LIMITS.musicItemsMax) and every video's details with our thumbnail URLs. Reads MongoDB only.
 */
export async function resolveYouTube(conn: Connection, sections: HomeSection[], opts: { apiKey: boolean; publicUrl: (key: string) => string }): Promise<PageYouTubeDto> {
  const music = musicSections(sections)
  const out: PageYouTubeDto = { feeds: {}, videos: {} }
  if (!music.length) return out
  const keys = new Set<string>()
  for (const s of music) for (const g of ['newest', 'popular', 'channel'] as const) {
    const k = autoFeedKey(s.data, g, opts.apiKey)
    if (k) keys.add(k)
  }
  const feeds = new Map((keys.size ? await feedsCol(conn).find({ _id: { $in: [...keys] } }).toArray() : []).map((f) => [f._id, f]))
  const ids = new Set<string>()
  for (const s of music) {
    const entry = { newest: [], popular: [], channel: [] } as Record<MusicGroup, string[]>
    for (const g of ['newest', 'popular', 'channel'] as const) {
      const manual = manualIds(s.data, g)
      manual.forEach((id) => ids.add(id))
      const k = autoFeedKey(s.data, g, opts.apiKey)
      const auto = (k ? (feeds.get(k)?.ids ?? []) : []).filter((id) => !manual.includes(id)).slice(0, Math.max(0, HOME_LIMITS.musicItemsMax - manual.length))
      auto.forEach((id) => ids.add(id))
      entry[g] = auto
    }
    out.feeds[s.id] = entry
  }
  if (!ids.size) return out
  for (const v of await videosCol(conn).find({ _id: { $in: [...ids] } }).toArray()) {
    const renders = [...(v.thumb?.renders ?? [])].sort((a, b) => a.width - b.width)
    const version = v.thumb ? `?v=${v.thumb.at.getTime()}` : ''
    const main = renders.find((r) => r.width >= 480) ?? renders[renders.length - 1]
    out.videos[v._id] = {
      title: v.title,
      publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
      views: v.views,
      thumb: main
        ? {
            src: `${opts.publicUrl(main.key)}${version}`,
            srcset: renders.map((r) => `${opts.publicUrl(r.key)}${version} ${r.width}w`).join(', '),
            width: main.width,
            height: main.height,
          }
        : null,
    }
  }
  return out
}

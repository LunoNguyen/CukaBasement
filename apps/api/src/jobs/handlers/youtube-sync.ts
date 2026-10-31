import { Logger } from '@nestjs/common'
import { EDITABLE_SITE_PAGES, HOME_LIMITS, isYouTubeVideoId, MUSIC_GROUPS, type MusicData } from '@cuka/shared'
import sharp from 'sharp'
import { autoFeedKey, feedsCol, manualIds, musicSections, thumbKey, videosCol, type YouTubeVideoDoc } from '../../site/music-store'
import {
  type FetchedVideo,
  fetchChannelFeed,
  fetchChannelUploads,
  fetchOEmbedTitle,
  type Fetcher,
  fetchThumbnail,
  mostPopular,
  newestMatching,
} from '../../site/youtube'
import { type JobDeps, SHARP_INPUT } from './media'

const logger = new Logger('YouTubeSync')

/** A feed is fetched again once its last attempt is this old (the job runs hourly; a publish may run it sooner). */
export const FEED_FRESH_MS = 50 * 60_000
/** A video whose oEmbed lookup or thumbnail download failed is retried after these delays. */
export const OEMBED_RETRY_MS = 24 * 3600_000
export const THUMB_RETRY_MS = 6 * 3600_000
export const THUMB_TRIES_MAX = 5
/** Work per run, so one run stays short whatever the pages hold. */
export const OEMBED_PER_RUN = 24
export const THUMBS_PER_RUN = 30
/** Videos no page has referenced for this long are forgotten (and their thumbnails deleted). */
export const PRUNE_AFTER_MS = 30 * 24 * 3600_000
/** Thumbnail renders (webp widths; never enlarged). */
export const THUMB_WIDTHS = [480, 960] as const

export type YouTubeSyncDeps = JobDeps & { fetch?: Fetcher; now?: () => Date }
export interface YouTubeSyncData {
  /** Refetch every feed now, however fresh (the admin's "Làm mới ngay"). */
  force?: boolean
}
export interface YouTubeSyncResult {
  feeds: { fetched: string[]; failed: string[]; skipped: string[] }
  titles: number
  thumbs: { stored: number; failed: number }
  pruned: number
  changed: boolean
}

interface FeedPlan {
  key: string
  group: (typeof MUSIC_GROUPS)[number]
  channelId: string
  keyword: string
}

/**
 * What the music sections of the shown pages (drafts included, so the preview has data) want fetched. The old
 * landing page (`home`) is no longer shown, so its music sections are not followed.
 */
async function plan(deps: YouTubeSyncDeps, apiKey: boolean): Promise<{ feeds: Map<string, FeedPlan>; manual: string[] }> {
  const docs = await deps.conn
    .collection<{ _id: string; draft?: { sections?: unknown }; published?: { sections?: unknown } }>('homepage')
    .find({ _id: { $in: [...EDITABLE_SITE_PAGES] } })
    .toArray()
  const sections: Array<{ data: MusicData }> = docs.flatMap((d) => [...musicSections(d.draft?.sections), ...musicSections(d.published?.sections)])
  const feeds = new Map<string, FeedPlan>()
  const manual = new Set<string>()
  for (const { data } of sections) {
    for (const group of MUSIC_GROUPS) {
      manualIds(data, group).forEach((id) => manual.add(id))
      const key = autoFeedKey(data, group, apiKey)
      if (key && !feeds.has(key)) feeds.set(key, { key, group, channelId: data.channelId, keyword: group === 'newest' ? data.newest.keyword : '' })
    }
  }
  return { feeds, manual: [...manual] }
}

/** Center-crops a 4:3 letterboxed thumbnail to 16:9 and writes webp renders to the public bucket. */
async function storeThumb(deps: YouTubeSyncDeps, id: string, input: Buffer): Promise<NonNullable<YouTubeVideoDoc['thumb']>> {
  const meta = await sharp(input, SHARP_INPUT).metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  if (!w || !h) throw new Error('thumbnail has no size')
  const cropH = Math.min(h, Math.round((w * 9) / 16))
  const top = Math.max(0, Math.floor((h - cropH) / 2))
  const renders: Array<{ key: string; width: number; height: number }> = []
  for (const width of THUMB_WIDTHS) {
    if (width > w && renders.length) break
    const out = await sharp(input, SHARP_INPUT)
      .extract({ left: 0, top, width: w, height: cropH })
      .resize({ width: Math.min(width, w), withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true })
    const key = thumbKey(id, width)
    await deps.storage.put(deps.config.minio.bucketPublic, key, out.data, 'image/webp')
    renders.push({ key, width: out.info.width, height: out.info.height })
  }
  return { renders, at: deps.now?.() ?? new Date() }
}

async function saveVideos(deps: YouTubeSyncDeps, list: FetchedVideo[], now: Date): Promise<void> {
  if (!list.length) return
  await videosCol(deps.conn).bulkWrite(
    list.map((v) => ({
      updateOne: {
        filter: { _id: v.id },
        update: {
          $set: { ...(v.title ? { title: v.title } : {}), ...(v.publishedAt ? { publishedAt: v.publishedAt } : {}), ...(v.views !== null ? { views: v.views } : {}), seenAt: now, updatedAt: now },
          $setOnInsert: {
            ...(v.title ? {} : { title: null }),
            ...(v.publishedAt ? {} : { publishedAt: null }),
            ...(v.views !== null ? {} : { views: null }),
            thumb: null,
            thumbTries: 0,
            thumbTriedAt: null,
            oembedTriedAt: null,
          },
        },
        upsert: true,
      },
    })),
  )
}

/**
 * The music section's YouTube data, kept in MongoDB so visitors' requests never wait on YouTube (the worker runs this
 * hourly, after a draft save or publish that holds a music section, and on the admin's "Làm mới ngay"):
 * 1. the automatic tabs' feeds: the channel's public RSS feed, and with YOUTUBE_API_KEY the most popular and newest
 *    uploads; a failure keeps the last good list, records the error and logs a warning;
 * 2. titles of hand-picked videos YouTube's feeds did not name, from oEmbed (retried daily);
 * 3. a copy of each shown video's thumbnail in the public bucket (a few per run, retried a few times);
 * 4. videos no page has referenced for 30 days are forgotten.
 * Invalidates the page cache when anything visitors see changed.
 */
export async function youtubeSync(deps: YouTubeSyncDeps, data: YouTubeSyncData = {}): Promise<YouTubeSyncResult> {
  const fetcher: Fetcher = deps.fetch ?? ((url, init) => fetch(url, init))
  const now = deps.now?.() ?? new Date()
  const apiKey = deps.config.youtube?.apiKey
  const result: YouTubeSyncResult = { feeds: { fetched: [], failed: [], skipped: [] }, titles: 0, thumbs: { stored: 0, failed: 0 }, pruned: 0, changed: false }
  const { feeds, manual } = await plan(deps, !!apiKey)
  const shown = new Set(manual)

  // 1. Feeds
  const stored = new Map((feeds.size ? await feedsCol(deps.conn).find({ _id: { $in: [...feeds.keys()] } }).toArray() : []).map((f) => [f._id, f]))
  // The Data API answers both automatic tabs of a channel from one list of uploads.
  const uploads = new Map<string, Promise<FetchedVideo[]>>()
  for (const f of feeds.values()) {
    const old = stored.get(f.key)
    if (!data.force && old && now.getTime() - old.attemptAt.getTime() < FEED_FRESH_MS) {
      result.feeds.skipped.push(f.key)
      old.ids.forEach((id) => shown.add(id))
      continue
    }
    try {
      let list: FetchedVideo[]
      if (f.group === 'channel') list = (await fetchChannelFeed(fetcher, f.channelId)).slice(0, HOME_LIMITS.musicItemsMax)
      else {
        if (!uploads.has(f.channelId)) uploads.set(f.channelId, fetchChannelUploads(fetcher, apiKey!, f.channelId))
        const all = await uploads.get(f.channelId)!
        list = f.group === 'popular' ? mostPopular(all, HOME_LIMITS.musicItemsMax) : newestMatching(all, f.keyword, HOME_LIMITS.musicItemsMax)
      }
      await saveVideos(deps, list, now)
      const ids = list.map((v) => v.id)
      await feedsCol(deps.conn).updateOne({ _id: f.key }, { $set: { ids, fetchedAt: now, attemptAt: now, error: null, errorAt: null } }, { upsert: true })
      ids.forEach((id) => shown.add(id))
      result.feeds.fetched.push(f.key)
      result.changed = true
    } catch (e) {
      const message = ((e as Error).message || 'failed').slice(0, 300)
      logger.warn(`YouTube ${f.key} not refreshed, keeping the last good list: ${message}`)
      await feedsCol(deps.conn).updateOne(
        { _id: f.key },
        { $set: { attemptAt: now, error: message, errorAt: now }, $setOnInsert: { ids: [], fetchedAt: null } },
        { upsert: true },
      )
      old?.ids.forEach((id) => shown.add(id))
      result.feeds.failed.push(f.key)
    }
  }

  // Every shown video has a document, marked as seen.
  const ids = [...shown].filter(isYouTubeVideoId)
  if (ids.length) {
    await videosCol(deps.conn).bulkWrite(
      ids.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { seenAt: now }, $setOnInsert: { title: null, publishedAt: null, views: null, thumb: null, thumbTries: 0, thumbTriedAt: null, oembedTriedAt: null, updatedAt: now } },
          upsert: true,
        },
      })),
    )
  }

  // 2. Titles of hand-picked videos
  const untitled = manual.length
    ? await videosCol(deps.conn)
        .find({ _id: { $in: manual }, title: null, $or: [{ oembedTriedAt: null }, { oembedTriedAt: { $lt: new Date(now.getTime() - OEMBED_RETRY_MS) } }] })
        .limit(OEMBED_PER_RUN)
        .toArray()
    : []
  for (const v of untitled) {
    let title: string | null = null
    try {
      title = await fetchOEmbedTitle(fetcher, v._id)
    } catch (e) {
      logger.warn(`oEmbed title of ${v._id} not found: ${(e as Error).message}`)
    }
    await videosCol(deps.conn).updateOne({ _id: v._id }, { $set: { oembedTriedAt: now, ...(title ? { title, updatedAt: now } : {}) } })
    if (title) {
      result.titles++
      result.changed = true
    }
  }

  // 3. Thumbnails
  const missing = ids.length
    ? await videosCol(deps.conn)
        .find({
          _id: { $in: ids },
          thumb: null,
          thumbTries: { $lt: THUMB_TRIES_MAX },
          $or: [{ thumbTriedAt: null }, { thumbTriedAt: { $lt: new Date(now.getTime() - THUMB_RETRY_MS) } }],
        })
        .limit(THUMBS_PER_RUN)
        .toArray()
    : []
  for (const v of missing) {
    try {
      const thumb = await storeThumb(deps, v._id, await fetchThumbnail(fetcher, v._id))
      await videosCol(deps.conn).updateOne({ _id: v._id }, { $set: { thumb, thumbTriedAt: now, updatedAt: now }, $inc: { thumbTries: 1 } })
      result.thumbs.stored++
      result.changed = true
    } catch (e) {
      logger.warn(`Thumbnail of ${v._id} not stored: ${(e as Error).message}`)
      await videosCol(deps.conn).updateOne({ _id: v._id }, { $set: { thumbTriedAt: now }, $inc: { thumbTries: 1 } })
      result.thumbs.failed++
    }
  }

  // 4. Forget what no page has shown for a long time
  const stale = await videosCol(deps.conn)
    .find({ seenAt: { $lt: new Date(now.getTime() - PRUNE_AFTER_MS) } })
    .limit(200)
    .toArray()
  for (const v of stale) {
    for (const r of v.thumb?.renders ?? []) await deps.storage.remove(deps.config.minio.bucketPublic, r.key)
    await videosCol(deps.conn).deleteOne({ _id: v._id, seenAt: v.seenAt })
    result.pruned++
  }
  await feedsCol(deps.conn).deleteMany({ _id: { $nin: [...feeds.keys()] }, attemptAt: { $lt: new Date(now.getTime() - PRUNE_AFTER_MS) } })

  if (result.changed) await deps.feed?.bump()
  return result
}

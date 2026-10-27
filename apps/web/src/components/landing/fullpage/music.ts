import { HOME_LIMITS, type LocalizedText, type MusicData, type MusicGroup, MUSIC_GROUPS, parseYouTubeId, pickText } from '@cuka/shared'
import type { PageYouTubeDto, YouTubeVideoDto } from '@/api/types'

/** A video of the music section as the panel draws it. */
export interface MusicVideo {
  id: string
  title: string
  /** `YYYY-MM-DD` or an ISO date-time; null when unknown. */
  date: string | null
  views: number | null
  thumb: YouTubeVideoDto['thumb']
  /** The video on youtube.com (the "Watch on YouTube" link). */
  watchUrl: string
}

/**
 * The videos of one tab: the hand-picked ones first (their title, date and view count override YouTube's), then
 * what the server's automatic feed adds, without repeats, at most HOME_LIMITS.musicItemsMax.
 */
export function musicVideos(data: MusicData, group: MusicGroup, sectionId: string, yt: PageYouTubeDto, locale: string, untitled: string): MusicVideo[] {
  const out: MusicVideo[] = []
  const seen = new Set<string>()
  const push = (id: string, own: { title: LocalizedText; date: string; views: number | null } | null) => {
    if (seen.has(id) || out.length >= HOME_LIMITS.musicItemsMax) return
    seen.add(id)
    const v = yt.videos[id]
    out.push({
      id,
      title: pickText(own?.title, locale).trim() || v?.title || untitled,
      date: own?.date || v?.publishedAt || null,
      views: own?.views ?? v?.views ?? null,
      thumb: v?.thumb ?? null,
      watchUrl: `https://www.youtube.com/watch?v=${id}`,
    })
  }
  for (const it of data[group].items) {
    const id = parseYouTubeId(it.url)
    if (id) push(id, it)
  }
  for (const id of yt.feeds[sectionId]?.[group] ?? []) if (/^[A-Za-z0-9_-]{11}$/.test(id)) push(id, null)
  return out
}

/** Every tab's videos. */
export function musicTabs(data: MusicData, sectionId: string, yt: PageYouTubeDto, locale: string, untitled: string): Record<MusicGroup, MusicVideo[]> {
  return Object.fromEntries(MUSIC_GROUPS.map((g) => [g, musicVideos(data, g, sectionId, yt, locale, untitled)])) as Record<MusicGroup, MusicVideo[]>
}

/** A date for people: 21/10/2026 or 21 Oct 2026. */
export function formatMusicDate(date: string | null, locale: string): string {
  if (!date) return ''
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(locale === 'en' ? 'en-GB' : 'vi-VN', { day: 'numeric', month: locale === 'en' ? 'short' : '2-digit', year: 'numeric', timeZone: 'UTC' })
}

/** A view count for people: 12K, 1,2 Tr… */
export function formatViews(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale === 'en' ? 'en' : 'vi', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  } catch {
    return String(n)
  }
}

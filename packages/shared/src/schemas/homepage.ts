import { z } from 'zod'
import { DU_CA_CHANNEL_ID, GALLERY_LAYOUTS, HOME_LIMITS as L, isSafeHref, isYouTubeChannelId, parseYouTubeId, RELEASE_SOURCES, SITE_PAGES, unsafeMarkdownLinks } from '../homepage'
import { SOCIAL_PLATFORMS } from '../social'

/** Control characters other than tab and newline. */
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/
const noControl = (s: string) => !CONTROL.test(s)

const text = (max: number) => z.string().trim().max(max).refine(noControl, 'Contains control characters')

/** Vietnamese and English text; `en` may be left empty (the Vietnamese text is shown). */
const localized = (max: number, required = false) =>
  required
    ? z.strictObject({ vi: text(max).min(1), en: text(max).default('') })
    : // An optional text may also be left out entirely.
      z.strictObject({ vi: text(max).default(''), en: text(max).default('') }).prefault({ vi: '' })

/** Limited Markdown (see parseMarkdown): a link to anything but an http(s) URL or a site path is refused. */
const markdown = (max: number) =>
  localized(max).superRefine((t, ctx) => {
    for (const lang of ['vi', 'en'] as const) {
      const bad = unsafeMarkdownLinks(t[lang])
      if (bad.length) ctx.addIssue({ code: 'custom', path: [lang], message: `Unsafe link target: ${bad[0]}` })
    }
  })

/** An http(s) URL or a site path starting with `/`. */
export const homeHrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(L.urlMax)
  .refine(isSafeHref, 'Must be an http(s) URL or a path starting with /')

const httpUrl = z.url({ protocol: /^https?$/ }).max(L.urlMax)

const socialLinkSchema = z.strictObject({ platform: z.enum(SOCIAL_PLATFORMS), label: localized(L.labelMax), url: httpUrl })

export const homeFileIdSchema = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid file id')

/**
 * An uploaded site image. A meaningful image needs Vietnamese alt text; a decorative one is skipped by screen
 * readers and needs none.
 */
export const homeImageSchema = z
  .strictObject({
    fileId: homeFileIdSchema,
    alt: localized(L.altMax),
    decorative: z.boolean().default(false),
  })
  .superRefine((img, ctx) => {
    if (!img.decorative && !img.alt.vi) ctx.addIssue({ code: 'custom', path: ['alt', 'vi'], message: 'Alt text is required', params: { code: 'ALT_REQUIRED' } })
  })

const optionalImage = homeImageSchema.nullable().default(null)

/** An uploaded site video (mp4/webm). It plays muted as a background, so it needs no alt text. */
export const homeVideoSchema = z.strictObject({ fileId: homeFileIdSchema })
const optionalVideo = homeVideoSchema.nullable().default(null)

const optionalHref = z.union([z.literal(''), homeHrefSchema]).default('')

export const homeCtaSchema = z.strictObject({ label: localized(L.labelMax, true), href: homeHrefSchema })

const heading = {
  eyebrow: localized(L.eyebrowMax),
  heading: localized(L.headingMax, true),
}

export const heroDataSchema = z.strictObject({
  eyebrow: localized(L.eyebrowMax),
  title: localized(L.headingMax, true),
  subtitle: localized(L.subtitleMax),
  images: z.array(homeImageSchema).max(L.heroImagesMax).default([]),
  ctas: z.array(homeCtaSchema).max(L.ctasMax).default([]),
})

export const aboutDataSchema = z.strictObject({
  ...heading,
  body: markdown(L.bodyMax),
  image: optionalImage,
  imageSide: z.enum(['left', 'right']).default('right'),
})

export const profileDataSchema = z.strictObject({
  ...heading,
  facts: z
    .array(z.strictObject({ label: localized(L.labelMax, true), value: localized(L.factValueMax, true) }))
    .max(L.factsMax)
    .default([]),
  image: optionalImage,
})

export const timelineDataSchema = z.strictObject({
  ...heading,
  items: z
    .array(
      z.strictObject({
        date: text(L.dateMax).min(1),
        title: localized(L.headingMax, true),
        text: localized(L.shortTextMax),
        image: optionalImage,
      }),
    )
    .max(L.timelineMax)
    .default([]),
})

export const galleryDataSchema = z.strictObject({
  ...heading,
  layout: z.enum(GALLERY_LAYOUTS).default('grid'),
  items: z
    .array(
      z.strictObject({
        image: homeImageSchema,
        caption: localized(L.subtitleMax),
        href: z.union([z.literal(''), homeHrefSchema]).default(''),
      }),
    )
    .max(L.galleryMax)
    .default([]),
})

export const videosDataSchema = z.strictObject({
  ...heading,
  items: z
    .array(
      z.strictObject({
        url: httpUrl.refine((u) => parseYouTubeId(u) !== null, 'Not a YouTube video link'),
        title: localized(L.headingMax),
      }),
    )
    .max(L.videosMax)
    .default([]),
})

export const linksDataSchema = z.strictObject({
  ...heading,
  items: z
    .array(socialLinkSchema)
    .max(L.linksMax)
    .default([]),
})

export const fanartDataSchema = z.strictObject({
  ...heading,
  count: z.number().int().min(L.fanartMin).max(L.fanartMax).default(8),
})

export const bannerDataSchema = z.strictObject({
  eyebrow: localized(L.eyebrowMax),
  text: localized(L.subtitleMax, true),
  attribution: localized(L.labelMax),
  image: optionalImage,
  cta: homeCtaSchema.nullable().default(null),
})

// --- Landing page ("/") sections -------------------------------------------------------------------------------

/**
 * The opening screen: a muted looping background video (a separate one for phones optional; without any, the
 * images as a slideshow, else the brand art), the name in huge letters and a "now playing" style link.
 */
export const heroVideoDataSchema = z.strictObject({
  eyebrow: localized(L.eyebrowMax),
  name: localized(L.headingMax, true),
  subtitle: localized(L.subtitleMax),
  video: optionalVideo,
  videoMobile: optionalVideo,
  images: z.array(homeImageSchema).max(L.heroImagesMax).default([]),
  link: z
    .strictObject({ kicker: localized(L.labelMax), label: localized(L.labelMax, true), href: homeHrefSchema })
    .nullable()
    .default(null),
})

export const releaseItemSchema = z.strictObject({
  title: localized(L.headingMax, true),
  cover: homeImageSchema,
  /** Shown instead of the square cover while the item is expanded (16:9). */
  wide: optionalImage,
  href: homeHrefSchema,
  date: text(L.dateMax).default(''),
})

/** "New release": hand-picked covers (`manual`) or the newest approved all-ages fanart (`latestFanart`, `count` posts). */
export const releasesDataSchema = z.strictObject({
  ...heading,
  source: z.enum(RELEASE_SOURCES).default('manual'),
  count: z.number().int().min(L.releasesMin).max(L.releasesMax).default(5),
  items: z.array(releaseItemSchema).max(L.releasesMax).default([]),
})

export const spotlightItemSchema = z.strictObject({
  name: localized(L.headingMax, true),
  caption: localized(L.subtitleMax),
  background: optionalImage,
  /** The small picture in the strip (black-and-white until active); the background is used when left out. */
  thumb: optionalImage,
  href: optionalHref,
})

/** Like an agency's "Our artists": full-bleed pictures cross-fading every `intervalSec` seconds, with a list of names. */
export const spotlightDataSchema = z.strictObject({
  ...heading,
  intervalSec: z.number().int().min(L.spotlightIntervalMin).max(L.spotlightIntervalMax).default(4),
  items: z.array(spotlightItemSchema).max(L.spotlightMax).default([]),
})

/** A large brand statement with a picture (or the logo mark) and a link, by default to the Introduction page. */
export const vibeDataSchema = z.strictObject({
  eyebrow: localized(L.eyebrowMax),
  text: localized(L.subtitleMax, true),
  image: optionalImage,
  cta: homeCtaSchema.nullable().default(null),
})

/** A calendar day `YYYY-MM-DD` that exists. */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v)
  }, 'Not a date')

/**
 * One hand-picked video of the music section: a YouTube link, and what to show instead of what YouTube says (a
 * title, the date, the view count); left empty, the server fills them in from YouTube.
 */
export const musicItemSchema = z.strictObject({
  url: httpUrl.refine((u) => parseYouTubeId(u) !== null, 'Not a YouTube video link'),
  title: localized(L.headingMax),
  date: z.union([z.literal(''), isoDay]).default(''),
  views: z.number().int().min(0).max(L.musicViewsMax).nullable().default(null),
})

/**
 * A tab of the music section: its label (empty: the default "MV mới" / "MV phổ biến" / "Video kênh"), the
 * hand-picked videos shown first, and whether the server adds videos on its own (`auto`; see musicDataSchema).
 */
const musicGroupShape = (autoDefault: boolean) => ({
  label: localized(L.labelMax),
  auto: z.boolean().default(autoDefault),
  items: z.array(musicItemSchema).max(L.musicItemsMax).default([]),
})
const newestGroup = z.strictObject({ ...musicGroupShape(false), keyword: text(L.musicKeywordMax).default('') }).prefault({ label: { vi: '' } })
const popularGroup = z.strictObject(musicGroupShape(false)).prefault({ label: { vi: '' } })
const channelGroup = z.strictObject(musicGroupShape(true)).prefault({ label: { vi: '' } })

/**
 * "Âm nhạc / MV": three tabs of YouTube videos from Du Ca's channel. `newest` features the newest MV, `popular`
 * ranks the most watched, `channel` is a row of the channel's latest uploads. With `auto`, the channel tab follows
 * the channel's public feed (no API key needed); the other two follow the YouTube Data API, so only when the server
 * has a YOUTUBE_API_KEY (`newest` may keep only titles containing `keyword`, e.g. "MV"). Hand-picked videos come
 * first in every tab. Visitors load nothing from YouTube until they press play: thumbnails are copied to our storage.
 */
export const musicDataSchema = z.strictObject({
  ...heading,
  channelId: z.string().trim().refine(isYouTubeChannelId, 'Not a YouTube channel id (UC…)').default(DU_CA_CHANNEL_ID),
  newest: newestGroup,
  popular: popularGroup,
  channel: channelGroup,
})

/** The landing page's closing screen: logo, a note, site links, contact e-mail, social links and the copyright line. */
export const footerDataSchema = z.strictObject({
  note: localized(L.subtitleMax),
  email: z.union([z.literal(''), z.email().max(L.emailMax)]).default(''),
  links: z.array(socialLinkSchema).max(L.linksMax).default([]),
  copyright: localized(L.subtitleMax),
})

const sectionId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Invalid section id')
const section = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.strictObject({ id: sectionId, type: z.literal(type), visible: z.boolean().default(true), data })

export const homeSectionSchema = z.discriminatedUnion('type', [
  section('heroVideo', heroVideoDataSchema),
  section('releases', releasesDataSchema),
  section('music', musicDataSchema),
  section('spotlight', spotlightDataSchema),
  section('vibe', vibeDataSchema),
  section('footer', footerDataSchema),
  section('hero', heroDataSchema),
  section('about', aboutDataSchema),
  section('profile', profileDataSchema),
  section('timeline', timelineDataSchema),
  section('gallery', galleryDataSchema),
  section('videos', videosDataSchema),
  section('links', linksDataSchema),
  section('fanart', fanartDataSchema),
  section('banner', bannerDataSchema),
])

export const homeSectionsSchema = z
  .array(homeSectionSchema)
  .max(L.sectionsMax)
  .superRefine((list, ctx) => {
    const seen = new Set<string>()
    list.forEach((s, i) => {
      if (seen.has(s.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: 'Duplicate section id' })
      seen.add(s.id)
      // A hidden row may be built up one cover at a time; a visible one needs a full row.
      if (s.type === 'releases' && s.visible && s.data.source === 'manual' && s.data.items.length < L.releasesMin)
        ctx.addIssue({ code: 'custom', path: [i, 'data', 'items'], message: `A visible release row needs at least ${L.releasesMin} items`, params: { code: 'RELEASES_TOO_FEW' } })
    })
  })

/** PUT /admin/site/home/draft: the whole section list, saved only over the draft revision the editor loaded. */
export const saveHomeDraftSchema = z.strictObject({
  revision: z.number().int().min(0),
  sections: homeSectionsSchema,
})

/** The `:page` of the site page routes. */
export const sitePageSchema = z.enum(SITE_PAGES)

/** POST publish / discard: the draft revision the admin is looking at. */
export const homeRevisionSchema = z.strictObject({ revision: z.number().int().min(0) })

export type HomeImage = z.output<typeof homeImageSchema>
export type HomeCta = z.output<typeof homeCtaSchema>
export type HomeSection = z.output<typeof homeSectionSchema>
export type HomeSectionInput = z.input<typeof homeSectionSchema>
export type HeroData = z.output<typeof heroDataSchema>
export type AboutData = z.output<typeof aboutDataSchema>
export type ProfileData = z.output<typeof profileDataSchema>
export type TimelineData = z.output<typeof timelineDataSchema>
export type GalleryData = z.output<typeof galleryDataSchema>
export type VideosData = z.output<typeof videosDataSchema>
export type LinksData = z.output<typeof linksDataSchema>
export type FanartData = z.output<typeof fanartDataSchema>
export type BannerData = z.output<typeof bannerDataSchema>
export type HomeVideo = z.output<typeof homeVideoSchema>
export type HeroVideoData = z.output<typeof heroVideoDataSchema>
export type ReleaseItem = z.output<typeof releaseItemSchema>
export type ReleasesData = z.output<typeof releasesDataSchema>
export type SpotlightItem = z.output<typeof spotlightItemSchema>
export type SpotlightData = z.output<typeof spotlightDataSchema>
export type VibeData = z.output<typeof vibeDataSchema>
export type FooterData = z.output<typeof footerDataSchema>
export type MusicItem = z.output<typeof musicItemSchema>
export type MusicData = z.output<typeof musicDataSchema>

/**
 * Every media file id the sections reference: images (hero slides, about/profile/timeline/banner images, gallery,
 * release and spotlight items) and the background videos of `heroVideo` sections (see homeVideoIds).
 */
export function homeImageIds(sections: ReadonlyArray<{ data: unknown }>): string[] {
  const ids = new Set<string>()
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if (typeof o.fileId === 'string') ids.add(o.fileId)
      for (const k of Object.keys(o)) if (k !== 'fileId') walk(o[k])
    }
  }
  for (const s of sections) walk(s.data)
  return [...ids]
}

/** The file ids used as background videos (`heroVideo` desktop and phone clips); every other id is an image. */
export function homeVideoIds(sections: ReadonlyArray<{ type: string; data: unknown }>): string[] {
  const ids = new Set<string>()
  for (const s of sections) {
    if (s.type !== 'heroVideo') continue
    const d = s.data as { video?: { fileId?: unknown } | null; videoMobile?: { fileId?: unknown } | null }
    for (const v of [d.video, d.videoMobile]) if (v && typeof v.fileId === 'string') ids.add(v.fileId)
  }
  return [...ids]
}

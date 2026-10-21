import { z } from 'zod'
import { GALLERY_LAYOUTS, HOME_LIMITS as L, isSafeHref, parseYouTubeId, unsafeMarkdownLinks } from '../homepage'
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
    .array(z.strictObject({ platform: z.enum(SOCIAL_PLATFORMS), label: localized(L.labelMax), url: httpUrl }))
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

const sectionId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Invalid section id')
const section = <T extends string, D extends z.ZodType>(type: T, data: D) =>
  z.strictObject({ id: sectionId, type: z.literal(type), visible: z.boolean().default(true), data })

export const homeSectionSchema = z.discriminatedUnion('type', [
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
    })
  })

/** PUT /admin/site/home/draft: the whole section list, saved only over the draft revision the editor loaded. */
export const saveHomeDraftSchema = z.strictObject({
  revision: z.number().int().min(0),
  sections: homeSectionsSchema,
})

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

/** Every image file id the sections reference (hero slides, about/profile/timeline/banner images, gallery items). */
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

import { describe, expect, it } from 'vitest'
import {
  createUploadSchema,
  ERROR_CODES,
  HOME_LIMITS,
  HOME_SECTION_TYPES,
  homeImageIds,
  homeSectionSchema,
  homeSectionsSchema,
  homeVideoIds,
  isSafeHref,
  LANDING_SECTION_TYPES,
  markdownToText,
  MOD_ACTIONS,
  parseMarkdown,
  parseYouTubeId,
  pickText,
  saveHomeDraftSchema,
  SITE_PAGE_TYPES,
  SITE_PAGES,
  sitePageSchema,
  UPLOAD_PURPOSES,
  VARIANT_NAMES,
} from '../src'

const FID = 'a'.repeat(24)
const VID = 'c'.repeat(24)
const lt = (vi: string, en = '') => ({ vi, en })
const img = (over: Record<string, unknown> = {}) => ({ fileId: FID, alt: lt('Du Ca'), decorative: false, ...over })

/** One valid section of every type. */
const samples: Record<string, unknown> = {
  hero: { id: 'hero', type: 'hero', visible: true, data: { eyebrow: lt('NIJIGEN'), title: lt('Hibiki Du Ca'), subtitle: lt('x'), images: [img()], ctas: [{ label: lt('Xem'), href: '/posts' }] } },
  about: { id: 'about', type: 'about', visible: true, data: { eyebrow: lt(''), heading: lt('Giới thiệu'), body: lt('**Nữ thần** [YT](https://youtube.com)'), image: null, imageSide: 'left' } },
  profile: { id: 'profile', type: 'profile', visible: true, data: { eyebrow: lt(''), heading: lt('Hồ sơ'), facts: [{ label: lt('Sinh nhật'), value: lt('14/02') }], image: img() } },
  timeline: { id: 'timeline', type: 'timeline', visible: true, data: { eyebrow: lt(''), heading: lt('Dấu mốc'), items: [{ date: '08/08/2021', title: lt('Ra mắt'), text: lt(''), image: null }] } },
  gallery: { id: 'gallery', type: 'gallery', visible: false, data: { eyebrow: lt(''), heading: lt('Ảnh'), layout: 'masonry', items: [{ image: img(), caption: lt(''), href: '' }] } },
  videos: { id: 'videos', type: 'videos', visible: true, data: { eyebrow: lt(''), heading: lt('Video'), items: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: lt('') }] } },
  links: { id: 'links', type: 'links', visible: true, data: { eyebrow: lt(''), heading: lt('Liên kết'), items: [{ platform: 'youtube', label: lt(''), url: 'https://www.youtube.com/@hibikiduca' }] } },
  fanart: { id: 'fanart', type: 'fanart', visible: true, data: { eyebrow: lt(''), heading: lt('Fanart'), count: 8 } },
  banner: { id: 'banner', type: 'banner', visible: true, data: { eyebrow: lt(''), text: lt('#DuCaArt'), attribution: lt(''), image: null, cta: { label: lt('Đăng'), href: '/upload' } } },
  heroVideo: {
    id: 'top',
    type: 'heroVideo',
    visible: true,
    data: { eyebrow: lt('NIJIGEN'), name: lt('Hibiki Du Ca'), subtitle: lt(''), video: { fileId: VID }, videoMobile: null, images: [img()], link: { kicker: lt('Đang phát'), label: lt('Kênh YouTube'), href: 'https://www.youtube.com/@hibikiduca' } },
  },
  releases: {
    id: 'new',
    type: 'releases',
    visible: true,
    data: {
      eyebrow: lt(''),
      heading: lt('Mới phát hành', 'New release'),
      source: 'manual',
      count: 5,
      items: [1, 2, 3].map((n) => ({ title: lt(`Bài ${n}`), cover: img(), wide: n === 1 ? img() : null, href: 'https://open.spotify.com/track/x', date: '2026' })),
    },
  },
  spotlight: {
    id: 'looks',
    type: 'spotlight',
    visible: true,
    data: { eyebrow: lt(''), heading: lt('Diện mạo'), intervalSec: 4, items: [{ name: lt('Model gốc'), caption: lt('08/08/2021'), background: img(), thumb: null, href: '' }] },
  },
  vibe: { id: 'vibe', type: 'vibe', visible: true, data: { eyebrow: lt(''), text: lt('Một căn hầm ấm áp'), image: null, cta: { label: lt('Giới thiệu'), href: '/gioi-thieu' } } },
  footer: { id: 'foot', type: 'footer', visible: true, data: { note: lt('Fan site'), email: 'hi@cuka.test', links: [{ platform: 'youtube', label: lt(''), url: 'https://www.youtube.com/@hibikiduca' }], copyright: lt('© CukaBasement') } },
}

describe('homepage schemas', () => {
  it('accepts one valid section of every type', () => {
    for (const type of HOME_SECTION_TYPES) {
      const r = homeSectionSchema.safeParse(samples[type])
      expect(r.success, `${type}: ${JSON.stringify(r.error?.issues)}`).toBe(true)
    }
    expect(homeSectionsSchema.safeParse(Object.values(samples)).success).toBe(true)
  })

  it('fills defaults: missing en, visible, optional lists', () => {
    const r = homeSectionSchema.parse({ id: 'f', type: 'fanart', data: { eyebrow: { vi: '' }, heading: { vi: 'Fanart' } } })
    expect(r).toEqual({ id: 'f', type: 'fanart', visible: true, data: { eyebrow: lt(''), heading: lt('Fanart'), count: 8 } })
  })

  it('is strict: unknown keys are refused at every level', () => {
    expect(homeSectionSchema.safeParse({ ...(samples.fanart as object), extra: 1 }).success).toBe(false)
    const hero = structuredClone(samples.hero) as { data: Record<string, unknown> }
    hero.data.html = '<b>x</b>'
    expect(homeSectionSchema.safeParse(hero).success).toBe(false)
    const withSrc = structuredClone(samples.hero) as { data: { images: Array<Record<string, unknown>> } }
    withSrc.data.images[0]!.src = 'https://evil.example/x.png'
    expect(homeSectionSchema.safeParse(withSrc).success).toBe(false)
  })

  it('refuses unknown types, duplicate ids, bad ids and too many sections', () => {
    expect(homeSectionSchema.safeParse({ id: 'x', type: 'script', data: {} }).success).toBe(false)
    expect(homeSectionsSchema.safeParse([samples.fanart, samples.fanart]).success).toBe(false)
    expect(homeSectionSchema.safeParse({ ...(samples.fanart as object), id: 'Bad Id' }).success).toBe(false)
    const many = Array.from({ length: HOME_LIMITS.sectionsMax + 1 }, (_, i) => ({ ...(samples.fanart as object), id: `f${i}` }))
    expect(homeSectionsSchema.safeParse(many).success).toBe(false)
  })

  it('requires Vietnamese text for headings and titles; enforces length limits', () => {
    const noTitle = structuredClone(samples.hero) as { data: { title: { vi: string } } }
    noTitle.data.title.vi = '   '
    expect(homeSectionSchema.safeParse(noTitle).success).toBe(false)
    const long = structuredClone(samples.about) as { data: { body: { vi: string } } }
    long.data.body.vi = 'a'.repeat(HOME_LIMITS.bodyMax + 1)
    expect(homeSectionSchema.safeParse(long).success).toBe(false)
  })

  it('requires alt text unless the image is decorative', () => {
    const p = (image: unknown) => homeSectionSchema.safeParse({ ...(samples.profile as object), data: { ...(samples.profile as { data: object }).data, image } })
    expect(p(img({ alt: lt('') })).success).toBe(false)
    expect(p(img({ alt: lt(''), decorative: true })).success).toBe(true)
    expect(p(img({ fileId: 'not-an-id' })).success).toBe(false)
  })

  it('links: only http(s) URLs or site paths', () => {
    const cta = (href: string) =>
      homeSectionSchema.safeParse({ ...(samples.banner as object), data: { ...(samples.banner as { data: object }).data, cta: { label: lt('Go'), href } } }).success
    for (const ok of ['/posts', '/tags/fanart?x=1', 'https://x.com/hibikiduca', 'http://example.com']) expect(cta(ok), ok).toBe(true)
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', '//evil.example', '/\\evil', 'mailto:a@b.c', 'posts', ' java\tscript:x', '']) {
      expect(cta(bad), bad).toBe(false)
    }
    const link = (url: string) =>
      homeSectionSchema.safeParse({ ...(samples.links as object), data: { ...(samples.links as { data: object }).data, items: [{ platform: 'x', label: lt(''), url }] } }).success
    expect(link('javascript:alert(1)')).toBe(false)
    expect(link('/posts')).toBe(false)
  })

  it('markdown with an unsafe link target is refused', () => {
    const about = (body: string) =>
      homeSectionSchema.safeParse({ ...(samples.about as object), data: { ...(samples.about as { data: object }).data, body: lt(body) } }).success
    expect(about('[ok](/posts) and [yt](https://youtube.com)')).toBe(true)
    expect(about('[x](javascript:alert(1))')).toBe(false)
    expect(about('<script>alert(1)</script>')).toBe(true) // stored as text; rendered as text
  })

  it('videos must be YouTube video links', () => {
    const v = (url: string) =>
      homeSectionSchema.safeParse({ ...(samples.videos as object), data: { ...(samples.videos as { data: object }).data, items: [{ url, title: lt('') }] } }).success
    expect(v('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    expect(v('https://www.youtube.com/@hibikiduca')).toBe(false)
    expect(v('https://vimeo.com/123')).toBe(false)
  })

  it('saveHomeDraftSchema needs a revision', () => {
    expect(saveHomeDraftSchema.safeParse({ sections: [] }).success).toBe(false)
    expect(saveHomeDraftSchema.safeParse({ revision: 0, sections: [] }).success).toBe(true)
  })

  it('homeImageIds collects every referenced file; homeVideoIds only the background videos', () => {
    const parsed = homeSectionsSchema.parse(Object.values(samples))
    expect(homeImageIds(parsed).sort()).toEqual([FID, VID])
    expect(homeVideoIds(parsed)).toEqual([VID])
  })

  it('landing sections fill their defaults', () => {
    expect(homeSectionSchema.parse({ id: 'h', type: 'heroVideo', data: { name: { vi: 'Du Ca' } } }).data).toEqual({
      eyebrow: lt(''),
      name: lt('Du Ca'),
      subtitle: lt(''),
      video: null,
      videoMobile: null,
      images: [],
      link: null,
    })
    expect(homeSectionSchema.parse({ id: 'r', type: 'releases', data: { heading: { vi: 'Mới' } } }).data).toMatchObject({ source: 'manual', count: 5, items: [] })
    expect(homeSectionSchema.parse({ id: 's', type: 'spotlight', data: { heading: { vi: 'S' } } }).data).toMatchObject({ intervalSec: 4, items: [] })
    expect(homeSectionSchema.parse({ id: 'f', type: 'footer', data: {} }).data).toEqual({ note: lt(''), email: '', links: [], copyright: lt('') })
  })

  it('releases: 3–8 covers when visible and hand-picked; links must be safe; fanart source needs no items', () => {
    const rel = samples.releases as { data: { items: unknown[] } }
    const withItems = (n: number, extra: Record<string, unknown> = {}) => ({ ...rel, ...extra, data: { ...rel.data, items: Array.from({ length: n }, () => rel.data.items[0]) } })
    expect(homeSectionsSchema.safeParse([withItems(2)]).success).toBe(false)
    expect(homeSectionsSchema.safeParse([withItems(2, { visible: false })]).success).toBe(true)
    expect(homeSectionsSchema.safeParse([withItems(8)]).success).toBe(true)
    expect(homeSectionsSchema.safeParse([withItems(9)]).success).toBe(false)
    expect(homeSectionsSchema.safeParse([{ ...rel, data: { ...rel.data, source: 'latestFanart', items: [] } }]).success).toBe(true)
    expect(homeSectionSchema.safeParse({ ...rel, data: { ...rel.data, count: 2 } }).success).toBe(false)
    const bad = structuredClone(rel) as { data: { items: Array<{ href: string }> } }
    bad.data.items[0]!.href = 'javascript:alert(1)'
    expect(homeSectionSchema.safeParse(bad).success).toBe(false)
    const noCover = structuredClone(rel) as { data: { items: Array<Record<string, unknown>> } }
    delete noCover.data.items[0]!.cover
    expect(homeSectionSchema.safeParse(noCover).success).toBe(false)
  })

  it('heroVideo: the video is a file id only, the link must be safe; spotlight interval and footer e-mail are bounded', () => {
    const hv = samples.heroVideo as { data: Record<string, unknown> }
    const withData = (d: Record<string, unknown>) => homeSectionSchema.safeParse({ ...hv, data: { ...hv.data, ...d } }).success
    expect(withData({ video: { fileId: VID, src: 'https://evil.example/x.mp4' } })).toBe(false)
    expect(withData({ video: { fileId: 'nope' } })).toBe(false)
    expect(withData({ link: { kicker: lt(''), label: lt('x'), href: 'javascript:alert(1)' } })).toBe(false)
    expect(withData({ name: lt(' ') })).toBe(false)
    const sp = samples.spotlight as { data: Record<string, unknown> }
    for (const [sec, ok] of [[2, false], [3, true], [15, true], [16, false]] as const) expect(homeSectionSchema.safeParse({ ...sp, data: { ...sp.data, intervalSec: sec } }).success).toBe(ok)
    const ft = samples.footer as { data: Record<string, unknown> }
    expect(homeSectionSchema.safeParse({ ...ft, data: { ...ft.data, email: 'not-an-email' } }).success).toBe(false)
    expect(homeSectionSchema.safeParse({ ...ft, data: { ...ft.data, email: 'javascript:alert(1)' } }).success).toBe(false)
  })

  it('site pages: home and intro, each with its own suggested types', () => {
    expect(SITE_PAGES).toEqual(['home', 'intro'])
    expect(sitePageSchema.safeParse('intro').success).toBe(true)
    expect(sitePageSchema.safeParse('admin').success).toBe(false)
    expect(SITE_PAGE_TYPES.home).toEqual(LANDING_SECTION_TYPES)
    expect(SITE_PAGE_TYPES.intro).toContain('profile')
    expect(HOME_SECTION_TYPES).toHaveLength(14)
  })

  it('upload purpose, variant, actions and error codes exist', () => {
    expect(createUploadSchema.parse({ name: 'a.png', size: 1, mime: 'image/png', purpose: 'site' }).purpose).toBe('site')
    expect(createUploadSchema.safeParse({ name: 'a.png', size: 1, mime: 'image/png', purpose: 'avatar' }).success).toBe(false)
    expect(VARIANT_NAMES).toContain('large')
    expect(VARIANT_NAMES).toContain('video')
    expect(UPLOAD_PURPOSES).toEqual(['post', 'site'])
    for (const a of ['homepage_publish', 'homepage_discard', 'site_image_delete']) expect(MOD_ACTIONS).toContain(a)
    for (const c of ['REVISION_CONFLICT', 'SITE_IMAGE_INVALID', 'SITE_IMAGE_IN_USE']) expect(ERROR_CODES).toContain(c)
  })
})

describe('homepage helpers', () => {
  it('parseYouTubeId', () => {
    const id = 'dQw4w9WgXcQ'
    for (const u of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&t=30`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
    ]) {
      expect(parseYouTubeId(u), u).toBe(id)
    }
    for (const u of ['https://www.youtube.com/@hibikiduca', 'https://evil.example/watch?v=' + id, 'javascript:alert(1)', `https://youtu.be/${id}x`, 'not a url']) {
      expect(parseYouTubeId(u), u).toBeNull()
    }
  })

  it('isSafeHref', () => {
    expect(isSafeHref('/posts')).toBe(true)
    expect(isSafeHref('https://a.b')).toBe(true)
    expect(isSafeHref('//a.b')).toBe(false)
    expect(isSafeHref('javascript:void(0)')).toBe(false)
    expect(isSafeHref('/a b')).toBe(false)
  })

  it('pickText falls back to Vietnamese', () => {
    expect(pickText(lt('Xin chào', 'Hello'), 'en')).toBe('Hello')
    expect(pickText(lt('Xin chào', ''), 'en')).toBe('Xin chào')
    expect(pickText(lt('Xin chào', 'Hello'), 'vi')).toBe('Xin chào')
  })

  it('parseMarkdown: paragraphs, bold, italic, safe links; never HTML', () => {
    expect(parseMarkdown('Một **đậm** và *nghiêng*\nxuống dòng\n\n[YT](https://youtube.com)')).toEqual([
      {
        t: 'p',
        c: [
          { t: 'text', v: 'Một ' },
          { t: 'strong', c: [{ t: 'text', v: 'đậm' }] },
          { t: 'text', v: ' và ' },
          { t: 'em', c: [{ t: 'text', v: 'nghiêng' }] },
          { t: 'br' },
          { t: 'text', v: 'xuống dòng' },
        ],
      },
      { t: 'p', c: [{ t: 'link', href: 'https://youtube.com', c: [{ t: 'text', v: 'YT' }] }] },
    ])
    expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([{ t: 'p', c: [{ t: 'text', v: '<img src=x onerror=alert(1)>' }] }])
    expect(parseMarkdown('[bad](javascript:alert)')).toEqual([{ t: 'p', c: [{ t: 'text', v: 'bad' }] }])
    expect(parseMarkdown('2 * 3 * 4')).toEqual([{ t: 'p', c: [{ t: 'text', v: '2 * 3 * 4' }] }])
    expect(markdownToText('**A** [b](/x)')).toBe('A b')
  })
})

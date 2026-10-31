import { DU_CA_CHANNEL_ID, type HomeBanner, homeBannerSchema, HOME_LIMITS, type HomeSection, homeSectionSchema, homeSectionsSchema, type SitePage } from '@cuka/shared'
import type { Connection, Types } from 'mongoose'

// Kept free of Nest services: database/prepare (setup, restore) imports it.


/**
 * The long-form page: Hibiki Du Ca's profile from public sources. It was the first homepage; it now seeds the
 * Introduction page ("/gioi-thieu"), and an untouched homepage still holding it is upgraded to the landing below.
 * Every fact here is editable from Quản trị → Trang chủ; image slots are empty until an admin uploads pictures.
 * Gallery and videos start hidden because they have nothing to show yet.
 */
const longForm = [
  {
    id: 'hero',
    type: 'hero',
    visible: true,
    data: {
      eyebrow: { vi: 'NIJIGEN Project · Thế hệ 1', en: 'NIJIGEN Project · 1st generation' },
      title: { vi: 'Hibiki Du Ca', en: 'Hibiki Du Ca' },
      subtitle: {
        vi: 'Nữ thần thích lang thang khám phá, lỡ phải lòng âm nhạc và đồ ăn Việt Nam — nên xuống trần làm VTuber để kiếm tiền mua đồ ăn ngon.',
        en: 'A wandering goddess who fell for human music and Vietnamese food — and became a VTuber to earn enough to keep eating it.',
      },
      images: [],
      ctas: [
        { label: { vi: 'Xem fanart', en: 'Browse fanart' }, href: '/posts' },
        { label: { vi: 'Kênh YouTube', en: 'YouTube channel' }, href: 'https://www.youtube.com/@hibikiduca' },
      ],
    },
  },
  {
    id: 'about',
    type: 'about',
    visible: true,
    data: {
      eyebrow: { vi: 'Giới thiệu', en: 'About' },
      heading: { vi: 'Một nữ thần đi lạc xuống trần gian', en: 'A goddess who wandered down to Earth' },
      body: {
        vi: '**Hibiki Du Ca** (響ゆうか) là nữ VTuber người Việt thuộc thế hệ đầu tiên của *NIJIGEN Project*, ra mắt cùng Akatsuki Ban Mai.\n\nCô là một nữ thần rất thích đi đây đi đó để khám phá những điều mới lạ. Xuống Trái Đất, cô say mê âm nhạc của loài người và các món ăn Việt Nam, nên đã học tiếng người và trở thành VTuber — để kiếm tiền mua đồ ăn Việt.\n\nDu Ca nói tiếng Việt, tiếng Anh và một chút tiếng Nhật. Fan gọi cô là Yuuka, Kami-sama hay Yukami.',
        en: '**Hibiki Du Ca** (響ゆうか) is a Vietnamese VTuber from the first generation of *NIJIGEN Project*, debuting alongside Akatsuki Ban Mai.\n\nShe is a goddess who loves to wander and discover new things. On Earth she fell in love with human music and Vietnamese food, so she learned the human language and became a VTuber — to earn money for Vietnamese food.\n\nDu Ca speaks Vietnamese, English and a little Japanese. Fans call her Yuuka, Kami-sama or Yukami.',
      },
      image: null,
      imageSide: 'right',
    },
  },
  {
    id: 'profile',
    type: 'profile',
    visible: true,
    data: {
      eyebrow: { vi: 'Hồ sơ', en: 'Profile' },
      heading: { vi: 'Hibiki Du Ca · 響ゆうか', en: 'Hibiki Du Ca · 響ゆうか' },
      facts: [
        { label: { vi: 'Ra mắt', en: 'Debut' }, value: { vi: '08/08/2021 trên YouTube', en: 'August 8, 2021 on YouTube' } },
        { label: { vi: 'Sinh nhật', en: 'Birthday' }, value: { vi: '14 tháng 2', en: 'February 14' } },
        { label: { vi: 'Thế hệ', en: 'Generation' }, value: { vi: 'NIJIGEN Project thế hệ 1, cùng Akatsuki Ban Mai', en: 'NIJIGEN Project 1st gen, with Akatsuki Ban Mai' } },
        { label: { vi: 'Ngôn ngữ', en: 'Languages' }, value: { vi: 'Tiếng Việt, tiếng Anh, một chút tiếng Nhật', en: 'Vietnamese, English, a little Japanese' } },
        { label: { vi: 'Biệt danh', en: 'Nicknames' }, value: { vi: 'Yuuka, Kami-sama, Yukami', en: 'Yuuka, Kami-sama, Yukami' } },
        {
          label: { vi: 'Ngoại hình', en: 'Look' },
          value: {
            vi: 'Tóc hồng dài ngang vai tết bím, mái bằng, băng đô trắng, mắt hồng, một chiếc răng nanh nhỏ, váy Lolita hồng trắng và túi thỏ bông',
            en: 'Medium-long pink braided hair with bangs, white headband, pink eyes, a small fang, a pink-and-white Lolita dress and a plush bunny bag',
          },
        },
        { label: { vi: 'Thiết kế (mama)', en: 'Designer (mama)' }, value: { vi: '@siriuflong', en: '@siriuflong' } },
        { label: { vi: 'Rigger (papa)', en: 'Rigger (papa)' }, value: { vi: '@6bigduck9', en: '@6bigduck9' } },
        { label: { vi: 'Cộng đồng fan', en: 'Fandom' }, value: { vi: 'Cuka', en: 'Cuka' } },
      ],
      image: null,
    },
  },
  {
    id: 'timeline',
    type: 'timeline',
    visible: true,
    data: {
      eyebrow: { vi: 'Hành trình', en: 'Journey' },
      heading: { vi: 'Những dấu mốc', en: 'Milestones' },
      items: [
        { date: '08/08/2021', title: { vi: 'Ra mắt trên YouTube', en: 'Debut on YouTube' }, text: { vi: 'Buổi stream đầu tiên cùng NIJIGEN Project thế hệ 1.', en: 'First stream as part of NIJIGEN Project’s first generation.' }, image: null },
        { date: '14/01/2022', title: { vi: 'Bắt đầu stream TikTok', en: 'TikTok streams begin' }, text: { vi: '', en: '' }, image: null },
        { date: '01/02/2022', title: { vi: '60.000 người đăng ký YouTube', en: '60,000 YouTube subscribers' }, text: { vi: '', en: '' }, image: null },
        { date: '14/02/2022', title: { vi: 'Stream sinh nhật đầu tiên', en: 'First birthday stream' }, text: { vi: '', en: '' }, image: null },
        { date: '09/08/2024', title: { vi: 'Model chibi mừng 3 năm', en: 'Chibi model for the 3rd anniversary' }, text: { vi: '', en: '' }, image: null },
      ],
    },
  },
  {
    id: 'hashtags',
    type: 'banner',
    visible: true,
    data: {
      eyebrow: { vi: 'Hashtag', en: 'Hashtags' },
      text: {
        vi: 'Vẽ Du Ca thì gắn #DuCaArt, xem stream thì #DuCalive, còn lại là #HibikiDuCa.',
        en: 'Drew Du Ca? Tag it #DuCaArt. Watching a stream? #DuCalive. Everything else: #HibikiDuCa.',
      },
      attribution: { vi: 'Fanart R18 dùng #ameoDuCa', en: 'R18 fanart goes under #ameoDuCa' },
      image: null,
      cta: { label: { vi: 'Đăng fanart', en: 'Share your fanart' }, href: '/upload' },
    },
  },
  {
    id: 'fanart',
    type: 'fanart',
    visible: true,
    data: {
      eyebrow: { vi: 'Từ Cuka', en: 'From the Cuka' },
      heading: { vi: 'Fanart mới', en: 'Latest fanart' },
      count: 8,
    },
  },
  {
    id: 'gallery',
    type: 'gallery',
    visible: false,
    data: { eyebrow: { vi: 'Thư viện', en: 'Gallery' }, heading: { vi: 'Khoảnh khắc của Du Ca', en: 'Du Ca moments' }, layout: 'masonry', items: [] },
  },
  {
    id: 'videos',
    type: 'videos',
    visible: false,
    data: { eyebrow: { vi: 'Video', en: 'Videos' }, heading: { vi: 'Xem cùng Du Ca', en: 'Watch with Du Ca' }, items: [] },
  },
  {
    id: 'links',
    type: 'links',
    visible: true,
    data: {
      eyebrow: { vi: 'Theo dõi', en: 'Follow' },
      heading: { vi: 'Tìm Du Ca ở đâu', en: 'Where to find Du Ca' },
      items: [
        { platform: 'youtube', label: { vi: '@hibikiduca', en: '@hibikiduca' }, url: 'https://www.youtube.com/@hibikiduca' },
        { platform: 'x', label: { vi: '@hibikiduca', en: '@hibikiduca' }, url: 'https://x.com/hibikiduca' },
        { platform: 'facebook', label: { vi: 'Hibiki Du Ca', en: 'Hibiki Du Ca' }, url: 'https://www.facebook.com/hibikiduca' },
      ],
    },
  },
]

/** Validated once at load, so a typo here fails every test instead of reaching a database. */
export const LEGACY_HOME_SEED: HomeSection[] = homeSectionsSchema.parse(longForm)

/**
 * The landing page ("/") created on first setup: full-screen sections in the spirit of an agency site. No video or
 * pictures yet (the brand art stands in), the newest fanart as the "new release" row, Du Ca's channel videos (from
 * its public feed; the MV tabs wait for an admin to pick videos), and no invented facts: the spotlight names only the
 * two models whose dates are public.
 */
const landing = [
  {
    id: 'top',
    type: 'heroVideo',
    visible: true,
    data: {
      eyebrow: { vi: 'NIJIGEN Project · VTuber', en: 'NIJIGEN Project · VTuber' },
      name: { vi: 'Hibiki Du Ca', en: 'Hibiki Du Ca' },
      subtitle: {
        vi: 'Nữ thần thích lang thang khám phá, lỡ phải lòng âm nhạc và đồ ăn Việt Nam.',
        en: 'A wandering goddess who fell for human music and Vietnamese food.',
      },
      video: null,
      videoMobile: null,
      images: [],
      link: { kicker: { vi: 'Xem trên YouTube', en: 'Watch on YouTube' }, label: { vi: 'Kênh YouTube', en: 'YouTube channel' }, href: 'https://www.youtube.com/@hibikiduca' },
    },
  },
  {
    id: 'new',
    type: 'releases',
    visible: true,
    data: { eyebrow: { vi: 'Từ Cuka', en: 'From the Cuka' }, heading: { vi: 'Mới phát hành', en: 'New release' }, source: 'latestFanart', count: 5, items: [] },
  },
  {
    id: 'music',
    type: 'music',
    visible: true,
    data: {
      eyebrow: { vi: 'Hibiki Du Ca', en: 'Hibiki Du Ca' },
      heading: { vi: 'Âm nhạc', en: 'Music' },
      channelId: DU_CA_CHANNEL_ID,
      newest: { label: { vi: 'MV mới', en: 'New MV' }, auto: false, keyword: '', items: [] },
      popular: { label: { vi: 'MV phổ biến', en: 'Popular MVs' }, auto: false, items: [] },
      channel: { label: { vi: 'Video kênh', en: 'Channel videos' }, auto: true, items: [] },
    },
  },
  {
    id: 'looks',
    type: 'spotlight',
    visible: true,
    data: {
      eyebrow: { vi: 'Diện mạo', en: 'Looks' },
      heading: { vi: 'Những phiên bản của Du Ca', en: 'Du Ca, every version' },
      intervalSec: 4,
      items: [
        { name: { vi: 'Model gốc', en: 'Original model' }, caption: { vi: '08/08/2021 · ra mắt trên YouTube', en: 'August 8, 2021 · YouTube debut' }, background: null, thumb: null, href: '/gioi-thieu' },
        { name: { vi: 'Chibi', en: 'Chibi' }, caption: { vi: '09/08/2024 · mừng 3 năm hoạt động', en: 'August 9, 2024 · 3rd anniversary' }, background: null, thumb: null, href: '' },
        { name: { vi: 'Qua nét vẽ của Cuka', en: 'Drawn by the Cuka' }, caption: { vi: 'Mọi phiên bản fan vẽ, ở cùng một chỗ', en: 'Every version fans have drawn, in one place' }, background: null, thumb: null, href: '/' },
      ],
    },
  },
  {
    id: 'vibe',
    type: 'vibe',
    visible: true,
    data: {
      eyebrow: { vi: 'CukaBasement', en: 'CukaBasement' },
      text: { vi: 'Một căn hầm ấm áp cho những ai thương Du Ca — để vẽ, để xem, để kể lại.', en: 'A warm basement for everyone who loves Du Ca — to draw, to watch, to tell.' },
      image: null,
      cta: { label: { vi: 'Giới thiệu về Du Ca', en: 'Meet Du Ca' }, href: '/gioi-thieu' },
    },
  },
  {
    id: 'end',
    type: 'footer',
    visible: true,
    data: {
      note: {
        vi: 'Trang của cộng đồng fan, không phải trang chính thức của Hibiki Du Ca hay NIJIGEN Project.',
        en: 'A fan community site, not an official page of Hibiki Du Ca or NIJIGEN Project.',
      },
      email: '',
      links: [
        { platform: 'youtube', label: { vi: '@hibikiduca', en: '@hibikiduca' }, url: 'https://www.youtube.com/@hibikiduca' },
        { platform: 'x', label: { vi: '@hibikiduca', en: '@hibikiduca' }, url: 'https://x.com/hibikiduca' },
        { platform: 'facebook', label: { vi: 'Hibiki Du Ca', en: 'Hibiki Du Ca' }, url: 'https://www.facebook.com/hibikiduca' },
      ],
      copyright: { vi: '© CukaBasement · Fanart thuộc về các họa sĩ', en: '© CukaBasement · Fanart belongs to its artists' },
    },
  },
]

export const HOME_SEED: HomeSection[] = homeSectionsSchema.parse(landing)

const byId = (list: Array<{ id: string }>, id: string) => list.find((x) => x.id === id)!

/**
 * The Introduction page's default content (one normal-scrolling page): the former landing blocks (opening video,
 * music, new releases, looks), then the long-form profile, the hashtag banner, and gallery and videos hidden until
 * they have something to show.
 */
export const INTRO_SEED: HomeSection[] = homeSectionsSchema.parse([
  ...['top', 'music', 'new', 'looks'].map((id) => byId(landing, id)),
  ...['about', 'profile', 'timeline', 'links', 'fanart', 'hashtags', 'gallery', 'videos'].map((id) => byId(longForm, id)),
])

/** The small banner atop the fanart gallery ("/"): no picture yet, a line about Du Ca, a link to the Introduction page. */
export const HOME_BANNER_SEED: HomeBanner = homeBannerSchema.parse({
  title: { vi: 'Hibiki Du Ca', en: 'Hibiki Du Ca' },
  text: {
    vi: 'Nữ VTuber người Việt thuộc thế hệ đầu tiên của NIJIGEN Project — nơi Cuka chia sẻ fanart về cô.',
    en: 'A Vietnamese VTuber from the first generation of NIJIGEN Project — where the Cuka share their fanart of her.',
  },
  image: null,
  link: { label: { vi: 'Giới thiệu', en: 'About Du Ca' }, href: '/gioi-thieu' },
})

/** Section types of the old landing page that only made sense full-screen: never copied to the Introduction page. */
const LANDING_ONLY_TYPES = new Set(['vibe', 'footer'])

export const HOME_COLLECTION = 'homepage'
export const HOME_ID = 'home' as const
export const INTRO_ID = 'intro' as const

const SEEDS: Record<SitePage, HomeSection[]> = { home: HOME_SEED, intro: INTRO_SEED }

/**
 * One CMS page (`_id`: home, intro): the draft admins edit (revision bumps on every save, for optimistic
 * concurrency) and the published version visitors see.
 */
export interface HomepageDoc {
  _id: SitePage
  /** `banner`: the gallery's home banner, kept on the Introduction page only (absent on older documents). */
  draft: { revision: number; sections: HomeSection[]; banner?: HomeBanner | null; updatedAt: Date; updatedBy: Types.ObjectId | null }
  published: { sections: HomeSection[]; banner?: HomeBanner | null; publishedAt: Date; publishedBy: Types.ObjectId | null }
  /** On `home`, from an earlier release: its sections were already copied to the Introduction page. */
  migratedToIntro?: Date
  /** On `intro`: when the old landing page's sections were merged in (see migrateHomeIntoIntro). */
  migratedFromHome?: Date
}

/** Creates page `page` with its default content unless it exists; never overwrites. Returns whether it was created. */
async function ensurePage(conn: Connection, page: SitePage): Promise<boolean> {
  const now = new Date()
  const sections = SEEDS[page]
  const banner = page === 'intro' ? { banner: HOME_BANNER_SEED } : {}
  try {
    const res = await conn.collection<HomepageDoc>(HOME_COLLECTION).updateOne(
      { _id: page },
      {
        $setOnInsert: {
          draft: { revision: 0, sections, ...banner, updatedAt: now, updatedBy: null },
          published: { sections, ...banner, publishedAt: now, publishedBy: null },
        },
      },
      { upsert: true },
    )
    return res.upsertedCount > 0
  } catch (err) {
    // Two first requests racing the upsert: the loser sees a duplicate key, and the document exists.
    if ((err as { code?: number }).code === 11000) return false
    throw err
  }
}

/** The stored sections normalised by the schema (as the API serves them), for comparing with a seed. */
const normalised = (list: unknown) =>
  JSON.stringify(
    (Array.isArray(list) ? list : []).flatMap((s) => {
      const r = homeSectionSchema.safeParse(s)
      return r.success ? [r.data] : [s]
    }),
  )

/**
 * Whether the homepage is still exactly the first seed, never saved or published by anyone: draft and published
 * both equal the long-form seed, with no editor recorded. Anything an admin touched fails this.
 */
export function isUntouchedLegacyHome(doc: HomepageDoc | null): boolean {
  if (!doc || doc.draft?.updatedBy || doc.published?.publishedBy) return false
  const legacy = JSON.stringify(LEGACY_HOME_SEED)
  return normalised(doc.draft.sections) === legacy && normalised(doc.published.sections) === legacy
}

/** `moved`: sections of the old landing page added to or replaced on the Introduction page by this run (see migrateHomeIntoIntro). */
export type EnsurePagesResult = { home: 'created' | 'migrated' | 'kept'; intro: 'created' | 'kept'; moved: number }

/**
 * Makes sure both pages exist (setup, restore, first read). A homepage that is still the untouched first seed
 * becomes the new landing page (its long-form content lives on in the Introduction page); one an admin edited is
 * kept exactly as it is, and only gains the new section types in the editor.
 */
export async function ensureSitePages(conn: Connection, log: (line: string) => void = () => {}): Promise<EnsurePagesResult> {
  const intro = (await ensurePage(conn, 'intro')) ? 'created' : 'kept'
  const home = await ensureHome(conn)
  await ensureIntroBanner(conn)
  return { home, intro, moved: await migrateHomeIntoIntro(conn, log) }
}

async function ensureHome(conn: Connection): Promise<EnsurePagesResult['home']> {
  if (await ensurePage(conn, 'home')) return 'created'
  const col = conn.collection<HomepageDoc>(HOME_COLLECTION)
  const doc = await col.findOne({ _id: HOME_ID })
  if (!doc || !isUntouchedLegacyHome(doc)) return 'kept'
  const now = new Date()
  // Guarded on the revision and the empty editor fields, so a save landing meanwhile wins.
  const res = await col.updateOne(
    { _id: HOME_ID, 'draft.revision': doc.draft.revision, 'draft.updatedBy': null, 'published.publishedBy': null },
    {
      $set: { 'draft.sections': HOME_SEED, 'draft.updatedAt': now, 'published.sections': HOME_SEED, 'published.publishedAt': now },
      $inc: { 'draft.revision': 1 },
    },
  )
  return res.modifiedCount ? 'migrated' : 'kept'
}

/** An Introduction page from before the home banner gets the default one (draft and published); never overwrites. */
async function ensureIntroBanner(conn: Connection): Promise<void> {
  const col = conn.collection<HomepageDoc>(HOME_COLLECTION)
  for (const part of ['draft', 'published'] as const)
    await col.updateOne({ _id: INTRO_ID, [`${part}.banner`]: { $exists: false } }, { $set: { [`${part}.banner`]: HOME_BANNER_SEED } })
}

/** Stable JSON (sorted keys) of a section, for telling an edited one from the seed. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

interface Merge {
  sections: HomeSection[]
  /** Sections added to the top or replaced in place. */
  changed: number
  /** Sections cut from the end to stay within HOME_LIMITS.sectionsMax. */
  dropped: number
}

/**
 * The Introduction page's `into` list with the old landing page's `from` sections merged in: sections it lacks go
 * to the top (in their order); a section with the same id but other content is replaced in place by the landing
 * version (that is what the admin last edited there); `vibe` and `footer` are left out. A moved `heroVideo` hides
 * the intro's long-form `hero`, so the page keeps one opening. The result is cut to the section limit.
 */
function mergeInto(into: unknown, from: unknown): Merge {
  const intro = (Array.isArray(into) ? into : []) as HomeSection[]
  const landing = ((Array.isArray(from) ? from : []) as HomeSection[]).filter((s) => s && typeof s.id === 'string' && !LANDING_ONLY_TYPES.has(s.type))
  const byId = new Map(landing.map((s) => [s.id, s]))
  const have = new Set(intro.map((s) => s.id))
  let changed = 0
  const kept = intro.map((s) => {
    const mine = byId.get(s.id)
    if (!mine || canonical(mine) === canonical(s)) return s
    changed++
    return mine
  })
  const added = landing.filter((s) => !have.has(s.id))
  changed += added.length
  let sections = [...added, ...kept]
  if (added.some((s) => s.type === 'heroVideo')) sections = sections.map((s) => (s.type === 'hero' && s.visible ? ({ ...s, visible: false } as HomeSection) : s))
  const dropped = Math.max(0, sections.length - HOME_LIMITS.sectionsMax)
  return { sections: sections.slice(0, HOME_LIMITS.sectionsMax), changed, dropped }
}

/**
 * "/" became the fanart gallery, so the old landing page (`home`) is no longer shown or edited. Once (setup, restore
 * or first read) its sections are merged into the Introduction page, draft into draft and published into published
 * (see mergeInto). The merged lists and the `migratedFromHome` record are written in one update, guarded on the
 * draft revision and the publish time, so an admin save or publish landing meanwhile is re-read and merged into,
 * never overwritten; after repeated conflicts the move is left unrecorded and runs again next time. An earlier
 * release's record on `home` (`migratedToIntro`) counts as done. Returns how many draft sections were added or
 * replaced (0 when there was nothing to do).
 */
export async function migrateHomeIntoIntro(conn: Connection, log: (line: string) => void = () => {}): Promise<number> {
  const col = conn.collection<HomepageDoc>(HOME_COLLECTION)
  for (let attempt = 0; attempt < 5; attempt++) {
    const intro = await col.findOne({ _id: INTRO_ID })
    if (!intro || intro.migratedFromHome) return 0
    const home = await col.findOne({ _id: HOME_ID })
    const guard = { _id: INTRO_ID, 'draft.revision': intro.draft.revision, 'published.publishedAt': intro.published.publishedAt, migratedFromHome: { $exists: false } }
    if (!home || home.migratedToIntro) {
      if ((await col.updateOne(guard, { $set: { migratedFromHome: new Date() } })).matchedCount) return 0
      continue
    }
    const draft = mergeInto(intro.draft.sections, home.draft?.sections)
    const published = mergeInto(intro.published.sections, home.published?.sections)
    const res = await col.updateOne(guard, {
      $set: { 'draft.sections': draft.sections, 'published.sections': published.sections, migratedFromHome: new Date() },
      ...(draft.changed ? { $inc: { 'draft.revision': 1 } } : {}),
    })
    if (!res.matchedCount) continue
    for (const [part, m] of [['draft', draft], ['published', published]] as const)
      if (m.dropped) log(`introduction page: dropped ${m.dropped} section${m.dropped === 1 ? '' : 's'} from the end of the ${part} (limit ${HOME_LIMITS.sectionsMax})`)
    return draft.changed
  }
  log('introduction page: WARNING could not merge the old landing page (the page kept changing); it will be tried again')
  return 0
}

/** Creates the default pages unless they exist (see ensureSitePages). Returns whether the homepage was created. */
export async function ensureHomepage(conn: Connection): Promise<boolean> {
  return (await ensureSitePages(conn)).home === 'created'
}

import { type HomeSection, homeSectionsSchema } from '@cuka/shared'
import type { Connection, Types } from 'mongoose'

// Kept free of Nest services: database/prepare (setup, restore) imports it.


/**
 * The homepage created on first setup (never over an existing one): Hibiki Du Ca's profile from public sources.
 * Every fact here is editable from Quản trị → Trang chủ; image slots are empty until an admin uploads pictures.
 * Gallery and videos start hidden because they have nothing to show yet.
 */
const raw = [
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
export const HOME_SEED: HomeSection[] = homeSectionsSchema.parse(raw)

export const HOME_COLLECTION = 'homepage'
export const HOME_ID = 'home'

/**
 * The single homepage document: the draft admins edit (revision bumps on every save, for optimistic concurrency)
 * and the published version visitors see.
 */
export interface HomepageDoc {
  _id: typeof HOME_ID
  draft: { revision: number; sections: HomeSection[]; updatedAt: Date; updatedBy: Types.ObjectId | null }
  published: { sections: HomeSection[]; publishedAt: Date; publishedBy: Types.ObjectId | null }
}

/** Creates the default homepage unless one exists; never overwrites. Returns whether it was created. */
export async function ensureHomepage(conn: Connection): Promise<boolean> {
  const now = new Date()
  try {
    const res = await conn.collection<HomepageDoc>(HOME_COLLECTION).updateOne(
      { _id: HOME_ID },
      {
        $setOnInsert: {
          draft: { revision: 0, sections: HOME_SEED, updatedAt: now, updatedBy: null },
          published: { sections: HOME_SEED, publishedAt: now, publishedBy: null },
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


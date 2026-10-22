import type { HomeSection } from '@cuka/shared'
import type { PublicHomeDto, SiteImageDto, SiteVideoDto } from '@/api/types'

export const lt = (vi: string, en = '') => ({ vi, en })
export const IMG = 'a'.repeat(24)
export const IMG2 = 'b'.repeat(24)
export const image = (fileId = IMG, alt = 'Du Ca cười') => ({ fileId, alt: lt(alt, 'Du Ca smiling'), decorative: false })

export const resolved = (id: string): SiteImageDto => ({
  width: 2400,
  height: 1600,
  src: `http://cdn/${id}/md.webp?v=1`,
  srcset: `http://cdn/${id}/sm.webp?v=1 360w, http://cdn/${id}/md.webp?v=1 1200w, http://cdn/${id}/lg.webp?v=1 2400w`,
})

/** One section of every type, as the API returns them. */
export function allSections(): HomeSection[] {
  return [
    { id: 'hero', type: 'hero', visible: true, data: { eyebrow: lt('NIJIGEN Project'), title: lt('Hibiki Du Ca'), subtitle: lt('Nữ thần mê đồ ăn Việt', 'A goddess who loves Vietnamese food'), images: [image(), image(IMG2, 'Ảnh hai')], ctas: [{ label: lt('Xem fanart'), href: '/posts' }, { label: lt('YouTube'), href: 'https://www.youtube.com/@hibikiduca' }] } },
    { id: 'about', type: 'about', visible: true, data: { eyebrow: lt('Giới thiệu'), heading: lt('Nữ thần đi lạc'), body: lt('Một **nữ thần** thích *khám phá*.\n\n[Kênh](https://www.youtube.com/@hibikiduca) và [fanart](/posts). <script>alert(1)</script> [xấu](javascript:alert(1))'), image: null, imageSide: 'right' } },
    { id: 'profile', type: 'profile', visible: true, data: { eyebrow: lt('Hồ sơ'), heading: lt('Hồ sơ Du Ca', 'Du Ca profile'), facts: [{ label: lt('Sinh nhật', 'Birthday'), value: lt('14 tháng 2', 'February 14') }, { label: lt('Ra mắt'), value: lt('08/08/2021') }], image: image() } },
    { id: 'timeline', type: 'timeline', visible: true, data: { eyebrow: lt(''), heading: lt('Dấu mốc'), items: [{ date: '08/08/2021', title: lt('Ra mắt'), text: lt(''), image: null }, { date: '14/02/2022', title: lt('Stream sinh nhật'), text: lt('Lần đầu'), image: null }] } },
    { id: 'gallery', type: 'gallery', visible: true, data: { eyebrow: lt(''), heading: lt('Thư viện'), layout: 'carousel', items: [{ image: image(), caption: lt('Chú thích'), href: '' }, { image: image(IMG2, 'Hai'), caption: lt(''), href: '/posts' }] } },
    { id: 'videos', type: 'videos', visible: true, data: { eyebrow: lt(''), heading: lt('Video'), items: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: lt('Debut stream') }] } },
    { id: 'links', type: 'links', visible: true, data: { eyebrow: lt(''), heading: lt('Theo dõi'), items: [{ platform: 'youtube', label: lt('@hibikiduca'), url: 'https://www.youtube.com/@hibikiduca' }, { platform: 'x', label: lt(''), url: 'https://x.com/hibikiduca' }] } },
    { id: 'fanart', type: 'fanart', visible: true, data: { eyebrow: lt('Từ Cuka'), heading: lt('Fanart mới'), count: 6 } },
    { id: 'banner', type: 'banner', visible: true, data: { eyebrow: lt('Hashtag'), text: lt('Vẽ Du Ca thì gắn #DuCaArt nhé'), attribution: lt('R18: #ameoDuCa'), image: null, cta: { label: lt('Đăng fanart'), href: '/upload' } } },
    { id: 'hidden', type: 'about', visible: false, data: { eyebrow: lt(''), heading: lt('Mục bị ẩn'), body: lt('bí mật'), image: null, imageSide: 'left' } },
  ] as HomeSection[]
}

export function publicHome(sections = allSections()): PublicHomeDto {
  return { page: 'intro', sections, images: { [IMG]: resolved(IMG), [IMG2]: resolved(IMG2) }, videos: {}, publishedAt: '2026-10-01T00:00:00.000Z' }
}

export const VID = 'c'.repeat(24)
export const VID_M = 'd'.repeat(24)
export const resolvedVideo = (id: string): SiteVideoDto => ({ src: `http://cdn/${id}/video.mp4?v=1`, mime: 'video/mp4', width: 1920, height: 1080, durationSec: 12 })

/** The full-page landing: one section of every landing type, as the API returns them. */
export function landingSections(): HomeSection[] {
  return [
    {
      id: 'top',
      type: 'heroVideo',
      visible: true,
      data: {
        eyebrow: lt('NIJIGEN Project · VTuber'),
        name: lt('Hibiki Du Ca'),
        subtitle: lt('Nữ thần mê đồ ăn Việt', 'A goddess who loves Vietnamese food'),
        video: { fileId: VID },
        videoMobile: { fileId: VID_M },
        images: [],
        link: { kicker: lt('Đang phát', 'Now playing'), label: lt('Kênh YouTube', 'YouTube channel'), href: 'https://www.youtube.com/@hibikiduca' },
      },
    },
    {
      id: 'new',
      type: 'releases',
      visible: true,
      data: {
        eyebrow: lt('Từ Cuka'),
        heading: lt('Mới phát hành', 'New release'),
        source: 'manual',
        count: 5,
        items: [
          { title: lt('Bài một'), cover: image(IMG, 'Bìa một'), wide: image(IMG2, 'Ngang một'), href: 'https://open.spotify.com/track/1', date: '2026.10.01' },
          { title: lt('Bài hai'), cover: image(IMG2, 'Bìa hai'), wide: null, href: '/posts/p2', date: '' },
          { title: lt('Bài ba'), cover: image(IMG, 'Bìa ba'), wide: null, href: 'https://youtu.be/dQw4w9WgXcQ', date: '' },
          { title: lt('Bài bốn'), cover: image(IMG2, 'Bìa bốn'), wide: null, href: '/posts/p4', date: '' },
        ],
      },
    },
    {
      id: 'looks',
      type: 'spotlight',
      visible: true,
      data: {
        eyebrow: lt('Diện mạo'),
        heading: lt('Những phiên bản của Du Ca'),
        intervalSec: 4,
        items: [
          { name: lt('Model gốc', 'Original model'), caption: lt('08/08/2021'), background: image(IMG, 'Model gốc'), thumb: null, href: '/gioi-thieu' },
          { name: lt('Chibi'), caption: lt('09/08/2024'), background: image(IMG2, 'Chibi'), thumb: null, href: '' },
          { name: lt('Qua nét vẽ của Cuka'), caption: lt(''), background: null, thumb: null, href: '/posts' },
        ],
      },
    },
    { id: 'vibe', type: 'vibe', visible: true, data: { eyebrow: lt('CukaBasement'), text: lt('Một căn hầm ấm áp'), image: null, cta: { label: lt('Giới thiệu về Du Ca'), href: '/gioi-thieu' } } },
    {
      id: 'end',
      type: 'footer',
      visible: true,
      data: { note: lt('Trang của cộng đồng fan'), email: 'lienhe@cuka.test', links: [{ platform: 'youtube', label: lt('@hibikiduca'), url: 'https://www.youtube.com/@hibikiduca' }], copyright: lt('© CukaBasement') },
    },
    { id: 'hidden', type: 'vibe', visible: false, data: { eyebrow: lt(''), text: lt('Bí mật'), image: null, cta: null } },
  ] as HomeSection[]
}

export function publicLanding(sections = landingSections(), videos: Record<string, SiteVideoDto> = { [VID]: resolvedVideo(VID), [VID_M]: resolvedVideo(VID_M) }): PublicHomeDto {
  return {
    page: 'home',
    sections,
    images: { [IMG]: resolved(IMG), [IMG2]: resolved(IMG2), [VID]: resolved(VID), [VID_M]: resolved(VID_M) },
    videos,
    publishedAt: '2026-10-01T00:00:00.000Z',
  }
}

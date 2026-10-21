import type { HomeSection } from '@cuka/shared'
import type { PublicHomeDto, SiteImageDto } from '@/api/types'

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
  return { sections, images: { [IMG]: resolved(IMG), [IMG2]: resolved(IMG2) }, publishedAt: '2026-10-01T00:00:00.000Z' }
}

import type { HomeImage, HomeSection, HomeSectionType, LocalizedText } from '@cuka/shared'
import { inject, type InjectionKey, provide, type Ref } from 'vue'
import type { SiteImageDto, SiteVideoDto } from '@/api/types'

export const lt = (vi = '', en = ''): LocalizedText => ({ vi, en })

/** A fresh section of `type` with placeholder-free defaults (the admin fills in the required texts). */
export function newSection(type: HomeSectionType, id: string): HomeSection {
  const head = { eyebrow: lt(), heading: lt() }
  switch (type) {
    case 'heroVideo':
      return { id, type, visible: true, data: { eyebrow: lt(), name: lt(), subtitle: lt(), video: null, videoMobile: null, images: [], link: null } }
    case 'releases':
      return { id, type, visible: true, data: { eyebrow: lt(), heading: lt('Mới phát hành', 'New release'), source: 'latestFanart', count: 5, items: [] } }
    case 'spotlight':
      return { id, type, visible: true, data: { ...head, intervalSec: 4, items: [] } }
    case 'vibe':
      return { id, type, visible: true, data: { eyebrow: lt(), text: lt(), image: null, cta: { label: lt('Giới thiệu', 'About'), href: '/gioi-thieu' } } }
    case 'footer':
      return { id, type, visible: true, data: { note: lt(), email: '', links: [], copyright: lt('© CukaBasement') } }
    case 'hero':
      return { id, type, visible: true, data: { eyebrow: lt(), title: lt(), subtitle: lt(), images: [], ctas: [] } }
    case 'about':
      return { id, type, visible: true, data: { ...head, body: lt(), image: null, imageSide: 'right' } }
    case 'profile':
      return { id, type, visible: true, data: { ...head, facts: [], image: null } }
    case 'timeline':
      return { id, type, visible: true, data: { ...head, items: [] } }
    case 'gallery':
      return { id, type, visible: true, data: { ...head, layout: 'grid', items: [] } }
    case 'videos':
      return { id, type, visible: true, data: { ...head, items: [] } }
    case 'links':
      return { id, type, visible: true, data: { ...head, items: [] } }
    case 'fanart':
      return { id, type, visible: true, data: { ...head, count: 8 } }
    case 'banner':
      return { id, type, visible: true, data: { eyebrow: lt(), text: lt(), attribution: lt(), image: null, cta: null } }
  }
}

export const newImage = (fileId: string): HomeImage => ({ fileId, alt: lt(), decorative: false })

/** A section id not used in `taken`: `<type>-<4 random chars>`. */
export function freshId(type: string, taken: Set<string>): string {
  for (;;) {
    const id = `${type}-${Math.random().toString(36).slice(2, 6)}`
    if (!taken.has(id)) return id
  }
}

/** The editor state forms need without prop drilling: the editing language and the resolved images. */
export interface EditorContext {
  lang: Ref<'vi' | 'en'>
  images: Ref<Record<string, SiteImageDto>>
  /** Resolved site videos (their posters are in `images`). */
  videos: Ref<Record<string, SiteVideoDto>>
}
const KEY: InjectionKey<EditorContext> = Symbol('site-editor')
export const provideEditor = (ctx: EditorContext) => provide(KEY, ctx)
export function useEditor(): EditorContext {
  const ctx = inject(KEY)
  if (!ctx) throw new Error('useEditor outside the homepage editor')
  return ctx
}

/** The text a section is listed under in the editor. */
export function sectionTitle(s: HomeSection): LocalizedText | null {
  const d = s.data as { heading?: LocalizedText; title?: LocalizedText; name?: LocalizedText; text?: LocalizedText; note?: LocalizedText }
  return d.heading ?? d.title ?? d.name ?? d.text ?? d.note ?? null
}

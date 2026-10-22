/** The colour family of a landing screen: always dark, or the page's own (cream by day, cocoa by night). */
export type PanelTone = 'dark' | 'page'

import type { HomeImage } from '@cuka/shared'
import type { SiteImageDto } from '@/api/types'

/** A picture as the landing panels draw it: resolved URLs plus the alt text in the shown language. */
export interface PanelImage {
  src: string
  srcset?: string
  alt: string
  width?: number | null
  height?: number | null
}

/** A site image resolved for the panels; undefined when none is chosen or it is not ready yet. */
export function panelImage(img: HomeImage | null | undefined, images: Record<string, SiteImageDto>, tx: (t: HomeImage['alt']) => string): PanelImage | undefined {
  const r = img ? images[img.fileId] : undefined
  if (!img || !r) return undefined
  return { src: r.src, srcset: r.srcset, alt: img.decorative ? '' : tx(img.alt), width: r.width, height: r.height }
}

/**
 * The render in `srcset` closest above `minWidth` (the largest when none is that wide): a `<video poster>` takes one
 * URL, so it is picked for the screen instead of the browser.
 */
export function pickFromSrcset(srcset: string, minWidth: number, fallback: string): string {
  const list = srcset
    .split(',')
    .map((part) => {
      const [url, w] = part.trim().split(/\s+/)
      return { url: url ?? '', w: Number.parseInt(w ?? '', 10) || 0 }
    })
    .filter((x) => x.url)
    .sort((a, b) => a.w - b.w)
  if (!list.length) return fallback
  return (list.find((x) => x.w >= minWidth) ?? list[list.length - 1]!).url
}

import { artistTag, type Credit, PLATFORM_LABELS } from '@cuka/shared'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { SHARP_INPUT } from './media'

export interface WatermarkText {
  /** Large variants: "© @handle · Platform" (no " · Platform" for `other`). */
  full: string
  /** thumb_sm: "@handle". */
  short: string
}

/**
 * Credit line burned into display images. A repost credits the artist (handle, else name) and platform; own work
 * (or a post saved before credits existed) credits the uploader's @username.
 */
export function watermarkText(credit: Credit | null | undefined, uploaderUsername: string): WatermarkText {
  if (!credit || credit.isOwnWork) {
    const tag = `@${uploaderUsername}`
    return { full: `© ${tag}`, short: tag }
  }
  const tag = artistTag(credit)
  const label = PLATFORM_LABELS[credit.platform] ?? ''
  return { full: label ? `© ${tag} · ${label}` : `© ${tag}`, short: tag }
}

/**
 * Identifies the burned-in text, stored as `files.watermarkedFor`; '' for clean (unwatermarked) renders. A repost's
 * media is only served once its files carry the hash of the post's current credit.
 */
export function watermarkHash(text: WatermarkText | null): string {
  return text ? createHash('sha1').update(JSON.stringify([text.full, text.short])).digest('hex') : ''
}

const FONT_FAMILY = 'DejaVu Sans, FreeSans, Arial, sans-serif'
/** Average advance of a DejaVu Sans glyph in em, rounded up so the strip is never narrower than the text. */
const EM_PER_CHAR = 0.58
const WEBP = { quality: 82 }

/** Escapes markup and drops characters XML 1.0 forbids (they make librsvg reject the whole SVG). */
export function escapeXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * Draws `text` in white on a semi-transparent dark rounded strip in the bottom-right corner. Font size follows the
 * image width (`full` ≈ width/32, min 12; `small` ≈ width/24, min 9). When the strip is wider than the image it
 * starts at the left edge, so the start of the credit (the handle) stays visible. Output is webp q82 without metadata.
 * An animated input (a "toilet roll" of frames) gets the strip on every frame and stays animated.
 */
export async function applyWatermark(buf: Buffer, text: string, opts: { scale: 'full' | 'small' }): Promise<Buffer> {
  const input = { ...SHARP_INPUT, animated: true }
  const meta = await sharp(buf, input).metadata()
  const width = meta.width ?? 0
  const pages = meta.pages ?? 1
  // One frame's height: the overlay is drawn for one frame and tiled down the roll, once per frame.
  const height = pages > 1 && meta.pageHeight ? meta.pageHeight : (meta.height ?? 0)
  const fontSize = opts.scale === 'full' ? Math.max(12, Math.round(width / 32)) : Math.max(9, Math.round(width / 24))
  const padX = Math.round(fontSize * 0.5)
  const margin = Math.round(fontSize * 0.5)
  const stripH = Math.round(fontSize * 1.5)
  const stripW = Math.ceil([...text].length * fontSize * EM_PER_CHAR) + 2 * padX
  const x = Math.max(0, width - margin - stripW)
  const y = Math.max(0, height - margin - stripH)
  const radius = Math.round(fontSize * 0.3)
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect x="${x}" y="${y}" width="${stripW}" height="${stripH}" rx="${radius}" ry="${radius}" fill="#000000" fill-opacity="0.55"/>
<text x="${x + padX}" y="${y + stripH / 2}" dominant-baseline="central" font-family="${FONT_FAMILY}" font-size="${fontSize}" fill="#ffffff" fill-opacity="0.95">${escapeXml(text)}</text>
</svg>`
  const overlay = pages > 1 ? await sharp(Buffer.from(svg, 'utf8')).png().toBuffer() : Buffer.from(svg, 'utf8')
  // sharp drops EXIF and other metadata unless withMetadata/withExif is called; never call them here.
  return sharp(buf, input)
    .composite([pages > 1 ? { input: overlay, tile: true, gravity: 'northwest' } : { input: overlay, top: 0, left: 0 }])
    .webp(WEBP)
    .toBuffer()
}

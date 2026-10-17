import { artistTag, type Credit, PLATFORM_LABELS } from '@cuka/shared'
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

const FONT_FAMILY = 'DejaVu Sans, FreeSans, Arial, sans-serif'
/** Average advance of a DejaVu Sans glyph in em, rounded up so the strip is never narrower than the text. */
const EM_PER_CHAR = 0.58
const WEBP = { quality: 82 }

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * Draws `text` in white on a semi-transparent dark rounded strip in the bottom-right corner. Font size follows the
 * image width (`full` ≈ width/32, min 12; `small` ≈ width/24, min 9). When the strip is wider than the image it
 * starts at the left edge, so the start of the credit (the handle) stays visible. Output is webp q82 without metadata.
 */
export async function applyWatermark(buf: Buffer, text: string, opts: { scale: 'full' | 'small' }): Promise<Buffer> {
  const meta = await sharp(buf, SHARP_INPUT).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
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
  // sharp drops EXIF and other metadata unless withMetadata/withExif is called; never call them here.
  return sharp(buf, SHARP_INPUT)
    .composite([{ input: Buffer.from(svg, 'utf8'), top: 0, left: 0 }])
    .webp(WEBP)
    .toBuffer()
}

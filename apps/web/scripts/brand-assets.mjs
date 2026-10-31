// Regenerates favicon.ico, apple-touch-icon.png and og-default.png in public/ from public/favicon.svg.
// Run from the repo root: npm -w @cuka/web run brand-assets
// sharp comes from the api workspace; the OG fonts are downloaded once into the OS temp directory.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('..', import.meta.url))
const PUBLIC = join(WEB, 'public')
const sharp = createRequire(join(WEB, '../api/package.json'))('sharp')

const COCOA = '#1f1f1f'
const CREAM = '#ffffff'
const PINK = '#e8577a'
const TAGLINE = 'Vẽ thật. Ghi công <span foreground="#ff8fa2">thật.</span>'

const FONTS = {
  'Fraunces.ttf': 'https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf',
  'BeVietnamPro-Medium.ttf': 'https://github.com/google/fonts/raw/main/ofl/bevietnampro/BeVietnamPro-Medium.ttf',
}

async function fontFiles() {
  const dir = join(tmpdir(), 'cuka-brand-fonts')
  mkdirSync(dir, { recursive: true })
  for (const [name, url] of Object.entries(FONTS)) {
    const path = join(dir, name)
    if (existsSync(path)) continue
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`)
    writeFileSync(path, Buffer.from(await res.arrayBuffer()))
  }
  return { fraunces: join(dir, 'Fraunces.ttf'), vietnam: join(dir, 'BeVietnamPro-Medium.ttf') }
}

// The mark's paths on its 100-unit grid, in the given colours.
const mark = (fg, dot) => `<path d="M69.9 33.3A26 26 0 1 0 69.9 66.7" fill="none" stroke="${fg}" stroke-width="12"/>
<path d="M36 52H44V58H52V64H60V70H36Z" fill="${fg}"/>
<circle cx="72" cy="50" r="6.5" fill="${dot}"/>`
const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`)
const png = (input, size) => sharp(input, { density: 576 }).resize(size, size).png().toBuffer()

// An .ico is a directory of embedded PNGs.
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i
    header.writeUInt8(size, e)
    header.writeUInt8(size, e + 1)
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(data.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...images.map((i) => i.data)])
}

const favicon = readFileSync(join(PUBLIC, 'favicon.svg'))
const icons = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(favicon, size) })))
writeFileSync(join(PUBLIC, 'favicon.ico'), ico(icons))

// iOS rounds the corners itself, so the touch icon is full-bleed with the mark inset.
const touch = svg(`<rect width="100" height="100" fill="${COCOA}"/><g transform="translate(9 9) scale(0.82)">${mark(CREAM, PINK)}</g>`)
writeFileSync(join(PUBLIC, 'apple-touch-icon.png'), await png(touch, 180))

const fonts = await fontFiles()
const text = (markup, font, fontfile) => sharp({ text: { text: markup, font, fontfile, rgba: true, dpi: 72 } }).png().toBuffer()
const tile = await png(svg(`<rect width="100" height="100" rx="24" fill="${CREAM}"/>${mark(COCOA, PINK)}`), 150)
const word = await text(`<span foreground="${CREAM}" letter_spacing="-2048">CukaBasement</span>`, 'Fraunces 112 @wght=600,opsz=72', fonts.fraunces)
const tag = await text(`<span foreground="#e6dcd5">${TAGLINE}</span>`, 'Be Vietnam Pro Medium 40', fonts.vietnam)
await sharp({ create: { width: 1200, height: 630, channels: 4, background: COCOA } })
  .composite([
    { input: tile, left: 96, top: 120 },
    { input: word, left: 92, top: 312 },
    { input: tag, left: 98, top: 468 },
  ])
  .flatten({ background: COCOA })
  .png({ compressionLevel: 9 })
  .toFile(join(PUBLIC, 'og-default.png'))

console.log('favicon.ico, apple-touch-icon.png, og-default.png written to apps/web/public')

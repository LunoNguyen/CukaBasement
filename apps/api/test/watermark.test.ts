import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { applyWatermark, watermarkText } from '../src/jobs/handlers/watermark'

const repost = {
  isOwnWork: false,
  artistName: 'Ruri',
  artistHandle: '@_rurisuisen',
  platform: 'x' as const,
  sourceUrl: 'https://x.com/_rurisuisen/status/1',
  permissionNote: '',
}

/** Mean absolute per-channel difference of two same-size images over a region. */
async function regionDiff(a: Buffer, b: Buffer, region: { left: number; top: number; width: number; height: number }): Promise<number> {
  const raw = (buf: Buffer) => sharp(buf).removeAlpha().extract(region).raw().toBuffer()
  const [x, y] = await Promise.all([raw(a), raw(b)])
  let sum = 0
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i]! - y[i]!)
  return sum / x.length
}

describe('watermarkText', () => {
  it('repost: "© @handle · Platform" and short "@handle"', () => {
    expect(watermarkText(repost, 'uploader')).toEqual({ full: '© @_rurisuisen · X', short: '@_rurisuisen' })
    expect(watermarkText({ ...repost, artistHandle: 'funo_yun' }, 'uploader')).toEqual({ full: '© @funo_yun · X', short: '@funo_yun' })
    expect(watermarkText({ ...repost, artistHandle: 'Suiden', platform: 'pixiv' }, 'uploader').full).toBe('© @Suiden · pixiv')
    expect(watermarkText({ ...repost, artistHandle: 'SgtDuky', platform: 'deviantart' }, 'uploader').full).toBe('© @SgtDuky · DeviantArt')
  })

  it('handle falls back to the artist name', () => {
    expect(watermarkText({ ...repost, artistHandle: '' }, 'uploader')).toEqual({ full: '© Ruri · X', short: 'Ruri' })
    expect(watermarkText({ ...repost, artistHandle: '  @ ' }, 'uploader').short).toBe('Ruri')
  })

  it("platform 'other' has no label", () => {
    expect(watermarkText({ ...repost, platform: 'other' }, 'uploader')).toEqual({ full: '© @_rurisuisen', short: '@_rurisuisen' })
  })

  it("own work credits the uploader's @username, whatever else the credit says", () => {
    expect(watermarkText({ ...repost, isOwnWork: true }, 'du_ca')).toEqual({ full: '© @du_ca', short: '@du_ca' })
    expect(watermarkText({ isOwnWork: true, artistName: '', artistHandle: '', platform: 'other', sourceUrl: '', permissionNote: '' }, 'du_ca').full).toBe('© @du_ca')
  })
})

describe('applyWatermark', () => {
  const W = 1200
  const H = 800
  const source = () => sharp({ create: { width: W, height: H, channels: 3, background: '#88aacc' } }).png().toBuffer()

  it('changes the bottom-right corner and leaves the top-left alone; webp of the same size', async () => {
    const input = await source()
    const out = await applyWatermark(input, '© @_rurisuisen · X', { scale: 'full' })
    const meta = await sharp(out).metadata()
    expect(meta).toMatchObject({ format: 'webp', width: W, height: H })
    expect(await regionDiff(input, out, { left: W - 300, top: H - 60, width: 300, height: 60 })).toBeGreaterThan(10)
    expect(await regionDiff(input, out, { left: 0, top: 0, width: 300, height: 200 })).toBeLessThan(2)
  })

  it('small scale also marks the corner of a 360px thumbnail', async () => {
    const input = await sharp({ create: { width: 360, height: 270, channels: 3, background: '#88aacc' } }).png().toBuffer()
    const out = await applyWatermark(input, '@_rurisuisen', { scale: 'small' })
    expect(await sharp(out).metadata()).toMatchObject({ format: 'webp', width: 360, height: 270 })
    expect(await regionDiff(input, out, { left: 360 - 100, top: 270 - 25, width: 100, height: 25 })).toBeGreaterThan(10)
    expect(await regionDiff(input, out, { left: 0, top: 0, width: 100, height: 100 })).toBeLessThan(2)
  })

  it('output carries no EXIF', async () => {
    const input = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#3a7' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'someone' } })
      .toBuffer()
    expect((await sharp(input).metadata()).exif).toBeDefined()
    const out = await applyWatermark(input, '© @x', { scale: 'full' })
    expect((await sharp(out).metadata()).exif).toBeUndefined()
  })

  it('text with <&>"\' is escaped and still renders', async () => {
    const input = await source()
    const out = await applyWatermark(input, `© @<script>&"'</script>`, { scale: 'full' })
    expect((await sharp(out).metadata()).format).toBe('webp')
    expect(await regionDiff(input, out, { left: W - 200, top: H - 50, width: 200, height: 50 })).toBeGreaterThan(5)
  })

  it('a tiny image is not enlarged and does not throw', async () => {
    const input = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#fff' } }).png().toBuffer()
    const out = await applyWatermark(input, '© @a_very_long_handle_name · DeviantArt', { scale: 'full' })
    expect(await sharp(out).metadata()).toMatchObject({ width: 64, height: 48 })
  })
})

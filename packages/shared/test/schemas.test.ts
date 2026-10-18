import { describe, expect, it } from 'vitest'
import {
  CREDIT_PLATFORMS,
  creditSchema,
  cropRectSchema,
  LIMITS,
  legacySocialLinks,
  SOCIAL_PLATFORM_LABELS,
  SOCIAL_PLATFORMS,
  socialLinkSchema,
  ERROR_CODES,
  MOD_ACTIONS,
  PLATFORM_LABELS,
  adminSettingsSchema,
  createPostSchema,
  cursorQuerySchema,
  registerSchema,
  updatePostSchema,
  updateProfileSchema,
  updateSettingsSchema,
} from '../src'

const validPost = {
  type: 'illustration',
  title: 'Hibiki',
  rating: 'all',
  tags: ['a'],
  aiDeclaration: true,
  credit: { isOwnWork: true },
  files: [{ fileId: 'f1', position: 0, isCover: true }],
}
const repostCredit = {
  isOwnWork: false,
  artistName: 'Ruri',
  artistHandle: '@_rurisuisen',
  platform: 'x',
  sourceUrl: 'https://x.com/_rurisuisen/status/1890567100382544149',
  permissionNote: '',
}
const creditCode = (r: { success: boolean; error?: { issues: Array<{ code: string; params?: Record<string, unknown> }> } }) =>
  r.error?.issues.find((i) => i.code === 'custom')?.params?.code
const validReg = {
  email: 'a@b.co',
  password: 'password1',
  username: 'du_ca',
  displayName: 'Du Ca',
}

describe('schemas', () => {
  it('accepts valid post and applies defaults', () => {
    const r = createPostSchema.parse(validPost)
    expect(r.description).toBe('')
    expect(r).not.toHaveProperty('sourceCredit')
    expect(r.credit).toEqual({ isOwnWork: true, artistName: '', artistHandle: '', platform: 'other', sourceUrl: '', permissionNote: '' })
  })
  it('createPost requires credit; updatePost leaves it optional', () => {
    const { credit: _, ...noCredit } = validPost
    expect(createPostSchema.safeParse(noCredit).success).toBe(false)
    expect(updatePostSchema.safeParse({ title: 'x' }).success).toBe(true)
    expect(updatePostSchema.parse({ credit: repostCredit }).credit).toEqual(repostCredit)
  })
  it('repost credit needs artistName, platform and sourceUrl (CREDIT_REQUIRED)', () => {
    expect(createPostSchema.safeParse({ ...validPost, credit: repostCredit }).success).toBe(true)
    for (const missing of ['artistName', 'platform', 'sourceUrl'] as const) {
      const { [missing]: _, ...credit } = repostCredit
      const r = createPostSchema.safeParse({ ...validPost, credit })
      expect(r.success, missing).toBe(false)
      expect(creditCode(r), missing).toBe('CREDIT_REQUIRED')
    }
    const blank = creditSchema.safeParse({ ...repostCredit, artistName: '  ', sourceUrl: '' })
    expect(blank.success).toBe(false)
    expect(creditCode(blank)).toBe('CREDIT_REQUIRED')
    expect(updatePostSchema.safeParse({ credit: { isOwnWork: false } }).success).toBe(false)
  })
  it('own work passes without artist fields', () => {
    expect(creditSchema.safeParse({ isOwnWork: true }).success).toBe(true)
    expect(creditSchema.safeParse({ isOwnWork: true, artistName: '', sourceUrl: '' }).success).toBe(true)
  })
  it('credit field limits and url/platform checks', () => {
    expect(creditSchema.safeParse({ ...repostCredit, artistName: 'a'.repeat(101) }).success).toBe(false)
    expect(creditSchema.safeParse({ ...repostCredit, artistHandle: 'a'.repeat(101) }).success).toBe(false)
    expect(creditSchema.safeParse({ ...repostCredit, permissionNote: 'a'.repeat(301) }).success).toBe(false)
    expect(creditSchema.safeParse({ ...repostCredit, sourceUrl: `https://x.com/${'a'.repeat(500)}` }).success).toBe(false)
    expect(creditSchema.safeParse({ ...repostCredit, sourceUrl: 'not a url' }).success).toBe(false)
    expect(creditSchema.safeParse({ ...repostCredit, sourceUrl: 'javascript:alert(1)' }).success).toBe(false)
    expect(creditSchema.safeParse({ ...repostCredit, platform: 'tumblr' }).success).toBe(false)
  })
  it('credit strings reject XML-invalid control characters (tab/newline allowed in the note)', () => {
    for (const field of ['artistName', 'artistHandle', 'permissionNote'] as const) {
      expect(creditSchema.safeParse({ ...repostCredit, [field]: 'a\u0001b' }).success, field).toBe(false)
      expect(creditSchema.safeParse({ ...repostCredit, [field]: 'a\uFFFEb' }).success, field).toBe(false)
    }
    expect(creditSchema.safeParse({ ...repostCredit, sourceUrl: 'https://x.com/a\u0001b' }).success).toBe(false)
    expect(creditSchema.safeParse({ ...repostCredit, permissionNote: 'line one\nline\ttwo' }).success).toBe(true)
  })
  it('exports credit platforms, labels, error code and mod action', () => {
    // Additive only: the original seven stay valid, `other` stays last.
    expect(CREDIT_PLATFORMS).toEqual(['x', 'facebook', 'pixiv', 'deviantart', 'instagram', 'youtube', 'tiktok', 'threads', 'vgen', 'bluesky', 'twitch', 'kofi', 'other'])
    expect(PLATFORM_LABELS).toEqual({
      x: 'X',
      facebook: 'Facebook',
      pixiv: 'pixiv',
      deviantart: 'DeviantArt',
      instagram: 'Instagram',
      youtube: 'YouTube',
      tiktok: 'TikTok',
      threads: 'Threads',
      vgen: 'VGen',
      bluesky: 'Bluesky',
      twitch: 'Twitch',
      kofi: 'Ko-fi',
      other: '',
    })
    expect(ERROR_CODES).toContain('CREDIT_REQUIRED')
    expect(MOD_ACTIONS).toContain('update_credit')
  })
  it('requires aiDeclaration true', () =>
    expect(createPostSchema.safeParse({ ...validPost, aiDeclaration: false }).success).toBe(false))
  it('limits tags to 10', () =>
    expect(createPostSchema.safeParse({ ...validPost, tags: Array(11).fill('a') }).success).toBe(false))
  it('requires at least one file', () =>
    expect(createPostSchema.safeParse({ ...validPost, files: [] }).success).toBe(false))
  it('updatePost is partial but aiDeclaration literal true', () => {
    expect(updatePostSchema.safeParse({ title: 'x' }).success).toBe(true)
    expect(updatePostSchema.safeParse({ aiDeclaration: false }).success).toBe(false)
    expect(updatePostSchema.parse({ title: 'x' })).toEqual({ title: 'x' })
  })
  it('validates register', () => {
    expect(registerSchema.safeParse(validReg).success).toBe(true)
    expect(registerSchema.safeParse({ ...validReg, username: 'Du Ca' }).success).toBe(false)
    expect(registerSchema.safeParse({ ...validReg, password: 'short' }).success).toBe(false)
  })
  it('caps admin maxFileBytes', () => {
    expect(adminSettingsSchema.safeParse({ maxFileBytes: 52428800 }).success).toBe(true)
    expect(adminSettingsSchema.safeParse({ maxFileBytes: 52428801 }).success).toBe(false)
  })
  it('validates birthDate', () => {
    expect(updateSettingsSchema.safeParse({ birthDate: '2999-01-01' }).success).toBe(false)
    expect(updateSettingsSchema.safeParse({ birthDate: '1850-01-01' }).success).toBe(false)
    expect(updateSettingsSchema.safeParse({ birthDate: '2000-02-30' }).success).toBe(false)
    expect(updateSettingsSchema.safeParse({ birthDate: '2000-01-31' }).success).toBe(true)
  })
  it('profile links: http(s) urls, a label only for other, at most 10', () => {
    const ok = (links: unknown) => updateProfileSchema.safeParse({ links }).success
    expect(ok([])).toBe(true)
    expect(ok([{ platform: 'x', url: 'https://x.com/a' }, { platform: 'vgen', url: 'http://vgen.co/a' }])).toBe(true)
    expect(ok([{ platform: 'x', url: 'nope' }])).toBe(false)
    expect(ok([{ platform: 'x', url: '' }])).toBe(false)
    expect(ok([{ platform: 'x', url: 'javascript:alert(1)' }])).toBe(false)
    expect(ok([{ platform: 'x', url: 'ftp://x.com/a' }])).toBe(false)
    expect(ok([{ platform: 'tumblr', url: 'https://t.com/a' }])).toBe(false)
    expect(ok([{ platform: 'x', url: 'https://x.com/' + 'a'.repeat(LIMITS.socialLinkUrlMax - 14) }])).toBe(true)
    expect(ok([{ platform: 'x', url: 'https://x.com/' + 'a'.repeat(LIMITS.socialLinkUrlMax - 13) }])).toBe(false)
    expect(ok(Array.from({ length: LIMITS.socialLinksMax }, () => ({ platform: 'x', url: 'https://x.com/a' })))).toBe(true)
    expect(ok(Array.from({ length: LIMITS.socialLinksMax + 1 }, () => ({ platform: 'x', url: 'https://x.com/a' })))).toBe(false)
  })
  it('crop rects: fractions 0..1, positive size, inside the image; nullable in the profile body', () => {
    const ok = (r: unknown) => cropRectSchema.safeParse(r).success
    expect(ok({ x: 0, y: 0, w: 1, h: 1 })).toBe(true)
    expect(ok({ x: 0.25, y: 0.1, w: 0.75, h: 0.2 })).toBe(true)
    // float rounding slack
    expect(ok({ x: 0.1, y: 0.2, w: 0.9000000001, h: 0.8 })).toBe(true)
    expect(ok({ x: 0.5, y: 0, w: 0.6, h: 1 })).toBe(false)
    expect(ok({ x: 0, y: 0.5, w: 1, h: 0.51 })).toBe(false)
    expect(ok({ x: 0, y: 0, w: 0, h: 1 })).toBe(false)
    expect(ok({ x: 0, y: 0, w: 1, h: -0.1 })).toBe(false)
    expect(ok({ x: -0.1, y: 0, w: 0.5, h: 0.5 })).toBe(false)
    expect(ok({ x: 1.1, y: 0, w: 0.5, h: 0.5 })).toBe(false)
    expect(ok({ x: Number.NaN, y: 0, w: 0.5, h: 0.5 })).toBe(false)
    expect(ok({ x: Infinity, y: 0, w: 0.5, h: 0.5 })).toBe(false)
    expect(ok({ x: '0', y: 0, w: 0.5, h: 0.5 })).toBe(false)
    expect(ok({ x: 0, y: 0, w: 0.5 })).toBe(false)
    expect(ok({ x: 0, y: 0, w: 0.5, h: 0.5, extra: 1 })).toBe(false)
    expect(updateProfileSchema.safeParse({ bannerCrop: null }).success).toBe(true)
    expect(updateProfileSchema.safeParse({ avatarFileId: 'f', avatarCrop: { x: 0, y: 0, w: 0.5, h: 0.5 } }).success).toBe(true)
    expect(updateProfileSchema.safeParse({ bannerCrop: { x: 0.9, y: 0, w: 0.5, h: 0.5 } }).success).toBe(false)
  })
  it('profile links: other needs a 1..40 char label (LABEL_REQUIRED); other platforms drop theirs', () => {
    const missing = socialLinkSchema.safeParse({ platform: 'other', url: 'https://a.b', label: '   ' })
    expect(missing.success).toBe(false)
    expect(missing.error!.issues[0]).toMatchObject({ path: ['label'], params: { code: 'LABEL_REQUIRED' } })
    expect(socialLinkSchema.safeParse({ platform: 'other', url: 'https://a.b' }).success).toBe(false)
    expect(socialLinkSchema.safeParse({ platform: 'other', url: 'https://a.b', label: 'a'.repeat(LIMITS.socialLinkLabelMax + 1) }).success).toBe(false)
    expect(socialLinkSchema.parse({ platform: 'other', url: 'https://a.b', label: ' Shop ' })).toEqual({ platform: 'other', url: 'https://a.b', label: 'Shop' })
    expect(socialLinkSchema.parse({ platform: 'x', url: 'https://x.com/a', label: 'ignored' })).toEqual({ platform: 'x', url: 'https://x.com/a' })
  })
  it('legacy fixed links convert in their old order, skipping empty and non-http(s) values', () => {
    expect(legacySocialLinks(undefined)).toEqual([])
    expect(legacySocialLinks({ pixiv: 'https://pixiv.net/u/1', x: ' https://x.com/a ', facebook: '', youtube: 'javascript:alert(1)' })).toEqual([
      { platform: 'x', url: 'https://x.com/a' },
      { platform: 'pixiv', url: 'https://pixiv.net/u/1' },
    ])
  })
  it('social platforms and labels', () => {
    expect(SOCIAL_PLATFORMS).toEqual(['x', 'facebook', 'youtube', 'pixiv', 'tiktok', 'threads', 'vgen', 'instagram', 'bluesky', 'twitch', 'kofi', 'deviantart', 'other'])
    expect(SOCIAL_PLATFORM_LABELS.kofi).toBe('Ko-fi')
    expect(SOCIAL_PLATFORM_LABELS.other).toBe('')
  })
  it('cursor query coerces limit with default', () => {
    expect(cursorQuerySchema.parse({}).limit).toBe(30)
    expect(cursorQuerySchema.parse({ limit: '50' }).limit).toBe(50)
    expect(cursorQuerySchema.safeParse({ limit: '101' }).success).toBe(false)
  })
})

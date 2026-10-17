import { describe, expect, it } from 'vitest'
import {
  CREDIT_PLATFORMS,
  creditSchema,
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
  it('exports credit platforms, labels, error code and mod action', () => {
    expect(CREDIT_PLATFORMS).toEqual(['x', 'facebook', 'pixiv', 'deviantart', 'instagram', 'youtube', 'other'])
    expect(PLATFORM_LABELS).toEqual({ x: 'X', facebook: 'Facebook', pixiv: 'pixiv', deviantart: 'DeviantArt', instagram: 'Instagram', youtube: 'YouTube', other: '' })
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
  it('social links accept url or empty', () => {
    expect(updateProfileSchema.safeParse({ socialLinks: { x: '' } }).success).toBe(true)
    expect(updateProfileSchema.safeParse({ socialLinks: { x: 'https://x.com/a' } }).success).toBe(true)
    expect(updateProfileSchema.safeParse({ socialLinks: { x: 'nope' } }).success).toBe(false)
  })
  it('cursor query coerces limit with default', () => {
    expect(cursorQuerySchema.parse({}).limit).toBe(30)
    expect(cursorQuerySchema.parse({ limit: '50' }).limit).toBe(50)
    expect(cursorQuerySchema.safeParse({ limit: '101' }).success).toBe(false)
  })
})

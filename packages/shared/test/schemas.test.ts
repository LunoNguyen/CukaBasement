import { describe, expect, it } from 'vitest'
import {
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
  files: [{ fileId: 'f1', position: 0, isCover: true }],
}
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
    expect(r.sourceCredit).toBe('')
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

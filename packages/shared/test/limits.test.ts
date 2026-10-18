import { describe, expect, it } from 'vitest'
import { LIMITS, adminStatusSchema, createReportSchema, creditSchema, rejectSchema } from '../src'

const repost = { isOwnWork: false, artistName: 'a', artistHandle: '', platform: 'x', sourceUrl: 'https://x.com/a', permissionNote: '' } as const

describe('text limits', () => {
  it('match the schema values', () => {
    expect(LIMITS).toMatchObject({
      rejectReasonMax: 500,
      reportDetailMax: 1000,
      adminNoteMax: 500,
      creditArtistNameMax: 100,
      creditArtistHandleMax: 100,
      creditSourceUrlMax: 500,
      creditPermissionNoteMax: 300,
    })
  })

  it('drive the schemas', () => {
    const at = (n: number) => 'a'.repeat(n)
    expect(rejectSchema.safeParse({ reason: at(LIMITS.rejectReasonMax) }).success).toBe(true)
    expect(rejectSchema.safeParse({ reason: at(LIMITS.rejectReasonMax + 1) }).success).toBe(false)
    expect(createReportSchema.safeParse({ reason: 'other', detail: at(LIMITS.reportDetailMax + 1) }).success).toBe(false)
    expect(adminStatusSchema.safeParse({ status: 'active', note: at(LIMITS.adminNoteMax + 1) }).success).toBe(false)
    expect(creditSchema.safeParse({ ...repost, artistName: at(LIMITS.creditArtistNameMax + 1) }).success).toBe(false)
    expect(creditSchema.safeParse({ ...repost, artistHandle: at(LIMITS.creditArtistHandleMax + 1) }).success).toBe(false)
    expect(creditSchema.safeParse({ ...repost, permissionNote: at(LIMITS.creditPermissionNoteMax + 1) }).success).toBe(false)
    const url = 'https://x.com/' + at(LIMITS.creditSourceUrlMax - 14)
    expect(url).toHaveLength(LIMITS.creditSourceUrlMax)
    expect(creditSchema.safeParse({ ...repost, sourceUrl: url }).success).toBe(true)
    expect(creditSchema.safeParse({ ...repost, sourceUrl: url + 'a' }).success).toBe(false)
  })
})

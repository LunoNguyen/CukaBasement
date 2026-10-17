import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { cursorFilter, decodeCursor, encodeCursor, pageOf } from '../src/common/cursor'

describe('cursor', () => {
  const d = new Date('2026-10-17T10:00:00.000Z')
  const id = new Types.ObjectId().toHexString()

  it('invalid cursor decodes to null', () => {
    expect(decodeCursor('garbage')).toBeNull()
    expect(decodeCursor(undefined)).toBeNull()
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor(Buffer.from('{"createdAt":"x","id":"y"}').toString('base64url'))).toBeNull()
  })

  it('round-trips', () => {
    const c = decodeCursor(encodeCursor({ createdAt: d, id }))!
    expect(c.id.toHexString()).toBe(id)
    expect(c.createdAt.toISOString()).toBe(d.toISOString())
  })

  it('cursorFilter matches (createdAt desc, _id desc)', () => {
    const c = decodeCursor(encodeCursor({ createdAt: d, id }))!
    expect(cursorFilter(c)).toEqual({
      $or: [{ createdAt: { $lt: d } }, { createdAt: d, _id: { $lt: c.id } }],
    })
  })

  it('pageOf trims the extra doc and sets nextCursor from the last item', () => {
    const docs = [0, 1, 2].map((i) => ({ _id: new Types.ObjectId(), createdAt: new Date(d.getTime() - i) }))
    const page = pageOf(docs, 2)
    expect(page.items).toHaveLength(2)
    const next = decodeCursor(page.nextCursor!)!
    expect(next.id.toHexString()).toBe(docs[1]!._id.toHexString())
    expect(pageOf(docs, 3)).toEqual({ items: docs, nextCursor: null })
  })
})

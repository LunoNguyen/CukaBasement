import { Types } from 'mongoose'

export interface Cursor {
  createdAt: Date
  id: Types.ObjectId
}

export function encodeCursor(c: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: c.createdAt.toISOString(), id: c.id })).toString('base64url')
}

/** Returns null for a missing or malformed cursor; never throws. */
export function decodeCursor(s?: string): Cursor | null {
  if (!s) return null
  try {
    const v: unknown = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))
    if (typeof v !== 'object' || v === null) return null
    const { createdAt, id } = v as { createdAt?: unknown; id?: unknown }
    if (typeof createdAt !== 'string' || typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) return null
    const date = new Date(createdAt)
    if (Number.isNaN(date.getTime())) return null
    return { createdAt: date, id: new Types.ObjectId(id) }
  } catch {
    return null
  }
}

/** Filter for the page after `c` in (createdAt desc, _id desc) order. */
export function cursorFilter(c: Cursor) {
  return { $or: [{ createdAt: { $lt: c.createdAt } }, { createdAt: c.createdAt, _id: { $lt: c.id } }] }
}

/** `docs` must come from a query with `limit + 1`; the extra doc only signals that another page exists. */
export function pageOf<T extends { _id: { toString(): string }; createdAt: Date }>(
  docs: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  if (docs.length <= limit) return { items: docs, nextCursor: null }
  const items = docs.slice(0, limit)
  const last = items[items.length - 1]!
  return { items, nextCursor: encodeCursor({ createdAt: last.createdAt, id: last._id.toString() }) }
}

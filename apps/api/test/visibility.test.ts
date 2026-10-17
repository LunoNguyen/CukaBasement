import { REVIEW_STATUSES, RATINGS, type ReviewStatus, type Rating, VISIBILITIES, type Visibility } from '@cuka/shared'
import { Types } from 'mongoose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Viewer } from '../src/auth/viewer'
import { canViewPost, isStaff, type PostContext, visiblePostsFilter } from '../src/posts/visibility'
import { createTestHarness, type Harness } from './harness'

const authorId = new Types.ObjectId()

const viewer = (over: Partial<Viewer>): Viewer => ({
  id: new Types.ObjectId().toString(),
  role: 'user',
  status: 'active',
  emailVerified: true,
  isAdult: false,
  showR18: false,
  ...over,
})

const anon = null
const other = viewer({})
const owner = viewer({ id: authorId.toString() })
const mod = viewer({ role: 'moderator' })
const admin = viewer({ role: 'admin' })
const adultR18 = viewer({ isAdult: true, showR18: true })
const VIEWERS: Array<[string, Viewer | null]> = [
  ['anon', anon],
  ['other', other],
  ['owner', owner],
  ['mod', mod],
  ['admin', admin],
  ['adultR18', adultR18],
]

interface PostOpts {
  review?: ReviewStatus
  visibility?: Visibility
  rating?: Rating
  deleted?: boolean
}

function post(o: PostOpts = {}) {
  return {
    _id: new Types.ObjectId(),
    authorId,
    review: { status: o.review ?? 'approved', reason: null },
    visibility: o.visibility ?? 'public',
    rating: o.rating ?? 'all',
    deletedAt: o.deleted ? new Date() : null,
    createdAt: new Date(),
  }
}

/** Independent statement of spec §5.3, used as the oracle for the table-driven test. */
function expected(v: Viewer | null, ctx: PostContext, o: Required<PostOpts>): boolean {
  if (o.deleted) return false
  const staff = v?.role === 'moderator' || v?.role === 'admin'
  const isOwner = v?.id === authorId.toString()
  if (ctx === 'feed') {
    const r18Ok = !!v && v.isAdult && v.showR18
    return o.review === 'approved' && o.visibility === 'public' && (o.rating === 'all' || r18Ok)
  }
  if (staff || isOwner) return true
  return o.review !== 'rejected' && o.visibility === 'public'
}

describe('visibility rules', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  afterAll(() => h.close())

  /** Real MongoDB semantics: insert the post into a scratch collection and count matches of the filter. */
  async function matches(filter: object, doc: ReturnType<typeof post>): Promise<boolean> {
    const col = h.db.collection('_test')
    await col.deleteMany({})
    await col.insertOne(doc)
    return (await col.countDocuments(filter)) === 1
  }

  it('spot checks from the brief', async () => {
    expect(await matches(visiblePostsFilter(null, 'feed'), post({ review: 'pending' }))).toBe(false)
    expect(await matches(visiblePostsFilter(null, 'direct'), post({ review: 'pending' }))).toBe(true)
    expect(await matches(visiblePostsFilter(null, 'direct'), post({ review: 'rejected' }))).toBe(false)
    expect(await matches(visiblePostsFilter(adultR18, 'feed'), post({ review: 'approved', rating: 'r18' }))).toBe(true)
    expect(await matches(visiblePostsFilter(other, 'feed'), post({ review: 'approved', rating: 'r18' }))).toBe(false)
    expect(canViewPost(owner, post({ visibility: 'hidden_by_reports' }))).toBe(true)
    expect(canViewPost(other, post({ visibility: 'hidden_by_reports' }))).toBe(false)
  })

  it('table: review × visibility × rating × deleted × viewer × context matches spec §5.3', async () => {
    const col = h.db.collection('_test')
    await col.deleteMany({})
    const cases: Array<{ key: string; opts: Required<PostOpts>; doc: ReturnType<typeof post> }> = []
    for (const review of REVIEW_STATUSES)
      for (const visibility of VISIBILITIES)
        for (const rating of RATINGS)
          for (const deleted of [false, true]) {
            const opts = { review, visibility, rating, deleted }
            cases.push({ key: JSON.stringify(opts), opts, doc: post(opts) })
          }
    await col.insertMany(cases.map((c) => ({ ...c.doc, key: c.key })))

    const mismatches: string[] = []
    for (const [name, v] of VIEWERS) {
      for (const ctx of ['feed', 'direct'] as const) {
        const found = new Set((await col.find(visiblePostsFilter(v, ctx) as Record<string, unknown>).toArray()).map((d) => d.key as string))
        for (const c of cases) {
          const want = expected(v, ctx, c.opts)
          if (found.has(c.key) !== want) mismatches.push(`${name}/${ctx} ${c.key}: got ${!want} want ${want}`)
          if (ctx === 'direct' && canViewPost(v, c.doc) !== want) mismatches.push(`canViewPost ${name} ${c.key}: want ${want}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  it('isStaff is true only for moderator and admin', () => {
    expect([null, other, owner, mod, admin, adultR18].map(isStaff)).toEqual([false, false, false, true, true, false])
  })
})

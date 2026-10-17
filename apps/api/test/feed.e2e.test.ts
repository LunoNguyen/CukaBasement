import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestHarness, createUser, type Harness } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

function yearsAgo(n: number): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  return d.toISOString().slice(0, 10)
}

describe('feed, search and tags', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  let seq = 0
  /** Inserts a post document directly (matching the Post schema); createdAt increases with each call. */
  async function seed(authorId: string, over: Record<string, unknown> = {}): Promise<string> {
    const _id = new Types.ObjectId()
    const createdAt = new Date(Date.UTC(2026, 0, 1) + ++seq * 1000)
    await h.db.collection('posts').insertOne({
      _id,
      authorId: new Types.ObjectId(authorId),
      type: 'illustration',
      title: 'Seed post',
      description: '',
      rating: 'all',
      visibility: 'public',
      review: { status: 'approved', reason: null, by: null, at: null },
      aiDeclaration: true,
      credit: { isOwnWork: true, artistName: '', artistHandle: '', platform: 'other', sourceUrl: '', permissionNote: '' },
      files: [{ fileId: new Types.ObjectId(), position: 0, isCover: true }],
      tags: [],
      counts: { likes: 0, bookmarks: 0, comments: 0, views: 0 },
      reportCounts: { total: 0, ai_art: 0 },
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
      ...over,
    })
    return _id.toString()
  }
  const ids = (res: { body: { items: Array<{ id: string }> } }) => res.body.items.map((i) => i.id)

  it('home shows only approved+public, newest first, 30 per page with working nextCursor', async () => {
    const u = await createUser(h)
    const all: string[] = []
    for (let i = 0; i < 35; i++) all.push(await seed(u.id))
    const hidden = await seed(u.id, { review: { status: 'pending', reason: null, by: null, at: null } })
    const priv = await seed(u.id, { visibility: 'private' })
    const newestFirst = [...all].reverse()

    const p1 = await h.http().get('/api/feed/home')
    expect(p1.status).toBe(200)
    expect(ids(p1)).toEqual(newestFirst.slice(0, 30))
    expect(ids(p1)).not.toContain(hidden)
    expect(ids(p1)).not.toContain(priv)
    expect(typeof p1.body.nextCursor).toBe('string')

    const p2 = await h.http().get('/api/feed/home').query({ cursor: p1.body.nextCursor })
    expect(ids(p2)).toEqual(newestFirst.slice(30))
    expect(p2.body.nextCursor).toBeNull()
  })

  it('home hides r18 from anonymous and from adult without showR18; shows to eligible', async () => {
    const author = await createUser(h)
    const r18 = await seed(author.id, { rating: 'r18' })
    const safe = await seed(author.id)
    const adultOff = await createUser(h, { birthDate: yearsAgo(30), showR18: false })
    const adultOn = await createUser(h, { birthDate: yearsAgo(30), showR18: true })

    expect(ids(await h.http().get('/api/feed/home'))).toEqual([safe])
    expect(ids(await h.http().get('/api/feed/home').set(auth(adultOff.token)))).toEqual([safe])
    expect(ids(await h.http().get('/api/feed/home').set(auth(adultOn.token)))).toEqual([safe, r18])
  })

  it('home excludes hidden_by_reports and deleted posts', async () => {
    const u = await createUser(h)
    const ok = await seed(u.id)
    await seed(u.id, { review: { status: 'hidden_by_reports', reason: null, by: null, at: null } })
    await seed(u.id, { deletedAt: new Date() })
    expect(ids(await h.http().get('/api/feed/home'))).toEqual([ok])
  })

  it('search tag "#DuCaArt" finds posts tagged ducaart', async () => {
    const u = await createUser(h)
    const hit = await seed(u.id, { tags: ['ducaart'] })
    await seed(u.id, { tags: ['other'] })
    const res = await h.http().get('/api/search').query({ tag: '#DuCaArt' })
    expect(res.status).toBe(200)
    expect(ids(res)).toEqual([hit])
  })

  it('search q matches title words', async () => {
    const u = await createUser(h)
    const hit = await seed(u.id, { title: 'Sunset over mountains' })
    await seed(u.id, { title: 'Forest' })
    const res = await h.http().get('/api/search').query({ q: 'sunset' })
    expect(res.status).toBe(200)
    expect(ids(res)).toEqual([hit])
  })

  it('search filters by type and paginates with q', async () => {
    const u = await createUser(h)
    const a = await seed(u.id, { title: 'cat', type: 'manga' })
    const b = await seed(u.id, { title: 'cat', type: 'manga' })
    await seed(u.id, { title: 'cat', type: 'illustration' })
    const p1 = await h.http().get('/api/search').query({ q: 'cat', type: 'manga', limit: 1 })
    expect(ids(p1)).toEqual([b])
    const p2 = await h.http().get('/api/search').query({ q: 'cat', type: 'manga', limit: 1, cursor: p1.body.nextCursor })
    expect(ids(p2)).toEqual([a])
    expect(p2.body.nextCursor).toBeNull()
  })

  it('invalid cursor is treated as first page', async () => {
    const u = await createUser(h)
    const id = await seed(u.id)
    const res = await h.http().get('/api/feed/home').query({ cursor: 'not-a-cursor' })
    expect(res.status).toBe(200)
    expect(ids(res)).toEqual([id])
  })

  it('following requires auth and is empty without follows', async () => {
    expect((await h.http().get('/api/feed/following')).status).toBe(401)
    const u = await createUser(h)
    const res = await h.http().get('/api/feed/following').set(auth(u.token))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [], nextCursor: null })
  })

  it('tags/suggest "du" returns ducaart before less-used tags', async () => {
    await h.db.collection<{ _id: string; display: string; postCount: number }>('tags').insertMany([
      { _id: 'duck', display: 'Duck', postCount: 2 },
      { _id: 'ducaart', display: 'DuCaArt', postCount: 50 },
      { _id: 'cat', display: 'Cat', postCount: 99 },
    ])
    const res = await h.http().get('/api/tags/suggest').query({ q: '#Du' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { name: 'ducaart', display: 'DuCaArt', postCount: 50 },
      { name: 'duck', display: 'Duck', postCount: 2 },
    ])
    expect((await h.http().get('/api/tags/suggest').query({ q: '  ' })).body).toEqual([])
  })

  it('tags/featured returns the three tags, with 0 for absent ones', async () => {
    await h.db.collection<{ _id: string; display: string; postCount: number }>('tags').insertOne({ _id: 'ducaart', display: 'DuCaArt', postCount: 7 })
    const res = await h.http().get('/api/tags/featured')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([
      { name: 'ducaart', display: 'DuCaArt', postCount: 7 },
      { name: 'hibikiduca', display: 'HibikiDuCa', postCount: 0 },
      { name: 'wearecuka', display: 'WeAreCuka', postCount: 0 },
    ])
  })
})

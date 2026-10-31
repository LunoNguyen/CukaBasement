import { Redis } from 'ioredis'
import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FeedCache } from '../src/cache/feed-cache.service'
import { createTestHarness, createUser, type Harness } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
const DAY = 86_400_000
const REDIS_URL = process.env.REDIS_URL_TEST || 'redis://127.0.0.1:6379/15'

function yearsAgo(n: number): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  return d.toISOString().slice(0, 10)
}

async function reachable(url: string): Promise<boolean> {
  const c = new Redis(url, { lazyConnect: true, connectTimeout: 500, maxRetriesPerRequest: 0, retryStrategy: () => null })
  c.on('error', () => {})
  try {
    await c.connect()
    return (await c.ping()) === 'PONG'
  } catch {
    return false
  } finally {
    c.disconnect()
  }
}

type RankItem = { id: string; rank: number; score: number; type: string; rating: string }

/** Seeding helpers bound to one harness. */
function seeding(h: () => Harness) {
  let seq = 0
  async function post(authorId: string, over: Record<string, unknown> = {}): Promise<string> {
    const _id = new Types.ObjectId()
    const createdAt = new Date(Date.now() - 40 * DAY + ++seq * 1000)
    await h().db.collection('posts').insertOne({
      _id,
      authorId: new Types.ObjectId(authorId),
      type: 'illustration',
      title: `Post ${seq}`,
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
  /** `n` likes on `postId`, each by a different (made-up) user, `ageMs` ago. */
  async function likes(postId: string, n: number, ageMs = 60_000): Promise<void> {
    if (!n) return
    const at = new Date(Date.now() - ageMs)
    await h().db.collection('likes').insertMany(Array.from({ length: n }, () => ({ userId: new Types.ObjectId(), postId: new Types.ObjectId(postId), createdAt: at })))
  }
  async function bookmarks(postId: string, n: number, ageMs = 60_000): Promise<void> {
    const at = new Date(Date.now() - ageMs)
    await h().db.collection('bookmarks').insertMany(Array.from({ length: n }, () => ({ userId: new Types.ObjectId(), postId: new Types.ObjectId(postId), isPrivate: false, createdAt: at })))
  }
  return { post, likes, bookmarks }
}

const items = (res: { body: { items: RankItem[] } }) => res.body.items
const ids = (res: { body: { items: RankItem[] } }) => items(res).map((i) => i.id)

describe('fanart ranking', () => {
  let h: Harness
  const s = seeding(() => h)
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  it('ranks by likes in the period, 1-based, with the score; posts nobody liked are left out', async () => {
    const u = await createUser(h)
    const a = await s.post(u.id)
    const b = await s.post(u.id)
    const c = await s.post(u.id)
    await s.post(u.id) // no likes at all
    await s.likes(b, 5)
    await s.likes(a, 3)
    await s.likes(c, 1)
    const res = await h.http().get('/api/feed/ranking')
    expect(res.status).toBe(200)
    expect(items(res).map(({ id, rank, score }) => ({ id, rank, score }))).toEqual([
      { id: b, rank: 1, score: 5 },
      { id: a, rank: 2, score: 3 },
      { id: c, rank: 3, score: 1 },
    ])
    // Full cards, like the feeds.
    expect(items(res)[0]).toMatchObject({ title: expect.any(String), author: expect.objectContaining({ username: expect.any(String) }) })
    expect(res.body.nextCursor).toBeUndefined()
  })

  it('only likes and bookmarks inside the period count: day, week, month', async () => {
    const u = await createUser(h)
    const old = await s.post(u.id)
    const fresh = await s.post(u.id)
    await s.likes(old, 4, 3 * DAY) // this week, not today
    await s.likes(old, 6, 20 * DAY) // this month only
    await s.likes(old, 9, 40 * DAY) // too old for any period
    await s.likes(fresh, 2)
    expect(items(await h.http().get('/api/feed/ranking?period=day')).map((i) => [i.id, i.score])).toEqual([[fresh, 2]])
    expect(items(await h.http().get('/api/feed/ranking?period=week')).map((i) => [i.id, i.score])).toEqual([[old, 4], [fresh, 2]])
    expect(items(await h.http().get('/api/feed/ranking?period=month')).map((i) => [i.id, i.score])).toEqual([[old, 10], [fresh, 2]])
  })

  it('a bookmark counts as one, like a like', async () => {
    const u = await createUser(h)
    const liked = await s.post(u.id)
    const saved = await s.post(u.id)
    await s.likes(liked, 2)
    await s.bookmarks(saved, 2)
    await s.likes(saved, 1)
    expect(items(await h.http().get('/api/feed/ranking')).map((i) => [i.id, i.score])).toEqual([[saved, 3], [liked, 2]])
  })

  it('R18 posts are left out (not blurred) for viewers who cannot see R18, and ranked for those who can', async () => {
    const u = await createUser(h)
    const r18 = await s.post(u.id, { rating: 'r18' })
    const safe = await s.post(u.id)
    await s.likes(r18, 9)
    await s.likes(safe, 1)
    const adultOff = await createUser(h, { birthDate: yearsAgo(30), showR18: false })
    const minor = await createUser(h, { birthDate: yearsAgo(15), showR18: true })
    const adultOn = await createUser(h, { birthDate: yearsAgo(30), showR18: true })
    expect(ids(await h.http().get('/api/feed/ranking'))).toEqual([safe])
    expect(ids(await h.http().get('/api/feed/ranking').set(auth(adultOff.token)))).toEqual([safe])
    expect(ids(await h.http().get('/api/feed/ranking').set(auth(minor.token)))).toEqual([safe])
    const on = items(await h.http().get('/api/feed/ranking').set(auth(adultOn.token)))
    expect(on.map((i) => [i.id, i.rank])).toEqual([[r18, 1], [safe, 2]])
  })

  it('hidden, removed, pending, rejected and deleted posts never rank', async () => {
    const u = await createUser(h)
    const ok = await s.post(u.id)
    const bad = [
      await s.post(u.id, { visibility: 'hidden_by_reports' }),
      await s.post(u.id, { visibility: 'removed' }),
      await s.post(u.id, { review: { status: 'pending', reason: null, by: null, at: null } }),
      await s.post(u.id, { review: { status: 'rejected', reason: null, by: null, at: null } }),
      await s.post(u.id, { deletedAt: new Date() }),
    ]
    await s.likes(ok, 1)
    for (const id of bad) await s.likes(id, 5)
    expect(ids(await h.http().get('/api/feed/ranking'))).toEqual([ok])
  })

  it('type filter: only posts of that type', async () => {
    const u = await createUser(h)
    const ill = await s.post(u.id)
    const manga = await s.post(u.id, { type: 'manga' })
    await s.likes(ill, 5)
    await s.likes(manga, 1)
    expect(ids(await h.http().get('/api/feed/ranking?type=manga'))).toEqual([manga])
    expect((await h.http().get('/api/feed/ranking?type=painting')).status).toBe(400)
    expect((await h.http().get('/api/feed/ranking?period=year')).status).toBe(400)
  })

  it('a tie goes to the newer post; limit caps the list (max 50)', async () => {
    const u = await createUser(h)
    const older = await s.post(u.id)
    const newer = await s.post(u.id)
    const third = await s.post(u.id)
    await s.likes(older, 2)
    await s.likes(newer, 2)
    await s.likes(third, 1)
    expect(ids(await h.http().get('/api/feed/ranking'))).toEqual([newer, older, third])
    expect(ids(await h.http().get('/api/feed/ranking?limit=2'))).toEqual([newer, older])
    expect((await h.http().get('/api/feed/ranking?limit=51')).status).toBe(400)
  })
})

describe('ranking cache', async () => {
  const up = await reachable(REDIS_URL)
  let h: Harness
  const s = seeding(() => h)
  beforeAll(async () => {
    if (!up) return
    const flush = new Redis(REDIS_URL)
    await flush.flushdb()
    flush.disconnect()
    h = await createTestHarness({ redisUrl: REDIS_URL })
    const cache = h.app.get(FeedCache)
    for (let i = 0; i < 60 && !cache.ready; i++) await new Promise((r) => setTimeout(r, 25))
  })
  beforeEach(async () => {
    if (up) await h.reset()
  })
  afterAll(async () => {
    if (up) await h.close()
  })

  it.skipIf(!up)('serves the ranking from Redis; a bump (moderation, edits, deletes) drops a newly hidden post', async () => {
    const u = await createUser(h)
    const a = await s.post(u.id)
    const b = await s.post(u.id)
    await s.likes(a, 3)
    await s.likes(b, 1)
    await h.http().get('/api/feed/ranking').expect(200) // starts a generation
    expect(ids(await h.http().get('/api/feed/ranking'))).toEqual([a, b]) // stored
    await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(a) }, { $set: { visibility: 'hidden_by_reports' } })
    // Still the cached list: the ranking is not recomputed on every request.
    expect(ids(await h.http().get('/api/feed/ranking'))).toEqual([a, b])
    await h.app.get(FeedCache).bump()
    expect(ids(await h.http().get('/api/feed/ranking'))).toEqual([b])
  })
})

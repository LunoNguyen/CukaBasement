import { Redis } from 'ioredis'
import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FEED_CACHE_TTL_SEC, FEED_GEN_KEY, FeedCache } from '../src/cache/feed-cache.service'
import type { Config } from '../src/config/config'
import { bumpFeedIfListed } from '../src/jobs/handlers/feed-gen'
import { createTestHarness, createUser, type Harness, jobDeps, testConfig } from './harness'

/** A Redis database of its own (flushed by these tests); the suite is skipped when nothing listens there. */
const REDIS_URL = process.env.REDIS_URL_TEST || 'redis://127.0.0.1:6379/15'
const UNREACHABLE = 'redis://127.0.0.1:1'

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

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

function yearsAgo(n: number): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  return d.toISOString().slice(0, 10)
}

function cacheWith(redis: Partial<Config['redis']>): FeedCache {
  const config = testConfig()
  return new FeedCache({ ...config, redis: { ...config.redis, ...redis } })
}

async function untilReady(cache: FeedCache): Promise<void> {
  await vi.waitFor(() => expect(cache.ready).toBe(true), { timeout: 3000, interval: 20 })
}

describe('FeedCache fail-open', () => {
  it('disabled: no client, compute every call, bump is a no-op', async () => {
    const cache = cacheWith({ disabled: true })
    cache.onModuleInit()
    const compute = vi.fn(async () => ({ n: 1 }))
    expect(await cache.wrap('home', {}, compute)).toEqual({ n: 1 })
    expect(await cache.wrap('home', {}, compute)).toEqual({ n: 1 })
    expect(compute).toHaveBeenCalledTimes(2)
    await cache.bump()
    expect(cache.ready).toBe(false)
    cache.onModuleDestroy()
  })

  it('unreachable Redis: serves from compute without delay or errors; compute errors still propagate', async () => {
    const cache = cacheWith({ disabled: false, url: UNREACHABLE })
    cache.onModuleInit()
    try {
      const compute = vi.fn(async () => ({ n: 2 }))
      const started = Date.now()
      for (let i = 0; i < 3; i++) expect(await cache.wrap('home', { i }, compute)).toEqual({ n: 2 })
      await cache.bump()
      expect(Date.now() - started).toBeLessThan(500)
      expect(compute).toHaveBeenCalledTimes(3)
      await expect(cache.wrap('home', {}, async () => Promise.reject(new Error('mongo down')))).rejects.toThrow('mongo down')
    } finally {
      cache.onModuleDestroy()
    }
  })

  it('the app starts and serves the feed with Redis unreachable', async () => {
    const h = await createTestHarness({ redisUrl: UNREACHABLE })
    try {
      const res = await h.http().get('/api/feed/home')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ items: [], nextCursor: null })
    } finally {
      await h.close()
    }
  })
})

describe('FeedCache with Redis', () => {
  const raw = new Redis(REDIS_URL, { lazyConnect: true })
  let redisUp = false
  beforeAll(async () => {
    redisUp = await reachable(REDIS_URL)
    if (redisUp) await raw.connect()
  })
  // Skipped without a local Redis (`redis-server`, or REDIS_URL_TEST); the fail-open tests above always run.
  beforeEach(async (ctx) => {
    if (!redisUp) ctx.skip()
    await raw.flushdb()
  })
  afterAll(() => (redisUp ? raw.quit() : undefined))

  describe('unit', () => {
    let cache: FeedCache
    beforeEach(async () => {
      cache?.onModuleDestroy()
      cache = cacheWith({ disabled: false, url: REDIS_URL })
      cache.onModuleInit()
      await untilReady(cache)
    })
    afterAll(() => cache.onModuleDestroy())

    it('starts a generation on first use, then caches per params with a short TTL', async () => {
      const compute = vi.fn(async () => ({ items: ['a'] }))
      await cache.wrap('home', { r18: false }, compute)
      expect(await raw.get(FEED_GEN_KEY)).toBeTruthy()
      await cache.wrap('home', { r18: false }, compute)
      await vi.waitFor(async () => expect(await raw.keys('cuka:feed:v1:*')).toHaveLength(1))
      expect(await cache.wrap('home', { r18: false }, compute)).toEqual({ items: ['a'] })
      expect(compute).toHaveBeenCalledTimes(2)
      const [key] = await raw.keys('cuka:feed:v1:*')
      const ttl = await raw.ttl(key!)
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(FEED_CACHE_TTL_SEC)
      // Any param in the key gives a separate entry.
      await cache.wrap('home', { r18: true }, compute)
      expect(compute).toHaveBeenCalledTimes(3)
    })

    it('bump orphans every entry', async () => {
      let n = 0
      const compute = async () => ({ n: ++n })
      await cache.wrap('search', { q: 'a' }, compute)
      await cache.wrap('search', { q: 'a' }, compute)
      await vi.waitFor(async () => expect(await raw.keys('cuka:feed:v1:*')).toHaveLength(1))
      expect(await cache.wrap('search', { q: 'a' }, compute)).toEqual({ n: 2 })
      await cache.bump()
      expect(await cache.wrap('search', { q: 'a' }, compute)).toEqual({ n: 3 })
    })

    it('a lost generation key never revives old entries', async () => {
      let n = 0
      const compute = async () => ({ n: ++n })
      await cache.wrap('home', {}, compute)
      await cache.wrap('home', {}, compute)
      await vi.waitFor(async () => expect(await raw.keys('cuka:feed:v1:*')).toHaveLength(1))
      await raw.del(FEED_GEN_KEY)
      expect(await cache.wrap('home', {}, compute)).toEqual({ n: 3 })
      expect(await cache.wrap('home', {}, compute)).toEqual({ n: 4 })
    })

    it('a bump that fails is retried, and no cached entry is served until it lands', async () => {
      let n = 0
      const compute = async () => ({ n: ++n })
      await cache.wrap('home', {}, compute)
      await cache.wrap('home', {}, compute)
      await vi.waitFor(async () => expect(await raw.keys('cuka:feed:v1:*')).toHaveLength(1))
      const client = (cache as unknown as { client: Redis }).client
      const set = vi.spyOn(client, 'set').mockRejectedValueOnce(new Error('Command timed out'))
      await cache.bump()
      // The old entry ({ n: 2 }) would be stale; it is skipped and the retried bump replaces the generation.
      expect(await cache.wrap('home', {}, compute)).toEqual({ n: 3 })
      set.mockRestore()
      await vi.waitFor(async () => expect(await cache.wrap('home', {}, compute)).not.toEqual({ n: 2 }))
      const gen = await raw.get(FEED_GEN_KEY)
      expect(await cache.wrap('home', {}, async () => ({ n: -1 }))).not.toEqual({ n: 2 })
      expect(await raw.get(FEED_GEN_KEY)).toBe(gen)
    })

    it('worker jobs bump only for listed posts, files in them, and avatars', async () => {
      const h = await createTestHarness()
      try {
        const deps = { ...jobDeps(h), feed: cache }
        const bump = vi.spyOn(cache, 'bump')
        const u = await createUser(h)
        const listedFile = new Types.ObjectId()
        const pendingFile = new Types.ObjectId()
        const avatar = new Types.ObjectId()
        const base = { authorId: new Types.ObjectId(u.id), visibility: 'public', deletedAt: null }
        const { insertedId: listed } = await h.db
          .collection('posts')
          .insertOne({ ...base, review: { status: 'approved' }, files: [{ fileId: listedFile, position: 0, isCover: true }] })
        const { insertedId: pending } = await h.db
          .collection('posts')
          .insertOne({ ...base, review: { status: 'pending' }, files: [{ fileId: pendingFile, position: 0, isCover: true }] })
        await h.db.collection('users').updateOne({ _id: new Types.ObjectId(u.id) }, { $set: { 'profile.avatarFileId': avatar } })

        await bumpFeedIfListed(deps, { postId: pending })
        await bumpFeedIfListed(deps, { fileId: pendingFile })
        await bumpFeedIfListed(deps, { fileId: new Types.ObjectId() })
        await bumpFeedIfListed(jobDeps(h), { postId: listed })
        expect(bump).not.toHaveBeenCalled()
        await bumpFeedIfListed(deps, { postId: listed })
        await bumpFeedIfListed(deps, { fileId: listedFile })
        await bumpFeedIfListed(deps, { fileId: avatar })
        expect(bump).toHaveBeenCalledTimes(3)
      } finally {
        await h.close()
      }
    })
  })

  describe('feed endpoints', () => {
    let h: Harness
    let started = false
    beforeEach(async () => {
      if (!started) {
        started = true
        h = await createTestHarness({ redisUrl: REDIS_URL })
        await untilReady(h.app.get(FeedCache))
      }
      await h.reset()
      await raw.flushdb()
    })
    afterAll(() => (started ? h.close() : undefined))

    let seq = 0
    /** Inserts a listed post directly (no invalidation, as a stale cache would see it). */
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
        tags: ['ducaart'],
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
    /** Two reads: the first may only start a generation, the second stores the entry. */
    async function warm(path: string, query: Record<string, string> = {}, headers: Record<string, string> = {}) {
      await h.http().get(path).query(query).set(headers)
      await h.http().get(path).query(query).set(headers)
      await vi.waitFor(async () => expect((await raw.keys('cuka:feed:v1:*')).length).toBeGreaterThan(0))
    }

    it('serves home from the cache until a moderation hide bumps it; the hidden post never comes back', async () => {
      const author = await createUser(h)
      const mod = await createUser(h, { role: 'moderator' })
      const a = await seed(author.id)
      await warm('/api/feed/home')
      const b = await seed(author.id)
      // Cached: the directly inserted post is not there yet.
      expect(ids(await h.http().get('/api/feed/home'))).toEqual([a])
      expect((await h.http().post(`/api/mod/posts/${a}/hide`).set(auth(mod.token)).send({})).status).toBe(200)
      expect(ids(await h.http().get('/api/feed/home'))).toEqual([b])
      expect(ids(await h.http().get('/api/feed/home'))).toEqual([b])
    })

    it('search and tag pages are invalidated by a reject, an author edit and a delete', async () => {
      const author = await createUser(h)
      const mod = await createUser(h, { role: 'moderator' })
      const [a, b, c] = [await seed(author.id), await seed(author.id), await seed(author.id)]
      await warm('/api/search', { tag: 'DuCaArt' })
      expect(ids(await h.http().get('/api/search').query({ tag: 'DuCaArt' }))).toEqual([c, b, a])
      await h.http().post(`/api/mod/posts/${c}/reject`).set(auth(mod.token)).send({ reason: 'no' })
      expect(ids(await h.http().get('/api/search').query({ tag: 'DuCaArt' }))).toEqual([b, a])
      await h.http().patch(`/api/posts/${b}`).set(auth(author.token)).send({ title: 'Renamed' })
      expect((await h.http().get('/api/search').query({ tag: 'ducaart' })).body.items[0].title).toBe('Renamed')
      await h.http().delete(`/api/posts/${a}`).set(auth(author.token))
      expect(ids(await h.http().get('/api/search').query({ tag: 'ducaart' }))).toEqual([b])
    })

    it('r18 posts never reach a viewer who cannot see them through the cache', async () => {
      const author = await createUser(h)
      const adultOn = await createUser(h, { birthDate: yearsAgo(30), showR18: true })
      const adultOff = await createUser(h, { birthDate: yearsAgo(30), showR18: false })
      const r18 = await seed(author.id, { rating: 'r18' })
      const safe = await seed(author.id)
      await warm('/api/feed/home', {}, auth(adultOn.token))
      expect(ids(await h.http().get('/api/feed/home').set(auth(adultOn.token)))).toEqual([safe, r18])
      expect(ids(await h.http().get('/api/feed/home'))).toEqual([safe])
      expect(ids(await h.http().get('/api/feed/home').set(auth(adultOff.token)))).toEqual([safe])
      // The anonymous entry is shared by every viewer who cannot see r18, and carries nothing about the viewer.
      await warm('/api/feed/home')
      expect(ids(await h.http().get('/api/feed/home').set(auth(adultOff.token)))).toEqual([safe])
      expect(ids(await h.http().get('/api/feed/home').set(auth(adultOn.token)))).toEqual([safe, r18])
    })

    it('a rating change to r18 takes the post out of the cached safe feed at once', async () => {
      const author = await createUser(h)
      const post = await seed(author.id)
      await warm('/api/feed/home')
      expect(ids(await h.http().get('/api/feed/home'))).toEqual([post])
      expect((await h.http().patch(`/api/posts/${post}`).set(auth(author.token)).send({ rating: 'r18' })).status).toBe(200)
      expect(ids(await h.http().get('/api/feed/home'))).toEqual([])
    })

    it('reports that auto-hide a post invalidate the feed', async () => {
      const author = await createUser(h)
      const post = await seed(author.id)
      await warm('/api/feed/home')
      for (let i = 0; i < 5; i++) {
        const r = await createUser(h)
        await h.http().post(`/api/posts/${post}/report`).set(auth(r.token)).send({ reason: 'spam', detail: '' })
      }
      expect((await h.db.collection('posts').findOne({ _id: new Types.ObjectId(post) }))!.visibility).toBe('hidden_by_reports')
      expect(ids(await h.http().get('/api/feed/home'))).toEqual([])
    })

    it('the following feed is never cached', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      await h.http().post(`/api/users/${author.username}/follow`).set(auth(fan.token))
      const a = await seed(author.id)
      await h.http().get('/api/feed/following').set(auth(fan.token))
      const b = await seed(author.id)
      expect(ids(await h.http().get('/api/feed/following').set(auth(fan.token)))).toEqual([b, a])
    })
  })
})

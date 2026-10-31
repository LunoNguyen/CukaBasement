import { Redis } from 'ioredis'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeedCache } from '../src/cache/feed-cache.service'
import { CONFIG, type Config } from '../src/config/config'
import { FEED_FRESH_MS, PRUNE_AFTER_MS, youtubeSync, type YouTubeSyncDeps } from '../src/jobs/handlers/youtube-sync'
import { ensureSitePages, HOME_SEED } from '../src/site/home-seed'
import { feedsCol, videosCol } from '../src/site/music-store'
import { fetchCapped, parseChannelFeed, YOUTUBE_HOSTS, YT_MAX_BYTES } from '../src/site/youtube'
import { StorageService } from '../src/storage/storage.service'
import { createTestHarness, createUser, type Harness, jobDeps } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
const lt = (vi: string, en = '') => ({ vi, en })
const CH = 'UC5RSxmHP5c4pU9Og1Pxx4wg'
const IDS = ['aaaaaaaaaa1', 'bbbbbbbbbb2', 'ccccccccc_3', 'ddddddddd-4']

/** A channel feed like YouTube's: newest first, with view counts in media:statistics. */
function feed(entries: Array<{ id: string; title: string; published?: string; views?: number; channel?: string }>, extra = ''): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=${CH}"/>
  <id>yt:channel:${CH.slice(2)}</id>
  <yt:channelId>${CH.slice(2)}</yt:channelId>
  <title>Hibiki Du Ca</title>${extra}
  ${entries
    .map(
      (e) => `<entry>
    <id>yt:video:${e.id}</id>
    <yt:videoId>${e.id}</yt:videoId>
    <yt:channelId>${e.channel ?? CH}</yt:channelId>
    <title>${e.title}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${e.id}"/>
    <published>${e.published ?? '2026-10-01T12:00:00+00:00'}</published>
    <media:group>
      <media:title>${e.title}</media:title>
      <media:thumbnail url="https://i1.ytimg.com/vi/${e.id}/hqdefault.jpg" width="480" height="360"/>
      <media:community>
        <media:starRating count="10" average="5.00" min="1" max="5"/>
        <media:statistics views="${e.views ?? 0}"/>
      </media:community>
    </media:group>
  </entry>`,
    )
    .join('\n')}
</feed>`
}

const FEED_OK = feed([
  { id: IDS[0]!, title: 'Du Ca – Bài hát mới (Official MV)', published: '2026-10-20T10:00:00+00:00', views: 12000 },
  { id: IDS[1]!, title: 'Karaoke stream &amp; chat', published: '2026-10-18T10:00:00+00:00', views: 3400 },
  { id: IDS[2]!, title: 'Cover &#8211; Ánh trăng', published: '2026-10-10T10:00:00+00:00', views: 800 },
])

let jpeg43: Buffer
let jpeg169: Buffer

type Answer = { status?: number; body?: string | Buffer; type?: string } | (() => never)
/** A stand-in for YouTube: answers by URL prefix and records every request. */
function fakeYouTube(routes: Array<[string | RegExp, Answer]>) {
  const calls: string[] = []
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push(url)
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeDefined()
    const hit = routes.find(([p]) => (typeof p === 'string' ? url.startsWith(p) : p.test(url)))
    if (!hit) return new Response('not found', { status: 404 })
    const a = hit[1]
    if (typeof a === 'function') return a()
    const body = a.body ?? ''
    return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: a.status ?? 200, headers: { 'content-type': a.type ?? 'text/xml' } })
  })
  return { fetch: fn, calls }
}

const thumbRoutes = (): Array<[RegExp, Answer]> => [
  [/^https:\/\/i\.ytimg\.com\/vi\/[^/]+\/maxresdefault\.jpg$/, { status: 404, body: 'nope' }],
  [/^https:\/\/i\.ytimg\.com\/vi\/[^/]+\/hqdefault\.jpg$/, { body: jpeg43, type: 'image/jpeg' }],
]

function musicSection(over: Record<string, unknown> = {}) {
  return {
    id: 'music',
    type: 'music',
    visible: true,
    data: {
      eyebrow: lt('Hibiki Du Ca'),
      heading: lt('Âm nhạc', 'Music'),
      channelId: CH,
      newest: { label: lt('MV mới'), auto: false, keyword: '', items: [] },
      popular: { label: lt('MV phổ biến'), auto: false, items: [] },
      channel: { label: lt('Video kênh'), auto: true, items: [] },
      ...over,
    },
  }
}

describe('music section (YouTube)', () => {
  let h: Harness
  let config: Config
  let admin: { token: string }
  beforeAll(async () => {
    h = await createTestHarness()
    config = h.app.get<Config>(CONFIG)
    jpeg43 = await sharp({ create: { width: 480, height: 360, channels: 3, background: '#e85d75' } }).jpeg().toBuffer()
    jpeg169 = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#5b3a29' } }).jpeg().toBuffer()
  })
  beforeEach(async () => {
    await h.reset()
    config.youtube = { apiKey: undefined }
    admin = await createUser(h, { role: 'admin' })
  })
  afterAll(() => h.close())

  const deps = (fetch: YouTubeSyncDeps['fetch'], more: Partial<YouTubeSyncDeps> = {}): YouTubeSyncDeps => ({ ...jobDeps(h), fetch, ...more })

  /** Saves and publishes `sections` as the Introduction page. */
  async function publish(sections: unknown[]) {
    const d = (await h.http().get('/api/admin/site/pages/intro/draft').set(auth(admin.token))).body
    const saved = await h.http().put('/api/admin/site/pages/intro/draft').set(auth(admin.token)).send({ revision: d.revision, sections })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    await h.http().post('/api/admin/site/pages/intro/publish').set(auth(admin.token)).send({ revision: saved.body.revision }).expect(200)
  }

  it('the default landing has the music row after the releases: channel videos automatic, MV tabs empty', async () => {
    const res = await h.http().get('/api/site/home').expect(200)
    const types = res.body.sections.map((s: { type: string }) => s.type)
    expect(types).toEqual(['heroVideo', 'releases', 'music', 'spotlight', 'vibe', 'footer'])
    const music = res.body.sections[2]
    expect(music.data).toMatchObject({ channelId: CH, channel: { auto: true, items: [] }, newest: { auto: false, items: [] }, popular: { auto: false, items: [] } })
    expect(res.body.youtube).toEqual({ feeds: { music: { newest: [], popular: [], channel: [] } }, videos: {} })
    expect(HOME_SEED.map((s) => s.id)).toContain('music')
  })

  it('an existing homepage (even an untouched older landing) is never given the section by itself', async () => {
    const old = HOME_SEED.filter((s) => s.type !== 'music')
    const at = new Date('2026-01-01')
    await h.db.collection('homepage').insertOne({
      _id: 'home' as never,
      draft: { revision: 3, sections: old, updatedAt: at, updatedBy: null },
      published: { sections: old, publishedAt: at, publishedBy: null },
    })
    await ensureSitePages(h.db)
    const doc = await h.db.collection('homepage').findOne({ _id: 'home' as never })
    expect(doc!.published.sections.map((s: { type: string }) => s.type)).not.toContain('music')
    expect(doc!.draft.revision).toBe(3)
  })

  it('sync: reads the channel feed, stores titles, dates, views and thumbnails in our bucket; the page serves them', async () => {
    await publish([musicSection()])
    const yt = fakeYouTube([['https://www.youtube.com/feeds/videos.xml?channel_id=' + CH, { body: FEED_OK }], ...thumbRoutes()])
    const bump = vi.fn(async () => {})
    const r = await youtubeSync(deps(yt.fetch, { feed: { bump } }))
    expect(r.feeds.fetched).toEqual([`channel:${CH}`])
    expect(r.thumbs).toEqual({ stored: 3, failed: 0 })
    expect(bump).toHaveBeenCalledTimes(1)
    // Only YouTube's own hosts, built from validated ids.
    for (const u of yt.calls) expect(YOUTUBE_HOSTS.has(new URL(u).hostname), u).toBe(true)
    expect(yt.calls.filter((u) => u.includes('maxresdefault'))).toHaveLength(3)

    const res = await h.http().get('/api/site/pages/intro').expect(200)
    expect(res.body.youtube.feeds.music).toEqual({ newest: [], popular: [], channel: IDS.slice(0, 3) })
    const v = res.body.youtube.videos[IDS[0]!]
    expect(v).toMatchObject({ title: 'Du Ca – Bài hát mới (Official MV)', views: 12000, publishedAt: '2026-10-20T10:00:00.000Z' })
    expect(res.body.youtube.videos[IDS[1]!].title).toBe('Karaoke stream & chat')
    expect(res.body.youtube.videos[IDS[2]!].title).toBe('Cover – Ánh trăng')
    // The thumbnail is ours (public bucket), cropped to 16:9, never a ytimg URL.
    const storage = h.app.get(StorageService)
    expect(v.thumb.src.startsWith(storage.publicUrl(`youtube/${IDS[0]}/w480.webp`))).toBe(true)
    expect(JSON.stringify(res.body)).not.toContain('ytimg')
    expect(v.thumb).toMatchObject({ width: 480, height: 270 })
    const obj = await storage.getBuffer(config.minio.bucketPublic, `youtube/${IDS[0]}/w480.webp`)
    expect((await sharp(obj).metadata()).format).toBe('webp')

    // A second run soon after fetches nothing again: the feed is fresh and the thumbnails are stored.
    const again = fakeYouTube([])
    const r2 = await youtubeSync(deps(again.fetch))
    expect(r2.feeds.skipped).toEqual([`channel:${CH}`])
    expect(again.calls).toEqual([])
    expect(r2.changed).toBe(false)
  })

  it('sync prefers the 16:9 maxres thumbnail and renders two widths', async () => {
    await publish([musicSection()])
    const yt = fakeYouTube([
      ['https://www.youtube.com/feeds/', { body: feed([{ id: IDS[0]!, title: 'MV' }]) }],
      [/maxresdefault\.jpg$/, { body: jpeg169, type: 'image/jpeg' }],
    ])
    await youtubeSync(deps(yt.fetch))
    const doc = await videosCol(h.db).findOne({ _id: IDS[0]! })
    expect(doc!.thumb!.renders.map((r) => [r.width, r.height])).toEqual([
      [480, 270],
      [960, 540],
    ])
    expect(yt.calls.some((u) => u.includes('hqdefault'))).toBe(false)
  })

  it('a failed fetch keeps the last good list, records the error and warns; malformed, oversized or DOCTYPE feeds are refused', async () => {
    await publish([musicSection()])
    await youtubeSync(deps(fakeYouTube([['https://www.youtube.com/feeds/', { body: FEED_OK }], ...thumbRoutes()]).fetch))
    const warn = vi.spyOn((await import('@nestjs/common')).Logger.prototype, 'warn').mockImplementation(() => {})
    const bad: Array<[string, Answer]> = [
      ['malformed', { body: '<feed><entry><yt:videoId>x</entry></feed>' }],
      ['doctype', { body: `<?xml version="1.0"?><!DOCTYPE feed [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]><feed><title>&b;</title></feed>` }],
      ['oversized', { body: feed([{ id: IDS[3]!, title: 'x' }], `<x>${'a'.repeat(YT_MAX_BYTES.feed)}</x>`) }],
      ['not a feed', { body: '<?xml version="1.0"?><html><body>consent</body></html>' }],
      ['http 500', { status: 500, body: 'oops' }],
      ['network', () => { throw new TypeError('fetch failed') }],
    ]
    for (const [name, answer] of bad) {
      const r = await youtubeSync(deps(fakeYouTube([['https://www.youtube.com/feeds/', answer]]).fetch), { force: true })
      expect(r.feeds.failed, name).toEqual([`channel:${CH}`])
      const f = await feedsCol(h.db).findOne({ _id: `channel:${CH}` })
      expect(f!.ids, name).toEqual(IDS.slice(0, 3))
      expect(f!.error, name).toBeTruthy()
      expect((await h.http().get('/api/site/pages/intro')).body.youtube.feeds.music.channel, name).toEqual(IDS.slice(0, 3))
    }
    expect(warn).toHaveBeenCalled()
    expect(String(warn.mock.calls[0]![0])).toContain('keeping the last good list')
    warn.mockRestore()

    const status = await h.http().get('/api/admin/site/music').set(auth(admin.token)).expect(200)
    expect(status.body.apiKey).toBe(false)
    expect(status.body.feeds).toEqual([expect.objectContaining({ key: `channel:${CH}`, count: 3, error: expect.any(String), fetchedAt: expect.any(String) })])
  })

  it('feed parsing: skips bad ids, other channels and repeats; caps the titles', () => {
    const xml = feed([
      { id: IDS[0]!, title: 'Một' },
      { id: '../../etc/x', title: 'Path' },
      { id: 'short', title: 'Short' },
      { id: IDS[1]!, title: 'Kênh khác', channel: 'UCxxxxxxxxxxxxxxxxxxxxxx' },
      { id: IDS[0]!, title: 'Lặp' },
      { id: IDS[2]!, title: 'T'.repeat(500), views: 5 },
    ])
    const list = parseChannelFeed(xml, CH)
    expect(list.map((v) => v.id)).toEqual([IDS[0], IDS[2]])
    expect(list[1]!.title).toHaveLength(200)
    expect(list[1]!.views).toBe(5)
  })

  it('fetches only https on YouTube hosts, with no redirects, a timeout and a size cap', async () => {
    const f = vi.fn(async () => new Response('x'))
    for (const url of ['http://www.youtube.com/feeds/videos.xml', 'https://evil.example/x', 'https://www.youtube.com:8443/x', 'https://u:p@www.youtube.com/x', 'https://169.254.169.254/latest'])
      await expect(fetchCapped(f, url, 10), url).rejects.toThrow(/refused/)
    expect(f).not.toHaveBeenCalled()
    const big = vi.fn(async () => new Response('y'.repeat(100)))
    await expect(fetchCapped(big, 'https://www.youtube.com/x', 10)).rejects.toThrow(/too large/)
    const slow = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason))))
    await expect(fetchCapped(slow, 'https://www.youtube.com/x', 10, 50)).rejects.toThrow(/timed out/)
  })

  it('hand-picked videos: oEmbed fills missing titles (failures ignored, retried later); thumbnails are cached once', async () => {
    const items = [
      { url: `https://www.youtube.com/watch?v=${IDS[0]}`, title: lt(''), date: '', views: null },
      { url: `https://youtu.be/${IDS[1]}`, title: lt('Tên do admin đặt'), date: '2026-09-01', views: 99 },
      { url: `https://www.youtube.com/shorts/${IDS[2]}`, title: lt(''), date: '', views: null },
    ]
    await publish([musicSection({ newest: { label: lt(''), auto: false, keyword: '', items }, channel: { label: lt(''), auto: false, items: [] } })])
    expect(h.jobs.enqueued.filter((j) => j.name === 'youtube-sync')).toHaveLength(2) // save and publish
    const yt = fakeYouTube([
      [`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${IDS[0]}`)}&format=json`, { body: JSON.stringify({ title: 'MV chính thức', author_name: 'Du Ca' }), type: 'application/json' }],
      [`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${IDS[1]}`)}`, { body: JSON.stringify({ title: 'Tên YouTube' }), type: 'application/json' }],
      [`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${IDS[2]}`)}`, { status: 401, body: 'private' }],
      ...thumbRoutes(),
    ])
    const r = await youtubeSync(deps(yt.fetch))
    expect(r.titles).toBe(2)
    expect(r.thumbs.stored).toBe(3)
    const res = await h.http().get('/api/site/pages/intro').expect(200)
    expect(res.body.youtube.videos[IDS[0]!].title).toBe('MV chính thức')
    // The admin's own title stays in the section and wins on the page; the stored one is only the fallback.
    expect(res.body.youtube.videos[IDS[1]!].title).toBe('Tên YouTube')
    expect(res.body.sections[0].data.newest.items[1].title).toEqual(lt('Tên do admin đặt'))
    expect(res.body.youtube.videos[IDS[2]!].title).toBeNull()
    expect(res.body.youtube.feeds.music).toEqual({ newest: [], popular: [], channel: [] })

    // Within a day nothing is asked again: the failed title waits, the thumbnails are stored.
    const again = fakeYouTube([])
    await youtubeSync(deps(again.fetch))
    expect(again.calls).toEqual([])
    const later = fakeYouTube([[/oembed/, { body: JSON.stringify({ title: 'Đã công khai' }), type: 'application/json' }]])
    await youtubeSync(deps(later.fetch, { now: () => new Date(Date.now() + 25 * 3600_000) }))
    expect(later.calls).toHaveLength(1)
    expect((await videosCol(h.db).findOne({ _id: IDS[2]! }))!.title).toBe('Đã công khai')
  })

  it('a thumbnail that cannot be fetched or decoded is left out (the page shows its placeholder) and retried a few times', async () => {
    await publish([musicSection()])
    const yt = fakeYouTube([
      ['https://www.youtube.com/feeds/', { body: feed([{ id: IDS[0]!, title: 'A' }, { id: IDS[1]!, title: 'B' }]) }],
      [new RegExp(`${IDS[0]}/maxresdefault`), { status: 404 }],
      [new RegExp(`${IDS[0]}/hqdefault`), { body: 'not an image', type: 'image/jpeg' }],
      [new RegExp(`${IDS[1]}/`), { body: '<html>', type: 'text/html' }],
    ])
    const r = await youtubeSync(deps(yt.fetch))
    expect(r.thumbs).toEqual({ stored: 0, failed: 2 })
    const res = await h.http().get('/api/site/pages/intro').expect(200)
    expect(res.body.youtube.videos[IDS[0]!].thumb).toBeNull()
    expect((await videosCol(h.db).findOne({ _id: IDS[0]! }))!.thumbTries).toBe(1)
    const soon = fakeYouTube([])
    await youtubeSync(deps(soon.fetch))
    expect(soon.calls).toEqual([])
  })

  it('without YOUTUBE_API_KEY the newest/popular automatic options do nothing; with it they follow the Data API', async () => {
    await publish([musicSection({ newest: { label: lt(''), auto: true, keyword: 'MV', items: [] }, popular: { label: lt(''), auto: true, items: [] }, channel: { label: lt(''), auto: false, items: [] } })])
    const none = fakeYouTube([])
    const r0 = await youtubeSync(deps(none.fetch))
    expect(r0.feeds).toEqual({ fetched: [], failed: [], skipped: [] })
    expect(none.calls.some((u) => u.includes('googleapis'))).toBe(false)
    expect((await h.http().get('/api/admin/site/music').set(auth(admin.token))).body.apiKey).toBe(false)

    config.youtube = { apiKey: 'test-key' }
    const uploads = [
      { id: IDS[0]!, title: 'Vlog', publishedAt: '2026-10-21T00:00:00Z', viewCount: '10' },
      { id: IDS[1]!, title: 'Du Ca - Sao (Official MV)', publishedAt: '2026-10-15T00:00:00Z', viewCount: '5000' },
      { id: IDS[2]!, title: 'Du Ca - Trăng [mv]', publishedAt: '2026-10-19T00:00:00Z', viewCount: '900' },
      { id: IDS[3]!, title: 'Stream', publishedAt: '2026-01-01T00:00:00Z', viewCount: '99999' },
    ]
    const yt = fakeYouTube([
      ['https://www.googleapis.com/youtube/v3/playlistItems?', { body: JSON.stringify({ items: uploads.map((u) => ({ contentDetails: { videoId: u.id } })) }), type: 'application/json' }],
      [
        'https://www.googleapis.com/youtube/v3/videos?',
        { body: JSON.stringify({ items: uploads.map((u) => ({ id: u.id, snippet: { title: u.title, publishedAt: u.publishedAt }, statistics: { viewCount: u.viewCount } })) }), type: 'application/json' },
      ],
      ...thumbRoutes(),
    ])
    const r = await youtubeSync(deps(yt.fetch))
    expect(r.feeds.fetched.sort()).toEqual([`newest:${CH}:mv`, `popular:${CH}`])
    // One list of uploads answers both tabs.
    expect(yt.calls.filter((u) => u.includes('playlistItems'))).toHaveLength(1)
    expect(yt.calls.find((u) => u.includes('playlistItems'))).toContain(`playlistId=UU${CH.slice(2)}`)
    const res = await h.http().get('/api/site/pages/intro').expect(200)
    expect(res.body.youtube.feeds.music.popular).toEqual([IDS[3], IDS[1], IDS[2], IDS[0]])
    expect(res.body.youtube.feeds.music.newest).toEqual([IDS[2], IDS[1]])
    expect(res.body.youtube.videos[IDS[3]!].views).toBe(99999)
    expect(JSON.stringify(res.body)).not.toContain('test-key')
    expect((await h.http().get('/api/admin/site/music').set(auth(admin.token))).body.apiKey).toBe(true)

    // Removing the key again: the tabs fall back to their hand-picked videos (none here).
    config.youtube = { apiKey: undefined }
    await h.app.get(FeedCache).bump()
    expect((await h.http().get('/api/site/pages/intro')).body.youtube.feeds.music).toEqual({ newest: [], popular: [], channel: [] })
  })

  it('hand-picked videos come first, automatic ones fill the tab up to 12 without repeats', async () => {
    const items = [{ url: `https://youtu.be/${IDS[2]}`, title: lt(''), date: '', views: null }]
    await publish([musicSection({ channel: { label: lt(''), auto: true, items } })])
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `vid${String(i).padStart(8, '0')}`, title: `V${i}` }))
    await youtubeSync(deps(fakeYouTube([['https://www.youtube.com/feeds/', { body: feed([{ id: IDS[2]!, title: 'pinned' }, ...many]) }]]).fetch))
    const res = await h.http().get('/api/site/pages/intro').expect(200)
    const auto = res.body.youtube.feeds.music.channel as string[]
    expect(auto).toHaveLength(11)
    expect(auto).not.toContain(IDS[2])
  })

  it('refresh is admin-only, queues a forced sync and is rate-limited; saving without a music section queues nothing', async () => {
    const user = await createUser(h)
    const mod = await createUser(h, { role: 'moderator' })
    for (const u of [user, mod]) {
      expect((await h.http().post('/api/admin/site/music/refresh').set(auth(u.token))).status).toBe(403)
      expect((await h.http().get('/api/admin/site/music').set(auth(u.token))).status).toBe(403)
    }
    expect((await h.http().post('/api/admin/site/music/refresh')).status).toBe(401)
    h.jobs.clear()
    const res = await h.http().post('/api/admin/site/music/refresh').set(auth(admin.token))
    expect(res.status).toBe(202)
    expect(h.jobs.enqueued).toEqual([{ name: 'youtube-sync', data: { force: true } }])

    h.enableThrottling()
    const codes: number[] = []
    for (let i = 0; i < 4; i++) codes.push((await h.http().post('/api/admin/site/music/refresh').set(auth(admin.token))).status)
    expect(codes.slice(0, 3)).toEqual([202, 202, 202])
    expect(codes[3]).toBe(429)

    await h.reset()
    admin = await createUser(h, { role: 'admin' })
    const d = (await h.http().get('/api/admin/site/pages/intro/draft').set(auth(admin.token))).body
    h.jobs.clear()
    await h.http().put('/api/admin/site/pages/intro/draft').set(auth(admin.token)).send({ revision: d.revision, sections: [{ id: 'v', type: 'vibe', visible: true, data: { eyebrow: lt(''), text: lt('Xin chào'), image: null, cta: null } }] }).expect(200)
    expect(h.jobs.enqueued).toEqual([])
  })

  it('the draft preview gets the stored data too; videos no page uses are forgotten after 30 days', async () => {
    await publish([musicSection()])
    await youtubeSync(deps(fakeYouTube([['https://www.youtube.com/feeds/', { body: FEED_OK }], ...thumbRoutes()]).fetch))
    const d = (await h.http().get('/api/admin/site/pages/intro/draft').set(auth(admin.token))).body
    expect(d.youtube.feeds.music.channel).toEqual(IDS.slice(0, 3))
    expect(d.youtube.videos[IDS[0]!].thumb.src).toContain('/youtube/')

    await publish([{ id: 'v', type: 'vibe', visible: true, data: { eyebrow: lt(''), text: lt('Xin chào'), image: null, cta: null } }])
    const storage = h.app.get(StorageService)
    const r = await youtubeSync(deps(fakeYouTube([]).fetch, { now: () => new Date(Date.now() + PRUNE_AFTER_MS + FEED_FRESH_MS) }))
    expect(r.pruned).toBe(3)
    expect(await videosCol(h.db).countDocuments()).toBe(0)
    expect(await storage.stat(config.minio.bucketPublic, `youtube/${IDS[0]}/w480.webp`)).toBeNull()
    expect(await feedsCol(h.db).countDocuments()).toBe(0)
  })
})

describe('music section cache', () => {
  let h: Harness | undefined
  const REDIS_URL = process.env.REDIS_URL_TEST || 'redis://127.0.0.1:6379/15'
  const raw = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null })
  raw.on('error', () => {})
  let up = false
  beforeAll(async () => {
    try {
      await raw.connect()
      up = (await raw.ping()) === 'PONG'
    } catch {
      up = false
    }
    if (up) {
      await raw.flushdb()
      h = await createTestHarness({ redisUrl: REDIS_URL })
    }
  })
  afterAll(async () => {
    await h?.close()
    if (up) raw.disconnect()
  })

  it('a sync that changes what visitors see refreshes the cached page', async (ctx) => {
    if (!up || !h) return ctx.skip()
    await vi.waitFor(() => expect(h!.app.get(FeedCache).ready).toBe(true), { timeout: 3000 })
    await h.http().get('/api/site/pages/intro').expect(200)
    await h.http().get('/api/site/pages/intro').expect(200)
    expect((await h.http().get('/api/site/pages/intro')).body.youtube.feeds.music.channel).toEqual([])
    const yt = fakeYouTube([['https://www.youtube.com/feeds/', { body: FEED_OK }]])
    await youtubeSync({ ...jobDeps(h), fetch: yt.fetch, feed: h.app.get(FeedCache) })
    expect((await h.http().get('/api/site/pages/intro')).body.youtube.feeds.music.channel).toEqual(IDS.slice(0, 3))
  })
})

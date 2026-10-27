import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Redis } from 'ioredis'
import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeedCache } from '../src/cache/feed-cache.service'
import { prepareDatabase } from '../src/database/prepare'
import { cleanupUploads } from '../src/jobs/handlers/cleanup-uploads'
import { processFile } from '../src/jobs/handlers/process-file'
import { ensureHomepage, ensureSitePages, HOME_SEED, INTRO_SEED, LEGACY_HOME_SEED } from '../src/site/home-seed'
import { approve, createPost, createTestHarness, createUser, type Harness, jobDeps, postMultipart, uploadFixture } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
const lt = (vi: string, en = '') => ({ vi, en })

/** Presigns and uploads tiny.png as a site image (admin token), optionally processing it like the worker would. */
async function siteImage(h: Harness, admin: { token: string }, process = true): Promise<string> {
  const id = await uploadSite(h, admin)
  if (process) await processFile(jobDeps(h), { fileId: id })
  return id
}

async function uploadSite(h: Harness, user: { token: string }, fixture = 'tiny.png', mime = 'image/png'): Promise<string> {
  const body = readFileSync(join(__dirname, 'fixtures', fixture))
  const presign = await h.http().post('/api/uploads').set(auth(user.token)).send({ name: fixture, size: body.length, mime, purpose: 'site' })
  if (presign.status !== 201) throw new Error(`presign ${presign.status} ${JSON.stringify(presign.body)}`)
  const up = await postMultipart(presign.body.url, presign.body.fields, body)
  if (!up.ok) throw new Error(`storage ${up.status}`)
  const done = await h.http().post(`/api/uploads/${presign.body.fileId}/complete`).set(auth(user.token))
  if (done.status !== 200) throw new Error(`complete ${done.status}`)
  return presign.body.fileId as string
}

/** Uploads one-second.mp4 as a site video and processes it like the worker would. */
async function siteVideo(h: Harness, admin: { token: string }, process = true): Promise<string> {
  const id = await uploadSite(h, admin, 'one-second.mp4', 'video/mp4')
  if (process) await processFile(jobDeps(h), { fileId: id })
  return id
}

function heroVideoWith(video: string | null, images: string[] = [], name = 'Hibiki Du Ca') {
  return {
    id: 'top',
    type: 'heroVideo',
    visible: true,
    data: {
      eyebrow: lt(''),
      name: lt(name),
      subtitle: lt(''),
      video: video ? { fileId: video } : null,
      videoMobile: null,
      images: images.map((fileId) => ({ fileId, alt: lt('Du Ca'), decorative: false })),
      link: { kicker: lt('Đang phát'), label: lt('Kênh YouTube'), href: 'https://www.youtube.com/@hibikiduca' },
    },
  }
}

function heroWith(images: string[], title = 'Hibiki Du Ca') {
  return {
    id: 'hero',
    type: 'hero',
    visible: true,
    data: { eyebrow: lt('NIJIGEN'), title: lt(title), subtitle: lt(''), images: images.map((fileId) => ({ fileId, alt: lt('Du Ca'), decorative: false })), ctas: [] },
  }
}

describe('homepage CMS', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  async function draftOf(admin: { token: string }) {
    const res = await h.http().get('/api/admin/site/home/draft').set(auth(admin.token))
    expect(res.status).toBe(200)
    return res.body as { revision: number; sections: Array<Record<string, unknown>>; unpublished: boolean; images: Record<string, { src: string; srcset: string }> }
  }

  it('public GET seeds the default landing page on first use: full-screen sections, no media yet', async () => {
    const res = await h.http().get('/api/site/home')
    expect(res.status).toBe(200)
    const types = (res.body.sections as Array<{ type: string; visible: boolean }>).map((s) => s.type)
    expect(types).toEqual(['heroVideo', 'releases', 'music', 'spotlight', 'vibe', 'footer'])
    expect(types).toEqual(HOME_SEED.filter((s) => s.visible).map((s) => s.type))
    expect(res.body).toMatchObject({ page: 'home', images: {}, videos: {} })
    expect(res.body.sections[0].data).toMatchObject({ name: lt('Hibiki Du Ca', 'Hibiki Du Ca'), video: null, link: { href: 'https://www.youtube.com/@hibikiduca' } })
    expect(res.body.sections[1].data.source).toBe('latestFanart')
    // The spotlight only names what is public: the original model's debut and the chibi model.
    expect(JSON.stringify(res.body.sections[3])).toContain('08/08/2021')
    expect((await h.http().get('/api/site/pages/home')).body).toEqual(res.body)
  })

  it('the Introduction page carries the long-form profile; unknown pages are 404', async () => {
    const res = await h.http().get('/api/site/pages/intro')
    expect(res.status).toBe(200)
    expect(res.body.page).toBe('intro')
    const types = res.body.sections.map((s: { type: string }) => s.type)
    expect(types[0]).toBe('hero')
    expect(types).toEqual(INTRO_SEED.filter((s) => s.visible).map((s) => s.type))
    expect(types).toContain('profile')
    expect(types).not.toContain('gallery')
    expect(res.body.sections[0].data.title.vi).toBe('Hibiki Du Ca')
    for (const bad of ['admin', 'HOME', '..', 'x'.repeat(50)]) expect((await h.http().get(`/api/site/pages/${bad}`)).status, bad).toBe(404)
    const admin = await createUser(h, { role: 'admin' })
    expect((await h.http().get('/api/admin/site/pages/nope/draft').set(auth(admin.token))).status).toBe(404)
  })

  describe('upgrade of the first homepage', () => {
    /** The database as the first homepage release left it: only `home`, holding the long-form seed. */
    async function legacyDb(edit?: { updatedBy?: Types.ObjectId; publishedBy?: Types.ObjectId; sections?: unknown[] }) {
      const now = new Date()
      await h.db.collection('homepage').deleteMany({})
      await h.db.collection('homepage').insertOne({
        _id: 'home' as never,
        draft: { revision: 3, sections: edit?.sections ?? LEGACY_HOME_SEED, updatedAt: now, updatedBy: edit?.updatedBy ?? null },
        published: { sections: LEGACY_HOME_SEED, publishedAt: now, publishedBy: edit?.publishedBy ?? null },
      })
    }

    it('an untouched seeded homepage becomes the landing page; its content moves to the Introduction page', async () => {
      await legacyDb()
      const lines: string[] = []
      await prepareDatabase(h.db, (l) => lines.push(l))
      expect(lines.find((l) => l.startsWith('homepage:'))).toMatch(/upgraded.*introduction page: created/)
      const home = await h.db.collection('homepage').findOne({ _id: 'home' as never })
      expect(home!.draft.revision).toBe(4)
      expect(home!.published.sections.map((s: { type: string }) => s.type)).toEqual(HOME_SEED.map((s) => s.type))
      expect(home!.draft.sections).toEqual(home!.published.sections)
      expect((await h.http().get('/api/site/pages/intro')).body.sections.map((s: { id: string }) => s.id)).toEqual(INTRO_SEED.filter((s) => s.visible).map((s) => s.id))
      // Running again changes nothing.
      expect(await ensureSitePages(h.db)).toEqual({ home: 'kept', intro: 'kept' })
    })

    it('a homepage an admin saved, published or changed is never replaced', async () => {
      const someone = new Types.ObjectId()
      const changed = LEGACY_HOME_SEED.map((s) => (s.type === 'hero' ? { ...s, data: { ...s.data, title: lt('Của admin') } } : s))
      for (const edit of [{ updatedBy: someone }, { publishedBy: someone }, { sections: changed }]) {
        await legacyDb(edit)
        expect(await ensureSitePages(h.db)).toEqual({ home: 'kept', intro: 'created' })
        const home = await h.db.collection('homepage').findOne({ _id: 'home' as never })
        expect(home!.draft.revision).toBe(3)
        expect(home!.published.sections[0].type).toBe('hero')
        if (edit.sections) expect(home!.draft.sections[0].data.title.vi).toBe('Của admin')
      }
      // The kept homepage still renders, and new section types can be added to it.
      const admin = await createUser(h, { role: 'admin' })
      const d = await draftOf(admin)
      const res = await h.http().put('/api/admin/site/home/draft').set(auth(admin.token)).send({ revision: d.revision, sections: [...d.sections, heroVideoWith(null)] })
      expect(res.status).toBe(200)
      expect(res.body.sections.map((s: { type: string }) => s.type).at(-1)).toBe('heroVideo')
    })
  })

  it('each page has its own draft, revision and publish; the log names the page', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const intro = (await h.http().get('/api/admin/site/pages/intro/draft').set(auth(admin.token))).body
    const home = await draftOf(admin)
    expect(intro.page).toBe('intro')
    const saved = await h.http().put('/api/admin/site/pages/intro/draft').set(auth(admin.token)).send({ revision: intro.revision, sections: [heroWith([], 'Giới thiệu mới')] })
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({ page: 'intro', unpublished: true, revision: intro.revision + 1 })
    expect((await draftOf(admin)).revision).toBe(home.revision)
    expect(JSON.stringify((await h.http().get('/api/site/pages/intro')).body)).not.toContain('Giới thiệu mới')

    // The homepage's revision does not publish the intro draft.
    expect((await h.http().post('/api/admin/site/pages/intro/publish').set(auth(admin.token)).send({ revision: intro.revision })).status).toBe(409)
    await h.http().post('/api/admin/site/pages/intro/publish').set(auth(admin.token)).send({ revision: intro.revision + 1 }).expect(200)
    const pub = await h.http().get('/api/site/pages/intro')
    expect(pub.body.sections.map((s: { data: { title: { vi: string } } }) => s.data.title.vi)).toEqual(['Giới thiệu mới'])
    expect((await h.http().get('/api/site/home')).body.sections[0].type).toBe('heroVideo')

    const d = (await h.http().get('/api/admin/site/pages/intro/draft').set(auth(admin.token))).body
    await h.http().post('/api/admin/site/pages/intro/discard').set(auth(admin.token)).send({ revision: d.revision }).expect(200)
    const logs = await h.http().get('/api/admin/logs').set(auth(admin.token))
    expect(logs.body.items.map((l: { action: string; targetId: string }) => [l.action, l.targetId])).toEqual([
      ['homepage_discard', 'intro'],
      ['homepage_publish', 'intro'],
    ])
    for (const who of [await createUser(h), await createUser(h, { role: 'moderator' })]) {
      await h.http().get('/api/admin/site/pages/intro/draft').set(auth(who.token)).expect(403)
      await h.http().put('/api/admin/site/pages/intro/draft').set(auth(who.token)).send({ revision: 0, sections: [] }).expect(403)
      await h.http().post('/api/admin/site/pages/intro/publish').set(auth(who.token)).send({ revision: 0 }).expect(403)
    }
  })

  it('seeding is idempotent and never overwrites an edited homepage (setup re-run included)', async () => {
    expect(await ensureHomepage(h.db)).toBe(true)
    expect(await ensureHomepage(h.db)).toBe(false)
    const admin = await createUser(h, { role: 'admin' })
    const d = await draftOf(admin)
    await h.http().put('/api/admin/site/home/draft').set(auth(admin.token)).send({ revision: d.revision, sections: [heroWith([], 'Đã sửa')] }).expect(200)
    await h.http().post('/api/admin/site/home/publish').set(auth(admin.token)).send({ revision: d.revision + 1 }).expect(200)
    await prepareDatabase(h.db)
    expect(await ensureHomepage(h.db)).toBe(false)
    const pub = await h.http().get('/api/site/home')
    expect(pub.body.sections).toHaveLength(1)
    expect(pub.body.sections[0].data.title.vi).toBe('Đã sửa')
  })

  it('only admins read or edit the draft; moderators and users are refused', async () => {
    const user = await createUser(h)
    const mod = await createUser(h, { role: 'moderator' })
    await h.http().get('/api/admin/site/home/draft').expect(401)
    for (const who of [user, mod]) {
      await h.http().get('/api/admin/site/home/draft').set(auth(who.token)).expect(403)
      await h.http().put('/api/admin/site/home/draft').set(auth(who.token)).send({ revision: 0, sections: [] }).expect(403)
      await h.http().post('/api/admin/site/home/publish').set(auth(who.token)).send({ revision: 0 }).expect(403)
      await h.http().post('/api/admin/site/home/discard').set(auth(who.token)).send({ revision: 0 }).expect(403)
      await h.http().get('/api/admin/site/images').set(auth(who.token)).expect(403)
      const presign = await h.http().post('/api/uploads').set(auth(who.token)).send({ name: 'a.png', size: 10, mime: 'image/png', purpose: 'site' })
      expect(presign.status).toBe(403)
    }
  })

  it('a saved draft is not public until published; publish logs and serves it; discard resets the draft', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const d0 = await draftOf(admin)
    expect(d0.unpublished).toBe(false)
    const saved = await h.http().put('/api/admin/site/home/draft').set(auth(admin.token)).send({ revision: d0.revision, sections: [heroWith([], 'Bản nháp bí mật')] })
    expect(saved.status).toBe(200)
    expect(saved.body.revision).toBe(d0.revision + 1)
    expect(saved.body.unpublished).toBe(true)
    expect(saved.body.updatedBy).toEqual({ username: admin.username })

    const pub = await h.http().get('/api/site/home')
    expect(JSON.stringify(pub.body)).not.toContain('Bản nháp bí mật')

    await h.http().post('/api/admin/site/home/discard').set(auth(admin.token)).send({ revision: d0.revision + 1 }).expect(200)
    const reset = await draftOf(admin)
    expect(reset.unpublished).toBe(false)
    expect(reset.sections.map((s) => s.id)).toEqual(HOME_SEED.map((s) => s.id))

    await h.http().put('/api/admin/site/home/draft').set(auth(admin.token)).send({ revision: reset.revision, sections: [heroWith([], 'Lên sóng')] }).expect(200)
    const published = await h.http().post('/api/admin/site/home/publish').set(auth(admin.token)).send({ revision: reset.revision + 1 })
    expect(published.status).toBe(200)
    expect(published.body.unpublished).toBe(false)
    expect(published.body.publishedBy).toEqual({ username: admin.username })
    const after = await h.http().get('/api/site/home')
    expect(after.body.sections.map((s: { data: { title: { vi: string } } }) => s.data.title.vi)).toEqual(['Lên sóng'])

    const logs = await h.http().get('/api/admin/logs').set(auth(admin.token))
    expect(logs.body.items.map((l: { action: string }) => l.action)).toEqual(['homepage_publish', 'homepage_discard'])
    expect(logs.body.items[0]).toMatchObject({ targetType: 'site', targetId: 'home' })
  })

  it('hidden sections are kept in the draft but not served publicly', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const d = await draftOf(admin)
    const sections = [heroWith([]), { ...heroWith([], 'Ẩn'), id: 'hero-2', visible: false }]
    await h.http().put('/api/admin/site/home/draft').set(auth(admin.token)).send({ revision: d.revision, sections }).expect(200)
    await h.http().post('/api/admin/site/home/publish').set(auth(admin.token)).send({ revision: d.revision + 1 }).expect(200)
    expect((await h.http().get('/api/site/home')).body.sections.map((s: { id: string }) => s.id)).toEqual(['hero'])
    expect((await draftOf(admin)).sections.map((s) => s.id)).toEqual(['hero', 'hero-2'])
  })

  it('409 REVISION_CONFLICT when saving, publishing or discarding over a stale revision', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const other = await createUser(h, { role: 'admin' })
    const d = await draftOf(admin)
    await h.http().put('/api/admin/site/home/draft').set(auth(other.token)).send({ revision: d.revision, sections: [heroWith([], 'Người khác')] }).expect(200)
    const stale = await h.http().put('/api/admin/site/home/draft').set(auth(admin.token)).send({ revision: d.revision, sections: [heroWith([], 'Của tôi')] })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toMatchObject({ code: 'REVISION_CONFLICT', details: { revision: d.revision + 1 } })
    expect((await h.http().post('/api/admin/site/home/publish').set(auth(admin.token)).send({ revision: d.revision })).status).toBe(409)
    expect((await h.http().post('/api/admin/site/home/discard').set(auth(admin.token)).send({ revision: d.revision })).status).toBe(409)
    expect(JSON.stringify((await h.http().get('/api/site/home')).body)).not.toContain('Người khác')
  })

  it('refuses unsafe links, unknown keys and invalid sections', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const { revision } = await draftOf(admin)
    const put = (sections: unknown[]) => h.http().put('/api/admin/site/home/draft').set(auth(admin.token)).send({ revision, sections })
    const hero = heroWith([])
    const bad = [
      [{ ...hero, data: { ...hero.data, ctas: [{ label: lt('x'), href: 'javascript:alert(1)' }] } }],
      [{ ...hero, data: { ...hero.data, ctas: [{ label: lt('x'), href: '//evil.example' }] } }],
      [{ id: 'about', type: 'about', data: { heading: lt('A'), body: lt('[x](javascript:alert(1))') } }],
      [{ id: 'l', type: 'links', data: { heading: lt('L'), items: [{ platform: 'x', label: lt(''), url: 'data:text/html,hi' }] } }],
      [{ id: 'v', type: 'videos', data: { heading: lt('V'), items: [{ url: 'https://evil.example/watch?v=dQw4w9WgXcQ', title: lt('') }] } }],
      [{ ...hero, data: { ...hero.data, html: '<script>' } }],
      [{ id: 'x', type: 'iframe', data: {} }],
    ]
    for (const sections of bad) {
      const res = await put(sections)
      expect(res.status, JSON.stringify(sections)).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    }
    // Markup in text is kept as text (the web renders it escaped).
    const ok = await put([{ id: 'about', type: 'about', data: { heading: lt('<b>A</b>'), body: lt('<img src=x onerror=alert(1)>') } }])
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
    expect(ok.body.sections[0].data.body.vi).toBe('<img src=x onerror=alert(1)>')
  })

  describe('site images', () => {
    it('site uploads are images or videos only; a post file, unknown id or processing image is refused where it must be', async () => {
      const admin = await createUser(h, { role: 'admin' })
      for (const [name, mime] of [['a.mp3', 'audio/mpeg'], ['a.zip', 'application/zip'], ['a.psd', 'image/vnd.adobe.photoshop']]) {
        const res = await h.http().post('/api/uploads').set(auth(admin.token)).send({ name, size: 10, mime, purpose: 'site' })
        expect(res.status, name).toBe(415)
      }
      for (const [name, mime] of [['a.mp4', 'video/mp4'], ['a.webm', 'video/webm']]) {
        expect((await h.http().post('/api/uploads').set(auth(admin.token)).send({ name, size: 10, mime, purpose: 'site' })).status, name).toBe(201)
      }
      // Over the upload size limit like any other file.
      const huge = await h.http().post('/api/uploads').set(auth(admin.token)).send({ name: 'big.mp4', size: 10 * 1024 * 1024 * 1024, mime: 'video/mp4', purpose: 'site' })
      expect(huge.status).toBe(413)

      const postFile = await uploadFixture(h, admin, 'tiny.png')
      await processFile(jobDeps(h), { fileId: postFile })
      const { revision } = await draftOf(admin)
      const put = (ids: string[], rev = revision) => h.http().put('/api/admin/site/home/draft').set(auth(admin.token)).send({ revision: rev, sections: [heroWith(ids)] })
      for (const ids of [[postFile], [new Types.ObjectId().toString()]]) {
        const res = await put(ids)
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('SITE_IMAGE_INVALID')
      }

      // Still processing: fine in a draft, not publishable.
      const pending = await siteImage(h, admin, false)
      expect((await put([pending])).status).toBe(200)
      const pub = await h.http().post('/api/admin/site/home/publish').set(auth(admin.token)).send({ revision: revision + 1 })
      expect(pub.status).toBe(400)
      expect(pub.body.error).toMatchObject({ code: 'SITE_IMAGE_INVALID', details: { fileIds: [pending] } })

      await processFile(jobDeps(h), { fileId: pending })
      await h.http().post('/api/admin/site/home/publish').set(auth(admin.token)).send({ revision: revision + 1 }).expect(200)
      const home = await h.http().get('/api/site/home')
      const img = home.body.images[pending]
      expect(img.src).toMatch(/test-cuka-public\/.+\?v=\d+$/)
      expect(img.srcset).toMatch(/ \d+w/)
    })

    it('the worker renders site images clean into the public bucket, with a large variant', async () => {
      const admin = await createUser(h, { role: 'admin' })
      const id = await siteImage(h, admin)
      const file = await h.db.collection('files').findOne({ _id: new Types.ObjectId(id) })
      expect(file).toMatchObject({ purpose: 'site', status: 'ready', watermarkedFor: '' })
      expect(file!.variants.map((v: { name: string }) => v.name).sort()).toEqual(['large', 'thumb_md', 'thumb_sm'])
      expect(new Set(file!.variants.map((v: { bucket: string }) => v.bucket))).toEqual(new Set(['test-cuka-public']))
    })

    it('site videos: the worker publishes the clip and a poster frame; the page serves both', async () => {
      const admin = await createUser(h, { role: 'admin' })
      const vid = await siteVideo(h, admin)
      const file = await h.db.collection('files').findOne({ _id: new Types.ObjectId(vid) })
      expect(file).toMatchObject({ purpose: 'site', kind: 'video', status: 'ready', watermarkedFor: '' })
      expect(file!.durationSec).toBeGreaterThan(0)
      const names = file!.variants.map((v: { name: string }) => v.name).sort()
      expect(names).toEqual(['large', 'preview', 'thumb_md', 'thumb_sm', 'video'])
      expect(new Set(file!.variants.map((v: { bucket: string }) => v.bucket))).toEqual(new Set(['test-cuka-public']))
      const clip = file!.variants.find((v: { name: string }) => v.name === 'video')
      expect(clip.objectKey).toMatch(/\/video\.mp4$/)
      expect((await jobDeps(h).storage.stat('test-cuka-public', clip.objectKey))!.size).toBe(file!.sizeBytes)

      const { revision } = await draftOf(admin)
      await h.http().put('/api/admin/site/home/draft').set(auth(admin.token)).send({ revision, sections: [heroVideoWith(vid)] }).expect(200)
      await h.http().post('/api/admin/site/home/publish').set(auth(admin.token)).send({ revision: revision + 1 }).expect(200)
      const home = (await h.http().get('/api/site/home')).body
      expect(home.videos[vid]).toMatchObject({ mime: 'video/mp4', durationSec: expect.any(Number) })
      expect(home.videos[vid].src).toMatch(/test-cuka-public\/.+\/video\.mp4\?v=\d+$/)
      // The poster frame, as responsive renders.
      expect(home.images[vid].srcset).toMatch(/ \d+w/)

      const lib = (await h.http().get('/api/admin/site/images').set(auth(admin.token))).body
      expect(lib.find((i: { id: string }) => i.id === vid)).toMatchObject({ kind: 'video', used: true, video: { mime: 'video/mp4' }, image: { src: expect.any(String) } })
      expect((await h.http().delete(`/api/admin/site/images/${vid}`).set(auth(admin.token))).status).toBe(409)
    })

    it('a video slot takes only a site video, an image slot only a site image; a processing video is not publishable', async () => {
      const admin = await createUser(h, { role: 'admin' })
      const img = await siteImage(h, admin)
      const vid = await siteVideo(h, admin)
      const { revision } = await draftOf(admin)
      const put = (sections: unknown[]) => h.http().put('/api/admin/site/home/draft').set(auth(admin.token)).send({ revision, sections })
      for (const sections of [[heroVideoWith(img)], [heroVideoWith(null, [vid])], [heroWith([vid])]]) {
        const res = await put(sections)
        expect(res.status, JSON.stringify(sections)).toBe(400)
        expect(res.body.error.code).toBe('SITE_IMAGE_INVALID')
      }
      const pending = await siteVideo(h, admin, false)
      await put([heroVideoWith(pending, [img])]).expect(200)
      const pub = await h.http().post('/api/admin/site/home/publish').set(auth(admin.token)).send({ revision: revision + 1 })
      expect(pub.status).toBe(400)
      expect(pub.body.error.details.fileIds).toEqual([pending])
      // Ready without its published clip (e.g. processed before the upgrade) still is not publishable.
      await processFile(jobDeps(h), { fileId: pending })
      await h.db.collection('files').updateOne({ _id: new Types.ObjectId(pending) }, { $pull: { variants: { name: 'video' } } as never })
      expect((await h.http().post('/api/admin/site/home/publish').set(auth(admin.token)).send({ revision: revision + 1 })).status).toBe(400)
      await processFile(jobDeps(h), { fileId: pending })
      await h.http().post('/api/admin/site/home/publish').set(auth(admin.token)).send({ revision: revision + 1 }).expect(200)
    })

    it('media used by the Introduction page is in use too, for deletion and for the cleanup job', async () => {
      const admin = await createUser(h, { role: 'admin' })
      const img = await siteImage(h, admin)
      const d = (await h.http().get('/api/admin/site/pages/intro/draft').set(auth(admin.token))).body
      await h.http().put('/api/admin/site/pages/intro/draft').set(auth(admin.token)).send({ revision: d.revision, sections: [heroWith([img])] }).expect(200)
      expect((await h.http().delete(`/api/admin/site/images/${img}`).set(auth(admin.token))).status).toBe(409)
      await h.db.collection('files').updateOne({ _id: new Types.ObjectId(img) }, { $set: { purpose: 'post', createdAt: new Date(Date.now() - 3 * 24 * 3600_000) } })
      await cleanupUploads({ ...jobDeps(h), jobs: { enqueue: async () => {} } })
      expect(await h.db.collection('files').countDocuments({ _id: new Types.ObjectId(img) })).toBe(1)
    })

    it('a site image cannot be attached to a post or used as an avatar', async () => {
      const admin = await createUser(h, { role: 'admin' })
      const id = await siteImage(h, admin)
      const res = await h
        .http()
        .post('/api/posts')
        .set(auth(admin.token))
        .send({ type: 'illustration', title: 't', description: '', rating: 'all', tags: [], credit: { isOwnWork: true }, aiDeclaration: true, files: [{ fileId: id, position: 0, isCover: true }] })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('FILE_NOT_READY')
      const avatar = await h.http().patch('/api/me').set(auth(admin.token)).send({ avatarFileId: id })
      expect(avatar.status).toBe(400)
    })

    it('library lists images with usage; only unused ones can be deleted; cleanup keeps the library', async () => {
      const admin = await createUser(h, { role: 'admin' })
      const used = await siteImage(h, admin)
      const spare = await siteImage(h, admin)
      const { revision } = await draftOf(admin)
      await h.http().put('/api/admin/site/home/draft').set(auth(admin.token)).send({ revision, sections: [heroWith([used])] }).expect(200)

      const list = await h.http().get('/api/admin/site/images').set(auth(admin.token))
      expect(list.status).toBe(200)
      const byId = Object.fromEntries(list.body.map((i: { id: string }) => [i.id, i]))
      expect(byId[used]).toMatchObject({ used: true, status: 'ready' })
      expect(byId[spare]).toMatchObject({ used: false })
      expect(byId[spare].image.src).toContain('?v=')

      // Old enough for the hourly cleanup, which must keep both (one is in the draft, the other in the library).
      await h.db.collection('files').updateMany({ purpose: 'site' }, { $set: { createdAt: new Date(Date.now() - 3 * 24 * 3600_000) } })
      await cleanupUploads({ ...jobDeps(h), jobs: { enqueue: async () => {} } })
      expect(await h.db.collection('files').countDocuments({ purpose: 'site' })).toBe(2)

      const inUse = await h.http().delete(`/api/admin/site/images/${used}`).set(auth(admin.token))
      expect(inUse.status).toBe(409)
      expect(inUse.body.error.code).toBe('SITE_IMAGE_IN_USE')
      await h.http().delete(`/api/admin/site/images/${spare}`).set(auth(admin.token)).expect(204)
      expect(await h.db.collection('files').countDocuments({ _id: new Types.ObjectId(spare) })).toBe(0)
      await h.http().delete(`/api/admin/site/images/${spare}`).set(auth(admin.token)).expect(404)
      const logs = await h.http().get('/api/admin/logs').set(auth(admin.token)).query({ action: 'site_image_delete' })
      expect(logs.body.items).toHaveLength(1)
    })

    it('cleanup removes failed site images', async () => {
      const admin = await createUser(h, { role: 'admin' })
      const id = await siteImage(h, admin)
      await h.db.collection('files').updateOne({ _id: new Types.ObjectId(id) }, { $set: { status: 'failed', createdAt: new Date(Date.now() - 3 * 24 * 3600_000) } })
      await cleanupUploads({ ...jobDeps(h), jobs: { enqueue: async () => {} } })
      expect(await h.db.collection('files').countDocuments({ _id: new Types.ObjectId(id) })).toBe(0)
    })
  })

  it('fanart showcase: approved all-ages posts only, newest first', async () => {
    const user = await createUser(h)
    const a = await createPost(h, user, { title: 'A' })
    const r18 = await createPost(h, user, { title: 'R', rating: 'r18' })
    const pending = await createPost(h, user, { title: 'P' })
    const b = await createPost(h, user, { title: 'B' })
    for (const id of [a, r18, b]) await approve(h, id)
    void pending
    const res = await h.http().get('/api/feed/showcase').query({ limit: 3 })
    expect(res.status).toBe(200)
    expect(res.body.items.map((p: { title: string }) => p.title)).toEqual(['B', 'A'])
    const adult = await createUser(h, { birthDate: '1990-01-01', showR18: true })
    const asAdult = await h.http().get('/api/feed/showcase').set(auth(adult.token))
    expect(asAdult.body.items.map((p: { title: string }) => p.title)).toEqual(['B', 'A'])
    expect((await h.http().get('/api/feed/showcase').query({ limit: 100 })).status).toBe(400)
  })
})

/** Same Redis database the feed-cache suite uses; skipped when nothing listens there. */
const REDIS_URL = process.env.REDIS_URL_TEST || 'redis://127.0.0.1:6379/15'

describe('homepage cache', () => {
  let h: Harness | undefined
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

  it('serves the published page from Redis and refreshes it on publish', async (ctx) => {
    if (!up || !h) return ctx.skip()
    await vi.waitFor(() => expect(h!.app.get(FeedCache).ready).toBe(true), { timeout: 3000 })
    const admin = await createUser(h, { role: 'admin' })
    await h.http().get('/api/site/home').expect(200) // starts a generation
    await h.http().get('/api/site/home').expect(200) // stored
    await vi.waitFor(async () => expect((await raw.keys('cuka:feed:v1:*')).length).toBeGreaterThan(0))

    // A change written behind the API's back stays invisible while the entry is cached…
    await h.db.collection('homepage').updateOne({ _id: 'home' as never }, { $set: { 'published.sections': [heroWith([], 'Ngầm')] } })
    expect(JSON.stringify((await h.http().get('/api/site/home')).body)).not.toContain('Ngầm')

    // …and a publish invalidates it at once.
    const d = (await h.http().get('/api/admin/site/home/draft').set(auth(admin.token))).body
    await h.http().put('/api/admin/site/home/draft').set(auth(admin.token)).send({ revision: d.revision, sections: [heroWith([], 'Mới xuất bản')] }).expect(200)
    await h.http().post('/api/admin/site/home/publish').set(auth(admin.token)).send({ revision: d.revision + 1 }).expect(200)
    const res = await h.http().get('/api/site/home')
    expect(res.body.sections[0].data.title.vi).toBe('Mới xuất bản')

    // Pages are cached apart: the intro page is its own entry, refreshed by its own publish.
    await h.http().get('/api/site/pages/intro').expect(200)
    await h.http().get('/api/site/pages/intro').expect(200)
    await h.db.collection('homepage').updateOne({ _id: 'intro' as never }, { $set: { 'published.sections': [heroWith([], 'Ngầm intro')] } })
    expect(JSON.stringify((await h.http().get('/api/site/pages/intro')).body)).not.toContain('Ngầm intro')
    const di = (await h.http().get('/api/admin/site/pages/intro/draft').set(auth(admin.token))).body
    await h.http().put('/api/admin/site/pages/intro/draft').set(auth(admin.token)).send({ revision: di.revision, sections: [heroWith([], 'Intro mới')] }).expect(200)
    await h.http().post('/api/admin/site/pages/intro/publish').set(auth(admin.token)).send({ revision: di.revision + 1 }).expect(200)
    expect((await h.http().get('/api/site/pages/intro')).body.sections[0].data.title.vi).toBe('Intro mới')
    expect((await h.http().get('/api/site/home')).body.sections[0].data.title.vi).toBe('Mới xuất bản')
  })
})

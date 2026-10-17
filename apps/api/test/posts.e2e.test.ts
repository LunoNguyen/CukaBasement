import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { processFile } from '../src/jobs/handlers/process-file'
import { rewatermark } from '../src/jobs/handlers/rewatermark'
import { SettingsService } from '../src/settings/settings.service'
import { StorageService } from '../src/storage/storage.service'
import { approve, createPost, createTestHarness, createUser, type Harness, jobDeps, uploadFixture } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

function yearsAgo(n: number): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  return d.toISOString().slice(0, 10)
}

const body = (fileId: string, over: Record<string, unknown> = {}) => ({
  type: 'illustration',
  title: 'Hello',
  rating: 'all',
  tags: [],
  aiDeclaration: true,
  credit: { isOwnWork: true },
  files: [{ fileId, position: 0, isCover: true }],
  ...over,
})

const repost = {
  isOwnWork: false,
  artistName: 'Ruri',
  artistHandle: '@_rurisuisen',
  platform: 'x',
  sourceUrl: 'https://x.com/_rurisuisen/status/1890567100382544149',
  permissionNote: 'asked on X',
}

describe('posts', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const posts = () => h.db.collection('posts')
  const loadPost = (id: string) => posts().findOne({ _id: new Types.ObjectId(id) })
  const readyPng = async (u: { token: string }) => {
    const fileId = await uploadFixture(h, u, 'tiny.png')
    await processFile(jobDeps(h), { fileId })
    return fileId
  }
  const create = (u: { token: string }, b: object) => h.http().post('/api/posts').set(auth(u.token)).send(b)

  describe('create', () => {
    it('create with aiDeclaration false → 400 VALIDATION_FAILED', async () => {
      const u = await createUser(h)
      const fileId = await readyPng(u)
      const res = await create(u, body(fileId, { aiDeclaration: false }))
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    })

    it('create with only a zip → 400 POST_NEEDS_MEDIA', async () => {
      const u = await createUser(h)
      const zip = await uploadFixture(h, u, 'fake.zip')
      const res = await create(u, body(zip))
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('POST_NEEDS_MEDIA')
    })

    it('create with a failed file → 400 FILE_NOT_READY', async () => {
      const u = await createUser(h)
      const fileId = await uploadFixture(h, u, 'tiny.png')
      await h.db.collection('files').updateOne({ _id: new Types.ObjectId(fileId) }, { $set: { status: 'failed' } })
      const res = await create(u, body(fileId))
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('FILE_NOT_READY')
    })

    it("create with another user's file → 400 FILE_NOT_READY", async () => {
      const u = await createUser(h)
      const other = await createUser(h)
      const fileId = await readyPng(other)
      const res = await create(u, body(fileId))
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('FILE_NOT_READY')
    })

    it('create with a file already attached to another post → 400 FILE_NOT_READY', async () => {
      const u = await createUser(h)
      const fileId = await readyPng(u)
      expect((await create(u, body(fileId))).status).toBe(201)
      const res = await create(u, body(fileId))
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('FILE_NOT_READY')
    })

    it('create with a processing file → 201 and media url null', async () => {
      const u = await createUser(h)
      const fileId = await uploadFixture(h, u, 'tiny.png')
      const res = await create(u, body(fileId))
      expect(res.status).toBe(201)
      expect(res.body.media).toEqual([
        expect.objectContaining({ fileId, kind: 'image', position: 0, isCover: true, status: 'processing', thumbSmUrl: null, thumbMdUrl: null, previewUrl: null, blurred: false }),
      ])
    })

    it('more files than settings.maxFilesPerPost → 400 TOO_MANY_FILES', async () => {
      await h.app.get(SettingsService).update({ maxFilesPerPost: 1 })
      const u = await createUser(h)
      const a = await readyPng(u)
      const b = await readyPng(u)
      const res = await create(u, body(a, { files: [{ fileId: a, position: 0, isCover: true }, { fileId: b, position: 1, isCover: false }] }))
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('TOO_MANY_FILES')
    })

    it('duplicate fileId or position, or two covers → 400 VALIDATION_FAILED', async () => {
      const u = await createUser(h)
      const a = await readyPng(u)
      const b = await readyPng(u)
      for (const files of [
        [{ fileId: a, position: 0, isCover: true }, { fileId: a, position: 1, isCover: false }],
        [{ fileId: a, position: 0, isCover: true }, { fileId: b, position: 0, isCover: false }],
        [{ fileId: a, position: 0, isCover: true }, { fileId: b, position: 1, isCover: true }],
      ]) {
        const res = await create(u, body(a, { files }))
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_FAILED')
      }
      expect(await posts().countDocuments()).toBe(0)
    })

    it('no cover given → the lowest position becomes the cover; media ordered by position', async () => {
      const u = await createUser(h)
      const a = await readyPng(u)
      const b = await readyPng(u)
      const res = await create(u, body(a, { files: [{ fileId: a, position: 5, isCover: false }, { fileId: b, position: 2, isCover: false }] }))
      expect(res.status).toBe(201)
      expect(res.body.media.map((m: { fileId: string; isCover: boolean }) => [m.fileId, m.isCover])).toEqual([
        [b, true],
        [a, false],
      ])
    })

    it('new post is pending and visible by direct link to anonymous', async () => {
      const u = await createUser(h)
      const id = await createPost(h, u, { title: 'My art', credit: repost })
      const res = await h.http().get(`/api/posts/${id}`)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({
        id,
        type: 'illustration',
        title: 'My art',
        description: '',
        rating: 'all',
        tags: [],
        credit: { ...repost, permissionNote: '' },
        review: { status: 'pending' },
        visibility: 'public',
        counts: { likes: 0, bookmarks: 0, comments: 0 },
        author: { id: u.id, username: u.username, displayName: expect.any(String), avatarUrl: null },
        viewerState: { liked: false, bookmarked: false },
      })
      expect(res.body.review).not.toHaveProperty('reason')
      const media = res.body.media[0]
      expect(media).toMatchObject({ status: 'ready', blurred: false, previewUrl: null })
      const storage = h.app.get(StorageService)
      const file = await h.db.collection('files').findOne({ _id: new Types.ObjectId(media.fileId) })
      const md = file!.variants.find((v: { name: string }) => v.name === 'thumb_md')
      expect(media.thumbMdUrl).toBe(storage.publicUrl(md.objectKey))
      expect((await h.db.collection('users').findOne({ _id: new Types.ObjectId(u.id) }))!.stats.postCount).toBe(1)
    })

    it('GET counts a view for others but not for the author', async () => {
      const u = await createUser(h)
      const id = await createPost(h, u)
      await h.http().get(`/api/posts/${id}`)
      await h.http().get(`/api/posts/${id}`).set(auth(u.token))
      await expect.poll(async () => (await loadPost(id))!.counts.views).toBe(1)
      await new Promise((r) => setTimeout(r, 50))
      expect((await loadPost(id))!.counts.views).toBe(1)
    })

    it('unknown or malformed id → 404 POST_NOT_FOUND', async () => {
      for (const id of [new Types.ObjectId().toString(), 'nope']) {
        const res = await h.http().get(`/api/posts/${id}`)
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('POST_NOT_FOUND')
      }
    })

    it('tags "#DuCaArt", "ducaart" dedupe to ["ducaart"] and tags.postCount = 1', async () => {
      const u = await createUser(h)
      const id = await createPost(h, u, { tags: ['#DuCaArt', 'ducaart', '   ', 'x'.repeat(31)] })
      expect((await loadPost(id))!.tags).toEqual(['ducaart'])
      expect(await h.db.collection('tags').find().toArray()).toEqual([{ _id: 'ducaart', display: 'DuCaArt', postCount: 1 }])
    })

    it('#ameoDuCa requires r18: rated all → 400 R18_TAG_REQUIRES_R18; rated r18 → 201', async () => {
      const u = await createUser(h)
      const bad = await create(u, body(await readyPng(u), { tags: ['#ameoDuCa'] }))
      expect(bad.status).toBe(400)
      expect(bad.body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'rating', reason: 'R18_TAG_REQUIRES_R18' } })
      expect(await posts().countDocuments()).toBe(0)
      const ok = await create(u, body(await readyPng(u), { tags: ['#ameoDuCa'], rating: 'r18' }))
      expect(ok.status).toBe(201)
      expect(ok.body.tags).toEqual(['ameoduca'])
    })

    it('repost credit without artistName/platform/sourceUrl → 400 CREDIT_REQUIRED; missing credit → 400 VALIDATION_FAILED', async () => {
      const u = await createUser(h)
      const fileId = await readyPng(u)
      for (const credit of [{ isOwnWork: false }, { ...repost, sourceUrl: '' }, { ...repost, artistName: '' }]) {
        const res = await create(u, body(fileId, { credit }))
        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('CREDIT_REQUIRED')
      }
      const { credit: _, ...noCredit } = body(fileId)
      const missing = await create(u, noCredit)
      expect(missing.status).toBe(400)
      expect(missing.body.error.code).toBe('VALIDATION_FAILED')
      expect(await posts().countDocuments()).toBe(0)
    })

    it('own work needs no artist fields; credit is stored with defaults', async () => {
      const u = await createUser(h)
      const res = await create(u, body(await readyPng(u)))
      expect(res.status).toBe(201)
      expect(res.body.credit).toEqual({ isOwnWork: true, artistName: '', artistHandle: '', platform: 'other', sourceUrl: '', permissionNote: '' })
      expect((await loadPost(res.body.id))!.credit).toEqual(res.body.credit)
      expect(await loadPost(res.body.id)).not.toHaveProperty('sourceCredit')
    })

    it('create always enqueues rewatermark for the post', async () => {
      const u = await createUser(h)
      const res = await create(u, body(await readyPng(u)))
      expect(res.status).toBe(201)
      expect(h.jobs.enqueued.filter((j) => j.name !== 'process-file')).toEqual([{ name: 'rewatermark', data: { postId: res.body.id } }])
    })

    it('r18 create enqueues only rewatermark (it places variants in the r18 bucket itself)', async () => {
      const u = await createUser(h)
      const fileId = await readyPng(u)
      h.jobs.clear()
      const res = await create(u, body(fileId, { rating: 'r18' }))
      expect(res.status).toBe(201)
      expect(h.jobs.enqueued).toEqual([{ name: 'rewatermark', data: { postId: res.body.id } }])
    })
  })

  describe('update', () => {
    it('edit title of approved post keeps approved; replacing a file → pending', async () => {
      const u = await createUser(h)
      const id = await createPost(h, u)
      await approve(h, id)
      const patch = await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ title: 'New title', tags: ['a'], description: 'd' })
      expect(patch.status).toBe(200)
      expect(patch.body).toMatchObject({ title: 'New title', tags: ['a'], review: { status: 'approved' } })

      const replacement = await readyPng(u)
      const res = await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ files: [{ fileId: replacement, position: 0, isCover: true }] })
      expect(res.status).toBe(200)
      expect(res.body.review.status).toBe('pending')
      expect(res.body.media.map((m: { fileId: string }) => m.fileId)).toEqual([replacement])
    })

    it('credit-only PATCH keeps approved and enqueues rewatermark; other edits do not', async () => {
      const u = await createUser(h)
      const id = await createPost(h, u)
      await approve(h, id)
      h.jobs.clear()
      const res = await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ credit: repost })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ credit: repost, review: { status: 'approved' } })
      expect(h.jobs.enqueued).toEqual([{ name: 'rewatermark', data: { postId: id } }])
      h.jobs.clear()
      await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ title: 'x' })
      expect(h.jobs.enqueued).toEqual([])
      const bad = await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ credit: { ...repost, platform: undefined } })
      expect(bad.status).toBe(400)
      expect(bad.body.error.code).toBe('CREDIT_REQUIRED')
      expect((await loadPost(id))!.credit).toEqual(repost)
    })

    it('reordering the same files keeps approved', async () => {
      const u = await createUser(h)
      const a = await readyPng(u)
      const b = await readyPng(u)
      const id = await createPost(h, u, { files: [{ fileId: a, position: 0, isCover: true }, { fileId: b, position: 1, isCover: false }] })
      await approve(h, id)
      const res = await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ files: [{ fileId: a, position: 1, isCover: false }, { fileId: b, position: 0, isCover: true }] })
      expect(res.status).toBe(200)
      expect(res.body.review.status).toBe('approved')
      expect(res.body.media.map((m: { fileId: string }) => m.fileId)).toEqual([b, a])
    })

    it('rejected post edited → pending and reason cleared', async () => {
      const u = await createUser(h)
      const id = await createPost(h, u)
      await posts().updateOne({ _id: new Types.ObjectId(id) }, { $set: { 'review.status': 'rejected', 'review.reason': 'blurry' } })
      expect((await h.http().get(`/api/posts/${id}`)).status).toBe(404)
      expect((await h.http().get(`/api/posts/${id}`).set(auth(u.token))).body.review).toEqual({ status: 'rejected', reason: 'blurry' })
      const res = await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ description: 'fixed' })
      expect(res.status).toBe(200)
      expect(res.body.review).toEqual({ status: 'pending' })
      expect((await loadPost(id))!.review.reason).toBeNull()
    })

    it('rating all → r18 keeps approved, r18 → all goes pending; both enqueue relocate-variants', async () => {
      const u = await createUser(h)
      const id = await createPost(h, u)
      await approve(h, id)
      h.jobs.clear()
      const up = await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ rating: 'r18' })
      expect(up.body).toMatchObject({ rating: 'r18', review: { status: 'approved' } })
      expect(h.jobs.enqueued).toEqual([{ name: 'relocate-variants', data: { postId: id } }])
      h.jobs.clear()
      const down = await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ rating: 'all' })
      expect(down.body).toMatchObject({ rating: 'all', review: { status: 'pending' } })
      expect(h.jobs.enqueued).toEqual([{ name: 'relocate-variants', data: { postId: id } }])
    })

    it('adding a file to an r18 post enqueues only rewatermark', async () => {
      const u = await createUser(h)
      const a = await readyPng(u)
      const id = await createPost(h, u, { rating: 'r18', files: [{ fileId: a, position: 0, isCover: true }] })
      h.jobs.clear()
      const b = await readyPng(u)
      h.jobs.clear()
      const res = await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ files: [{ fileId: a, position: 0, isCover: true }, { fileId: b, position: 1, isCover: false }] })
      expect(res.status).toBe(200)
      expect(h.jobs.enqueued).toEqual([{ name: 'rewatermark', data: { postId: id } }])
    })

    it('PATCH changing rating and credit together enqueues only rewatermark', async () => {
      const u = await createUser(h)
      const id = await createPost(h, u)
      h.jobs.clear()
      const res = await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ rating: 'r18', credit: repost })
      expect(res.status).toBe(200)
      expect(h.jobs.enqueued).toEqual([{ name: 'rewatermark', data: { postId: id } }])
    })

    it('tag edits move tag counts', async () => {
      const u = await createUser(h)
      const id = await createPost(h, u, { tags: ['a', 'b'] })
      await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ tags: ['b', 'C'] })
      const tags = await h.db.collection('tags').find().sort({ _id: 1 }).toArray()
      expect(tags.map((t) => [t._id, t.postCount])).toEqual([
        ['a', 0],
        ['b', 1],
        ['c', 1],
      ])
    })

    it('#ameoDuCa requires r18 on update: adding the tag to an all post, or r18 → all while tagged → 400', async () => {
      const u = await createUser(h)
      const patch = (id: string, b: object) => h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send(b)
      const allPost = await createPost(h, u)
      const addTag = await patch(allPost, { tags: ['AmeoDuCa'] })
      expect(addTag.status).toBe(400)
      expect(addTag.body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'rating', reason: 'R18_TAG_REQUIRES_R18' } })
      expect((await loadPost(allPost))!.tags).toEqual([])
      expect((await patch(allPost, { tags: ['AmeoDuCa'], rating: 'r18' })).status).toBe(200)

      const r18Post = await createPost(h, u, { rating: 'r18', tags: ['ameoduca'] })
      const toAll = await patch(r18Post, { rating: 'all' })
      expect(toAll.status).toBe(400)
      expect(toAll.body.error.details).toEqual({ field: 'rating', reason: 'R18_TAG_REQUIRES_R18' })
      expect((await loadPost(r18Post))!.rating).toBe('r18')
      expect((await patch(r18Post, { rating: 'all', tags: ['other'] })).status).toBe(200)
    })

    it('PATCH by non-owner → 403 FORBIDDEN', async () => {
      const u = await createUser(h)
      const other = await createUser(h)
      const id = await createPost(h, u)
      const res = await h.http().patch(`/api/posts/${id}`).set(auth(other.token)).send({ title: 'x' })
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    })
  })

  describe('media URLs', () => {
    it('r18 post: anonymous gets blurred=true and no original URL; adult with showR18 gets presigned URLs', async () => {
      const u = await createUser(h)
      const adult = await createUser(h, { birthDate: yearsAgo(20), showR18: true })
      const id = await createPost(h, u, { rating: 'r18' })

      const anon = await h.http().get(`/api/posts/${id}`)
      expect(anon.status).toBe(200)
      const am = anon.body.media[0]
      expect(am).toMatchObject({ blurred: true, previewUrl: null })
      expect(am.thumbMdUrl).toMatch(/\/blurred\.webp\?.*X-Amz-Signature=/)
      expect(am.thumbSmUrl).toMatch(/\/blurred\.webp\?.*X-Amz-Signature=/)
      expect(JSON.stringify(anon.body)).not.toMatch(/original\.|thumb_md|thumb_sm/)
      const fileUrl = await h.http().get(`/api/posts/${id}/files/${am.fileId}/url`)
      expect(fileUrl.status).toBe(404)

      const full = await h.http().get(`/api/posts/${id}`).set(auth(adult.token))
      const fm = full.body.media[0]
      expect(fm.blurred).toBe(false)
      expect(fm.thumbMdUrl).toMatch(/\/thumb_md\.webp\?.*X-Amz-Signature=/)
      expect(fm.thumbSmUrl).toMatch(/\/thumb_sm\.webp\?.*X-Amz-Signature=/)
      const ok = await fetch(fm.thumbMdUrl)
      expect(ok.status).toBe(200)
    })

    it('outside /mod staff follow the r18 rules: moderator with showR18 off gets blurred media and no file url', async () => {
      const u = await createUser(h)
      const mod = await createUser(h, { role: 'moderator', birthDate: yearsAgo(30), showR18: false })
      const id = await createPost(h, u, { rating: 'r18' })
      const res = await h.http().get(`/api/posts/${id}`).set(auth(mod.token))
      expect(res.body.media[0]).toMatchObject({ blurred: true, previewUrl: null, thumbMdUrl: expect.stringMatching(/\/blurred\.webp\?/) })
      const fileId = res.body.media[0].fileId
      expect((await h.http().get(`/api/posts/${id}/files/${fileId}/url`).set(auth(mod.token))).status).toBe(404)
      const eligible = await createUser(h, { role: 'moderator', birthDate: yearsAgo(30), showR18: true })
      const full = await h.http().get(`/api/posts/${id}`).set(auth(eligible.token))
      expect(full.body.media[0]).toMatchObject({ blurred: false, thumbMdUrl: expect.stringMatching(/thumb_md\.webp\?/) })
    })

    it('file url endpoint for r18 post by ineligible viewer → 404 POST_NOT_FOUND', async () => {
      const u = await createUser(h)
      const minor = await createUser(h, { birthDate: yearsAgo(10) })
      const adult = await createUser(h, { birthDate: yearsAgo(20), showR18: true })
      const id = await createPost(h, u, { rating: 'r18' })
      const fileId = (await loadPost(id))!.files[0].fileId.toString()
      for (const t of [undefined, minor.token]) {
        const req = h.http().get(`/api/posts/${id}/files/${fileId}/url`)
        const res = await (t ? req.set(auth(t)) : req)
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('POST_NOT_FOUND')
      }
      const ok = await h.http().get(`/api/posts/${id}/files/${fileId}/url`).set(auth(adult.token))
      expect(ok.status).toBe(200)
      expect(ok.body.url).toMatch(/\/original\.png\?.*response-content-disposition=attachment/)
      expect((await fetch(ok.body.url)).status).toBe(200)
    })

    it('file url endpoint for an all post works anonymously; a file not in the post → 404', async () => {
      const u = await createUser(h)
      const id = await createPost(h, u)
      const fileId = (await loadPost(id))!.files[0].fileId.toString()
      const ok = await h.http().get(`/api/posts/${id}/files/${fileId}/url`)
      expect(ok.status).toBe(200)
      expect(new URL(ok.body.url).searchParams.get('response-content-disposition')).toBe("attachment; filename*=UTF-8''tiny.png")
      const stranger = await readyPng(u)
      expect((await h.http().get(`/api/posts/${id}/files/${stranger}/url`)).status).toBe(404)
    })
  })

  describe('delete', () => {
    it('delete by non-owner user → 403 FORBIDDEN; by moderator → 204', async () => {
      const u = await createUser(h)
      const other = await createUser(h)
      const mod = await createUser(h, { role: 'moderator' })
      const id = await createPost(h, u, { tags: ['x'] })
      const forbidden = await h.http().delete(`/api/posts/${id}`).set(auth(other.token))
      expect(forbidden.status).toBe(403)
      expect(forbidden.body.error.code).toBe('FORBIDDEN')
      const ok = await h.http().delete(`/api/posts/${id}`).set(auth(mod.token))
      expect(ok.status).toBe(204)
      expect((await loadPost(id))!.deletedAt).toBeInstanceOf(Date)
      expect((await h.http().get(`/api/posts/${id}`).set(auth(u.token))).status).toBe(404)
      expect((await h.db.collection('users').findOne({ _id: new Types.ObjectId(u.id) }))!.stats.postCount).toBe(0)
      expect((await h.db.collection('tags').findOne({ _id: 'x' as never }))!.postCount).toBe(0)
      expect((await h.http().delete(`/api/posts/${id}`).set(auth(u.token))).status).toBe(404)
    })

    it("moderator deleting an admin's post → 403 CANNOT_MODERATE_PEER; admin may", async () => {
      const adminUser = await createUser(h, { role: 'admin' })
      const mod = await createUser(h, { role: 'moderator' })
      const otherAdmin = await createUser(h, { role: 'admin' })
      const id = await createPost(h, adminUser)
      const res = await h.http().delete(`/api/posts/${id}`).set(auth(mod.token))
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('CANNOT_MODERATE_PEER')
      expect((await h.http().delete(`/api/posts/${id}`).set(auth(otherAdmin.token))).status).toBe(204)
    })

    it('staff delete logs remove and notifies the author post_hidden; owner delete does neither', async () => {
      const u = await createUser(h)
      const mod = await createUser(h, { role: 'moderator' })
      const id = await createPost(h, u)
      expect((await h.http().delete(`/api/posts/${id}`).set(auth(mod.token))).status).toBe(204)
      const logs = await h.db.collection('moderationLogs').find({}).toArray()
      expect(logs.map((l) => [l.action, l.targetType, l.targetId, l.actorId.toString()])).toEqual([['remove', 'post', id, mod.id]])
      const notes = await h.db.collection('notifications').find({ userId: new Types.ObjectId(u.id) }).toArray()
      expect(notes.map((n) => [n.type, n.postId.toString()])).toEqual([['post_hidden', id]])

      const own = await createPost(h, u)
      expect((await h.http().delete(`/api/posts/${own}`).set(auth(u.token))).status).toBe(204)
      expect(await h.db.collection('moderationLogs').countDocuments()).toBe(1)
      expect(await h.db.collection('notifications').countDocuments()).toBe(1)
    })

    it('owner can delete their own post', async () => {
      const u = await createUser(h)
      const id = await createPost(h, u)
      expect((await h.http().delete(`/api/posts/${id}`).set(auth(u.token))).status).toBe(204)
    })
  })

  describe('original file access by credit', () => {
    it('repost original: owner and staff → 200, anyone else → 404 POST_NOT_FOUND', async () => {
      const u = await createUser(h)
      const other = await createUser(h)
      const mod = await createUser(h, { role: 'moderator' })
      const id = await createPost(h, u, { credit: repost })
      const fileId = (await loadPost(id))!.files[0].fileId.toString()
      const url = `/api/posts/${id}/files/${fileId}/url`
      for (const t of [undefined, other.token]) {
        const req = h.http().get(url)
        const res = await (t ? req.set(auth(t)) : req)
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('POST_NOT_FOUND')
      }
      for (const t of [u.token, mod.token]) {
        const res = await h.http().get(url).set(auth(t))
        expect(res.status).toBe(200)
        expect(res.body.url).toMatch(/\/original\.png\?/)
      }
    })

    it('repost video and audio originals stay available to anyone who can view the post', async () => {
      const u = await createUser(h)
      const other = await createUser(h)
      const video = await uploadFixture(h, u, 'one-second.mp4')
      const audio = await uploadFixture(h, u, 'tone.mp3')
      await processFile(jobDeps(h), { fileId: video })
      await processFile(jobDeps(h), { fileId: audio })
      const id = await createPost(h, u, {
        type: 'video',
        credit: repost,
        files: [
          { fileId: video, position: 0, isCover: true },
          { fileId: audio, position: 1, isCover: false },
        ],
      })
      for (const fileId of [video, audio]) {
        expect((await h.http().get(`/api/posts/${id}/files/${fileId}/url`)).status).toBe(200)
        expect((await h.http().get(`/api/posts/${id}/files/${fileId}/url`).set(auth(other.token))).status).toBe(200)
      }
    })

    it('repost zip original is owner/staff only', async () => {
      const u = await createUser(h)
      const other = await createUser(h)
      const png = await readyPng(u)
      const zip = await uploadFixture(h, u, 'fake.zip')
      await processFile(jobDeps(h), { fileId: zip })
      const id = await createPost(h, u, {
        credit: repost,
        files: [
          { fileId: png, position: 0, isCover: true },
          { fileId: zip, position: 1, isCover: false },
        ],
      })
      expect((await h.http().get(`/api/posts/${id}/files/${zip}/url`).set(auth(other.token))).status).toBe(404)
      expect((await h.http().get(`/api/posts/${id}/files/${zip}/url`).set(auth(u.token))).status).toBe(200)
    })

    it('repost media URLs stay null until the files carry the current credit', async () => {
      const u = await createUser(h)
      const fileId = await readyPng(u)
      const res = await create(u, body(fileId, { credit: repost }))
      expect(res.status).toBe(201)
      const id = res.body.id as string
      expect(res.body.media[0]).toMatchObject({ status: 'processing', thumbSmUrl: null, thumbMdUrl: null, previewUrl: null })
      const card = (await h.http().get(`/api/users/${u.username}/posts`).set(auth(u.token))).body.items[0]
      expect(card.cover).toMatchObject({ status: 'processing', thumbMdUrl: null })

      await rewatermark(jobDeps(h), { postId: id })
      const after = await h.http().get(`/api/posts/${id}`)
      expect(after.body.media[0]).toMatchObject({ status: 'ready', thumbMdUrl: expect.any(String), thumbSmUrl: expect.any(String) })

      // A credit edit hides the media again until its rewatermark has run.
      await h.http().patch(`/api/posts/${id}`).set(auth(u.token)).send({ credit: { ...repost, artistHandle: 'other' } })
      expect((await h.http().get(`/api/posts/${id}`)).body.media[0]).toMatchObject({ status: 'processing', thumbMdUrl: null })
      await rewatermark(jobDeps(h), { postId: id })
      expect((await h.http().get(`/api/posts/${id}`)).body.media[0].thumbMdUrl).toEqual(expect.any(String))
    })

    it('own-work media is served right away (no watermark gate)', async () => {
      const u = await createUser(h)
      const res = await create(u, body(await readyPng(u)))
      expect(res.body.media[0]).toMatchObject({ status: 'ready', thumbMdUrl: expect.any(String) })
    })

    it('permissionNote is shown only to the owner and staff; cards never carry it', async () => {
      const u = await createUser(h)
      const other = await createUser(h)
      const mod = await createUser(h, { role: 'moderator' })
      const id = await createPost(h, u, { credit: repost })
      const note = async (t?: string) => {
        const req = h.http().get(`/api/posts/${id}`)
        return (await (t ? req.set(auth(t)) : req)).body.credit.permissionNote
      }
      expect(await note()).toBe('')
      expect(await note(other.token)).toBe('')
      expect(await note(u.token)).toBe('asked on X')
      expect(await note(mod.token)).toBe('asked on X')
      for (const t of [u.token, mod.token]) {
        const cards = await h.http().get(`/api/users/${u.username}/posts`).set(auth(t))
        expect(cards.body.items[0].credit).toEqual({ ...repost, permissionNote: '' })
      }
    })

    it('own-work original stays downloadable by anyone', async () => {
      const u = await createUser(h)
      const other = await createUser(h)
      const id = await createPost(h, u)
      const fileId = (await loadPost(id))!.files[0].fileId.toString()
      expect((await h.http().get(`/api/posts/${id}/files/${fileId}/url`)).status).toBe(200)
      expect((await h.http().get(`/api/posts/${id}/files/${fileId}/url`).set(auth(other.token))).status).toBe(200)
    })
  })

  describe('GET /users/:username/posts', () => {
    it('lists by direct rules (owner and staff also see rejected), newest first, with cursor', async () => {
      const u = await createUser(h)
      const mod = await createUser(h, { role: 'moderator' })
      const p1 = await createPost(h, u, { title: 'one' })
      const p2 = await createPost(h, u, { title: 'two' })
      const p3 = await createPost(h, u, { title: 'three' })
      await approve(h, p1)
      await posts().updateOne({ _id: new Types.ObjectId(p2) }, { $set: { 'review.status': 'rejected' } })

      const anon = await h.http().get(`/api/users/${u.username}/posts`)
      expect(anon.status).toBe(200)
      expect(anon.body.items.map((c: { id: string }) => c.id)).toEqual([p3, p1])
      expect(anon.body.nextCursor).toBeNull()
      expect(anon.body.items[0]).toMatchObject({
        id: p3,
        type: 'illustration',
        title: 'three',
        rating: 'all',
        pageCount: 1,
        counts: { likes: 0 },
        author: { id: u.id, username: u.username },
        cover: expect.objectContaining({ isCover: true, thumbMdUrl: expect.any(String) }),
        credit: { isOwnWork: true, artistName: '', artistHandle: '', platform: 'other', sourceUrl: '', permissionNote: '' },
        createdAt: expect.any(String),
      })

      for (const t of [u.token, mod.token]) {
        const all = await h.http().get(`/api/users/${u.username}/posts`).set(auth(t))
        expect(all.body.items.map((c: { id: string }) => c.id)).toEqual([p3, p2, p1])
      }

      const page1 = await h.http().get(`/api/users/${u.username}/posts?limit=1`).set(auth(u.token))
      expect(page1.body.items.map((c: { id: string }) => c.id)).toEqual([p3])
      const page2 = await h.http().get(`/api/users/${u.username}/posts?limit=1&cursor=${page1.body.nextCursor}`).set(auth(u.token))
      expect(page2.body.items.map((c: { id: string }) => c.id)).toEqual([p2])
    })

    it('unknown user → 404 NOT_FOUND', async () => {
      const res = await h.http().get('/api/users/nobody/posts')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })
})

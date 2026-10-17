import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getModelToken } from '@nestjs/mongoose'
import type { Model } from 'mongoose'
import { Types } from 'mongoose'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CONFIG, type Config } from '../src/config/config'
import { AgendaJobs } from '../src/jobs/agenda-jobs'
import { type JobDeps, run } from '../src/jobs/handlers/media'
import { processFile, processFileHooks } from '../src/jobs/handlers/process-file'
import { relocateFile, relocateVariants } from '../src/jobs/handlers/relocate-variants'
import { rewatermark } from '../src/jobs/handlers/rewatermark'
import { renderBlurred } from '../src/jobs/handlers/variants'
import { watermarkHash, watermarkText } from '../src/jobs/handlers/watermark'
import { StorageService } from '../src/storage/storage.service'
import { FILE_MODEL, type FileDoc } from '../src/uploads/file.schema'
import { createTestHarness, createUser, type Harness, uploadFixture } from './harness'

describe('process-file / relocate-variants', () => {
  let h: Harness
  let storage: StorageService
  let config: Config
  let deps: JobDeps
  let files: Model<FileDoc>
  let bucketPublic: string
  let bucketOriginals: string

  beforeAll(async () => {
    h = await createTestHarness()
    storage = h.app.get(StorageService)
    config = h.app.get(CONFIG)
    files = h.app.get(getModelToken(FILE_MODEL))
    deps = { conn: h.db, storage, config }
    bucketPublic = config.minio.bucketPublic
    bucketOriginals = config.minio.bucketOriginals
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const load = async (fileId: string) => (await files.findById(fileId).lean())!
  const variant = (f: FileDoc, name: string) => f.variants.find((v) => v.name === name)
  const exists = async (bucket: string, key: string) => (await storage.stat(bucket, key)) !== null

  /** Inserts a File in `processing` and puts `body` at its objectKey, bypassing upload validation. */
  async function seedFile(kind: FileDoc['kind'], mimeType: string, ext: string, body: Buffer): Promise<string> {
    const ownerId = new Types.ObjectId()
    const _id = new Types.ObjectId()
    const objectKey = storage.objectKey(ownerId.toString(), _id.toString(), 'original', ext)
    await storage.put(bucketOriginals, objectKey, body, mimeType)
    await files.create({ _id, ownerId, bucket: bucketOriginals, objectKey, originalName: `x.${ext}`, mimeType, sizeBytes: body.length, kind, status: 'processing' })
    return _id.toString()
  }

  it('image: thumb_sm 360w and thumb_md ≤1200w, private until a post exists, status ready, no EXIF', async () => {
    const big = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#3a7' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'someone' } })
      .toBuffer()
    expect((await sharp(big).metadata()).exif).toBeDefined()
    const fileId = await seedFile('image', 'image/jpeg', 'jpg', big)

    await processFile(deps, { fileId })

    const f = await load(fileId)
    expect(f).toMatchObject({ status: 'ready', width: 2000, height: 1500 })
    expect(f.variants.map((v) => v.name).sort()).toEqual(['thumb_md', 'thumb_sm'])
    const sm = variant(f, 'thumb_sm')!
    const md = variant(f, 'thumb_md')!
    expect(sm).toMatchObject({ bucket: bucketOriginals, objectKey: storage.objectKey(f.ownerId.toString(), fileId, 'thumb_sm', 'webp'), width: 360, height: 270 })
    expect(md).toMatchObject({ bucket: bucketOriginals, objectKey: storage.objectKey(f.ownerId.toString(), fileId, 'thumb_md', 'webp'), width: 1200, height: 900 })
    for (const v of f.variants) expect(await exists(bucketPublic, v.objectKey)).toBe(false)
    const smMeta = await sharp(await storage.getBuffer(bucketOriginals, sm.objectKey)).metadata()
    expect(smMeta).toMatchObject({ format: 'webp', width: 360 })
    const meta = await sharp(await storage.getBuffer(bucketOriginals, md.objectKey)).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBeLessThanOrEqual(1200)
    expect(meta.exif).toBeUndefined()
  })

  it('image: small upload (tiny.jpg with GPS EXIF) is not enlarged and loses EXIF', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'tiny.jpg')
    await processFile(deps, { fileId })
    const f = await load(fileId)
    expect(f).toMatchObject({ status: 'ready', width: 64, height: 48 })
    for (const name of ['thumb_sm', 'thumb_md']) {
      const v = variant(f, name)!
      expect(v).toMatchObject({ bucket: bucketOriginals, width: 64, height: 48 })
      expect((await sharp(await storage.getBuffer(bucketOriginals, v.objectKey)).metadata()).exif).toBeUndefined()
    }
  })

  it('video: preview + thumbs exist and durationSec ≈ 1', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'one-second.mp4')
    await processFile(deps, { fileId })
    const file = await load(fileId)
    expect(file.status).toBe('ready')
    expect(file.durationSec).toBeCloseTo(1, 0)
    expect(file).toMatchObject({ width: 320, height: 240 })
    expect(file.variants.map((v) => v.name).sort()).toEqual(['preview', 'thumb_md', 'thumb_sm'])
    for (const v of file.variants) {
      expect(v.bucket).toBe(bucketOriginals)
      expect(await exists(bucketPublic, v.objectKey)).toBe(false)
      const meta = await sharp(await storage.getBuffer(bucketOriginals, v.objectKey)).metadata()
      expect(meta).toMatchObject({ format: 'webp', width: 320, height: 240 })
    }
  })

  it('audio: durationSec set, no variants', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'tone.mp3')
    await processFile(deps, { fileId })
    const f = await load(fileId)
    expect(f.status).toBe('ready')
    expect(f.durationSec).toBeCloseTo(1, 0)
    expect(f.variants).toEqual([])
  })

  it('archive: no variants, status ready', async () => {
    const fileId = await seedFile('archive', 'application/zip', 'zip', readFileSync(join(__dirname, 'fixtures', 'fake.zip')))
    await processFile(deps, { fileId })
    const f = await load(fileId)
    expect(f.status).toBe('ready')
    expect(f.variants).toEqual([])
  })

  it('r18 post file: variants in originals bucket and blurred exists', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'tiny.png')
    await h.db.collection('posts').insertOne({ rating: 'r18', files: [{ fileId: new Types.ObjectId(fileId) }], deletedAt: null })

    await processFile(deps, { fileId })

    const f = await load(fileId)
    expect(f.status).toBe('ready')
    expect(f.variants.map((v) => v.name).sort()).toEqual(['blurred', 'thumb_md', 'thumb_sm'])
    for (const v of f.variants) {
      expect(v.bucket).toBe(bucketOriginals)
      expect(await exists(bucketOriginals, v.objectKey)).toBe(true)
      expect(await exists(bucketPublic, v.objectKey)).toBe(false)
    }
    expect(variant(f, 'blurred')!.objectKey).toBe(storage.objectKey(u.id, fileId, 'blurred', 'webp'))
  })

  it('relocate all→r18 moves variants to originals and adds blurred; r18→all reverses', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'tiny.png')
    const { insertedId: postId } = await h.db
      .collection('posts')
      .insertOne({ rating: 'all', files: [{ fileId: new Types.ObjectId(fileId) }], deletedAt: null })
    await processFile(deps, { fileId })
    const before = await load(fileId)
    expect(before.variants.every((v) => v.bucket === bucketPublic)).toBe(true)

    await h.db.collection('posts').updateOne({ _id: postId }, { $set: { rating: 'r18' } })
    await relocateVariants(deps, { postId: postId.toString() })

    const r18 = await load(fileId)
    expect(r18.variants.map((v) => v.name).sort()).toEqual(['blurred', 'thumb_md', 'thumb_sm'])
    for (const v of r18.variants) {
      expect(v.bucket).toBe(bucketOriginals)
      expect(await exists(bucketOriginals, v.objectKey)).toBe(true)
      expect(await exists(bucketPublic, v.objectKey)).toBe(false)
    }
    const blurredKey = variant(r18, 'blurred')!.objectKey

    await h.db.collection('posts').updateOne({ _id: postId }, { $set: { rating: 'all' } })
    await relocateVariants(deps, { postId: postId.toString() })

    const all = await load(fileId)
    expect(all.variants.map((v) => v.name).sort()).toEqual(['thumb_md', 'thumb_sm'])
    for (const v of all.variants) {
      expect(v.bucket).toBe(bucketPublic)
      expect(await exists(bucketPublic, v.objectKey)).toBe(true)
      expect(await exists(bucketOriginals, v.objectKey)).toBe(false)
    }
    expect(await exists(bucketOriginals, blurredKey)).toBe(false)
  })

  it('corrupt image (zip bytes saved as image kind) throws so the worker retries', async () => {
    const fileId = await seedFile('image', 'image/png', 'png', readFileSync(join(__dirname, 'fixtures', 'fake.zip')))
    await expect(processFile(deps, { fileId })).rejects.toThrow()
    const f = await load(fileId)
    expect(f.status).toBe('processing')
    expect(f.variants).toEqual([])
  })

  it('AgendaJobs.enqueue stores a due job in the jobs collection', async () => {
    const jobs = new AgendaJobs(h.db)
    await jobs.enqueue('process-file', { fileId: 'abc' })
    const job = await h.db.collection('jobs').findOne({ name: 'process-file' })
    expect(job).toMatchObject({ data: { fileId: 'abc' } })
    expect(job!.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('relocate is idempotent: a variant already moved by a failed attempt is accepted', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'tiny.png')
    const { insertedId: postId } = await h.db
      .collection('posts')
      .insertOne({ rating: 'all', files: [{ fileId: new Types.ObjectId(fileId) }], deletedAt: null })
    await processFile(deps, { fileId })
    const sm = variant(await load(fileId), 'thumb_sm')!
    // Simulate a prior attempt that moved thumb_sm and crashed before persisting.
    await storage.copy(bucketPublic, sm.objectKey, bucketOriginals, sm.objectKey)
    await storage.remove(bucketPublic, sm.objectKey)

    await h.db.collection('posts').updateOne({ _id: postId }, { $set: { rating: 'r18' } })
    await relocateVariants(deps, { postId: postId.toString() })

    const f = await load(fileId)
    expect(f.variants.map((v) => v.name).sort()).toEqual(['blurred', 'thumb_md', 'thumb_sm'])
    for (const v of f.variants) {
      expect(v.bucket).toBe(bucketOriginals)
      expect(await exists(bucketOriginals, v.objectKey)).toBe(true)
      expect(await exists(bucketPublic, v.objectKey)).toBe(false)
    }
  })

  it('relocate drops a variant whose object is gone from both buckets', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'tiny.png')
    const { insertedId: postId } = await h.db
      .collection('posts')
      .insertOne({ rating: 'all', files: [{ fileId: new Types.ObjectId(fileId) }], deletedAt: null })
    await processFile(deps, { fileId })
    const sm = variant(await load(fileId), 'thumb_sm')!
    await storage.remove(bucketPublic, sm.objectKey)
    await h.db.collection('posts').updateOne({ _id: postId }, { $set: { rating: 'r18' } })
    await relocateVariants(deps, { postId: postId.toString() })
    const f = await load(fileId)
    expect(f.variants.map((v) => v.name).sort()).toEqual(['blurred', 'thumb_md'])
    expect(f.variants.every((v) => v.bucket === bucketOriginals)).toBe(true)
  })

  it('rating changed to r18 while processing: variants end up in originals with blurred', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'tiny.png')
    processFileHooks.beforeStore = async () => {
      await h.db.collection('posts').insertOne({ rating: 'r18', files: [{ fileId: new Types.ObjectId(fileId) }], deletedAt: null })
    }
    try {
      await processFile(deps, { fileId })
    } finally {
      processFileHooks.beforeStore = undefined
    }
    const f = await load(fileId)
    expect(f.status).toBe('ready')
    expect(f.variants.map((v) => v.name).sort()).toEqual(['blurred', 'thumb_md', 'thumb_sm'])
    for (const v of f.variants) {
      expect(v.bucket).toBe(bucketOriginals)
      expect(await exists(bucketOriginals, v.objectKey)).toBe(true)
      expect(await exists(bucketPublic, v.objectKey)).toBe(false)
    }
  })

  it('storing variants removes same-key orphans from the other bucket', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'tiny.png')
    const orphanKey = storage.objectKey(u.id, fileId, 'thumb_sm', 'webp')
    await storage.put(bucketPublic, orphanKey, Buffer.from('stale'), 'image/webp')
    await processFile(deps, { fileId })
    expect(await exists(bucketOriginals, orphanKey)).toBe(true)
    expect(await exists(bucketPublic, orphanKey)).toBe(false)
  })

  it('file of a soft-deleted r18 post keeps r18 placement', async () => {
    const u = await createUser(h)
    const fileId = await uploadFixture(h, u, 'tiny.png')
    await h.db.collection('posts').insertOne({ rating: 'r18', files: [{ fileId: new Types.ObjectId(fileId) }], deletedAt: new Date() })
    await processFile(deps, { fileId })
    const f = await load(fileId)
    expect(f.variants.map((v) => v.name).sort()).toEqual(['blurred', 'thumb_md', 'thumb_sm'])
    expect(f.variants.every((v) => v.bucket === bucketOriginals)).toBe(true)
  })

  describe('watermark', () => {
    const repost = {
      isOwnWork: false,
      artistName: 'Ruri',
      artistHandle: '@_rurisuisen',
      platform: 'x',
      sourceUrl: 'https://x.com/_rurisuisen/status/1890567100382544149',
      permissionNote: '',
    }

    /** Mean absolute per-channel difference of two same-size images over a region given in fractions of the size. */
    async function diff(a: Buffer, b: Buffer, region: 'bottomRight' | 'topLeft'): Promise<number> {
      const meta = await sharp(a).metadata()
      const [w, h] = [meta.width!, meta.height!]
      const r = region === 'bottomRight'
        ? { left: Math.floor(w * 0.6), top: Math.floor(h * 0.9), width: w - Math.floor(w * 0.6), height: h - Math.floor(h * 0.9) }
        : { left: 0, top: 0, width: Math.floor(w * 0.4), height: Math.floor(h * 0.4) }
      const raw = (buf: Buffer) => sharp(buf).removeAlpha().extract(r).raw().toBuffer()
      const [x, y] = await Promise.all([raw(a), raw(b)])
      let sum = 0
      for (let i = 0; i < x.length; i++) sum += Math.abs(x[i]! - y[i]!)
      return sum / x.length
    }

    async function seedPost(fileIds: string[], over: Record<string, unknown> = {}): Promise<string> {
      const { insertedId: authorId } = await h.db.collection('users').insertOne({ profile: { username: 'du_ca' } })
      const { insertedId } = await h.db.collection('posts').insertOne({
        authorId,
        rating: 'all',
        credit: repost,
        files: fileIds.map((id, i) => ({ fileId: new Types.ObjectId(id), position: i, isCover: i === 0 })),
        deletedAt: null,
        ...over,
      })
      return insertedId.toString()
    }

    const big = () => sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#88aacc' } }).png().toBuffer()
    const bytesOf = async (fileId: string, name: string) => {
      const v = variant(await load(fileId), name)!
      return storage.getBuffer(v.bucket, v.objectKey)
    }

    it('file of a credited post: watermarked thumbs differ from an unwatermarked render bottom-right only; original untouched', async () => {
      const src = await big()
      const plain = await seedFile('image', 'image/png', 'png', src)
      const marked = await seedFile('image', 'image/png', 'png', src)
      await seedPost([marked])
      await processFile(deps, { fileId: plain })
      await processFile(deps, { fileId: marked })

      for (const name of ['thumb_md', 'thumb_sm']) {
        const [a, b] = [await bytesOf(plain, name), await bytesOf(marked, name)]
        expect(await diff(a, b, 'bottomRight'), name).toBeGreaterThan(5)
        expect(await diff(a, b, 'topLeft'), name).toBeLessThan(1)
        expect((await sharp(b).metadata()).exif).toBeUndefined()
      }
      const f = await load(marked)
      expect(f.variants.every((v) => v.bucket === bucketPublic)).toBe(true)
      expect((await storage.getBuffer(f.bucket, f.objectKey)).equals(src)).toBe(true)
    })

    it('file processed before its post exists: rewatermark adds the mark; a credit edit changes thumb_md bytes', async () => {
      const src = await big()
      const fileId = await seedFile('image', 'image/png', 'png', src)
      await processFile(deps, { fileId })
      const clean = await bytesOf(fileId, 'thumb_md')

      const postId = await seedPost([fileId])
      await rewatermark(deps, { postId })
      const first = await bytesOf(fileId, 'thumb_md')
      expect(await diff(clean, first, 'bottomRight')).toBeGreaterThan(5)
      expect(await diff(clean, first, 'topLeft')).toBeLessThan(1)

      await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { credit: { ...repost, artistHandle: 'someone_else', platform: 'pixiv' } } })
      await rewatermark(deps, { postId })
      const second = await bytesOf(fileId, 'thumb_md')
      expect(second.equals(first)).toBe(false)
      const f = await load(fileId)
      expect(f.status).toBe('ready')
      expect((await storage.getBuffer(f.bucket, f.objectKey)).equals(src)).toBe(true)
    })

    it('post appearing while the file is processing still gets the watermark', async () => {
      const src = await big()
      const plain = await seedFile('image', 'image/png', 'png', src)
      await processFile(deps, { fileId: plain })
      const fileId = await seedFile('image', 'image/png', 'png', src)
      processFileHooks.beforeStore = async () => {
        await seedPost([fileId])
      }
      try {
        await processFile(deps, { fileId })
      } finally {
        processFileHooks.beforeStore = undefined
      }
      expect(await diff(await bytesOf(plain, 'thumb_md'), await bytesOf(fileId, 'thumb_md'), 'bottomRight')).toBeGreaterThan(5)
    })

    it('r18 post: rewatermark keeps every variant in the originals bucket and marks blurred after blurring', async () => {
      const src = await big()
      const fileId = await seedFile('image', 'image/png', 'png', src)
      await processFile(deps, { fileId })
      const clean = await bytesOf(fileId, 'thumb_md')
      const postId = await seedPost([fileId], { rating: 'r18' })
      await relocateVariants(deps, { postId })
      await rewatermark(deps, { postId })

      const f = await load(fileId)
      expect(f.variants.map((v) => v.name).sort()).toEqual(['blurred', 'thumb_md', 'thumb_sm'])
      for (const v of f.variants) {
        expect(v.bucket).toBe(bucketOriginals)
        expect(await exists(bucketOriginals, v.objectKey)).toBe(true)
        expect(await exists(bucketPublic, v.objectKey)).toBe(false)
      }
      const plainBlurred = (await renderBlurred(clean)).body
      expect(await diff(plainBlurred, await bytesOf(fileId, 'blurred'), 'bottomRight')).toBeGreaterThan(5)

      // Back to all: rewatermark alone drops blurred from both buckets and publishes the rest.
      await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { rating: 'all' } })
      const blurredKey = variant(f, 'blurred')!.objectKey
      await rewatermark(deps, { postId })
      const all = await load(fileId)
      expect(all.variants.map((v) => v.name).sort()).toEqual(['thumb_md', 'thumb_sm'])
      expect(all.variants.every((v) => v.bucket === bucketPublic)).toBe(true)
      expect(await exists(bucketOriginals, blurredKey)).toBe(false)
      expect(await exists(bucketPublic, blurredKey)).toBe(false)
      for (const v of all.variants) expect(await exists(bucketOriginals, v.objectKey)).toBe(false)
    })

    it('relocate to r18 of a watermarked file marks the new blurred variant', async () => {
      const src = await big()
      const fileId = await seedFile('image', 'image/png', 'png', src)
      const postId = await seedPost([fileId])
      await processFile(deps, { fileId })
      const md = await bytesOf(fileId, 'thumb_md')
      await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { rating: 'r18' } })
      await relocateVariants(deps, { postId })
      const blurred = await bytesOf(fileId, 'blurred')
      // Blurring the watermarked thumb_md smears the mark; a fresh mark must be drawn on top.
      expect(await diff((await renderBlurred(md)).body, blurred, 'bottomRight')).toBeGreaterThan(5)
    })

    it('video: poster-derived preview and thumbs are watermarked; the video itself is untouched', async () => {
      const u = await createUser(h)
      const plain = await uploadFixture(h, u, 'one-second.mp4')
      const marked = await uploadFixture(h, u, 'one-second.mp4')
      await seedPost([marked])
      await processFile(deps, { fileId: plain })
      await processFile(deps, { fileId: marked })
      for (const name of ['preview', 'thumb_md', 'thumb_sm']) {
        expect(await diff(await bytesOf(plain, name), await bytesOf(marked, name), 'bottomRight'), name).toBeGreaterThan(5)
      }
      const f = await load(marked)
      const original = await storage.getBuffer(f.bucket, f.objectKey)
      expect(original.equals(readFileSync(join(__dirname, 'fixtures', 'one-second.mp4')))).toBe(true)
    })

    it('repost: no public object for the file before rewatermark; afterwards the public objects are watermarked', async () => {
      const fileId = await seedFile('image', 'image/png', 'png', await big())
      await processFile(deps, { fileId })
      const f = await load(fileId)
      const clean = await storage.getBuffer(bucketOriginals, variant(f, 'thumb_md')!.objectKey)
      for (const name of ['thumb_sm', 'thumb_md'] as const) {
        const key = storage.objectKey(f.ownerId.toString(), fileId, name, 'webp')
        expect(await exists(bucketPublic, key), name).toBe(false)
      }
      const postId = await seedPost([fileId])
      await rewatermark(deps, { postId })
      const after = await load(fileId)
      for (const v of after.variants) {
        expect(v.bucket).toBe(bucketPublic)
        expect(await exists(bucketOriginals, v.objectKey)).toBe(false)
      }
      const pub = await storage.getBuffer(bucketPublic, variant(after, 'thumb_md')!.objectKey)
      expect(await diff(clean, pub, 'bottomRight')).toBeGreaterThan(5)
    })

    it('profile image: processed after it is set as avatar → public; set afterwards → relocate-file publishes it', async () => {
      const ownerFirst = await seedFile('image', 'image/png', 'png', await big())
      const f0 = await load(ownerFirst)
      await h.db.collection('users').insertOne({ _id: f0.ownerId, email: 'av@example.com', profile: { username: 'av', avatarFileId: new Types.ObjectId(ownerFirst) } })
      await processFile(deps, { fileId: ownerFirst })
      expect((await load(ownerFirst)).variants.every((v) => v.bucket === bucketPublic)).toBe(true)

      const later = await seedFile('image', 'image/png', 'png', await big())
      await processFile(deps, { fileId: later })
      expect((await load(later)).variants.every((v) => v.bucket === bucketOriginals)).toBe(true)
      await h.db.collection('users').insertOne({ email: 'bn@example.com', profile: { username: 'bn', bannerFileId: new Types.ObjectId(later) } })
      await relocateFile(deps, { fileId: later })
      const f = await load(later)
      for (const v of f.variants) {
        expect(v.bucket).toBe(bucketPublic)
        expect(await exists(bucketPublic, v.objectKey)).toBe(true)
        expect(await exists(bucketOriginals, v.objectKey)).toBe(false)
      }
    })

    it('watermarkedFor records the burned-in text: "" for clean renders, its hash after rewatermark', async () => {
      const fileId = await seedFile('image', 'image/png', 'png', await big())
      await processFile(deps, { fileId })
      expect((await load(fileId)).watermarkedFor).toBe('')
      const postId = await seedPost([fileId])
      await rewatermark(deps, { postId })
      expect((await load(fileId)).watermarkedFor).toBe(watermarkHash(watermarkText(repost as never, '')))
    })

    it('rewatermark leaves audio, archives and not-ready files alone', async () => {
      const u = await createUser(h)
      const audio = await uploadFixture(h, u, 'tone.mp3')
      await processFile(deps, { fileId: audio })
      const pending = await seedFile('image', 'image/png', 'png', await big())
      const postId = await seedPost([audio, pending])
      await rewatermark(deps, { postId })
      expect((await load(audio)).variants).toEqual([])
      expect(await load(pending)).toMatchObject({ status: 'processing', variants: [] })
      await rewatermark(deps, { postId: new Types.ObjectId().toString() })
      await rewatermark(deps, { postId: 'nope' })
    })
  })

  it('run() kills a hung ffmpeg after the timeout', async () => {
    const started = Date.now()
    await expect(run(config.ffmpegPath, ['-nostdin', '-re', '-f', 'lavfi', '-i', 'anullsrc', '-t', '30', '-f', 'null', '-'], 200)).rejects.toThrow(/timed out after 200ms/)
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

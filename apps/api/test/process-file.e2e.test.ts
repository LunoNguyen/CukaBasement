import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getModelToken } from '@nestjs/mongoose'
import type { Model } from 'mongoose'
import { Types } from 'mongoose'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CONFIG, type Config } from '../src/config/config'
import { AgendaJobs } from '../src/jobs/agenda-jobs'
import type { JobDeps } from '../src/jobs/handlers/media'
import { processFile } from '../src/jobs/handlers/process-file'
import { relocateVariants } from '../src/jobs/handlers/relocate-variants'
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

  it('image: thumb_sm 360w and thumb_md ≤1200w in public bucket, status ready, no EXIF', async () => {
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
    expect(sm).toMatchObject({ bucket: bucketPublic, objectKey: storage.objectKey(f.ownerId.toString(), fileId, 'thumb_sm', 'webp'), width: 360, height: 270 })
    expect(md).toMatchObject({ bucket: bucketPublic, objectKey: storage.objectKey(f.ownerId.toString(), fileId, 'thumb_md', 'webp'), width: 1200, height: 900 })
    const smMeta = await sharp(await storage.getBuffer(bucketPublic, sm.objectKey)).metadata()
    expect(smMeta).toMatchObject({ format: 'webp', width: 360 })
    const meta = await sharp(await storage.getBuffer(bucketPublic, md.objectKey)).metadata()
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
      expect(v).toMatchObject({ bucket: bucketPublic, width: 64, height: 48 })
      expect((await sharp(await storage.getBuffer(bucketPublic, v.objectKey)).metadata()).exif).toBeUndefined()
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
      expect(v.bucket).toBe(bucketPublic)
      const meta = await sharp(await storage.getBuffer(bucketPublic, v.objectKey)).metadata()
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
    await processFile(deps, { fileId })
    const before = await load(fileId)
    expect(before.variants.every((v) => v.bucket === bucketPublic)).toBe(true)

    const { insertedId: postId } = await h.db
      .collection('posts')
      .insertOne({ rating: 'r18', files: [{ fileId: new Types.ObjectId(fileId) }], deletedAt: null })
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
})

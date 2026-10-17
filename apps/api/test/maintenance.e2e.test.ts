import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CONFIG, type Config } from '../src/config/config'
import { cleanupUploads } from '../src/jobs/handlers/cleanup-uploads'
import type { JobDeps } from '../src/jobs/handlers/media'
import { purgeDeletedPosts } from '../src/jobs/handlers/purge-deleted-posts'
import { reconcileCounters, reconcileHooks } from '../src/jobs/handlers/reconcile-counters'
import { JOBS, type JobsPort } from '../src/jobs/jobs.port'
import { StorageService } from '../src/storage/storage.service'
import type { FileDoc } from '../src/uploads/file.schema'
import { createPost, createTestHarness, createUser, type Harness, jobDeps } from './harness'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('maintenance jobs', () => {
  let h: Harness
  let storage: StorageService
  let config: Config
  let deps: JobDeps & { jobs: JobsPort }

  beforeAll(async () => {
    h = await createTestHarness()
    storage = h.app.get(StorageService)
    config = h.app.get(CONFIG)
    deps = { ...jobDeps(h), jobs: h.app.get<JobsPort>(JOBS) }
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const oid = (id: string) => new Types.ObjectId(id)
  const exists = async (bucket: string, key: string) => (await storage.stat(bucket, key)) !== null
  const fileDoc = (id: string) => h.db.collection<FileDoc>('files').findOne({ _id: oid(id) })

  /** Inserts a file doc (raw, so createdAt can be backdated) plus its original, staging and variant objects. */
  async function seedFile(status: FileDoc['status'], ageMs: number, opts: { staging?: boolean; variants?: boolean } = {}) {
    const ownerId = new Types.ObjectId()
    const _id = new Types.ObjectId()
    const bucket = config.minio.bucketOriginals
    const objectKey = storage.objectKey(ownerId.toString(), _id.toString(), 'original', 'png')
    const stagingKey = `${ownerId.toString()}/${_id.toString()}/upload.png`
    const variantKey = storage.objectKey(ownerId.toString(), _id.toString(), 'thumb_sm', 'webp')
    const body = Buffer.from('x')
    await storage.put(bucket, objectKey, body, 'image/png')
    if (opts.staging) await storage.put(bucket, stagingKey, body, 'image/png')
    const variants = []
    if (opts.variants) {
      await storage.put(config.minio.bucketPublic, variantKey, body, 'image/webp')
      variants.push({ name: 'thumb_sm', bucket: config.minio.bucketPublic, objectKey: variantKey, width: 1, height: 1 })
    }
    await h.db.collection('files').insertOne({
      _id,
      ownerId,
      bucket,
      objectKey,
      originalName: 'x.png',
      mimeType: 'image/png',
      sizeBytes: 1,
      kind: 'image',
      width: null,
      height: null,
      durationSec: null,
      status,
      variants,
      createdAt: new Date(Date.now() - ageMs),
    })
    return { id: _id.toString(), bucket, objectKey, stagingKey, variantKey }
  }

  describe('cleanupUploads', () => {
    it('cleanup removes 25h-old uploading file and its object; keeps 1h-old one; keeps avatar file', async () => {
      const old = await seedFile('uploading', 25 * HOUR)
      const fresh = await seedFile('uploading', 1 * HOUR)
      const avatar = await seedFile('ready', 25 * HOUR, { variants: true })
      const banner = await seedFile('ready', 25 * HOUR)
      const u = await createUser(h)
      await h.db
        .collection('users')
        .updateOne({ _id: oid(u.id) }, { $set: { 'profile.avatarFileId': oid(avatar.id), 'profile.bannerFileId': oid(banner.id) } })

      await cleanupUploads(deps)

      expect(await fileDoc(old.id)).toBeNull()
      expect(await exists(old.bucket, old.objectKey)).toBe(false)
      expect(await fileDoc(fresh.id)).not.toBeNull()
      expect(await exists(fresh.bucket, fresh.objectKey)).toBe(true)
      expect(await fileDoc(avatar.id)).not.toBeNull()
      expect(await exists(config.minio.bucketPublic, avatar.variantKey)).toBe(true)
      expect(await fileDoc(banner.id)).not.toBeNull()
    })

    it('removes an old failed file and an old unreferenced ready file with its variants; keeps one used by a post', async () => {
      const failed = await seedFile('failed', 25 * HOUR)
      const orphan = await seedFile('ready', 25 * HOUR, { variants: true })
      const used = await seedFile('ready', 25 * HOUR, { variants: true })
      await h.db.collection('posts').insertOne({ rating: 'all', files: [{ fileId: oid(used.id), position: 0, isCover: true }], deletedAt: null })

      await cleanupUploads(deps)

      expect(await fileDoc(failed.id)).toBeNull()
      expect(await exists(failed.bucket, failed.objectKey)).toBe(false)
      expect(await fileDoc(orphan.id)).toBeNull()
      expect(await exists(orphan.bucket, orphan.objectKey)).toBe(false)
      expect(await exists(config.minio.bucketPublic, orphan.variantKey)).toBe(false)
      expect(await fileDoc(used.id)).not.toBeNull()
      expect(await exists(config.minio.bucketPublic, used.variantKey)).toBe(true)
    })

    it('removes a file stuck in validating for over 24h with its staging, original and variants', async () => {
      const stuck = await seedFile('validating', 25 * HOUR, { staging: true, variants: true })
      const recent = await seedFile('validating', 1 * HOUR, { staging: true })

      await cleanupUploads(deps)

      expect(await fileDoc(stuck.id)).toBeNull()
      expect(await exists(stuck.bucket, stuck.stagingKey)).toBe(false)
      expect(await exists(stuck.bucket, stuck.objectKey)).toBe(false)
      expect(await exists(config.minio.bucketPublic, stuck.variantKey)).toBe(false)
      expect(await fileDoc(recent.id)).not.toBeNull()
      expect(await exists(recent.bucket, recent.stagingKey)).toBe(true)
    })

    it('removes leftover staging objects of completed files but not of files still uploading', async () => {
      const done = await seedFile('ready', 2 * HOUR, { staging: true })
      const uploading = await seedFile('uploading', 2 * HOUR, { staging: true })

      await cleanupUploads(deps)

      expect(await exists(done.bucket, done.stagingKey)).toBe(false)
      expect(await exists(done.bucket, done.objectKey)).toBe(true)
      expect(await fileDoc(done.id)).not.toBeNull()
      expect(await exists(uploading.bucket, uploading.stagingKey)).toBe(true)
    })

    it('keeps a 25h-old failed file still attached to a post', async () => {
      const failed = await seedFile('failed', 25 * HOUR)
      await h.db.collection('posts').insertOne({ rating: 'all', files: [{ fileId: oid(failed.id), position: 0, isCover: true }], deletedAt: null })

      await cleanupUploads(deps)

      expect(await fileDoc(failed.id)).not.toBeNull()
      expect(await exists(failed.bucket, failed.objectKey)).toBe(true)
    })

    it('leaves staging objects of files older than 48h to the regular expiry rules', async () => {
      const older = await seedFile('ready', 3 * DAY, { staging: true })
      await h.db.collection('posts').insertOne({ rating: 'all', files: [{ fileId: oid(older.id), position: 0, isCover: true }], deletedAt: null })

      const r = await cleanupUploads(deps)

      expect(r.stagingSwept).toBe(0)
      expect(await exists(older.bucket, older.stagingKey)).toBe(true)
    })

    it('re-enqueues process-file for a file processing over 1h with no pending job', async () => {
      const stuck = await seedFile('processing', 2 * HOUR)
      const queued = await seedFile('processing', 2 * HOUR)
      const recent = await seedFile('processing', 10 * 60 * 1000)
      await h.db.collection('jobs').insertOne({ name: 'process-file', data: { fileId: queued.id }, nextRunAt: new Date(), lockedAt: null })
      // A finished job for the stuck file does not count as pending.
      await h.db.collection('jobs').insertOne({ name: 'process-file', data: { fileId: stuck.id }, nextRunAt: null, lockedAt: null })

      await cleanupUploads(deps)

      expect(h.jobs.enqueued).toEqual([{ name: 'process-file', data: { fileId: stuck.id } }])
      expect(await fileDoc(recent.id)).not.toBeNull()
    })
  })

  describe('purgeDeletedPosts', () => {
    it('purge removes 31-day-deleted post with its likes/comments/files; keeps 29-day one', async () => {
      const author = await createUser(h)
      const other = await createUser(h)
      const oldPost = await createPost(h, author)
      const keptPost = await createPost(h, author)
      const oldFile = (await h.db.collection('posts').findOne({ _id: oid(oldPost) }))!.files[0].fileId as Types.ObjectId
      const keptFile = (await h.db.collection('posts').findOne({ _id: oid(keptPost) }))!.files[0].fileId as Types.ObjectId
      const oldFileDoc = (await fileDoc(oldFile.toString()))!
      expect(oldFileDoc.variants.length).toBeGreaterThan(0)

      for (const postId of [oldPost, keptPost].map(oid)) {
        await h.db.collection('likes').insertOne({ userId: oid(other.id), postId, createdAt: new Date() })
        await h.db.collection('bookmarks').insertOne({ userId: oid(other.id), postId, isPrivate: false, createdAt: new Date() })
        await h.db.collection('comments').insertOne({ postId, authorId: oid(other.id), parentId: null, body: 'hi', status: 'visible', deletedAt: null, createdAt: new Date() })
        await h.db.collection('reports').insertOne({ postId, reporterId: oid(other.id), reason: 'spam', detail: '', status: 'open', createdAt: new Date() })
        await h.db.collection('notifications').insertOne({ userId: oid(author.id), type: 'like', actorId: oid(other.id), postId, commentId: null, readAt: null, createdAt: new Date() })
      }
      await h.db.collection('posts').updateOne({ _id: oid(oldPost) }, { $set: { deletedAt: new Date(Date.now() - 31 * DAY) } })
      await h.db.collection('posts').updateOne({ _id: oid(keptPost) }, { $set: { deletedAt: new Date(Date.now() - 29 * DAY) } })

      await purgeDeletedPosts(deps, new Date())

      expect(await h.db.collection('posts').findOne({ _id: oid(oldPost) })).toBeNull()
      expect(await fileDoc(oldFile.toString())).toBeNull()
      expect(await exists(oldFileDoc.bucket, oldFileDoc.objectKey)).toBe(false)
      for (const v of oldFileDoc.variants) expect(await exists(v.bucket, v.objectKey)).toBe(false)
      for (const c of ['likes', 'bookmarks', 'comments', 'reports', 'notifications']) {
        expect(await h.db.collection(c).countDocuments({ postId: oid(oldPost) })).toBe(0)
        expect(await h.db.collection(c).countDocuments({ postId: oid(keptPost) })).toBe(1)
      }
      expect(await h.db.collection('posts').findOne({ _id: oid(keptPost) })).not.toBeNull()
      expect(await fileDoc(keptFile.toString())).not.toBeNull()
    })
    it("purge keeps a post file that is also the author's avatar", async () => {
      const author = await createUser(h)
      const other = await createUser(h)
      const postId = oid(await createPost(h, author))
      const fileId = (await h.db.collection('posts').findOne({ _id: postId }))!.files[0].fileId as Types.ObjectId
      const before = (await fileDoc(fileId.toString()))!
      await h.db.collection('users').updateOne({ _id: oid(author.id) }, { $set: { 'profile.avatarFileId': fileId } })
      await h.db.collection('likes').insertOne({ userId: oid(other.id), postId, createdAt: new Date() })
      await h.db.collection('posts').updateOne({ _id: postId }, { $set: { deletedAt: new Date(Date.now() - 31 * DAY) } })

      await purgeDeletedPosts(deps, new Date())

      expect(await h.db.collection('posts').findOne({ _id: postId })).toBeNull()
      expect(await h.db.collection('likes').countDocuments({ postId })).toBe(0)
      expect(await fileDoc(fileId.toString())).not.toBeNull()
      expect(await exists(before.bucket, before.objectKey)).toBe(true)
      for (const v of before.variants) expect(await exists(v.bucket, v.objectKey)).toBe(true)
    })

    it("purge's per-post notification delete uses an index", async () => {
      const plan = await h.db.db!.command({
        explain: { delete: 'notifications', deletes: [{ q: { postId: new Types.ObjectId() }, limit: 0 }] },
        verbosity: 'queryPlanner',
      })
      expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain('IXSCAN')
    })
  })

  describe('reconcileCounters', () => {
    it('skips a doc changed between its read and the write (compare-and-set)', async () => {
      const author = await createUser(h)
      const _id = oid(await createPost(h, author))
      await h.db.collection('posts').updateOne({ _id }, { $set: { 'counts.likes': 99 } })
      reconcileHooks.beforeWrite = async (coll) => {
        if (coll === 'posts') await h.db.collection('posts').updateOne({ _id }, { $set: { 'counts.likes': 50 } })
      }
      try {
        const r = await reconcileCounters(deps)
        expect(r.fixed).toBe(0)
        expect((await h.db.collection('posts').findOne({ _id }))!.counts.likes).toBe(50)
      } finally {
        reconcileHooks.beforeWrite = undefined
      }
      expect(await reconcileCounters(deps)).toEqual({ fixed: 1 })
      expect((await h.db.collection('posts').findOne({ _id }))!.counts.likes).toBe(0)
    })

    it('reconcile fixes a manually corrupted counts.likes and users.stats.followerCount', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const _id = oid(await createPost(h, author))
      await h.db.collection('likes').insertOne({ userId: oid(fan.id), postId: _id, createdAt: new Date() })
      await h.db.collection('follows').insertOne({ followerId: oid(fan.id), followeeId: oid(author.id), createdAt: new Date() })
      await h.db.collection('posts').updateOne({ _id }, { $set: { 'counts.likes': 99 } })
      await h.db.collection('users').updateOne({ _id: oid(author.id) }, { $set: { 'stats.followerCount': 7 } })

      const r = await reconcileCounters(deps)

      expect(r.fixed).toBeGreaterThan(0)
      expect((await h.db.collection('posts').findOne({ _id }))!.counts.likes).toBe(1)
      const authorDoc = (await h.db.collection('users').findOne({ _id: oid(author.id) }))!
      expect(authorDoc.stats.followerCount).toBe(1)
      const fanDoc = (await h.db.collection('users').findOne({ _id: oid(fan.id) }))!
      expect(fanDoc.stats.followingCount).toBe(1)
    })

    it('recomputes every counter from the source collections and is a no-op on a second run', async () => {
      const author = await createUser(h)
      const other = await createUser(h)
      const live = oid(await createPost(h, author, { tags: ['cat'] }))
      const gone = oid(await createPost(h, author, { tags: ['cat'] }))
      await h.db.collection('posts').updateOne({ _id: gone }, { $set: { deletedAt: new Date() } })
      await h.db.collection('comments').insertMany([
        { postId: live, authorId: oid(other.id), parentId: null, body: 'a', status: 'visible', deletedAt: null, createdAt: new Date() },
        { postId: live, authorId: oid(other.id), parentId: null, body: 'b', status: 'visible', deletedAt: new Date(), createdAt: new Date() },
      ])
      await h.db.collection('reports').insertMany([
        { postId: live, reporterId: oid(other.id), reason: 'ai_art', detail: '', status: 'open', createdAt: new Date() },
        { postId: live, reporterId: new Types.ObjectId(), reason: 'spam', detail: '', status: 'dismissed', createdAt: new Date() },
      ])
      // Drift left by the `$gt: 0` decrement guard and lost increments.
      await h.db.collection('posts').updateOne(
        { _id: live },
        { $set: { 'counts.bookmarks': 3, 'counts.comments': 0, reportCounts: { total: 5, ai_art: 0 } } },
      )
      await h.db.collection('users').updateOne({ _id: oid(author.id) }, { $set: { 'stats.postCount': 2, 'stats.followingCount': 4 } })
      const tags = h.db.collection<{ _id: string; postCount: number }>('tags')
      await tags.updateOne({ _id: 'cat' }, { $set: { postCount: 9 } })

      const r = await reconcileCounters(deps)

      expect(r.fixed).toBe(3)
      const post = (await h.db.collection('posts').findOne({ _id: live }))!
      expect(post.counts).toMatchObject({ likes: 0, bookmarks: 0, comments: 1 })
      expect(post.reportCounts).toEqual({ total: 1, ai_art: 1 })
      const user = (await h.db.collection('users').findOne({ _id: oid(author.id) }))!
      expect(user.stats).toEqual({ followerCount: 0, followingCount: 0, postCount: 1 })
      expect((await tags.findOne({ _id: 'cat' }))!.postCount).toBe(1)

      expect(await reconcileCounters(deps)).toEqual({ fixed: 0 })
    })
  })
})

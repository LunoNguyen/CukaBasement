import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTIFY_BATCH, notifyStaffReview, type NotifyStaffReviewData } from '../src/jobs/handlers/notify-staff-review'
import { processFile } from '../src/jobs/handlers/process-file'
import { JOBS, type JobsPort } from '../src/jobs/jobs.port'
import { approve, createPost, createTestHarness, createUser, type Harness, jobDeps, uploadFixture } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

describe('staff review notifications', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const reviewJobs = () => h.jobs.enqueued.filter((j) => j.name === 'notify-staff-review').map((j) => j.data as unknown as NotifyStaffReviewData)
  /** Runs every enqueued notify-staff-review job inline, as the worker would, then forgets them. */
  const runReviewJobs = async () => {
    const results = []
    for (const data of reviewJobs()) results.push(await notifyStaffReview(jobDeps(h), data))
    h.jobs.enqueued.splice(0, h.jobs.enqueued.length, ...h.jobs.enqueued.filter((j) => j.name !== 'notify-staff-review'))
    return results
  }
  const notifs = (userId: string) => h.db.collection('notifications').find({ userId: new Types.ObjectId(userId) }).toArray()
  const list = (token: string) => h.http().get('/api/notifications').set(auth(token))
  const count = async (token: string) => (await h.http().get('/api/notifications/unread-count').set(auth(token))).body.count as number
  const readyPng = async (u: { token: string }) => {
    const fileId = await uploadFixture(h, u, 'tiny.png')
    await processFile(jobDeps(h), { fileId })
    return fileId
  }

  async function cast() {
    const author = await createUser(h)
    const mod = await createUser(h, { role: 'moderator' })
    const admin = await createUser(h, { role: 'admin' })
    const user = await createUser(h)
    const bannedMod = await createUser(h, { role: 'moderator', status: 'banned' })
    const suspendedAdmin = await createUser(h, { role: 'admin', status: 'suspended' })
    return { author, mod, admin, user, bannedMod, suspendedAdmin }
  }

  it('a new post notifies each active moderator and admin once; author, users and banned/suspended staff get nothing', async () => {
    const c = await cast()
    const postId = await createPost(h, c.author, { title: 'Mèo mướp' })
    expect(reviewJobs()).toEqual([{ postId, event: 'submitted', key: 'new' }])
    expect(await runReviewJobs()).toEqual([{ inserted: 2 }])

    for (const staff of [c.mod, c.admin]) {
      expect(await count(staff.token)).toBe(1)
      const res = await list(staff.token)
      expect(res.body.items).toHaveLength(1)
      expect(res.body.items[0]).toMatchObject({
        type: 'post_pending_review',
        actor: { username: c.author.username },
        post: { id: postId, title: 'Mèo mướp' },
        readAt: null,
      })
      // Staff can open the pending post the notification links to.
      expect((await h.http().get(`/api/posts/${postId}`).set(auth(staff.token))).status).toBe(200)
    }
    for (const other of [c.author, c.user, c.bannedMod, c.suspendedAdmin]) expect(await notifs(other.id)).toHaveLength(0)
  })

  it('a staff author is not notified about their own post', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const admin = await createUser(h, { role: 'admin' })
    const postId = await createPost(h, mod)
    expect(await runReviewJobs()).toEqual([{ inserted: 1 }])
    expect(await notifs(mod.id)).toHaveLength(0)
    expect((await notifs(admin.id)).map((n) => [n.type, n.postId.toString(), n.actorId.toString()])).toEqual([['post_pending_review', postId, mod.id]])
  })

  it('is idempotent: retrying the job (whole or after a partial run) never duplicates', async () => {
    const c = await cast()
    const postId = await createPost(h, c.author)
    const [data] = reviewJobs()
    expect(await notifyStaffReview(jobDeps(h), data!)).toEqual({ inserted: 2 })
    expect(await notifyStaffReview(jobDeps(h), data!)).toEqual({ inserted: 0 })
    // A partial earlier attempt: only the admin was notified, the retry adds the rest.
    await h.db.collection('notifications').deleteMany({ userId: new Types.ObjectId(c.mod.id) })
    expect(await notifyStaffReview(jobDeps(h), data!)).toEqual({ inserted: 1 })
    expect(await notifs(c.mod.id)).toHaveLength(1)
    expect(await notifs(c.admin.id)).toHaveLength(1)
    expect(await h.db.collection('notifications').countDocuments({ postId: new Types.ObjectId(postId) })).toBe(2)
  })

  it('inserts in chunks for a large staff list', async () => {
    const author = await createUser(h)
    const n = NOTIFY_BATCH + 7
    await h.db.collection('users').insertMany(
      Array.from({ length: n }, (_, i) => ({
        email: `bulk${i}@example.com`,
        passwordHash: 'x',
        role: i % 2 ? 'admin' : 'moderator',
        status: 'active',
        profile: { username: `bulk_${i}`, displayName: `Bulk ${i}` },
      })),
    )
    const postId = await createPost(h, author)
    const spy = vi.spyOn(h.db.collection('notifications'), 'insertMany')
    try {
      expect(await runReviewJobs()).toEqual([{ inserted: n }])
      expect(spy.mock.calls.map(([docs]) => docs.length)).toEqual([NOTIFY_BATCH, 7])
    } finally {
      spy.mockRestore()
    }
    expect(await h.db.collection('notifications').countDocuments({ postId: new Types.ObjectId(postId), type: 'post_pending_review' })).toBe(n)
  })

  it('a post sent back to pending by an edit notifies post_resubmitted; edits of a still-pending post do not', async () => {
    const c = await cast()
    const postId = await createPost(h, c.author, { title: 'Bản cũ' })
    await runReviewJobs()

    // Still pending: replacing the file changes nothing in the queue.
    const [f1, f2] = [await readyPng(c.author), await readyPng(c.author)]
    let res = await h.http().patch(`/api/posts/${postId}`).set(auth(c.author.token)).send({ files: [{ fileId: f1, position: 0, isCover: true }] })
    expect(res.body.review.status).toBe('pending')
    expect(reviewJobs()).toEqual([])

    // Approved, then a new file → pending again.
    await approve(h, postId)
    res = await h.http().patch(`/api/posts/${postId}`).set(auth(c.author.token)).send({ files: [{ fileId: f2, position: 0, isCover: true }] })
    expect(res.body.review.status).toBe('pending')
    expect(reviewJobs()).toEqual([{ postId, event: 'resubmitted', key: expect.any(String) }])
    expect(await runReviewJobs()).toEqual([{ inserted: 2 }])

    // Rejected, then edited → pending again: a second, separate re-review notification.
    await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { 'review.status': 'rejected', 'review.reason': 'x' } })
    await h.http().patch(`/api/posts/${postId}`).set(auth(c.author.token)).send({ title: 'Bản mới' })
    expect(await runReviewJobs()).toEqual([{ inserted: 2 }])

    for (const staff of [c.mod, c.admin]) {
      const items = (await list(staff.token)).body.items as Array<{ type: string; post: { title: string } }>
      expect(items.map((i) => i.type)).toEqual(['post_resubmitted', 'post_resubmitted', 'post_pending_review'])
      expect(items[0]!.post.title).toBe('Bản mới')
    }
    for (const other of [c.author, c.user, c.bannedMod]) expect(await notifs(other.id)).toHaveLength(0)
  })

  it('an approved edit that keeps the status notifies no one', async () => {
    const c = await cast()
    const postId = await createPost(h, c.author)
    h.jobs.clear()
    await approve(h, postId)
    await h.http().patch(`/api/posts/${postId}`).set(auth(c.author.token)).send({ title: 'Đổi tên' })
    expect(reviewJobs()).toEqual([])
  })

  it('skips a post that was reviewed or deleted before the job ran', async () => {
    const c = await cast()
    const approved = await createPost(h, c.author)
    const deleted = await createPost(h, c.author)
    await approve(h, approved)
    expect((await h.http().delete(`/api/posts/${deleted}`).set(auth(c.author.token))).status).toBe(204)
    expect(await runReviewJobs()).toEqual([{ inserted: 0 }, { inserted: 0 }])
    expect(await h.db.collection('notifications').countDocuments({})).toBe(0)
  })

  it('a failing enqueue does not fail post creation', async () => {
    const author = await createUser(h)
    const jobs = h.app.get<JobsPort>(JOBS)
    const original = jobs.enqueue
    jobs.enqueue = async (name, data) => {
      if (name === 'notify-staff-review') throw new Error('queue down')
      return original(name, data)
    }
    try {
      const postId = await createPost(h, author)
      expect(Types.ObjectId.isValid(postId)).toBe(true)
    } finally {
      jobs.enqueue = original
    }
  })
})

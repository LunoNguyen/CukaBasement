import type { ReportReason } from '@cuka/shared'
import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SettingsService } from '../src/settings/settings.service'
import { createPost, createTestHarness, createUser, type Harness } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

describe('moderation', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  /** Inserts a post directly (default: approved, public, rating all). */
  async function seed(authorId: string, over: Record<string, unknown> = {}): Promise<string> {
    const _id = new Types.ObjectId()
    const now = new Date()
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
      sourceCredit: '',
      files: [{ fileId: new Types.ObjectId(), position: 0, isCover: true }],
      tags: [],
      counts: { likes: 0, bookmarks: 0, comments: 0, views: 0 },
      reportCounts: { total: 0, ai_art: 0 },
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...over,
    })
    return _id.toString()
  }

  const postDoc = (id: string) => h.db.collection('posts').findOne({ _id: new Types.ObjectId(id) })
  const report = (token: string, postId: string, reason: ReportReason) =>
    h.http().post(`/api/posts/${postId}/report`).set(auth(token)).send({ reason, detail: `d-${reason}` })
  const notifs = (userId: string, type: string) =>
    h.db.collection('notifications').find({ userId: new Types.ObjectId(userId), type }).toArray()
  const logs = (filter: Record<string, unknown> = {}) => h.db.collection('moderationLogs').find(filter).toArray()

  async function reportN(postId: string, reasons: ReportReason[]) {
    for (const reason of reasons) {
      const r = await createUser(h)
      expect((await report(r.token, postId, reason)).status).toBe(201)
    }
  }

  it('user → 403 FORBIDDEN on /mod/queue', async () => {
    const user = await createUser(h)
    const res = await h.http().get('/api/mod/queue').set(auth(user.token))
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect((await h.http().get('/api/mod/queue')).status).toBe(401)
  })

  it('queue lists pending posts oldest first, excludes deleted, includes r18, paginates', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h)
    const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s))
    const pending = { status: 'pending', reason: null, by: null, at: null }
    const a = await seed(author.id, { review: pending, createdAt: t(1) })
    const b = await seed(author.id, { review: pending, rating: 'r18', createdAt: t(2) })
    const c = await seed(author.id, { review: pending, createdAt: t(3) })
    await seed(author.id, { review: pending, createdAt: t(0), deletedAt: new Date() })
    await seed(author.id, { createdAt: t(0) })
    const rejected = await seed(author.id, { review: { ...pending, status: 'rejected', reason: 'x' } })

    const p1 = await h.http().get('/api/mod/queue?limit=2').set(auth(mod.token))
    expect(p1.status).toBe(200)
    expect(p1.body.items.map((x: { id: string }) => x.id)).toEqual([a, b])
    expect(p1.body.items[1].rating).toBe('r18')
    const p2 = await h.http().get(`/api/mod/queue?limit=2&cursor=${p1.body.nextCursor}`).set(auth(mod.token))
    expect(p2.body.items.map((x: { id: string }) => x.id)).toEqual([c])
    expect(p2.body.nextCursor).toBeNull()

    const rej = await h.http().get('/api/mod/queue?status=rejected').set(auth(mod.token))
    expect(rej.body.items.map((x: { id: string }) => x.id)).toEqual([rejected])
  })

  it('queue shows r18 covers with full (non-blurred) URLs to staff', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h, { birthDate: '1990-01-01', showR18: true })
    const postId = await createPost(h, author, { rating: 'r18' })
    const res = await h.http().get('/api/mod/queue').set(auth(mod.token))
    const card = res.body.items.find((x: { id: string }) => x.id === postId)
    expect(card.cover.blurred).toBe(false)
    expect(card.cover.thumbMdUrl).toMatch(/\/thumb_md\.webp\?.*X-Amz-Signature=/)
  })

  it('approve moves post into home feed and notifies author', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h)
    const postId = await createPost(h, author)
    const ids = async () => (await h.http().get('/api/feed/home')).body.items.map((x: { id: string }) => x.id)
    expect(await ids()).not.toContain(postId)

    const res = await h.http().post(`/api/mod/posts/${postId}/approve`).set(auth(mod.token))
    expect(res.status).toBe(200)
    expect(res.body.review).toMatchObject({ status: 'approved', by: mod.id })
    expect(typeof res.body.review.at).toBe('string')
    expect(await ids()).toContain(postId)
    const doc = await postDoc(postId)
    expect(doc!.review.by.toString()).toBe(mod.id)
    expect(await notifs(author.id, 'post_approved')).toHaveLength(1)

    // Approving again is idempotent: no second log or notification.
    expect((await h.http().post(`/api/mod/posts/${postId}/approve`).set(auth(mod.token))).status).toBe(200)
    expect(await notifs(author.id, 'post_approved')).toHaveLength(1)
    expect(await logs({ action: 'approve', targetId: postId })).toHaveLength(1)
  })

  it('concurrent approvals log and notify once', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h)
    const postId = await seed(author.id, { review: { status: 'pending', reason: null, by: null, at: null } })
    const results = await Promise.all(Array.from({ length: 5 }, () => h.http().post(`/api/mod/posts/${postId}/approve`).set(auth(mod.token))))
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(await logs({ action: 'approve', targetId: postId })).toHaveLength(1)
    expect(await notifs(author.id, 'post_approved')).toHaveLength(1)
  })

  it('approve or reject an unknown or deleted post → 404 POST_NOT_FOUND', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h)
    const deleted = await seed(author.id, { deletedAt: new Date() })
    for (const id of [deleted, new Types.ObjectId().toString(), 'nope']) {
      const res = await h.http().post(`/api/mod/posts/${id}/approve`).set(auth(mod.token))
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('POST_NOT_FOUND')
    }
  })

  it('reject requires reason; author sees reason in notification and on GET post', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h)
    const postId = await createPost(h, author)
    const missing = await h.http().post(`/api/mod/posts/${postId}/reject`).set(auth(mod.token)).send({})
    expect(missing.status).toBe(400)
    expect(missing.body.error.code).toBe('VALIDATION_FAILED')

    const res = await h.http().post(`/api/mod/posts/${postId}/reject`).set(auth(mod.token)).send({ reason: 'Watermark from another site' })
    expect(res.status).toBe(200)
    expect(res.body.review).toMatchObject({ status: 'rejected', reason: 'Watermark from another site', by: mod.id })

    const inbox = await h.http().get('/api/notifications').set(auth(author.token))
    const n = inbox.body.items.find((x: { type: string }) => x.type === 'post_rejected')
    expect(n.reason).toBe('Watermark from another site')
    const post = await h.http().get(`/api/posts/${postId}`).set(auth(author.token))
    expect(post.body.review).toEqual({ status: 'rejected', reason: 'Watermark from another site' })
    // Others no longer see a rejected post.
    expect((await h.http().get(`/api/posts/${postId}`)).status).toBe(404)
    // Rejected posts can be approved later.
    const ok = await h.http().post(`/api/mod/posts/${postId}/approve`).set(auth(mod.token))
    expect(ok.body.review.status).toBe('approved')
    expect((await postDoc(postId))!.review.reason).toBeNull()
  })

  it('hide removes the post and notifies; restore makes it public again', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h)
    const postId = await seed(author.id)
    const hide = await h.http().post(`/api/mod/posts/${postId}/hide`).set(auth(mod.token)).send({ note: 'off-topic' })
    expect(hide.status).toBe(200)
    expect(hide.body.visibility).toBe('removed')
    expect((await postDoc(postId))!.visibility).toBe('removed')
    expect(await notifs(author.id, 'post_hidden')).toHaveLength(1)
    expect((await logs({ action: 'hide', targetId: postId }))[0]!.note).toBe('off-topic')

    const restore = await h.http().post(`/api/mod/posts/${postId}/restore`).set(auth(mod.token))
    expect(restore.status).toBe(200)
    expect(restore.body.visibility).toBe('public')
    expect(await logs({ action: 'restore', targetId: postId })).toHaveLength(1)
  })

  it('report queue lists ai_art-reported posts before more-reported spam posts', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h)
    const spam = await seed(author.id)
    const ai = await seed(author.id)
    const few = await seed(author.id)
    await seed(author.id) // unreported
    await reportN(few, ['other'])
    await reportN(spam, ['spam', 'spam', 'spam', 'other'])
    await reportN(ai, ['ai_art'])

    const res = await h.http().get('/api/mod/reports').set(auth(mod.token))
    expect(res.status).toBe(200)
    expect(res.body.items.map((g: { post: { id: string } }) => g.post.id)).toEqual([ai, spam, few])
    const spamGroup = res.body.items[1]
    expect(spamGroup.total).toBe(4)
    expect(spamGroup.aiArt).toBe(0)
    expect(spamGroup.reasons).toEqual({ ai_art: 0, stolen_art: 0, unmarked_r18: 0, spam: 3, other: 1 })
    expect(spamGroup.latest).toHaveLength(4)
    expect(spamGroup.latest[0]).toMatchObject({ reason: 'other', detail: 'd-other' })
    expect(typeof spamGroup.latest[0].reporter.username).toBe('string')
    expect(spamGroup.latest[0].reporter.username).not.toBe('')
  })

  it('report queue keeps only the latest 5 reports per post and drops resolved reports', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h)
    const postId = await seed(author.id)
    await h.app.get(SettingsService).update({ reportHideThreshold: 100 })
    await reportN(postId, ['spam', 'spam', 'spam', 'spam', 'spam', 'other', 'other'])
    const res = await h.http().get('/api/mod/reports').set(auth(mod.token))
    expect(res.body.items[0].total).toBe(7)
    expect(res.body.items[0].latest).toHaveLength(5)
    expect(res.body.items[0].latest[0].reason).toBe('other')

    await h.http().post(`/api/mod/reports/posts/${postId}/resolve`).set(auth(mod.token)).send({ decision: 'keep' })
    expect((await h.http().get('/api/mod/reports').set(auth(mod.token))).body.items).toEqual([])
  })

  it('resolve keep restores auto-hidden post, zeroes counts, reporters still cannot re-report', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h)
    const postId = await seed(author.id)
    const reporters = [await createUser(h), await createUser(h), await createUser(h)]
    for (const r of reporters) await report(r.token, postId, 'ai_art')
    expect((await postDoc(postId))!.visibility).toBe('hidden_by_reports')

    const res = await h.http().post(`/api/mod/reports/posts/${postId}/resolve`).set(auth(mod.token)).send({ decision: 'keep', note: 'not AI' })
    expect(res.status).toBe(200)
    const doc = await postDoc(postId)
    expect(doc!.visibility).toBe('public')
    expect(doc!.reportCounts).toEqual({ total: 0, ai_art: 0 })
    const stored = await h.db.collection('reports').find({ postId: new Types.ObjectId(postId) }).toArray()
    expect(stored.every((r) => r.status === 'dismissed' && r.resolvedBy.toString() === mod.id && r.resolvedAt instanceof Date)).toBe(true)
    expect((await logs({ action: 'restore', targetId: postId }))[0]!.note).toBe('not AI')

    const again = await report(reporters[0]!.token, postId, 'ai_art')
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('REPORT_ALREADY_EXISTS')
    expect((await h.http().get('/api/feed/home')).body.items.map((x: { id: string }) => x.id)).toContain(postId)
  })

  it('resolve remove keeps post out of every feed and profile for others', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h)
    const other = await createUser(h)
    const postId = await seed(author.id)
    await reportN(postId, ['spam'])

    const res = await h.http().post(`/api/mod/reports/posts/${postId}/resolve`).set(auth(mod.token)).send({ decision: 'remove' })
    expect(res.status).toBe(200)
    const doc = await postDoc(postId)
    expect(doc!.visibility).toBe('removed')
    const stored = await h.db.collection('reports').find({ postId: new Types.ObjectId(postId) }).toArray()
    expect(stored.every((r) => r.status === 'actioned' && r.resolvedBy.toString() === mod.id)).toBe(true)
    expect(await logs({ action: 'remove', targetId: postId })).toHaveLength(1)
    expect(await notifs(author.id, 'post_hidden')).toHaveLength(1)

    const ids = (r: { body: { items: Array<{ id: string }> } }) => r.body.items.map((x) => x.id)
    expect(ids(await h.http().get('/api/feed/home').set(auth(other.token)))).not.toContain(postId)
    expect(ids(await h.http().get(`/api/users/${author.username}/posts`).set(auth(other.token)))).not.toContain(postId)
    expect(ids(await h.http().get(`/api/users/${author.username}/posts`))).not.toContain(postId)
    expect((await h.http().get(`/api/posts/${postId}`).set(auth(other.token))).status).toBe(404)
    // Restore only touches visibility: the actioned reports stay as they were.
    await h.http().post(`/api/mod/posts/${postId}/restore`).set(auth(mod.token))
    expect((await postDoc(postId))!.visibility).toBe('public')
    expect(await h.db.collection('reports').countDocuments({ status: 'actioned' })).toBe(1)
  })

  it('moderator cannot hide an admin’s post → 403 CANNOT_MODERATE_PEER; admin can', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const admin = await createUser(h, { role: 'admin' })
    const otherMod = await createUser(h, { role: 'moderator' })
    const adminPost = await seed(admin.id)
    const modPost = await seed(otherMod.id, { review: { status: 'pending', reason: null, by: null, at: null } })

    for (const [path, body] of [
      [`/api/mod/posts/${adminPost}/hide`, {}],
      [`/api/mod/posts/${modPost}/approve`, {}],
      [`/api/mod/posts/${modPost}/reject`, { reason: 'x' }],
      [`/api/mod/posts/${adminPost}/restore`, {}],
      [`/api/mod/reports/posts/${adminPost}/resolve`, { decision: 'remove' }],
    ] as const) {
      const res = await h.http().post(path).set(auth(mod.token)).send(body)
      expect(res.status, path).toBe(403)
      expect(res.body.error.code).toBe('CANNOT_MODERATE_PEER')
    }
    expect((await postDoc(adminPost))!.visibility).toBe('public')

    const comment = await h.http().post(`/api/posts/${adminPost}/comments`).set(auth(admin.token)).send({ body: 'hi' })
    const ch = await h.http().post(`/api/mod/comments/${comment.body.id}/hide`).set(auth(mod.token))
    expect(ch.status).toBe(403)
    expect(ch.body.error.code).toBe('CANNOT_MODERATE_PEER')

    const ok = await h.http().post(`/api/mod/posts/${modPost}/hide`).set(auth(admin.token)).send({})
    expect(ok.status).toBe(200)
    expect((await postDoc(modPost))!.visibility).toBe('removed')
  })

  it('hide comment sets status hidden; unknown or deleted → 404 COMMENT_NOT_FOUND', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h)
    const postId = await seed(author.id)
    const c = await h.http().post(`/api/posts/${postId}/comments`).set(auth(author.token)).send({ body: 'rude' })
    const res = await h.http().post(`/api/mod/comments/${c.body.id}/hide`).set(auth(mod.token))
    expect(res.status).toBe(200)
    const doc = await h.db.collection('comments').findOne({ _id: new Types.ObjectId(c.body.id) })
    expect(doc!.status).toBe('hidden')

    await h.db.collection('comments').updateOne({ _id: doc!._id }, { $set: { deletedAt: new Date() } })
    for (const id of [c.body.id, new Types.ObjectId().toString(), 'bad']) {
      const r = await h.http().post(`/api/mod/comments/${id}/hide`).set(auth(mod.token))
      expect(r.status).toBe(404)
      expect(r.body.error.code).toBe('COMMENT_NOT_FOUND')
    }
  })

  it('every action writes a moderationLogs entry with the actor id', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const author = await createUser(h)
    const pending = { status: 'pending', reason: null, by: null, at: null }
    const p1 = await seed(author.id, { review: pending })
    const p2 = await seed(author.id, { review: pending })
    const p3 = await seed(author.id)
    const p4 = await seed(author.id)
    await reportN(p4, ['spam'])
    const c = await h.http().post(`/api/posts/${p3}/comments`).set(auth(author.token)).send({ body: 'hey' })

    const as = (path: string, body: object = {}) => h.http().post(path).set(auth(mod.token)).send(body)
    expect((await as(`/api/mod/posts/${p1}/approve`)).status).toBe(200)
    expect((await as(`/api/mod/posts/${p2}/reject`, { reason: 'no' })).status).toBe(200)
    expect((await as(`/api/mod/posts/${p3}/hide`)).status).toBe(200)
    expect((await as(`/api/mod/posts/${p3}/restore`)).status).toBe(200)
    expect((await as(`/api/mod/reports/posts/${p4}/resolve`, { decision: 'remove' })).status).toBe(200)
    expect((await as(`/api/mod/comments/${c.body.id}/hide`)).status).toBe(200)

    const all = await logs()
    expect(all.map((l) => [l.action, l.targetType, l.targetId])).toEqual([
      ['approve', 'post', p1],
      ['reject', 'post', p2],
      ['hide', 'post', p3],
      ['restore', 'post', p3],
      ['remove', 'post', p4],
      ['hide_comment', 'comment', c.body.id],
    ])
    for (const l of all) {
      expect(l.actorId).toBeInstanceOf(Types.ObjectId)
      expect(l.actorId.toString()).toBe(mod.id)
    }
  })
})

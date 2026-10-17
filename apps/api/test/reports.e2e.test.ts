import type { ReportReason } from '@cuka/shared'
import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ReportsService, recountOpenReports } from '../src/reports/reports.service'
import { SettingsService } from '../src/settings/settings.service'
import { createTestHarness, createUser, type Harness } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

describe('reports and auto-hide', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  /** Inserts an approved public post directly. */
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
      credit: { isOwnWork: true, artistName: '', artistHandle: '', platform: 'other', sourceUrl: '', permissionNote: '' },
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

  const report = (token: string, postId: string, reason: ReportReason, detail?: string) =>
    h
      .http()
      .post(`/api/posts/${postId}/report`)
      .set(auth(token))
      .send(detail === undefined ? { reason } : { reason, detail })

  const postDoc = (id: string) => h.db.collection('posts').findOne({ _id: new Types.ObjectId(id) })
  const autoHideLogs = (id: string) => h.db.collection('moderationLogs').find({ action: 'auto_hide', targetId: id }).toArray()
  const hiddenNotifs = (userId: string) => h.db.collection('notifications').find({ userId: new Types.ObjectId(userId), type: 'post_hidden' }).toArray()

  async function reporters(n: number) {
    const out = []
    for (let i = 0; i < n; i++) out.push(await createUser(h))
    return out
  }

  it('stores a report and returns 201 { reported: true }', async () => {
    const author = await createUser(h)
    const r = await createUser(h)
    const postId = await seed(author.id)
    const res = await report(r.token, postId, 'spam', 'looks like an ad')
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ reported: true })
    const stored = await h.db.collection('reports').findOne({ postId: new Types.ObjectId(postId) })
    expect(stored).toMatchObject({ reason: 'spam', detail: 'looks like an ad', status: 'open', resolvedBy: null, resolvedAt: null })
    expect(stored!.reporterId.toString()).toBe(r.id)
    expect((await postDoc(postId))!.reportCounts).toEqual({ total: 1, ai_art: 0 })
  })

  it('rejects detail over 1000 chars and unknown reasons', async () => {
    const author = await createUser(h)
    const r = await createUser(h)
    const postId = await seed(author.id)
    expect((await report(r.token, postId, 'spam', 'x'.repeat(1001))).status).toBe(400)
    expect((await report(r.token, postId, 'nope' as ReportReason)).status).toBe(400)
  })

  it('second report by same user → 409 REPORT_ALREADY_EXISTS', async () => {
    const author = await createUser(h)
    const r = await createUser(h)
    const postId = await seed(author.id)
    expect((await report(r.token, postId, 'spam')).status).toBe(201)
    const again = await report(r.token, postId, 'ai_art')
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('REPORT_ALREADY_EXISTS')
    expect((await postDoc(postId))!.reportCounts).toEqual({ total: 1, ai_art: 0 })
  })

  it('a dismissed earlier report still blocks reporting again', async () => {
    const author = await createUser(h)
    const r = await createUser(h)
    const postId = await seed(author.id)
    await report(r.token, postId, 'spam')
    await h.db.collection('reports').updateMany({}, { $set: { status: 'dismissed' } })
    const again = await report(r.token, postId, 'spam')
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('REPORT_ALREADY_EXISTS')
  })

  it('parallel duplicate reports → exactly one stored, total 1', async () => {
    const author = await createUser(h)
    const r = await createUser(h)
    const postId = await seed(author.id)
    const results = await Promise.all(Array.from({ length: 5 }, () => report(r.token, postId, 'ai_art')))
    expect(results.map((x) => x.status).sort()).toEqual([201, 409, 409, 409, 409])
    expect(await h.db.collection('reports').countDocuments({ postId: new Types.ObjectId(postId) })).toBe(1)
    expect((await postDoc(postId))!.reportCounts).toEqual({ total: 1, ai_art: 1 })
  })

  it('5 reports of mixed reasons hide the post and log auto_hide', async () => {
    const author = await createUser(h)
    const users = await reporters(5)
    const postId = await seed(author.id)
    const reasons: ReportReason[] = ['spam', 'other', 'stolen_art', 'unmarked_r18', 'spam']
    for (let i = 0; i < 4; i++) expect((await report(users[i]!.token, postId, reasons[i]!)).status).toBe(201)
    expect((await postDoc(postId))!.visibility).toBe('public')
    expect(await autoHideLogs(postId)).toHaveLength(0)

    expect((await report(users[4]!.token, postId, reasons[4]!)).status).toBe(201)
    const post = await postDoc(postId)
    expect(post!.visibility).toBe('hidden_by_reports')
    expect(post!.reportCounts).toEqual({ total: 5, ai_art: 0 })
    const logs = await autoHideLogs(postId)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ actorId: 'system', action: 'auto_hide', targetType: 'post', targetId: postId, note: 'total=5 ai_art=0' })
    expect(logs[0]!.createdAt).toBeInstanceOf(Date)
  })

  it('3 ai_art reports hide the post; 2 ai_art + 2 spam do not', async () => {
    const author = await createUser(h)
    const users = await reporters(4)
    const a = await seed(author.id)
    const b = await seed(author.id)

    await report(users[0]!.token, b, 'ai_art')
    await report(users[1]!.token, b, 'ai_art')
    await report(users[2]!.token, b, 'spam')
    await report(users[3]!.token, b, 'spam')
    expect((await postDoc(b))!.visibility).toBe('public')
    expect((await postDoc(b))!.reportCounts).toEqual({ total: 4, ai_art: 2 })

    for (let i = 0; i < 3; i++) await report(users[i]!.token, a, 'ai_art')
    expect((await postDoc(a))!.visibility).toBe('hidden_by_reports')
    expect((await autoHideLogs(a))[0]!.note).toBe('total=3 ai_art=3')
  })

  it('threshold change via settings (ai=2) applies to the next report', async () => {
    const author = await createUser(h)
    const users = await reporters(2)
    const postId = await seed(author.id)
    await report(users[0]!.token, postId, 'ai_art')
    await h.app.get(SettingsService).update({ reportAiHideThreshold: 2 })
    await report(users[1]!.token, postId, 'ai_art')
    expect((await postDoc(postId))!.visibility).toBe('hidden_by_reports')
  })

  it('author receives post_hidden notification once', async () => {
    const author = await createUser(h)
    const users = await reporters(5)
    const postId = await seed(author.id)
    for (const u of users) await report(u.token, postId, 'ai_art')
    const notifs = await hiddenNotifs(author.id)
    expect(notifs).toHaveLength(1)
    expect(notifs[0]!.postId.toString()).toBe(postId)
    expect(notifs[0]!.actorId).toBeNull()
    expect(await autoHideLogs(postId)).toHaveLength(1)
  })

  it('concurrent reports crossing the threshold → one auto_hide log and one notification', async () => {
    const author = await createUser(h)
    const users = await reporters(8)
    const postId = await seed(author.id)
    const results = await Promise.all(users.map((u) => report(u.token, postId, 'ai_art')))
    // A request that loads the post after another one already hid it gets 404: the post is no longer viewable.
    for (const r of results) if (r.status !== 201) expect([r.status, r.body.error.code]).toEqual([404, 'POST_NOT_FOUND'])
    const accepted = results.filter((r) => r.status === 201).length
    expect(accepted).toBeGreaterThanOrEqual(3)
    const post = await postDoc(postId)
    expect(post!.visibility).toBe('hidden_by_reports')
    expect(post!.reportCounts).toEqual({ total: accepted, ai_art: accepted })
    expect(await autoHideLogs(postId)).toHaveLength(1)
    expect(await hiddenNotifs(author.id)).toHaveLength(1)
  })

  it('reporting own post → 400 CANNOT_REPORT_OWN_POST', async () => {
    const author = await createUser(h)
    const postId = await seed(author.id)
    const res = await report(author.token, postId, 'spam')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('CANNOT_REPORT_OWN_POST')
    expect(await h.db.collection('reports').countDocuments()).toBe(0)
  })

  it('post the reporter cannot view → 404 POST_NOT_FOUND', async () => {
    const author = await createUser(h)
    const r = await createUser(h)
    const rejected = await seed(author.id, { review: { status: 'rejected', reason: 'x', by: null, at: null } })
    const deleted = await seed(author.id, { deletedAt: new Date() })
    for (const id of [rejected, deleted, new Types.ObjectId().toString(), 'not-an-id']) {
      const res = await report(r.token, id, 'spam')
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('POST_NOT_FOUND')
    }
  })

  it('requires a verified login', async () => {
    const author = await createUser(h)
    const unverified = await createUser(h, { verified: false })
    const postId = await seed(author.id)
    expect((await h.http().post(`/api/posts/${postId}/report`).send({ reason: 'spam' })).status).toBe(401)
    expect((await report(unverified.token, postId, 'spam')).status).toBe(403)
  })

  it('hidden post disappears from home feed but owner still sees it', async () => {
    const author = await createUser(h)
    const users = await reporters(3)
    const postId = await seed(author.id)
    const before = await h.http().get('/api/feed/home')
    expect(before.body.items.map((i: { id: string }) => i.id)).toContain(postId)

    for (const u of users) await report(u.token, postId, 'ai_art')

    const after = await h.http().get('/api/feed/home')
    expect(after.body.items.map((i: { id: string }) => i.id)).not.toContain(postId)
    expect((await h.http().get(`/api/posts/${postId}`)).status).toBe(404)
    const own = await h.http().get(`/api/posts/${postId}`).set(auth(author.token))
    expect(own.status).toBe(200)
    expect(own.body.visibility).toBe('hidden_by_reports')
  })
  it('recountOpen recomputes reportCounts from open reports only', async () => {
    const author = await createUser(h)
    const users = await reporters(4)
    const postId = await seed(author.id)
    await report(users[0]!.token, postId, 'ai_art')
    await report(users[1]!.token, postId, 'ai_art')
    await report(users[2]!.token, postId, 'spam')
    await report(users[3]!.token, postId, 'other')
    await h.db.collection('reports').updateOne({ reporterId: new Types.ObjectId(users[0]!.id) }, { $set: { status: 'dismissed' } })
    await h.db.collection('reports').updateOne({ reporterId: new Types.ObjectId(users[3]!.id) }, { $set: { status: 'actioned' } })
    await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { reportCounts: { total: 99, ai_art: 42 } } })

    expect(await h.app.get(ReportsService).recountOpen(postId)).toEqual({ total: 2, ai_art: 1 })
    expect((await postDoc(postId))!.reportCounts).toEqual({ total: 2, ai_art: 1 })

    await h.db.collection('reports').updateMany({}, { $set: { status: 'dismissed' } })
    expect(await recountOpenReports(h.db, postId)).toEqual({ total: 0, ai_art: 0 })
    expect((await postDoc(postId))!.reportCounts).toEqual({ total: 0, ai_art: 0 })
  })
})

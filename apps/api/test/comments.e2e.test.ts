import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPost, createTestHarness, createUser, type Harness } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

describe('comments', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const add = (postId: string, token: string, body: Record<string, unknown>) =>
    h.http().post(`/api/posts/${postId}/comments`).set(auth(token)).send(body)
  const list = (postId: string, token?: string, query = '') =>
    h.http().get(`/api/posts/${postId}/comments${query}`).set(token ? auth(token) : {})
  const notifs = (q: Record<string, unknown> = {}) => h.db.collection('notifications').find(q).toArray()
  const commentCount = async (postId: string) =>
    (await h.db.collection('posts').findOne({ _id: new Types.ObjectId(postId) }))!.counts.comments

  it('creates a comment, counts it, notifies the post author, lists with author info', async () => {
    const author = await createUser(h)
    const fan = await createUser(h)
    const postId = await createPost(h, author)
    const res = await add(postId, fan.token, { body: 'nice' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ body: 'nice', parentId: null, status: 'visible', author: { id: fan.id, username: fan.username, avatarUrl: null } })
    expect(await commentCount(postId)).toBe(1)
    const n = await notifs({ type: 'comment' })
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ userId: new Types.ObjectId(author.id), actorId: new Types.ObjectId(fan.id), commentId: new Types.ObjectId(res.body.id) })
    const got = await list(postId)
    expect(got.status).toBe(200)
    expect(got.body.items).toHaveLength(1)
    expect(got.body.items[0].replies).toEqual([])
    expect(got.body.nextCursor).toBeNull()
  })

  it('commenting on own post sends no notification', async () => {
    const author = await createUser(h)
    const postId = await createPost(h, author)
    await add(postId, author.token, { body: 'mine' })
    expect(await notifs()).toHaveLength(0)
  })

  it('reply to a reply → 400 REPLY_DEPTH_EXCEEDED', async () => {
    const author = await createUser(h)
    const fan = await createUser(h)
    const postId = await createPost(h, author)
    const top = await add(postId, fan.token, { body: 'top' })
    const reply = await add(postId, author.token, { body: 'reply', parentId: top.body.id })
    expect(reply.status).toBe(201)
    const deep = await add(postId, fan.token, { body: 'deep', parentId: reply.body.id })
    expect(deep.status).toBe(400)
    expect(deep.body.error.code).toBe('REPLY_DEPTH_EXCEEDED')
  })

  it('parent from another post or unknown → 404 COMMENT_NOT_FOUND', async () => {
    const author = await createUser(h)
    const p1 = await createPost(h, author)
    const p2 = await createPost(h, author)
    const top = await add(p1, author.token, { body: 'top' })
    const wrong = await add(p2, author.token, { body: 'x', parentId: top.body.id })
    expect(wrong.status).toBe(404)
    expect(wrong.body.error.code).toBe('COMMENT_NOT_FOUND')
    const unknown = await add(p1, author.token, { body: 'x', parentId: new Types.ObjectId().toString() })
    expect(unknown.status).toBe(404)
    expect(unknown.body.error.code).toBe('COMMENT_NOT_FOUND')
  })

  it('reply notifies parent author (reply) and post author (comment); same person gets one', async () => {
    const author = await createUser(h)
    const a = await createUser(h)
    const b = await createUser(h)
    const postId = await createPost(h, author)
    const top = await add(postId, a.token, { body: 'top' })
    await h.db.collection('notifications').deleteMany({})
    await add(postId, b.token, { body: 'r1', parentId: top.body.id })
    const n = await notifs()
    expect(n.map((x) => [x.userId.toString(), x.type]).sort()).toEqual(
      [[a.id, 'reply'], [author.id, 'comment']].sort(),
    )

    // parent author is the post author: a single 'reply'
    const top2 = await add(postId, author.token, { body: 'top2' })
    await h.db.collection('notifications').deleteMany({})
    await add(postId, b.token, { body: 'r2', parentId: top2.body.id })
    const n2 = await notifs()
    expect(n2).toHaveLength(1)
    expect(n2[0]).toMatchObject({ userId: new Types.ObjectId(author.id), type: 'reply' })

    // replying to yourself notifies nobody extra
    await h.db.collection('notifications').deleteMany({})
    await add(postId, a.token, { body: 'self', parentId: top.body.id })
    const n3 = await notifs()
    expect(n3.map((x) => x.userId.toString())).toEqual([author.id])
  })

  it('lists replies nested oldest first, and paginates top-level comments', async () => {
    const author = await createUser(h)
    const fan = await createUser(h)
    const postId = await createPost(h, author)
    const c1 = await add(postId, fan.token, { body: 'c1' })
    const c2 = await add(postId, fan.token, { body: 'c2' })
    const c3 = await add(postId, fan.token, { body: 'c3' })
    await add(postId, author.token, { body: 'r1', parentId: c1.body.id })
    await add(postId, fan.token, { body: 'r2', parentId: c1.body.id })
    const p1 = await list(postId, undefined, '?limit=2')
    expect(p1.body.items.map((c: { body: string }) => c.body)).toEqual(['c1', 'c2'])
    expect(p1.body.items[0].replies.map((c: { body: string }) => c.body)).toEqual(['r1', 'r2'])
    expect(p1.body.nextCursor).not.toBeNull()
    const p2 = await list(postId, undefined, `?limit=2&cursor=${p1.body.nextCursor}`)
    expect(p2.body.items.map((c: { id: string }) => c.id)).toEqual([c3.body.id])
    expect(p2.body.nextCursor).toBeNull()
    expect(c2.status).toBe(201)
  })

  it('hidden comment body is empty for others and full for staff and author', async () => {
    const author = await createUser(h)
    const fan = await createUser(h)
    const other = await createUser(h)
    const mod = await createUser(h, { role: 'moderator' })
    const postId = await createPost(h, author)
    const c = await add(postId, fan.token, { body: 'secret' })
    await h.db.collection('comments').updateOne({ _id: new Types.ObjectId(c.body.id) }, { $set: { status: 'hidden' } })
    const bodyFor = async (token?: string) => (await list(postId, token)).body.items[0]
    expect(await bodyFor(other.token)).toMatchObject({ status: 'hidden', body: '', author: { id: fan.id } })
    expect(await bodyFor()).toMatchObject({ status: 'hidden', body: '' })
    expect(await bodyFor(mod.token)).toMatchObject({ status: 'hidden', body: 'secret' })
    expect(await bodyFor(fan.token)).toMatchObject({ status: 'hidden', body: 'secret' })
  })

  it('post that viewer cannot see → 404 POST_NOT_FOUND for list and create', async () => {
    const author = await createUser(h)
    const fan = await createUser(h)
    const postId = await createPost(h, author)
    await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { visibility: 'removed' } })
    const g = await list(postId, fan.token)
    expect(g.status).toBe(404)
    expect(g.body.error.code).toBe('POST_NOT_FOUND')
    const p = await add(postId, fan.token, { body: 'x' })
    expect(p.status).toBe(404)
    expect(p.body.error.code).toBe('POST_NOT_FOUND')
  })

  describe('delete', () => {
    it('delete decrements counts.comments once; deleted omitted; replies of deleted parent omitted', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const postId = await createPost(h, author)
      const top = await add(postId, fan.token, { body: 'top' })
      await add(postId, author.token, { body: 'r', parentId: top.body.id })
      expect(await commentCount(postId)).toBe(2)
      const del = () => h.http().delete(`/api/comments/${top.body.id}`).set(auth(fan.token))
      const first = await del()
      expect(first.status).toBe(204)
      expect(await commentCount(postId)).toBe(1)
      const again = await del()
      expect(again.status).toBe(404)
      expect(again.body.error.code).toBe('COMMENT_NOT_FOUND')
      expect(await commentCount(postId)).toBe(1)
      expect((await list(postId)).body.items).toEqual([])
    })

    it('only author or staff may delete; others get 403 FORBIDDEN', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const other = await createUser(h)
      const mod = await createUser(h, { role: 'moderator' })
      const postId = await createPost(h, author)
      const c = await add(postId, fan.token, { body: 'x' })
      const no = await h.http().delete(`/api/comments/${c.body.id}`).set(auth(other.token))
      expect(no.status).toBe(403)
      expect(no.body.error.code).toBe('FORBIDDEN')
      expect((await h.http().delete(`/api/comments/${c.body.id}`).set(auth(mod.token))).status).toBe(204)
      expect((await h.http().delete(`/api/comments/${new Types.ObjectId()}`).set(auth(mod.token))).status).toBe(404)
      expect((await h.http().delete(`/api/comments/not-an-id`).set(auth(mod.token))).status).toBe(404)
      expect(await commentCount(postId)).toBe(0)
    })
  })

  describe('staff delete', () => {
    it("moderator deleting a moderator's or admin's comment → 403 CANNOT_MODERATE_PEER; admin may", async () => {
      const author = await createUser(h)
      const mod = await createUser(h, { role: 'moderator' })
      const otherMod = await createUser(h, { role: 'moderator' })
      const admin = await createUser(h, { role: 'admin' })
      const postId = await createPost(h, author)
      for (const staff of [otherMod, admin]) {
        const c = await add(postId, staff.token, { body: 'staff' })
        const res = await h.http().delete(`/api/comments/${c.body.id}`).set(auth(mod.token))
        expect(res.status).toBe(403)
        expect(res.body.error.code).toBe('CANNOT_MODERATE_PEER')
      }
      expect(await commentCount(postId)).toBe(2)
      const modComment = await add(postId, otherMod.token, { body: 'x' })
      expect((await h.http().delete(`/api/comments/${modComment.body.id}`).set(auth(admin.token))).status).toBe(204)
    })

    it('staff delete logs delete_comment; author deleting own comment logs nothing', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const mod = await createUser(h, { role: 'moderator' })
      const postId = await createPost(h, author)
      const c = await add(postId, fan.token, { body: 'spam' })
      expect((await h.http().delete(`/api/comments/${c.body.id}`).set(auth(mod.token))).status).toBe(204)
      const own = await add(postId, fan.token, { body: 'mine' })
      expect((await h.http().delete(`/api/comments/${own.body.id}`).set(auth(fan.token))).status).toBe(204)
      const logs = await h.db.collection('moderationLogs').find({}).toArray()
      expect(logs.map((l) => [l.action, l.targetType, l.targetId, l.actorId.toString()])).toEqual([['delete_comment', 'comment', c.body.id, mod.id]])
    })
  })

  it('unverified user comment → 403 EMAIL_NOT_VERIFIED', async () => {
    const author = await createUser(h)
    const fan = await createUser(h, { verified: false })
    const postId = await createPost(h, author)
    const res = await add(postId, fan.token, { body: 'hi' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('1001-char body → 400 VALIDATION_FAILED; empty body too', async () => {
    const author = await createUser(h)
    const postId = await createPost(h, author)
    const long = await add(postId, author.token, { body: 'a'.repeat(1001) })
    expect(long.status).toBe(400)
    expect(long.body.error.code).toBe('VALIDATION_FAILED')
    expect((await add(postId, author.token, { body: '' })).status).toBe(400)
    expect((await add(postId, author.token, { body: 'a'.repeat(1000) })).status).toBe(201)
  })
})

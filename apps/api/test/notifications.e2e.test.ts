import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { NotificationsService } from '../src/notifications/notifications.service'
import { createPost, createTestHarness, createUser, type Harness } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

describe('notifications', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const notify = (n: Parameters<NotificationsService['notify']>[0]) => h.app.get(NotificationsService).notify(n)
  const list = (token: string, query = '') => h.http().get(`/api/notifications${query}`).set(auth(token))
  const count = (token: string) => h.http().get('/api/notifications/unread-count').set(auth(token))
  const markRead = (token: string, body: unknown) => h.http().post('/api/notifications/read').set(auth(token)).send(body as object)

  it('requires auth on all endpoints', async () => {
    expect((await h.http().get('/api/notifications')).status).toBe(401)
    expect((await h.http().get('/api/notifications/unread-count')).status).toBe(401)
    expect((await h.http().post('/api/notifications/read').send({ all: true })).status).toBe(401)
  })

  it('lists newest first with actor/post info and unread-count drops after read {ids}', async () => {
    const owner = await createUser(h)
    const fan = await createUser(h)
    const postId = await createPost(h, owner, { title: 'Hello' })
    await notify({ userId: owner.id, type: 'like', actorId: fan.id, postId })
    await notify({ userId: owner.id, type: 'follow', actorId: fan.id })
    const res = await list(owner.token)
    expect(res.status).toBe(200)
    expect(res.body.nextCursor).toBeNull()
    expect(res.body.items.map((i: { type: string }) => i.type)).toEqual(['follow', 'like'])
    expect(res.body.items[1]).toMatchObject({
      type: 'like',
      actor: { username: fan.username, displayName: expect.any(String), avatarUrl: null },
      post: { id: postId, title: 'Hello' },
      commentId: null,
      readAt: null,
    })
    expect(res.body.items[1].reason).toBeUndefined()
    expect(res.body.items[0].post).toBeNull()
    expect((await count(owner.token)).body).toEqual({ count: 2 })
    const r = await markRead(owner.token, { ids: [res.body.items[0].id] })
    expect(r.status).toBe(204)
    expect((await count(owner.token)).body).toEqual({ count: 1 })
    const after = await list(owner.token)
    expect(after.body.items[0].readAt).not.toBeNull()
    expect(after.body.items[1].readAt).toBeNull()
  })

  it('paginates with a cursor', async () => {
    const owner = await createUser(h)
    const fan = await createUser(h)
    for (let i = 0; i < 3; i++) await notify({ userId: owner.id, type: 'comment', actorId: fan.id, commentId: new Types.ObjectId().toString() })
    const p1 = await list(owner.token, '?limit=2')
    expect(p1.body.items).toHaveLength(2)
    expect(p1.body.nextCursor).toEqual(expect.any(String))
    const p2 = await list(owner.token, `?limit=2&cursor=${p1.body.nextCursor}`)
    expect(p2.body.items).toHaveLength(1)
    expect(p2.body.nextCursor).toBeNull()
    const ids = [...p1.body.items, ...p2.body.items].map((i: { id: string }) => i.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('actor is null when banned; post is null when soft-deleted; reason only for post_rejected', async () => {
    const owner = await createUser(h)
    const fan = await createUser(h)
    const postId = await createPost(h, owner)
    await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { 'review.reason': 'too blurry' } })
    await notify({ userId: owner.id, type: 'post_rejected', postId })
    await notify({ userId: owner.id, type: 'like', actorId: fan.id, postId })
    let res = await list(owner.token)
    const byType = (t: string) => res.body.items.find((i: { type: string }) => i.type === t)
    expect(byType('post_rejected').reason).toBe('too blurry')
    expect(byType('like').reason).toBeUndefined()
    await h.db.collection('users').updateOne({ _id: new Types.ObjectId(fan.id) }, { $set: { status: 'banned' } })
    await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { deletedAt: new Date() } })
    res = await list(owner.token)
    expect(byType('like').actor).toBeNull()
    expect(byType('like').post).toBeNull()
    expect(byType('post_rejected').post).toBeNull()
  })

  it('read {all:true} marks everything read', async () => {
    const owner = await createUser(h)
    const fan = await createUser(h)
    await notify({ userId: owner.id, type: 'follow', actorId: fan.id })
    await notify({ userId: owner.id, type: 'comment', actorId: fan.id, commentId: new Types.ObjectId().toString() })
    expect((await markRead(owner.token, { all: true })).status).toBe(204)
    expect((await count(owner.token)).body).toEqual({ count: 0 })
  })

  it('read with neither ids nor all, or bad ids → 400 VALIDATION_FAILED', async () => {
    const owner = await createUser(h)
    for (const body of [{}, { ids: ['nope'] }, { ids: Array.from({ length: 101 }, () => new Types.ObjectId().toString()) }]) {
      const res = await markRead(owner.token, body)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('cannot mark someone else’s notification read (count unchanged for them)', async () => {
    const owner = await createUser(h)
    const other = await createUser(h)
    const fan = await createUser(h)
    await notify({ userId: owner.id, type: 'follow', actorId: fan.id })
    const id = (await list(owner.token)).body.items[0].id
    expect((await markRead(other.token, { ids: [id] })).status).toBe(204)
    expect((await markRead(other.token, { all: true })).status).toBe(204)
    expect((await count(owner.token)).body).toEqual({ count: 1 })
  })
})

import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { approve, createPost, createTestHarness, createUser, type Harness } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

describe('likes, bookmarks, follows', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const getPost = async (id: string, token?: string) => {
    const res = await h.http().get(`/api/posts/${id}`).set(token ? auth(token) : {})
    return res.body
  }
  const notifs = (q: Record<string, unknown> = {}) => h.db.collection('notifications').find(q).toArray()
  const userStats = async (id: string) => (await h.db.collection('users').findOne({ _id: new Types.ObjectId(id) }))!.stats

  describe('likes', () => {
    it('two parallel likes → counts.likes === 1 and both 200', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const postId = await createPost(h, author)
      const like = () => h.http().post(`/api/posts/${postId}/like`).set(auth(fan.token))
      const [a, b] = await Promise.all([like(), like()])
      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect(a.body.liked).toBe(true)
      expect(b.body.liked).toBe(true)
      expect((await getPost(postId)).counts.likes).toBe(1)
    })

    it('unlike decrements once; unlike when not liked does not go negative', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const postId = await createPost(h, author)
      const none = await h.http().delete(`/api/posts/${postId}/like`).set(auth(fan.token))
      expect(none.status).toBe(200)
      expect(none.body).toEqual({ liked: false, likes: 0 })
      await h.http().post(`/api/posts/${postId}/like`).set(auth(fan.token))
      const [a, b] = await Promise.all([
        h.http().delete(`/api/posts/${postId}/like`).set(auth(fan.token)),
        h.http().delete(`/api/posts/${postId}/like`).set(auth(fan.token)),
      ])
      expect([a.body.liked, b.body.liked]).toEqual([false, false])
      expect((await getPost(postId)).counts.likes).toBe(0)
    })

    it('like notifies author once; liking own post creates no notification', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const postId = await createPost(h, author)
      await h.http().post(`/api/posts/${postId}/like`).set(auth(fan.token))
      await h.http().delete(`/api/posts/${postId}/like`).set(auth(fan.token))
      await h.http().post(`/api/posts/${postId}/like`).set(auth(fan.token))
      const list = await notifs({ type: 'like' })
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ userId: new Types.ObjectId(author.id), actorId: new Types.ObjectId(fan.id), postId: new Types.ObjectId(postId) })
      expect(list[0]!.readAt ?? null).toBeNull()

      await h.http().post(`/api/posts/${postId}/like`).set(auth(author.token))
      expect(await notifs({ type: 'like' })).toHaveLength(1)
    })

    it('GET post shows viewerState.liked true for the liker only', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const other = await createUser(h)
      const postId = await createPost(h, author)
      expect((await getPost(postId, fan.token)).viewerState).toEqual({ liked: false, bookmarked: false })
      await h.http().post(`/api/posts/${postId}/like`).set(auth(fan.token))
      expect((await getPost(postId, fan.token)).viewerState).toEqual({ liked: true, bookmarked: false })
      expect((await getPost(postId, other.token)).viewerState.liked).toBe(false)
      expect((await getPost(postId)).viewerState).toEqual({ liked: false, bookmarked: false })
    })

    it('unlike still works after the post is removed', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const postId = await createPost(h, author)
      await h.http().post(`/api/posts/${postId}/like`).set(auth(fan.token))
      await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { visibility: 'removed' } })
      const res = await h.http().delete(`/api/posts/${postId}/like`).set(auth(fan.token))
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ liked: false, likes: 0 })
      expect(await h.db.collection('likes').countDocuments()).toBe(0)
    })

    it('suspended user like → 403 ACCOUNT_SUSPENDED; anonymous → 401', async () => {
      const author = await createUser(h)
      const sus = await createUser(h, { status: 'suspended' })
      const postId = await createPost(h, author)
      const res = await h.http().post(`/api/posts/${postId}/like`).set(auth(sus.token))
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED')
      expect((await h.http().post(`/api/posts/${postId}/like`)).status).toBe(401)
    })

    it('post the viewer cannot see → 404 POST_NOT_FOUND', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const postId = await createPost(h, author)
      await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { visibility: 'removed' } })
      const res = await h.http().post(`/api/posts/${postId}/like`).set(auth(fan.token))
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('POST_NOT_FOUND')
      expect((await h.http().post('/api/posts/nope/like').set(auth(fan.token))).status).toBe(404)
    })
  })

  describe('bookmarks', () => {
    it('bodyless POST bookmark → 200 bookmarked, public', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const postId = await createPost(h, author)
      const res = await h.http().post(`/api/posts/${postId}/bookmark`).set(auth(fan.token))
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ bookmarked: true, bookmarks: 1 })
    })

    it('unbookmark still works after the post is removed', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const postId = await createPost(h, author)
      await h.http().post(`/api/posts/${postId}/bookmark`).set(auth(fan.token)).send({})
      await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { visibility: 'removed' } })
      const res = await h.http().delete(`/api/posts/${postId}/bookmark`).set(auth(fan.token))
      expect(res.status).toBe(200)
      expect(res.body.bookmarked).toBe(false)
      expect(await h.db.collection('bookmarks').countDocuments()).toBe(0)
    })

    it('bookmark list scan is bounded and hands back a cursor to continue', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const viewer = await createUser(h)
      const ids: string[] = []
      for (let i = 0; i < 3; i++) {
        const id = await createPost(h, author)
        await approve(h, id)
        ids.push(id)
      }
      // 60 bookmarks of invisible posts (newest), then the 3 visible ones
      const now = Date.now()
      for (const id of ids) await h.db.collection('bookmarks').insertOne({ userId: new Types.ObjectId(fan.id), postId: new Types.ObjectId(id), isPrivate: false, createdAt: new Date(now - 100000) })
      await h.db.collection('bookmarks').insertMany(
        Array.from({ length: 60 }, (_, i) => ({ userId: new Types.ObjectId(fan.id), postId: new Types.ObjectId(), isPrivate: false, createdAt: new Date(now - i * 1000) })),
      )
      const seen: string[] = []
      let cursor: string | null = null
      let pages = 0
      do {
        const res: any = await h.http().get(`/api/users/${fan.username}/bookmarks?limit=2${cursor ? `&cursor=${cursor}` : ''}`).set(auth(viewer.token))
        expect(res.status).toBe(200)
        seen.push(...res.body.items.map((i: { id: string }) => i.id))
        if (pages === 0) expect(res.body.items).toEqual([]) // first scan gave up early but offers a cursor
        if (pages === 0) expect(res.body.nextCursor).not.toBeNull()
        cursor = res.body.nextCursor
        pages++
      } while (cursor && pages < 20)
      expect(seen.sort()).toEqual([...ids].sort())
    })

    it('bookmark is idempotent, counts once, and unbookmark never goes negative', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const postId = await createPost(h, author)
      const bm = () => h.http().post(`/api/posts/${postId}/bookmark`).set(auth(fan.token)).send({})
      const [a, b] = await Promise.all([bm(), bm()])
      expect([a.body.bookmarked, b.body.bookmarked]).toEqual([true, true])
      expect((await getPost(postId)).counts.bookmarks).toBe(1)
      expect((await getPost(postId, fan.token)).viewerState.bookmarked).toBe(true)
      const del = await h.http().delete(`/api/posts/${postId}/bookmark`).set(auth(fan.token))
      expect(del.body).toEqual({ bookmarked: false, bookmarks: 0 })
      const again = await h.http().delete(`/api/posts/${postId}/bookmark`).set(auth(fan.token))
      expect(again.body).toEqual({ bookmarked: false, bookmarks: 0 })
    })

    it('re-bookmark with isPrivate true does not increment and hides it from others’ bookmark list', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const viewer = await createUser(h)
      const postId = await createPost(h, author)
      await approve(h, postId)
      await h.http().post(`/api/posts/${postId}/bookmark`).set(auth(fan.token)).send({})
      let list = await h.http().get(`/api/users/${fan.username}/bookmarks`).set(auth(viewer.token))
      expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([postId])

      const re = await h.http().post(`/api/posts/${postId}/bookmark`).set(auth(fan.token)).send({ isPrivate: true })
      expect(re.body).toEqual({ bookmarked: true, bookmarks: 1 })
      list = await h.http().get(`/api/users/${fan.username}/bookmarks`).set(auth(viewer.token))
      expect(list.body.items).toEqual([])
      list = await h.http().get(`/api/users/${fan.username}/bookmarks`)
      expect(list.body.items).toEqual([])
      list = await h.http().get(`/api/users/${fan.username}/bookmarks`).set(auth(fan.token))
      expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([postId])
    })

    it('others see only posts passing feed rules; owner sees pending posts too; cursor paginates', async () => {
      const author = await createUser(h)
      const fan = await createUser(h)
      const viewer = await createUser(h)
      const approved: string[] = []
      for (let i = 0; i < 3; i++) {
        const id = await createPost(h, author)
        await approve(h, id)
        await h.http().post(`/api/posts/${id}/bookmark`).set(auth(fan.token)).send({})
        approved.push(id)
      }
      const pending = await createPost(h, author)
      await h.http().post(`/api/posts/${pending}/bookmark`).set(auth(author.token)).send({})
      // A pending post can be opened directly, so fan may bookmark it; it shows to fan but not in feed-rule lists.
      expect((await h.http().post(`/api/posts/${pending}/bookmark`).set(auth(fan.token)).send({})).status).toBe(200)

      const p1 = await h.http().get(`/api/users/${fan.username}/bookmarks?limit=2`).set(auth(viewer.token))
      expect(p1.body.items.map((i: { id: string }) => i.id)).toEqual([approved[2], approved[1]])
      const p2 = await h.http().get(`/api/users/${fan.username}/bookmarks?limit=2&cursor=${p1.body.nextCursor}`).set(auth(viewer.token))
      expect(p2.body.items.map((i: { id: string }) => i.id)).toEqual([approved[0]])
      expect(p2.body.nextCursor).toBeNull()

      const mine = await h.http().get(`/api/users/${author.username}/bookmarks`).set(auth(author.token))
      expect(mine.body.items.map((i: { id: string }) => i.id)).toEqual([pending])
      const others = await h.http().get(`/api/users/${author.username}/bookmarks`).set(auth(viewer.token))
      expect(others.body.items).toEqual([])
      const fanOwn = await h.http().get(`/api/users/${fan.username}/bookmarks`).set(auth(fan.token))
      expect(fanOwn.body.items.map((i: { id: string }) => i.id)).toEqual([pending, approved[2], approved[1], approved[0]])

      expect((await h.http().get('/api/users/nobody/bookmarks')).status).toBe(404)
    })
  })

  describe('follows', () => {
    it('follow self → 400 CANNOT_FOLLOW_SELF; follow twice → followerCount 1; stats updated both sides', async () => {
      const a = await createUser(h)
      const b = await createUser(h)
      const self = await h.http().post(`/api/users/${a.username}/follow`).set(auth(a.token))
      expect(self.status).toBe(400)
      expect(self.body.error.code).toBe('CANNOT_FOLLOW_SELF')

      const [r1, r2] = await Promise.all([
        h.http().post(`/api/users/${b.username}/follow`).set(auth(a.token)),
        h.http().post(`/api/users/${b.username}/follow`).set(auth(a.token)),
      ])
      expect([r1.status, r2.status]).toEqual([200, 200])
      expect([r1.body.following, r2.body.following]).toEqual([true, true])
      expect(await userStats(b.id)).toMatchObject({ followerCount: 1 })
      expect(await userStats(a.id)).toMatchObject({ followingCount: 1 })
      expect((await h.http().get(`/api/users/${b.username}`).set(auth(a.token))).body.isFollowing).toBe(true)
      expect((await h.http().get(`/api/users/${b.username}`)).body.isFollowing).toBe(false)
      expect(await notifs({ type: 'follow' })).toHaveLength(1)
    })

    it('unfollow decrements once and never goes negative', async () => {
      const a = await createUser(h)
      const b = await createUser(h)
      expect((await h.http().delete(`/api/users/${b.username}/follow`).set(auth(a.token))).body).toEqual({ following: false, followerCount: 0 })
      await h.http().post(`/api/users/${b.username}/follow`).set(auth(a.token))
      await Promise.all([
        h.http().delete(`/api/users/${b.username}/follow`).set(auth(a.token)),
        h.http().delete(`/api/users/${b.username}/follow`).set(auth(a.token)),
      ])
      expect(await userStats(b.id)).toMatchObject({ followerCount: 0 })
      expect(await userStats(a.id)).toMatchObject({ followingCount: 0 })
    })

    it('follow unknown or banned user → 404 NOT_FOUND', async () => {
      const a = await createUser(h)
      const banned = await createUser(h, { status: 'banned' })
      for (const name of ['nobody', banned.username]) {
        const res = await h.http().post(`/api/users/${name}/follow`).set(auth(a.token))
        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('NOT_FOUND')
      }
    })

    it('suspended user follow → 403', async () => {
      const a = await createUser(h, { status: 'suspended' })
      const b = await createUser(h)
      expect((await h.http().post(`/api/users/${b.username}/follow`).set(auth(a.token))).status).toBe(403)
    })

    it('followers and following lists: newest first, cursor, no stats, banned excluded, isFollowing for viewer', async () => {
      const target = await createUser(h)
      const f1 = await createUser(h)
      const f2 = await createUser(h)
      const f3 = await createUser(h)
      const bannedFan = await createUser(h)
      for (const f of [f1, bannedFan, f2, f3]) {
        await h.http().post(`/api/users/${target.username}/follow`).set(auth(f.token))
        await new Promise((r) => setTimeout(r, 5))
      }
      await h.db.collection('users').updateOne({ _id: new Types.ObjectId(bannedFan.id) }, { $set: { status: 'banned' } })
      await h.http().post(`/api/users/${f3.username}/follow`).set(auth(f1.token))

      const p1 = await h.http().get(`/api/users/${target.username}/followers?limit=2`).set(auth(f1.token))
      expect(p1.status).toBe(200)
      expect(p1.body.items.map((u: { username: string }) => u.username)).toEqual([f3.username, f2.username])
      expect(p1.body.items[0]).not.toHaveProperty('stats')
      expect(p1.body.items[0].isFollowing).toBe(true)
      expect(p1.body.items[1].isFollowing).toBe(false)
      const p2 = await h.http().get(`/api/users/${target.username}/followers?limit=2&cursor=${p1.body.nextCursor}`)
      expect(p2.body.items.map((u: { username: string }) => u.username)).toEqual([f1.username])
      expect(p2.body.nextCursor).toBeNull()

      const following = await h.http().get(`/api/users/${f1.username}/following`)
      expect(following.body.items.map((u: { username: string }) => u.username)).toEqual([f3.username, target.username])
      expect((await h.http().get('/api/users/nobody/followers')).status).toBe(404)
    })

    it('following feed shows approved posts of followees only', async () => {
      const me = await createUser(h)
      const followee = await createUser(h)
      const stranger = await createUser(h)
      const mine = await createPost(h, followee)
      const pendingOne = await createPost(h, followee)
      const strangers = await createPost(h, stranger)
      await approve(h, mine)
      await approve(h, strangers)
      await h.http().post(`/api/users/${followee.username}/follow`).set(auth(me.token))
      const res = await h.http().get('/api/feed/following').set(auth(me.token))
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([mine])
      expect(pendingOne).toBeTruthy()
    })
  })
})

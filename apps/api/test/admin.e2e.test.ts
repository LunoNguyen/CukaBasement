import { Types } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AdminService } from '../src/admin/admin.service'
import { createPost, createTestHarness, createUser, type Harness } from './harness'

const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
const PASSWORD = 'Password123!'

describe('admin', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const logs = (filter: Record<string, unknown> = {}) => h.db.collection('moderationLogs').find(filter).toArray()
  const setStatus = (token: string, id: string, status: string, note?: string) =>
    h.http().post(`/api/admin/users/${id}/status`).set(auth(token)).send({ status, note })
  const setRole = (token: string, id: string, role: string) =>
    h.http().post(`/api/admin/users/${id}/role`).set(auth(token)).send({ role })

  it('moderator → 403 on /admin/users; anonymous → 401', async () => {
    const mod = await createUser(h, { role: 'moderator' })
    const res = await h.http().get('/api/admin/users').set(auth(mod.token))
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect((await h.http().get('/api/admin/users')).status).toBe(401)
    expect((await h.http().get('/api/admin/logs').set(auth(mod.token))).status).toBe(403)
    expect((await h.http().get('/api/admin/settings').set(auth(mod.token))).status).toBe(403)
  })

  it('lists users with dto shape, role/status filters and cursor pagination', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const a = await createUser(h)
    const b = await createUser(h, { status: 'suspended' })
    const all = await h.http().get('/api/admin/users').set(auth(admin.token))
    expect(all.status).toBe(200)
    expect(all.body.items).toHaveLength(3)
    const item = all.body.items.find((x: { id: string }) => x.id === a.id)
    expect(item).toMatchObject({
      id: a.id,
      email: a.email,
      username: a.username,
      role: 'user',
      status: 'active',
      emailVerified: true,
      lastLoginAt: null,
      stats: { followerCount: 0, followingCount: 0, postCount: 0 },
    })
    expect(item.displayName).toBeTypeOf('string')
    expect(item.createdAt).toBeTypeOf('string')
    expect(item.passwordHash).toBeUndefined()

    const susp = await h.http().get('/api/admin/users?status=suspended').set(auth(admin.token))
    expect(susp.body.items.map((x: { id: string }) => x.id)).toEqual([b.id])
    const admins = await h.http().get('/api/admin/users?role=admin').set(auth(admin.token))
    expect(admins.body.items.map((x: { id: string }) => x.id)).toEqual([admin.id])

    const p1 = await h.http().get('/api/admin/users?limit=2').set(auth(admin.token))
    expect(p1.body.items).toHaveLength(2)
    expect(p1.body.nextCursor).toBeTypeOf('string')
    const p2 = await h.http().get(`/api/admin/users?limit=2&cursor=${p1.body.nextCursor}`).set(auth(admin.token))
    expect(p2.body.items).toHaveLength(1)
    expect(p2.body.nextCursor).toBeNull()
    const ids = [...p1.body.items, ...p2.body.items].map((x: { id: string }) => x.id)
    expect(new Set(ids).size).toBe(3)
  })

  it('q matches email or username prefix case-insensitively', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const u = await createUser(h)
    const res = await h.http().get(`/api/admin/users?q=${u.username.toUpperCase()}`).set(auth(admin.token))
    expect(res.body.items.map((x: { id: string }) => x.id)).toEqual([u.id])
    const byMail = await h.http().get(`/api/admin/users?q=${encodeURIComponent(u.email.slice(0, 4).toUpperCase())}`).set(auth(admin.token))
    expect(byMail.body.items.map((x: { id: string }) => x.id)).toContain(u.id)
    const mid = await h.http().get('/api/admin/users?q=_1').set(auth(admin.token))
    expect(mid.body.items).toEqual([])
  })

  it('q with regex characters is matched literally, not as a pattern', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const u = await createUser(h)
    const ids = async (q: string) =>
      (await h.http().get(`/api/admin/users?q=${encodeURIComponent(q)}`).set(auth(admin.token))).body.items.map((x: { id: string }) => x.id)
    expect(await ids('u.*')).toEqual([])
    expect(await ids('.*')).toEqual([])
    expect(await ids('a.*')).toEqual([])
    expect(await ids('u_')).toContain(u.id)
    expect(await ids(u.username)).toEqual([u.id])
  })

  it('ban revokes refresh and login → 403 ACCOUNT_BANNED; unban restores', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const target = await createUser(h, { password: PASSWORD })
    const li = await h.http().post('/api/auth/login').send({ email: target.email, password: PASSWORD }).expect(200)
    expect(await h.db.collection('authTokens').countDocuments({ userId: new Types.ObjectId(target.id), type: 'refresh' })).toBe(1)
    const cookie = (li.headers['set-cookie'] as unknown as string[]).find((s) => s.startsWith('cuka_rt='))!.split(';')[0]!

    const res = await setStatus(admin.token, target.id, 'banned', 'spam')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: target.id, status: 'banned' })
    expect(await h.db.collection('authTokens').countDocuments({ userId: new Types.ObjectId(target.id), type: 'refresh' })).toBe(0)
    expect((await h.http().post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401)
    const login = await h.http().post('/api/auth/login').send({ email: target.email, password: PASSWORD })
    expect(login.status).toBe(403)
    expect(login.body.error.code).toBe('ACCOUNT_BANNED')
    expect(await logs({ action: 'ban', targetId: target.id, targetType: 'user', note: 'spam', actorId: new Types.ObjectId(admin.id) })).toHaveLength(1)

    expect((await setStatus(admin.token, target.id, 'active')).status).toBe(200)
    expect(await logs({ action: 'unban', targetId: target.id })).toHaveLength(1)
    expect((await h.http().post('/api/auth/login').send({ email: target.email, password: PASSWORD })).status).toBe(200)
  })

  it('suspended user can read but cannot post → 403 ACCOUNT_SUSPENDED', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const target = await createUser(h)
    expect((await setStatus(admin.token, target.id, 'suspended')).status).toBe(200)
    expect(await logs({ action: 'suspend', targetId: target.id })).toHaveLength(1)
    expect((await h.http().get('/api/me').set(auth(target.token))).status).toBe(200)
    const post = await h.http().post('/api/posts').set(auth(target.token)).send({})
    expect(post.status).toBe(403)
    expect(post.body.error.code).toBe('ACCOUNT_SUSPENDED')
  })

  it('same status is a no-op without a log; unknown user → 404; bad body → 400; self → 400', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const target = await createUser(h)
    const same = await setStatus(admin.token, target.id, 'active')
    expect(same.status).toBe(200)
    expect(same.body.status).toBe('active')
    expect(await logs()).toHaveLength(0)
    expect((await setStatus(admin.token, new Types.ObjectId().toString(), 'banned')).status).toBe(404)
    expect((await setStatus(admin.token, 'nope', 'banned')).status).toBe(404)
    expect((await setStatus(admin.token, target.id, 'weird')).status).toBe(400)
    expect((await h.http().post(`/api/admin/users/${target.id}/status`).set(auth(admin.token))).status).toBe(400)
    const self = await setStatus(admin.token, admin.id, 'banned')
    expect(self.status).toBe(400)
    expect(self.body.error.code).toBe('CANNOT_CHANGE_OWN_ROLE')
  })

  it('an admin can ban another admin while an active admin remains', async () => {
    const a = await createUser(h, { role: 'admin' })
    const b = await createUser(h, { role: 'admin' })
    expect((await setStatus(a.token, b.id, 'banned')).status).toBe(200)
  })

  it('role change: logs old→new, self → 400, unknown role → 400', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const target = await createUser(h)
    const res = await setRole(admin.token, target.id, 'moderator')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: target.id, role: 'moderator' })
    expect(await logs({ action: 'change_role', targetId: target.id, note: 'user→moderator' })).toHaveLength(1)
    // takes effect immediately
    expect((await h.http().get('/api/mod/queue').set(auth(target.token))).status).toBe(200)

    await setRole(admin.token, target.id, 'moderator').expect(200)
    expect(await logs({ action: 'change_role' })).toHaveLength(1)

    const self = await setRole(admin.token, admin.id, 'user')
    expect(self.status).toBe(400)
    expect(self.body.error.code).toBe('CANNOT_CHANGE_OWN_ROLE')
    expect((await setRole(admin.token, target.id, 'god')).status).toBe(400)
  })

  it('demoting or disabling the only active admin → 400 LAST_ADMIN', async () => {
    const only = await createUser(h, { role: 'admin' })
    const svc = h.app.get(AdminService)
    // The actor is not an admin in the db (e.g. just demoted concurrently), so `only` is the last one.
    const ghost = { id: new Types.ObjectId().toString(), role: 'admin' as const, status: 'active' as const } as never
    await expect(svc.setRole(ghost, only.id, 'user')).rejects.toMatchObject({ code: 'LAST_ADMIN', status: 400 })
    await expect(svc.setStatus(ghost, only.id, 'banned')).rejects.toMatchObject({ code: 'LAST_ADMIN', status: 400 })
    await expect(svc.setStatus(ghost, only.id, 'suspended')).rejects.toMatchObject({ code: 'LAST_ADMIN', status: 400 })
    expect(await h.db.collection('users').countDocuments({ role: 'admin', status: 'active' })).toBe(1)
    expect(await logs()).toHaveLength(0)

    // a banned admin does not count as "another admin"
    const banned = await createUser(h, { role: 'admin', status: 'banned' })
    await expect(svc.setRole(ghost, only.id, 'user')).rejects.toMatchObject({ code: 'LAST_ADMIN' })
    expect(banned.id).toBeTruthy()
  })

  it('settings: GET, PATCH applies and logs only changed keys, empty patch is a no-op', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const get = await h.http().get('/api/admin/settings').set(auth(admin.token))
    expect(get.status).toBe(200)
    expect(get.body).toMatchObject({ reportHideThreshold: 5, reportAiHideThreshold: 3, maxFileBytes: 52428800, maxFilesPerPost: 50 })

    const bad = await h.http().patch('/api/admin/settings').set(auth(admin.token)).send({ maxFileBytes: 52428801 })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('VALIDATION_FAILED')
    expect((await h.http().patch('/api/admin/settings').set(auth(admin.token))).status).toBe(400)

    const ok = await h.http().patch('/api/admin/settings').set(auth(admin.token)).send({ reportHideThreshold: 3, maxFilesPerPost: 50 })
    expect(ok.status).toBe(200)
    expect(ok.body.reportHideThreshold).toBe(3)
    const entries = await logs({ action: 'update_setting' })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ targetType: 'settings', targetId: 'global', note: 'reportHideThreshold' })

    expect((await h.http().patch('/api/admin/settings').set(auth(admin.token)).send({})).status).toBe(200)
    expect((await h.http().patch('/api/admin/settings').set(auth(admin.token)).send({ reportHideThreshold: 3 })).status).toBe(200)
    expect(await logs({ action: 'update_setting' })).toHaveLength(1)
  })

  it('suspended admin cannot PATCH settings → 403 ACCOUNT_SUSPENDED; can still GET', async () => {
    const admin = await createUser(h, { role: 'admin', status: 'suspended' })
    const res = await h.http().patch('/api/admin/settings').set(auth(admin.token)).send({ reportHideThreshold: 3 })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED')
    expect((await h.http().get('/api/admin/settings').set(auth(admin.token))).body.reportHideThreshold).toBe(5)
    expect(await logs({ action: 'update_setting' })).toHaveLength(0)
  })

  it('reportHideThreshold 3 applies to reports', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const author = await createUser(h)
    const postId = await createPost(h, author)
    await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { 'review.status': 'approved' } })
    await h.http().patch('/api/admin/settings').set(auth(admin.token)).send({ reportHideThreshold: 3 }).expect(200)
    for (let i = 0; i < 3; i++) {
      const r = await createUser(h)
      await h.http().post(`/api/posts/${postId}/report`).set(auth(r.token)).send({ reason: 'spam', detail: 'x' }).expect(201)
    }
    const post = await h.db.collection('posts').findOne({ _id: new Types.ObjectId(postId) })
    expect(post?.visibility).toBe('hidden_by_reports')
  })

  it('logs list: actor usernames, system actor, filters by action and actorId, paginates', async () => {
    const admin = await createUser(h, { role: 'admin' })
    const target = await createUser(h)
    await setStatus(admin.token, target.id, 'suspended').expect(200)
    await setRole(admin.token, target.id, 'moderator').expect(200)
    const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s))
    await h.db.collection('moderationLogs').insertOne({
      actorId: 'system', action: 'auto_hide', targetType: 'post', targetId: 'p1', note: '', createdAt: t(0),
    })

    const all = await h.http().get('/api/admin/logs').set(auth(admin.token))
    expect(all.status).toBe(200)
    expect(all.body.items).toHaveLength(3)
    expect(all.body.items[0]).toMatchObject({ actor: { username: admin.username }, action: 'change_role', targetType: 'user', targetId: target.id, note: 'user→moderator' })
    expect(all.body.items[0].id).toBeTypeOf('string')
    expect(all.body.items[0].createdAt).toBeTypeOf('string')
    expect(all.body.items[2]).toMatchObject({ actor: 'system', action: 'auto_hide' })

    const byAction = await h.http().get('/api/admin/logs?action=suspend').set(auth(admin.token))
    expect(byAction.body.items.map((x: { action: string }) => x.action)).toEqual(['suspend'])
    const sys = await h.http().get('/api/admin/logs?actorId=system').set(auth(admin.token))
    expect(sys.body.items.map((x: { action: string }) => x.action)).toEqual(['auto_hide'])
    const mine = await h.http().get(`/api/admin/logs?actorId=${admin.id}`).set(auth(admin.token))
    expect(mine.body.items).toHaveLength(2)
    expect((await h.http().get('/api/admin/logs?actorId=bogus').set(auth(admin.token))).body.error.code).toBe('VALIDATION_FAILED')
    expect((await h.http().get('/api/admin/logs?action=bogus').set(auth(admin.token))).status).toBe(400)

    const p1 = await h.http().get('/api/admin/logs?limit=2').set(auth(admin.token))
    const p2 = await h.http().get(`/api/admin/logs?limit=2&cursor=${p1.body.nextCursor}`).set(auth(admin.token))
    expect(p1.body.items).toHaveLength(2)
    expect(p2.body.items).toHaveLength(1)
    expect(p2.body.nextCursor).toBeNull()
  })
})

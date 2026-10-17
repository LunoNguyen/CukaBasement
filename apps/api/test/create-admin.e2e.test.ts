import { getModelToken } from '@nestjs/mongoose'
import type { Model } from 'mongoose'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAdmin } from '../src/scripts/create-admin'
import { USER_MODEL, type User } from '../src/users/user.schema'
import { createTestHarness, createUser, type Harness, testConfig } from './harness'

describe('create-admin script', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  const users = () => h.app.get<Model<User>>(getModelToken(USER_MODEL))

  it('createAdmin promotes existing user and is idempotent', async () => {
    const u = await createUser(h, { verified: false })
    const cfg = testConfig()
    const input = { email: u.email, password: 'long enough pw', username: 'ignored_name' }
    expect(await createAdmin(cfg, input)).toBe(u.id)
    expect(await createAdmin(cfg, input)).toBe(u.id)
    const doc = await users().findById(u.id)
    expect(doc?.role).toBe('admin')
    expect(doc?.emailVerifiedAt).not.toBeNull()
    expect(await users().countDocuments()).toBe(1)
  })

  it('createAdmin creates a verified admin who can log in', async () => {
    const id = await createAdmin(testConfig(), { email: 'Root@Example.com', password: 'long enough pw', username: 'root_admin' })
    const doc = await users().findById(id)
    expect(doc).toMatchObject({ email: 'root@example.com', role: 'admin' })
    expect(doc?.emailVerifiedAt).not.toBeNull()
    expect((await h.http().post('/api/auth/login').send({ email: 'root@example.com', password: 'long enough pw' })).status).toBe(200)
  })

  it('createAdmin rejects a short password and bad username', async () => {
    const cfg = testConfig()
    await expect(createAdmin(cfg, { email: 'a@example.com', password: 'short', username: 'good_name' })).rejects.toThrow()
    await expect(createAdmin(cfg, { email: 'a@example.com', password: 'long enough pw', username: 'Bad Name' })).rejects.toThrow()
  })
})

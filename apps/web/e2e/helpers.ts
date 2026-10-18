import { randomBytes } from 'node:crypto'
import * as argon2 from 'argon2'
import { MongoClient, ObjectId } from 'mongodb'
import type { APIRequestContext } from '@playwright/test'
import type { Role } from '@cuka/shared'

export const PASSWORD = 'e2e-password-123'

/** Required, no default: it must be the database the running api uses (`MONGODB_URI` of `npm run dev`). */
export function mongoUri(): string {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('e2e needs MONGODB_URI: the same `_test` database the running api uses, e.g. mongodb://127.0.0.1:27017/CukaE2E_test')
  return uri
}

/** The test writes to the database directly: refuse anything that is not a throw-away `_test` database. */
export function dbName(uri: string = mongoUri()): string {
  const name = new URL(uri).pathname.replace(/^\//, '')
  if (!name.endsWith('_test')) throw new Error(`e2e refuses database "${name}": its name must end with _test`)
  return name
}

async function withDb<T>(fn: (db: ReturnType<MongoClient['db']>) => Promise<T>): Promise<T> {
  const name = dbName()
  const client = await MongoClient.connect(mongoUri())
  try {
    return await fn(client.db(name))
  } finally {
    await client.close()
  }
}

function updateUser(email: string, set: Record<string, unknown>): Promise<void> {
  return withDb(async (db) => {
    const res = await db.collection('users').updateOne({ email: email.toLowerCase() }, { $set: set })
    if (res.matchedCount !== 1) throw new Error(`no user with email ${email}`)
  })
}

/** Mail is only printed to the api console, so verification is done in the database. */
export function markVerified(email: string): Promise<void> {
  return updateUser(email, { emailVerifiedAt: new Date() })
}

export function setRole(email: string, role: Role): Promise<void> {
  return updateUser(email, { role })
}

/** A unique, valid username/email pair for this run (usernames: `[a-z0-9_]{3,24}`). */
export function newUser(prefix: string): { username: string; email: string; displayName: string } {
  const username = `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(0, 24)
  return { username, email: `${username}@e2e.test`, displayName: `E2E ${prefix}` }
}

/**
 * Proves the api behind the web proxy uses the guarded database before anything is written through it: a probe user
 * is inserted directly into that database and must be able to log in. Returns a cleanup that deletes the probe.
 */
export async function assertApiUsesDb(request: APIRequestContext): Promise<() => Promise<void>> {
  const name = dbName()
  const u = newUser('probe')
  const password = randomBytes(12).toString('hex')
  const id = new ObjectId()
  await withDb(async (db) => {
    await db.collection('users').insertOne({
      _id: id,
      email: u.email,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      role: 'user',
      status: 'active',
      emailVerifiedAt: new Date(),
      birthDate: null,
      showR18: false,
      locale: 'vi',
      profile: { username: u.username, displayName: u.displayName, bio: '', avatarFileId: null, bannerFileId: null, links: [] },
      stats: { followerCount: 0, followingCount: 0, postCount: 0 },
      createdAt: new Date(),
      lastLoginAt: null,
    })
  })
  const cleanup = () =>
    withDb(async (db) => {
      await db.collection('authTokens').deleteMany({ userId: id })
      await db.collection('users').deleteOne({ _id: id })
    })
  const res = await request.post('/api/auth/login', { data: { email: u.email, password } }).catch(() => null)
  if (!res?.ok()) {
    await cleanup()
    throw new Error(`API is not using ${name}: a probe user inserted there cannot log in (${res ? res.status() : 'no response'})`)
  }
  return cleanup
}

/** Registers through the api, then verifies and promotes the account in the database. */
export async function createModerator(request: APIRequestContext): Promise<{ email: string; password: string }> {
  const u = newUser('mod')
  const res = await request.post('/api/auth/register', { data: { ...u, password: PASSWORD } })
  if (!res.ok()) throw new Error(`register moderator: ${res.status()} ${await res.text()}`)
  await markVerified(u.email)
  await setRole(u.email, 'moderator')
  return { email: u.email, password: PASSWORD }
}

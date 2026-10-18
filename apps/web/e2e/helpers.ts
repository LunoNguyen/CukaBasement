import { MongoClient } from 'mongodb'
import type { APIRequestContext } from '@playwright/test'
import type { Role } from '@cuka/shared'

/** Must point at the same database as the running api (`MONGODB_URI` of `npm run dev`). */
export const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/CukaE2E_test'

export const PASSWORD = 'e2e-password-123'

/** The test writes to the database directly: refuse anything that is not a throw-away `_test` database. */
export function dbName(uri: string = MONGODB_URI): string {
  const name = new URL(uri).pathname.replace(/^\//, '')
  if (!name.endsWith('_test')) throw new Error(`e2e refuses database "${name}": its name must end with _test`)
  return name
}

async function updateUser(email: string, set: Record<string, unknown>): Promise<void> {
  const name = dbName()
  const client = await MongoClient.connect(MONGODB_URI)
  try {
    const res = await client.db(name).collection('users').updateOne({ email: email.toLowerCase() }, { $set: set })
    if (res.matchedCount !== 1) throw new Error(`no user with email ${email}`)
  } finally {
    await client.close()
  }
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

/** Registers through the api, then verifies and promotes the account in the database. */
export async function createModerator(request: APIRequestContext): Promise<{ email: string; password: string }> {
  const u = newUser('mod')
  const res = await request.post('/api/auth/register', { data: { ...u, password: PASSWORD } })
  if (!res.ok()) throw new Error(`register moderator: ${res.status()} ${await res.text()}`)
  await markVerified(u.email)
  await setRole(u.email, 'moderator')
  return { email: u.email, password: PASSWORD }
}

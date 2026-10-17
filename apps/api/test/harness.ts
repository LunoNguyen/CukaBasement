import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { getConnectionToken, getModelToken } from '@nestjs/mongoose'
import { Test } from '@nestjs/testing'
import type { Role, UserStatus } from '@cuka/shared'
import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import * as argon2 from 'argon2'
import type mongoose from 'mongoose'
import { Types } from 'mongoose'
import { Client } from 'minio'
import supertest from 'supertest'
import { AppModule, configureApp } from '../src/app.module'
import { TokensService } from '../src/auth/tokens'
import { CONFIG, type Config, loadConfig } from '../src/config/config'
import type { JobDeps } from '../src/jobs/handlers/media'
import { processFile } from '../src/jobs/handlers/process-file'
import { relocateVariants } from '../src/jobs/handlers/relocate-variants'
import { JOBS, type JobName, type JobsPort } from '../src/jobs/jobs.port'
import { SettingsService } from '../src/settings/settings.service'
import { StorageService } from '../src/storage/storage.service'
import { MAIL, type MailMessage, type MailPort } from '../src/mail/mail.port'
import { USER_MODEL, type User } from '../src/users/user.schema'
import { TestOnlyModule } from './test-only.module'

const DEFAULT_TEST_URI = 'mongodb://127.0.0.1:27017/CukaDB_test'

export interface Harness {
  app: INestApplication
  http: () => supertest.Agent
  db: mongoose.Connection
  mail: { sent: MailMessage[]; lastLinkFor(email: string): string }
  jobs: { enqueued: Array<{ name: JobName; data: Record<string, unknown> }>; clear(): void }
  /** Turns @nestjs/throttler limits on (off by default in tests) until the next reset(). */
  enableThrottling(): void
  reset(): Promise<void>
  close(): Promise<void>
}

/** POSTs a presigned-POST form; the `file` field must come last. */
export async function postMultipart(url: string, fields: Record<string, string>, body: Buffer): Promise<Response> {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  form.append('file', new Blob([new Uint8Array(body)]), 'upload.bin')
  return fetch(url, { method: 'POST', body: form })
}

const FIXTURE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
}

/**
 * Presigns, uploads `test/fixtures/<fixtureName>` straight to MinIO and calls complete.
 * `declared` overrides the mime/name sent to the API (to simulate mislabelled uploads). Returns the fileId.
 */
export async function uploadFixture(
  h: Harness,
  user: { token: string },
  fixtureName: string,
  declared?: { mime: string; name: string },
): Promise<string> {
  const body = readFileSync(join(__dirname, 'fixtures', fixtureName))
  const mime = declared?.mime ?? FIXTURE_MIME[extname(fixtureName)]
  const name = declared?.name ?? fixtureName
  const auth = { Authorization: `Bearer ${user.token}` }
  const presign = await h.http().post('/api/uploads').set(auth).send({ name, size: body.length, mime })
  if (presign.status !== 201) throw new Error(`presign failed: ${presign.status} ${JSON.stringify(presign.body)}`)
  const { fileId, url, fields } = presign.body as { fileId: string; url: string; fields: Record<string, string> }
  const up = await postMultipart(url, fields, body)
  if (!up.ok) throw new Error(`upload to storage failed: ${up.status} ${await up.text()}`)
  const done = await h.http().post(`/api/uploads/${fileId}/complete`).set(auth)
  if (done.status !== 200) throw new Error(`complete failed: ${done.status} ${JSON.stringify(done.body)}`)
  return fileId
}

export interface CreateUserOptions {
  role?: Role
  verified?: boolean
  status?: UserStatus
  /** `YYYY-MM-DD` */
  birthDate?: string
  showR18?: boolean
  /** Hashed with argon2 so the user can log in; otherwise a non-verifiable placeholder hash is stored. */
  password?: string
}

let userSeq = 0

/** Inserts a user directly (defaults: verified, active, role user) and signs an access token for it. */
export async function createUser(
  h: Harness,
  opts: CreateUserOptions = {},
): Promise<{ id: string; token: string; email: string; username: string }> {
  const n = ++userSeq
  const email = `u${n}@example.com`
  const username = `u_${n}`
  const users = h.app.get<mongoose.Model<User>>(getModelToken(USER_MODEL))
  const user = await users.create({
    email,
    passwordHash: opts.password ? await argon2.hash(opts.password, { type: argon2.argon2id }) : 'placeholder',
    role: opts.role ?? 'user',
    status: opts.status ?? 'active',
    emailVerifiedAt: (opts.verified ?? true) ? new Date() : null,
    birthDate: opts.birthDate ? new Date(opts.birthDate) : null,
    showR18: opts.showR18 ?? false,
    profile: { username, displayName: `User ${n}` },
  })
  return { id: user._id.toString(), token: h.app.get(TokensService).signAccess(user), email, username }
}

async function resetBuckets(config: Config): Promise<void> {
  const m = config.minio
  const client = new Client({ endPoint: m.endPoint, port: m.port, useSSL: m.useSSL, accessKey: m.accessKey, secretKey: m.secretKey })
  for (const bucket of [m.bucketOriginals, m.bucketPublic]) {
    if (!(await client.bucketExists(bucket))) {
      await client.makeBucket(bucket)
      continue
    }
    const keys: string[] = []
    for await (const o of client.listObjectsV2(bucket, '', true)) if (o.name) keys.push(o.name)
    if (keys.length) await client.removeObjects(bucket, keys)
  }
}

function dbNameOf(uri: string): string {
  try {
    return decodeURIComponent(new URL(uri).pathname.replace(/^\//, ''))
  } catch {
    return ''
  }
}

export function testConfig(): Config {
  const mongoUri = process.env.MONGODB_URI_TEST || DEFAULT_TEST_URI
  if (!dbNameOf(mongoUri).endsWith('_test')) throw new Error('Refusing to run tests against non-_test database')
  const base = loadConfig({ MINIO_ENDPOINT: '127.0.0.1', ...process.env, NODE_ENV: 'test' })
  return {
    ...base,
    mongoUri,
    smtpUrl: undefined,
    throttleDisabled: true,
    minio: { ...base.minio, bucketOriginals: 'test-cuka-originals', bucketPublic: 'test-cuka-public' },
  }
}

export async function createTestHarness(): Promise<Harness> {
  const config = testConfig()

  const sent: MailMessage[] = []
  const mailCapture: MailPort = {
    send: async (msg) => {
      sent.push(msg)
    },
  }
  const enqueued: Harness['jobs']['enqueued'] = []
  const jobsRecorder: JobsPort = {
    enqueue: async (name, data) => {
      enqueued.push({ name, data })
    },
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule, TestOnlyModule] })
    .overrideProvider(CONFIG)
    .useValue(config)
    .overrideProvider(MAIL)
    .useValue(mailCapture)
    .overrideProvider(JOBS)
    .useValue(jobsRecorder)
    .compile()

  const app = moduleRef.createNestApplication({ logger: ['warn', 'error'] })
  configureApp(app, config)
  await app.init()
  const db = app.get<mongoose.Connection>(getConnectionToken())

  const harness: Harness = {
    app,
    http: () => supertest.agent(app.getHttpServer()),
    db,
    mail: {
      sent,
      lastLinkFor(email) {
        const msg = [...sent].reverse().find((m) => m.to === email)
        const link = msg?.text.match(/https?:\/\/\S+/)?.[0]
        if (!link) throw new Error(`No mail with a link sent to ${email}`)
        return link
      },
    },
    jobs: {
      enqueued,
      clear: () => {
        enqueued.length = 0
      },
    },
    enableThrottling() {
      config.throttleDisabled = false
    },
    async reset() {
      config.throttleDisabled = true
      // Let Mongoose's automatic index builds settle first so they cannot race the drop.
      await Promise.all(Object.values(db.models).map((m) => m.init()))
      const collections = await db.listCollections()
      await Promise.all(collections.map((c) => db.dropCollection(c.name)))
      await Promise.all(Object.values(db.models).map((m) => m.createIndexes()))
      await resetBuckets(config)
      app.get(SettingsService).clearCache()
      sent.length = 0
      enqueued.length = 0
    },
    async close() {
      await app.close()
    },
  }
  await harness.reset()
  return harness
}

export type CreatePostBody = {
  type: string
  title: string
  description: string
  rating: 'all' | 'r18'
  tags: string[]
  sourceCredit: string
  aiDeclaration: boolean
  files: Array<{ fileId: string; position: number; isCover: boolean }>
}

/** Job deps wired to the app's own connection, storage and config, for running worker handlers inline. */
export function jobDeps(h: Harness): JobDeps {
  return { conn: h.db, storage: h.app.get(StorageService), config: h.app.get(CONFIG) }
}

/**
 * Uploads tiny.png (unless `overrides.files` is given), processes it inline and creates a post via HTTP.
 * Any relocate-variants job the create enqueued is run inline too, as the worker would. Returns the postId.
 */
export async function createPost(h: Harness, user: { token: string }, overrides: Partial<CreatePostBody> = {}): Promise<string> {
  let files = overrides.files
  if (!files) {
    const fileId = await uploadFixture(h, user, 'tiny.png')
    await processFile(jobDeps(h), { fileId })
    files = [{ fileId, position: 0, isCover: true }]
  }
  const body: CreatePostBody = {
    type: 'illustration',
    title: 'Test post',
    description: '',
    rating: 'all',
    tags: [],
    sourceCredit: '',
    aiDeclaration: true,
    ...overrides,
    files,
  }
  const res = await h.http().post('/api/posts').set({ Authorization: `Bearer ${user.token}` }).send(body)
  if (res.status !== 201) throw new Error(`create post failed: ${res.status} ${JSON.stringify(res.body)}`)
  const postId = res.body.id as string
  for (const job of h.jobs.enqueued) {
    if (job.name === 'relocate-variants' && job.data.postId === postId) await relocateVariants(jobDeps(h), { postId })
  }
  return postId
}

/** Marks the post approved directly in the database. */
export async function approve(h: Harness, postId: string): Promise<void> {
  await h.db.collection('posts').updateOne({ _id: new Types.ObjectId(postId) }, { $set: { 'review.status': 'approved' } })
}

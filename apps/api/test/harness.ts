import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { getConnectionToken } from '@nestjs/mongoose'
import { Test } from '@nestjs/testing'
import type mongoose from 'mongoose'
import { Client } from 'minio'
import supertest from 'supertest'
import { AppModule, configureApp } from '../src/app.module'
import { CONFIG, type Config, loadConfig } from '../src/config/config'
import { JOBS, type JobName, type JobsPort } from '../src/jobs/jobs.port'
import { SettingsService } from '../src/settings/settings.service'
import { MAIL, type MailMessage, type MailPort } from '../src/mail/mail.port'

const DEFAULT_TEST_URI = 'mongodb://127.0.0.1:27017/CukaDB_test'

export interface Harness {
  app: INestApplication
  http: () => supertest.Agent
  db: mongoose.Connection
  mail: { sent: MailMessage[]; lastLinkFor(email: string): string }
  jobs: { enqueued: Array<{ name: JobName; data: Record<string, unknown> }>; clear(): void }
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

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
    async reset() {
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

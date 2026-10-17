import 'reflect-metadata'
import type { INestApplication } from '@nestjs/common'
import { getConnectionToken } from '@nestjs/mongoose'
import { Test } from '@nestjs/testing'
import type mongoose from 'mongoose'
import supertest from 'supertest'
import { AppModule, configureApp } from '../src/app.module'
import { CONFIG, type Config, loadConfig } from '../src/config/config'
import { JOBS, type JobName, type JobsPort } from '../src/jobs/jobs.port'
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
  const base = loadConfig({ NODE_ENV: 'test' })
  return {
    ...base,
    mongoUri,
    smtpUrl: undefined,
    minio: {
      ...base.minio,
      endPoint: '127.0.0.1',
      bucketOriginals: 'test-cuka-originals',
      bucketPublic: 'test-cuka-public',
    },
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
      const collections = await db.listCollections()
      await Promise.all(collections.map((c) => db.dropCollection(c.name)))
      await Promise.all(Object.values(db.models).map((m) => m.createIndexes()))
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

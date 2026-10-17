import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { processFile } from '../src/jobs/handlers/process-file'
import { createTestHarness, createUser, jobDeps, type Harness, postMultipart } from './harness'

const PASSWORD = 'correct horse battery'
const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

describe('end-to-end smoke', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  it('register → verify → upload → post → approve → feed → 3 ai_art reports → gone from feed', async () => {
    const email = 'smoke@example.com'
    await h.http().post('/api/auth/register').send({ email, password: PASSWORD, username: 'smoke_user', displayName: 'Smoke' }).expect(201)
    const token = new URL(h.mail.lastLinkFor(email)).searchParams.get('token')!
    await h.http().post('/api/auth/verify-email').send({ token }).expect(204)
    const login = await h.http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)
    const access = login.body.accessToken as string

    const body = readFileSync(join(__dirname, 'fixtures', 'tiny.png'))
    const presign = await h.http().post('/api/uploads').set(auth(access)).send({ name: 'tiny.png', size: body.length, mime: 'image/png' }).expect(201)
    const { fileId, url, fields } = presign.body as { fileId: string; url: string; fields: Record<string, string> }
    expect((await postMultipart(url, fields, body)).ok).toBe(true)
    await h.http().post(`/api/uploads/${fileId}/complete`).set(auth(access)).expect(200)
    const job = h.jobs.enqueued.find((j) => j.name === 'process-file' && j.data.fileId === fileId)
    expect(job).toBeDefined()
    await processFile(jobDeps(h), { fileId })

    const created = await h
      .http()
      .post('/api/posts')
      .set(auth(access))
      .send({
        type: 'illustration',
        title: 'Smoke post',
        description: 'end to end',
        rating: 'all',
        tags: ['smoke'],
        sourceCredit: '',
        aiDeclaration: true,
        files: [{ fileId, position: 0, isCover: true }],
      })
      .expect(201)
    const postId = created.body.id as string

    const feedIds = async () => (await h.http().get('/api/feed/home')).body.items.map((x: { id: string }) => x.id)
    expect(await feedIds()).not.toContain(postId)

    const mod = await createUser(h, { role: 'moderator' })
    await h.http().post(`/api/mod/posts/${postId}/approve`).set(auth(mod.token)).expect(200)
    expect(await feedIds()).toContain(postId)

    for (let i = 0; i < 3; i++) {
      const reporter = await createUser(h)
      await h.http().post(`/api/posts/${postId}/report`).set(auth(reporter.token)).send({ reason: 'ai_art' }).expect(201)
    }
    expect(await feedIds()).not.toContain(postId)
  })
})

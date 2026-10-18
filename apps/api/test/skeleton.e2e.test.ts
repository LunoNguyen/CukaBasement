import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestHarness, type Harness } from './harness'

describe('skeleton', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  afterAll(async () => {
    await h?.close()
  })

  it('health', async () => {
    await h.http().get('/api/health').expect(200, { ok: true, maintenance: false })
  })

  it('unknown route uses error envelope', async () => {
    const r = await h.http().get('/api/nope').expect(404)
    expect(r.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } })
  })

  it('malformed JSON body → 400 VALIDATION_FAILED envelope', async () => {
    const r = await h.http().post('/api/health').set('Content-Type', 'application/json').send('{bad').expect(400)
    expect(r.body).toEqual({ error: { code: 'VALIDATION_FAILED', message: expect.any(String) } })
  })

  it('JSON body over the size limit → 413 VALIDATION_FAILED envelope, not 500', async () => {
    const big = JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(200_000) })
    const r = await h.http().post('/api/auth/login').set('Content-Type', 'application/json').send(big)
    expect(r.status).toBe(413)
    expect(r.body).toEqual({ error: { code: 'VALIDATION_FAILED', message: expect.any(String) } })
  })

  it('harness refuses non-test db', async () => {
    const prev = process.env.MONGODB_URI_TEST
    try {
      process.env.MONGODB_URI_TEST = 'mongodb://localhost:27017/CukaDB'
      await expect(createTestHarness()).rejects.toThrow(/non-_test/)
    } finally {
      if (prev === undefined) delete process.env.MONGODB_URI_TEST
      else process.env.MONGODB_URI_TEST = prev
    }
  })
})

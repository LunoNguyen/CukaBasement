import { Client } from 'minio'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runSetup } from '../src/scripts/setup'
import { SettingsService } from '../src/settings/settings.service'
import { createTestHarness, type Harness, testConfig } from './harness'

describe('setup script', () => {
  let h: Harness
  beforeAll(async () => {
    h = await createTestHarness()
  })
  afterAll(() => h.close())

  it('setup is idempotent and keeps edited settings', async () => {
    const cfg = testConfig()
    const settings = h.app.get(SettingsService)
    await runSetup(cfg)
    await settings.update({ reportHideThreshold: 9 })
    await runSetup(cfg)
    expect((await settings.get()).reportHideThreshold).toBe(9)
  })

  it('setup builds the unique index on users.email', async () => {
    await h.db.collection('users').dropIndexes()
    expect((await h.db.collection('users').indexes()).map((i) => i.name)).toEqual(['_id_'])
    await runSetup(testConfig())
    const idx = (await h.db.collection('users').indexes()).find((i) => JSON.stringify(i.key) === '{"email":1}')
    expect(idx?.unique).toBe(true)
  })

  it('public bucket allows anonymous GetObject, originals does not', async () => {
    const cfg = testConfig()
    await runSetup(cfg)
    const m = cfg.minio
    const c = new Client({ endPoint: m.endPoint, port: m.port, useSSL: m.useSSL, accessKey: m.accessKey, secretKey: m.secretKey })
    const policy = JSON.parse(await c.getBucketPolicy(m.bucketPublic))
    expect(policy.Statement[0].Action).toEqual(['s3:GetObject'])
    expect(policy.Statement[0].Resource).toEqual([`arn:aws:s3:::${m.bucketPublic}/*`])
    await expect(c.getBucketPolicy(m.bucketOriginals)).rejects.toThrow()
  })
})

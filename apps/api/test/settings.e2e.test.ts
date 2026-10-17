import { DEFAULT_SETTINGS } from '@cuka/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SettingsService } from '../src/settings/settings.service'
import { createTestHarness, type Harness } from './harness'

describe('settings', () => {
  let h: Harness
  let settings: SettingsService
  beforeAll(async () => {
    h = await createTestHarness()
    settings = h.app.get(SettingsService)
  })
  beforeEach(() => h.reset())
  afterAll(() => h.close())

  it('settings defaults', async () => expect(await settings.get()).toEqual(DEFAULT_SETTINGS))

  it('settings update persists', async () => {
    await settings.update({ reportAiHideThreshold: 2 })
    expect((await settings.get()).reportAiHideThreshold).toBe(2)
    expect(await h.db.collection('settings').findOne({ _id: 'global' as never })).toMatchObject({ reportAiHideThreshold: 2 })
  })
})

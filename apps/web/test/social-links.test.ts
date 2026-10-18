import { describe, expect, it } from 'vitest'
import { isBlank, toLinks, type LinkRow } from '@/components/user/socialLinks'

const row = (r: Partial<LinkRow>): LinkRow => ({ id: 0, platform: 'x', label: '', url: '', ...r })

describe('profile link rows', () => {
  it('ignores a label left over from switching away from other', () => {
    const stale = row({ platform: 'tiktok', label: 'My shop' })
    expect(isBlank(stale)).toBe(true)
    expect(toLinks([stale])).toEqual([])
  })

  it('keeps an other row that only has a label', () => {
    expect(isBlank(row({ platform: 'other', label: 'My shop' }))).toBe(false)
  })
})

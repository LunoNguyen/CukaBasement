import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fanartCreditsSchema, loadFanartCredits, runSeedCredits } from '../src/seed/fanart-credits'

describe('fanart credit seed list', () => {
  it('the JSON validates against the schema', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, '../src/seed/fanart-credits.json'), 'utf8'))
    expect(fanartCreditsSchema.safeParse(raw).success).toBe(true)
  })

  it('has the 13 entries of the list, all pending permission and not AI-checked', () => {
    const list = loadFanartCredits()
    expect(list).toHaveLength(13)
    expect(list.every((e) => e.permission === 'pending' && e.aiChecked === false)).toBe(true)
    expect(list[0]).toEqual({
      artistName: 'Ruri',
      artistHandle: '@_rurisuisen',
      platform: 'x',
      sourceUrl: 'https://x.com/_rurisuisen/status/1890567100382544149',
      title: 'Happy Birthday & 3D reveal',
      tags: ['hibikiduca', 'ducaart'],
      permission: 'pending',
      aiChecked: false,
    })
    expect(list[1]).toMatchObject({ artistName: 'Yun Yun', artistHandle: '@funo_yun', title: 'Hibiki Duca 🐰🍓', tags: ['hibikiduca', 'ducaart', 'cukatrain2022'] })
    expect(list[2]).toMatchObject({ artistName: 'EMDNeeko', artistHandle: '@CamHaiDang1', title: 'Du Ca mermaid', tags: ['ducaart'] })
    const suiden = list.slice(3, 11)
    expect(suiden.map((e) => e.title)).toEqual([
      'Du Ca in the rain',
      'Hibiki Du Ca new outfit',
      'Life',
      'Du Ca and Shi',
      'Du Du',
      'Well, actually',
      'Du Ca Bunny Girl',
      'Hibiki Duca Minh Minh',
    ])
    for (const e of suiden) {
      expect(e).toMatchObject({ artistName: 'Suiden', artistHandle: 'Suiden', platform: 'pixiv', sourceUrl: 'https://dic.pixiv.net/a/HibikiDuCa', tags: ['hibikiduca'], note: 'find exact artwork URL on pixiv' })
    }
    expect(list[11]).toMatchObject({
      artistName: 'Suiden',
      platform: 'pixiv',
      sourceUrl: 'https://dic.pixiv.net/a/NIJIGEN%E3%83%97%E3%83%AD%E3%82%B8%E3%82%A7%E3%82%AF%E3%83%88',
      title: 'Welcom Nijigen Gen 2',
      tags: ['nijigen'],
    })
    expect(list[12]).toMatchObject({ artistName: 'SgtDuky', platform: 'deviantart', sourceUrl: 'https://www.deviantart.com/tag/duca', title: 'Chibi Du Ca', tags: ['ducaart'], note: 'find exact deviation URL' })
  })

  it('every entry is a valid repost credit', async () => {
    const { creditSchema } = await import('@cuka/shared')
    for (const e of loadFanartCredits()) {
      expect(creditSchema.safeParse({ isOwnWork: false, artistName: e.artistName, artistHandle: e.artistHandle, platform: e.platform, sourceUrl: e.sourceUrl }).success, e.title).toBe(true)
    }
  })

  it('schema rejects a bad entry', () => {
    const good = loadFanartCredits()[0]!
    expect(fanartCreditsSchema.safeParse([{ ...good, platform: 'tumblr' }]).success).toBe(false)
    expect(fanartCreditsSchema.safeParse([{ ...good, sourceUrl: '' }]).success).toBe(false)
    expect(fanartCreditsSchema.safeParse([{ ...good, permission: 'maybe' }]).success).toBe(false)
  })

  it('--list prints every entry and writes nothing; no flag prints usage', () => {
    const lines: string[] = []
    expect(runSeedCredits(['--list'], (l) => lines.push(l))).toBe(0)
    expect(lines).toHaveLength(13)
    expect(lines[0]).toContain('Happy Birthday & 3D reveal')
    expect(lines[0]).toContain('@_rurisuisen')
    expect(lines[0]).toContain('https://x.com/_rurisuisen/status/1890567100382544149')
    const usage: string[] = []
    expect(runSeedCredits([], (l) => usage.push(l))).toBe(1)
    expect(usage.join('\n')).toMatch(/--list/)
  })
})

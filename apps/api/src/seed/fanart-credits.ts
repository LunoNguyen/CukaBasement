import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CREDIT_PLATFORMS } from '@cuka/shared'
import { z } from 'zod'

/** One fanart to repost with credit; `permission` tracks the artist's answer, `aiChecked` the manual AI-art check. */
export const fanartCreditSchema = z.object({
  artistName: z.string().trim().min(1).max(100),
  artistHandle: z.string().trim().max(100),
  platform: z.enum(CREDIT_PLATFORMS),
  sourceUrl: z.url({ protocol: /^https?$/ }).max(500),
  title: z.string().trim().min(1).max(120),
  tags: z.array(z.string().min(1)),
  permission: z.enum(['pending', 'granted', 'refused']),
  aiChecked: z.boolean(),
  /** Follow-up for whoever does the upload (e.g. the exact artwork URL is still to be found). */
  note: z.string().optional(),
})

export const fanartCreditsSchema = z.array(fanartCreditSchema)
export type FanartCredit = z.infer<typeof fanartCreditSchema>

/** Reads and validates fanart-credits.json (copied next to the compiled file by nest-cli `assets`). */
export function loadFanartCredits(path = join(__dirname, 'fanart-credits.json')): FanartCredit[] {
  return fanartCreditsSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}

function line(e: FanartCredit, i: number): string {
  const who = e.artistHandle ? `${e.artistName} (${e.artistHandle})` : e.artistName
  const note = e.note ? ` — note: ${e.note}` : ''
  return `${String(i + 1).padStart(2)}. ${e.title} | ${who} | ${e.platform} | ${e.sourceUrl} | tags: ${e.tags.join(', ')} | permission: ${e.permission} | aiChecked: ${e.aiChecked}${note}`
}

/** `--list` prints the entries; nothing is written to the database or storage. Returns the exit code. */
export function runSeedCredits(argv: string[], log: (line: string) => void): number {
  if (!argv.includes('--list')) {
    log('Usage: npm -w @cuka/api run seed:credits -- --list   (prints the fanart credit list; read-only)')
    return 1
  }
  loadFanartCredits().forEach((e, i) => log(line(e, i)))
  return 0
}

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadEnvFile, ROOT_ENV_FILE } from '../src/config/env-file'

describe('loadEnvFile', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
    delete process.env.CUKA_ENV_FILE_TEST_A
    delete process.env.CUKA_ENV_FILE_TEST_B
  })

  it('defaults to the repository root .env (same path from src/ and dist/)', () => {
    expect(ROOT_ENV_FILE).toBe(resolve(__dirname, '../../../.env'))
    expect(readFileSync(resolve(ROOT_ENV_FILE, '../package.json'), 'utf8')).toContain('"workspaces"')
  })

  it('loads the file without overriding variables already set; a missing file is skipped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuka-env-'))
    dirs.push(dir)
    const file = join(dir, '.env')
    writeFileSync(file, 'CUKA_ENV_FILE_TEST_A=from-file\nCUKA_ENV_FILE_TEST_B=from-file\n')
    process.env.CUKA_ENV_FILE_TEST_B = 'already-set'
    expect(loadEnvFile(file)).toBe(true)
    expect(process.env.CUKA_ENV_FILE_TEST_A).toBe('from-file')
    expect(process.env.CUKA_ENV_FILE_TEST_B).toBe('already-set')
    expect(loadEnvFile(join(dir, 'missing.env'))).toBe(false)
  })

  it('is used by the api main, the worker main and both scripts', () => {
    const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
    for (const p of ['src/main.ts', 'src/scripts/setup.ts', 'src/scripts/create-admin.ts', '../worker/src/main.ts']) {
      expect(src(p), p).toMatch(/loadEnvFile\(\)/)
    }
  })
})

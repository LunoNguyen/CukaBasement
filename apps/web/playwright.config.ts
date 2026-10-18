import { existsSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

/** Pre-installed Chromium in the dev container; elsewhere Playwright uses its own download. */
const CHROMIUM = '/opt/pw-browsers/chromium'

// No `webServer`: the e2e runs against a stack you start yourself (see e2e/smoke.spec.ts and the README).
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    testIdAttribute: 'data-test',
    trace: 'retain-on-failure',
    launchOptions: existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {},
  },
})

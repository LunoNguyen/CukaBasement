/**
 * End-to-end smoke test of the whole stack: register → verify → login → upload a credited repost → moderator
 * approves → the post is public and its watermarked image loads.
 *
 * It does not start anything. Before `npm -w @cuka/web run e2e`, run the stack against a throw-away `_test`
 * database (helpers.ts refuses any other), e.g. from the repository root:
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017/CukaE2E_test THROTTLE_DISABLED=true npm run setup
 *   MONGODB_URI=mongodb://127.0.0.1:27017/CukaE2E_test THROTTLE_DISABLED=true npm run dev
 *
 * and run the e2e with the same MONGODB_URI (required; the run aborts unless the api is using that database).
 * MinIO must accept browser POST uploads from http://localhost:5173.
 */
import { fileURLToPath } from 'node:url'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { assertApiUsesDb, createModerator, markVerified, newUser, PASSWORD } from './helpers'

const TINY_PNG = fileURLToPath(new URL('./fixtures/tiny.png', import.meta.url))

let probeApi: APIRequestContext | undefined
let removeProbe: (() => Promise<void>) | undefined

// Before any write through the UI or api: MONGODB_URI must be a `_test` database and the api must be using it.
test.beforeAll(async ({ playwright }, testInfo) => {
  probeApi = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL })
  removeProbe = await assertApiUsesDb(probeApi)
})

test.afterAll(async () => {
  await removeProbe?.()
  await probeApi?.dispose()
})

test('register, upload a credited repost, approve, and see it public', async ({ page, browser, request }) => {
  // A long display name: the logged-in header must still fit a 360px screen.
  const user = { ...newUser('e2e'), displayName: 'E2E người dùng có cái tên hiển thị rất dài' }
  const title = `E2E smoke ${user.username}`

  // Register user A in the UI.
  await page.goto('/register')
  await page.getByTestId('email').fill(user.email)
  await page.getByTestId('username').fill(user.username)
  await page.getByTestId('displayName').fill(user.displayName)
  await page.getByTestId('password').fill(PASSWORD)
  await page.getByTestId('confirm').fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng ký' }).click()
  await expect(page.getByText('Kiểm tra email')).toBeVisible()

  await markVerified(user.email)

  // Log in and upload.
  await page.goto('/login?next=/upload')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Mật khẩu').fill(PASSWORD)
  await page.locator('form').getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page).toHaveURL(/\/upload$/)

  await page.getByTestId('file-input').setInputFiles(TINY_PNG)
  await page.getByTestId('title').fill(title)
  await page.getByTestId('credit-repost').check()
  await page.getByTestId('artist-name').fill('Ruri')
  await page.getByTestId('artist-handle').fill('@_rurisuisen')
  await page.getByTestId('platform').selectOption('x')
  await page.getByTestId('source-url').fill('https://x.com/_rurisuisen/status/1')
  await page.getByTestId('ai-declaration').check()
  // Enabled once the file has been uploaded to MinIO and registered with the api.
  await expect(page.getByTestId('submit')).toBeEnabled({ timeout: 30_000 })
  await page.getByTestId('submit').click()

  await expect(page).toHaveURL(/\/posts\/[0-9a-f]{24}$/)
  const postUrl = new URL(page.url()).pathname
  await expect(page.getByTestId('review-badge')).toHaveText('Đang chờ duyệt')
  await expect(page.getByTestId('credit')).toContainText('Art by @_rurisuisen · X')

  // No horizontal scroll at 360px while logged in, on the home page and the post page.
  await page.setViewportSize({ width: 360, height: 800 })
  for (const path of ['/', postUrl]) {
    await page.goto(path)
    await expect(page.getByTestId('account-menu-button')).toBeVisible()
    // The callback runs in the browser; the e2e tsconfig has no DOM lib.
    const width = await page.evaluate(() => (globalThis as unknown as { document: { documentElement: { scrollWidth: number } } }).document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(360)
  }
  await page.setViewportSize({ width: 1280, height: 720 })

  // A helper-created moderator approves it in /mod.
  const mod = await createModerator(request)
  const modCtx = await browser.newContext()
  const modPage = await modCtx.newPage()
  await modPage.goto('/login?next=/mod')
  await modPage.getByLabel('Email').fill(mod.email)
  await modPage.getByLabel('Mật khẩu').fill(mod.password)
  await modPage.locator('form').getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(modPage).toHaveURL(/\/mod$/)
  const item = modPage.getByTestId('queue-item').filter({ hasText: title })
  await item.getByRole('button', { name: 'Duyệt', exact: true }).click()
  await expect(item).toHaveCount(0)
  await modCtx.close()

  // Logged out: the home feed shows the card.
  const anonCtx = await browser.newContext()
  const anon = await anonCtx.newPage()
  await anon.goto('/')
  await expect(anon.getByRole('link', { name: title })).toBeVisible()

  // The image is served once the worker has watermarked the credit onto it: poll the post page.
  await expect(async () => {
    await anon.goto(postUrl)
    await expect(anon.getByTestId('media-main')).toHaveAttribute('src', /.+/, { timeout: 2_000 })
  }).toPass({ timeout: 30_000, intervals: [1_000, 2_000] })
  // Actually decoded, not a broken image.
  const img = anon.getByTestId('media-main')
  await expect.poll(() => img.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0)
  await anonCtx.close()
})

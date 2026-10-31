import { afterEach, describe, expect, it, vi as vitest } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ERROR_CODES } from '@cuka/shared'
import vi from '@/i18n/vi'
import en from '@/i18n/en'
import { i18n, setLocale } from '@/i18n'
import { createAppRouter } from '@/router'
import { createMemoryHistory } from 'vue-router'
import { useToast } from '@/stores/toast'
import { useAuth } from '@/stores/auth'
import App from '@/App.vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8')

async function mountApp(path = '/posts') {
  const pinia = createPinia()
  const router = createAppRouter(createMemoryHistory())
  router.push(path)
  await router.isReady()
  const w = mount(App, { global: { plugins: [pinia, router, i18n] } })
  await flushPromises()
  return { w, router, pinia }
}

afterEach(() => {
  vitest.useRealTimers()
  vitest.restoreAllMocks()
  setLocale('vi')
})

describe('foundation', () => {
  it('dark theme sets color-scheme: dark, light on :root', () => {
    const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)))
    expect(block(':root {')).toContain('color-scheme: light')
    expect(block("[data-theme='dark'] {")).toContain('color-scheme: dark')
  })

  it('heavy and rarely visited pages are lazy-loaded route chunks', () => {
    const router = createAppRouter(createMemoryHistory())
    const lazy = ['/upload', '/posts/:id/edit', '/settings', '/notifications', '/mod', '/admin', '/login', '/register', '/forgot-password', '/reset-password', '/verify-email']
    for (const path of lazy) {
      const rec = router.getRoutes().find((r) => r.path === path)!
      expect(typeof rec.components!.default, path).toBe('function')
    }
  })

  it('every shared ErrorCode has vi and en messages', () => {
    for (const c of ERROR_CODES) {
      expect(vi.errors[c]).toBeTruthy()
      expect(en.errors[c]).toBeTruthy()
    }
    expect(vi.errors.NETWORK).toBe('Không kết nối được máy chủ')
  })

  it('LangSwitch (in the header "more" menu when logged out) changes visible text and <html lang>', async () => {
    const { w } = await mountApp('/posts')
    expect(w.get('[data-test="main-nav"]').text()).toContain('Trang chủ')
    expect(w.find('[data-test="lang-en"]').exists()).toBe(false)
    await w.get('[data-test="header-more"]').trigger('click')
    await w.get('[data-test="header-more-menu"] [data-test="lang-en"]').trigger('click')
    expect(w.get('[data-test="main-nav"]').text()).toContain('Home')
    expect(document.documentElement.lang).toBe('en')
  })

  it('ThemeToggle flips data-theme and survives a throwing localStorage', async () => {
    vitest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const { w } = await mountApp('/posts')
    expect(document.documentElement.dataset.theme).toBe('light')
    await w.get('[data-test="header-more"]').trigger('click')
    await w.get('[data-test="header-more-menu"] [data-test="theme-toggle"]').trigger('click')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('the header has a second-row nav with Home and Introduction only, and a site search field', async () => {
    const { w } = await mountApp('/posts')
    const links = w.get('[data-test="main-nav"]').findAll('a')
    expect(links.map((a) => a.attributes('href'))).toEqual(['/', '/gioi-thieu'])
    expect(w.find('[data-test="header-search"]').exists()).toBe(true)
  })

  it('logged out, the header offers login (ghost) and register (primary)', async () => {
    const { w, pinia } = await mountApp('/posts')
    useAuth(pinia).ready = true
    await flushPromises()
    const login = w.get('[data-test="header-login"]')
    const register = w.get('[data-test="header-register"]')
    expect(login.attributes('href')).toBe('/login')
    expect(register.attributes('href')).toBe('/register')
    expect(register.classes().some((c) => c.includes('--c-accent-strong'))).toBe(true)
  })

  it('the footer is one muted line naming CukaBasement with a link to the introduction', async () => {
    const { w } = await mountApp('/posts')
    const footer = w.get('[data-test="footer"]')
    expect(footer.text()).toContain('CukaBasement')
    expect(footer.find('a[href="/gioi-thieu"]').exists()).toBe(true)
  })

  it('tokens: the pixiv palette on :root and in dark mode, no cellar/latte/paper/soft tokens', () => {
    const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)))
    const light = block(':root {')
    for (const [k, v] of Object.entries({ bg: '#ffffff', 'surface-2': '#f5f5f5', border: '#e5e5e5', text: '#1f1f1f', muted: '#6b6b6b', accent: '#e8577a', 'accent-strong': '#c2365a', 'accent-soft': '#fdecf1', danger: '#d92d20' }))
      expect(light.toLowerCase(), k).toContain(`--c-${k}: ${v};`)
    const dark = block("[data-theme='dark'] {")
    for (const [k, v] of Object.entries({ bg: '#141414', 'surface-2': '#1f1f1f', border: '#2e2e2e', text: '#ededed', muted: '#a3a3a3', accent: '#ff7d9a', 'accent-strong': '#ff9db3', 'accent-soft': '#3a1f27', danger: '#ff8a80' }))
      expect(dark.toLowerCase(), k).toContain(`--c-${k}: ${v};`)
    expect(css).not.toMatch(/--c-(cellar|latte|paper|soft)\b/)
  })

  it('unknown route renders NotFoundPage', async () => {
    const { w } = await mountApp('/nope')
    expect(w.text()).toContain(i18n.global.t('notFound.title'))
  })

  it('/403 renders ForbiddenPage', async () => {
    const { w } = await mountApp('/403')
    expect(w.text()).toContain(i18n.global.t('forbidden.title'))
  })

  it('toast store keeps at most 3 and auto-dismisses after 4s', () => {
    vitest.useFakeTimers()
    setActivePinia(createPinia())
    const t = useToast()
    for (let i = 0; i < 5; i++) t.push({ kind: 'info', text: 'm' + i })
    expect(t.toasts.length).toBe(3)
    vitest.advanceTimersByTime(4001)
    expect(t.toasts.length).toBe(0)
  })
})

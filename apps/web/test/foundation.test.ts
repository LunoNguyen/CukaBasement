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
  return { w, router }
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

  it('LangSwitch changes visible text and <html lang>', async () => {
    const { w } = await mountApp('/posts')
    expect(w.find('nav').text()).toContain('Trang chủ')
    await w.get('[data-test="lang-en"]').trigger('click')
    expect(w.find('nav').text()).toContain('Home')
    expect(document.documentElement.lang).toBe('en')
  })

  it('ThemeToggle flips data-theme and survives a throwing localStorage', async () => {
    vitest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const { w } = await mountApp('/posts')
    expect(document.documentElement.dataset.theme).toBe('light')
    await w.get('[data-test="theme-toggle"]').trigger('click')
    expect(document.documentElement.dataset.theme).toBe('dark')
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

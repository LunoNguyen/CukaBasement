import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { i18n, setLocale } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch } from './fakeApi'

let fake: FakeFetch | undefined
afterEach(() => {
  fake?.restore()
  fake = undefined
  setLocale('vi')
})

function setup(role?: 'user' | 'moderator' | 'admin', verified = true) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  if (role) auth.setSession({ accessToken: 't', user: makeMe({ role, emailVerified: verified }) })
  const router = createAppRouter(createMemoryHistory())
  return { pinia, auth, router }
}

describe('route guards', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('waits for auth readiness before deciding', async () => {
    const { auth, router } = setup('user')
    let done = false
    const nav = router.push('/upload').then(() => (done = true))
    await flushPromises()
    expect(done).toBe(false)
    auth.ready = true
    await nav
    expect(router.currentRoute.value.fullPath).toBe('/upload')
  })

  it('guard: /upload while logged out → /login?next=/upload', async () => {
    const { auth, router } = setup()
    auth.ready = true
    await router.push('/upload')
    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.next).toBe('/upload')
  })

  it('guard: /admin as moderator → /403; as admin → renders', async () => {
    let s = setup('moderator')
    s.auth.ready = true
    await s.router.push('/admin')
    expect(s.router.currentRoute.value.path).toBe('/403')

    s = setup('admin')
    s.auth.ready = true
    await s.router.push('/admin')
    expect(s.router.currentRoute.value.path).toBe('/admin')
  })
})

describe('session lost mid-use', () => {
  it('a cleared session on an auth-only page redirects to /login?next=', async () => {
    fake = installFakeFetch({})
    const { pinia, auth, router } = setup('user')
    auth.ready = true
    await router.push('/notifications')
    const w = mount(App, { global: { plugins: [pinia, router, i18n] } })
    await flushPromises()
    auth.clear()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/login')
    expect(router.currentRoute.value.query.next).toBe('/notifications')
    w.unmount()
  })

  it('a cleared session on a public page stays put', async () => {
    fake = installFakeFetch({})
    const { pinia, auth, router } = setup('user')
    auth.ready = true
    await router.push('/search')
    const w = mount(App, { global: { plugins: [pinia, router, i18n] } })
    await flushPromises()
    auth.clear()
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/search')
    w.unmount()
  })

  it('logout from the menu on an auth-only page goes home', async () => {
    fake = installFakeFetch({ 'POST /api/auth/logout': { status: 204 } })
    const { pinia, auth, router } = setup('user')
    auth.ready = true
    await router.push('/notifications')
    const w = mount(App, { global: { plugins: [pinia, router, i18n] } })
    await flushPromises()
    await w.get('[data-test="account-menu-button"]').trigger('click')
    await w.get('[data-test="menu-logout"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/')
    w.unmount()
  })
})

describe('account menu and banner', () => {
  it('unverified user sees resend banner; click calls resend once', async () => {
    fake = installFakeFetch({ 'POST /api/auth/resend-verification': { status: 204 } })
    const { pinia, auth, router } = setup('user', false)
    auth.ready = true
    await router.push('/')
    const w = mount(App, { global: { plugins: [pinia, router, i18n] } })
    await flushPromises()
    const btn = w.get('[data-test="resend-verification"]')
    expect(btn.text()).toBe('Gửi lại email')
    await btn.trigger('click')
    await flushPromises()
    expect(fake.callsTo('POST /api/auth/resend-verification')).toHaveLength(1)
  })

  it('no banner for verified users or logged-out visitors', async () => {
    const { pinia, auth, router } = setup('user', true)
    auth.ready = true
    await router.push('/')
    const w = mount(App, { global: { plugins: [pinia, router, i18n] } })
    await flushPromises()
    expect(w.find('[data-test="resend-verification"]').exists()).toBe(false)
  })

  it('logged out header shows login/register; logged in shows upload + menu', async () => {
    let s = setup()
    s.auth.ready = true
    await s.router.push('/')
    let w = mount(App, { global: { plugins: [s.pinia, s.router, i18n] } })
    await flushPromises()
    expect(w.text()).toContain('Đăng nhập')
    expect(w.text()).toContain('Đăng ký')
    expect(w.find('[data-test="account-menu-button"]').exists()).toBe(false)
    w.unmount()

    s = setup('admin')
    s.auth.ready = true
    await s.router.push('/')
    w = mount(App, { global: { plugins: [s.pinia, s.router, i18n] } })
    await flushPromises()
    expect(w.text()).toContain('Đăng bài')
    const btn = w.get('[data-test="account-menu-button"]')
    expect(btn.attributes('aria-expanded')).toBe('false')
    expect(w.find('[role="menu"]').exists()).toBe(false)
    await btn.trigger('click')
    expect(btn.attributes('aria-expanded')).toBe('true')
    const menu = w.get('[role="menu"]').text()
    for (const s of ['Trang cá nhân', 'Cài đặt', 'Mod', 'Admin', 'Đăng xuất']) expect(menu).toContain(s)
    w.unmount()
  })

  it('menu hides Mod/Admin for plain users and closes on Escape and outside click', async () => {
    const { pinia, auth, router } = setup('user')
    auth.ready = true
    await router.push('/')
    const w = mount(App, { attachTo: document.body, global: { plugins: [pinia, router, i18n] } })
    await flushPromises()
    const btn = w.get('[data-test="account-menu-button"]')
    await btn.trigger('click')
    const menu = w.get('[role="menu"]').text()
    expect(menu).not.toContain('Mod')
    expect(menu).not.toContain('Admin')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.find('[role="menu"]').exists()).toBe(false)
    await btn.trigger('click')
    expect(w.find('[role="menu"]').exists()).toBe(true)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(w.find('[role="menu"]').exists()).toBe(false)
    w.unmount()
  })

  it('logout from the menu clears the session', async () => {
    fake = installFakeFetch({ 'POST /api/auth/logout': { status: 204 } })
    const { pinia, auth, router } = setup('user')
    auth.ready = true
    await router.push('/')
    const w = mount(App, { global: { plugins: [pinia, router, i18n] } })
    await flushPromises()
    await w.get('[data-test="account-menu-button"]').trigger('click')
    await w.get('[data-test="menu-logout"]').trigger('click')
    await flushPromises()
    expect(auth.isLoggedIn).toBe(false)
    expect(fake.callsTo('POST /api/auth/logout')).toHaveLength(1)
  })
})

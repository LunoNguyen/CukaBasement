import { afterEach, describe, expect, it, vi } from 'vitest'
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

async function mountAt(path: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.ready = true
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  const w = mount(App, { global: { plugins: [pinia, router, i18n] } })
  await flushPromises()
  return { w, router, auth }
}

const err = (status: number, code: string) => ({ status, body: { error: { code, message: 'raw server text' } } })

describe('login', () => {
  it('login success redirects to ?next', async () => {
    fake = installFakeFetch({
      'POST /api/auth/login': { status: 200, body: { accessToken: 'tok', user: makeMe() } },
    })
    const { w, router, auth } = await mountAt('/login?next=/upload')
    await w.get('input[type="email"]').setValue('cuka@example.com')
    await w.get('input[type="password"]').setValue('password123')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(fake.callsTo('POST /api/auth/login')[0]!.body).toEqual({ email: 'cuka@example.com', password: 'password123' })
    expect(auth.isLoggedIn).toBe(true)
    // /upload is a lazily loaded stub, so the navigation settles a moment after the click.
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/upload'))
  })

  it('login ignores an external ?next and goes home', async () => {
    fake = installFakeFetch({
      'POST /api/auth/login': { status: 200, body: { accessToken: 'tok', user: makeMe() } },
    })
    const { w, router } = await mountAt('/login?next=//evil.example')
    await w.get('input[type="email"]').setValue('a@b.co')
    await w.get('input[type="password"]').setValue('password123')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('login switches UI locale to the user locale', async () => {
    fake = installFakeFetch({
      'POST /api/auth/login': { status: 200, body: { accessToken: 'tok', user: makeMe({ locale: 'en' }) } },
    })
    const { w } = await mountAt('/login')
    await w.get('input[type="email"]').setValue('a@b.co')
    await w.get('input[type="password"]').setValue('password123')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(i18n.global.locale.value).toBe('en')
  })

  it('login INVALID_CREDENTIALS shows vi message, stays on page', async () => {
    fake = installFakeFetch({ 'POST /api/auth/login': err(401, 'INVALID_CREDENTIALS') })
    const { w, router } = await mountAt('/login')
    await w.get('input[type="email"]').setValue('a@b.co')
    await w.get('input[type="password"]').setValue('wrongwrong')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toBe('Email hoặc mật khẩu không đúng')
    expect(w.text()).not.toContain('raw server text')
    expect(router.currentRoute.value.path).toBe('/login')
  })
})

describe('register', () => {
  async function fill(w: Awaited<ReturnType<typeof mountAt>>['w'], over: Record<string, string> = {}) {
    const v = { email: 'n@example.com', username: 'newbie_1', displayName: 'New', password: 'longpassword', confirm: 'longpassword', ...over }
    for (const [k, val] of Object.entries(v)) await w.get(`[data-test="${k}"]`).setValue(val)
  }

  it('register validates username pattern client-side before calling API', async () => {
    fake = installFakeFetch({ 'POST /api/auth/register': { status: 201, body: { userId: 'u9' } } })
    const { w } = await mountAt('/register')
    await fill(w, { username: 'Bad Name!' })
    expect(w.get('[data-test="username-hint"]').attributes('data-valid')).toBe('false')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(fake.callsTo('POST /api/auth/register')).toHaveLength(0)
    expect(w.get('[data-test="username-error"]').text()).not.toBe('')
  })

  it('register blocks short password and mismatched confirm', async () => {
    fake = installFakeFetch({ 'POST /api/auth/register': { status: 201, body: { userId: 'u9' } } })
    const { w } = await mountAt('/register')
    await fill(w, { password: 'short', confirm: 'short' })
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(fake.calls).toHaveLength(0)
    await fill(w, { password: 'longpassword', confirm: 'different12' })
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(fake.calls).toHaveLength(0)
  })

  it('register success shows check-email page', async () => {
    fake = installFakeFetch({ 'POST /api/auth/register': { status: 201, body: { userId: 'u9' } } })
    const { w } = await mountAt('/register')
    await fill(w)
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(fake.callsTo('POST /api/auth/register')[0]!.body).toEqual({
      email: 'n@example.com',
      username: 'newbie_1',
      displayName: 'New',
      password: 'longpassword',
    })
    expect(w.text()).toContain('Kiểm tra email để xác thực')
  })

  it('register EMAIL_TAKEN shows field error', async () => {
    fake = installFakeFetch({ 'POST /api/auth/register': err(409, 'EMAIL_TAKEN') })
    const { w } = await mountAt('/register')
    await fill(w)
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(w.get('[data-test="email-error"]').text()).toBe('Email này đã được sử dụng')
    expect(w.text()).not.toContain('Kiểm tra email để xác thực')
  })
})

describe('verify-email', () => {
  it('verify-email calls API with token from query and shows success', async () => {
    fake = installFakeFetch({ 'POST /api/auth/verify-email': { status: 204 } })
    const { w } = await mountAt('/verify-email?token=abc123')
    expect(fake.callsTo('POST /api/auth/verify-email')[0]!.body).toEqual({ token: 'abc123' })
    expect(w.get('[data-test="verify-success"]').exists()).toBe(true)
  })

  it('verify-email TOKEN_INVALID shows the error', async () => {
    fake = installFakeFetch({ 'POST /api/auth/verify-email': err(400, 'TOKEN_INVALID') })
    const { w } = await mountAt('/verify-email?token=bad')
    expect(w.get('[role="alert"]').text()).toBe('Liên kết không hợp lệ hoặc đã hết hạn')
  })
})

describe('forgot / reset password', () => {
  it('forgot shows the same success text whether or not the email exists', async () => {
    const texts: string[] = []
    for (const res of [{ status: 204 }, err(404, 'NOT_FOUND')]) {
      fake = installFakeFetch({ 'POST /api/auth/forgot-password': res })
      const { w } = await mountAt('/forgot-password')
      await w.get('input[type="email"]').setValue('x@y.co')
      await w.get('form').trigger('submit')
      await flushPromises()
      texts.push(w.get('[data-test="forgot-success"]').text())
      fake.restore()
    }
    expect(texts[0]).toBe(texts[1])
    expect(texts[0]).not.toBe('')
  })

  it('reset posts token + new password and links to login', async () => {
    fake = installFakeFetch({ 'POST /api/auth/reset-password': { status: 204 } })
    const { w } = await mountAt('/reset-password?token=tk1')
    await w.get('[data-test="password"]').setValue('newpassword1')
    await w.get('[data-test="confirm"]').setValue('newpassword1')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(fake.callsTo('POST /api/auth/reset-password')[0]!.body).toEqual({ token: 'tk1', password: 'newpassword1' })
    expect(w.get('[data-test="reset-success"]').exists()).toBe(true)
  })
})

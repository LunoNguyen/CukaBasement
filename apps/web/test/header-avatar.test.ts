import { afterEach, describe, expect, it } from 'vitest'
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

async function mountHeader(avatarUrl: string | null) {
  fake = installFakeFetch({})
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.setSession({ accessToken: 't', user: makeMe({ avatarUrl }) })
  auth.ready = true
  const router = createAppRouter(createMemoryHistory())
  await router.push('/')
  const w = mount(App, { global: { plugins: [pinia, router, i18n] } })
  await flushPromises()
  return { w, auth }
}

describe('header avatar', () => {
  it('shows the avatar image when the user has a published avatar', async () => {
    const { w } = await mountHeader('http://cdn/u1/a/thumb_md.webp')
    const img = w.get('[data-test="account-menu-button"] img[data-test="account-avatar"]')
    expect(img.attributes('src')).toBe('http://cdn/u1/a/thumb_md.webp')
    expect(img.attributes('alt')).toBe('')
    expect(w.find('[data-test="account-initial"]').exists()).toBe(false)
    w.unmount()
  })

  it('falls back to the initial without an avatar URL, and switches to the image after setUser', async () => {
    const { w, auth } = await mountHeader(null)
    expect(w.find('[data-test="account-avatar"]').exists()).toBe(false)
    expect(w.get('[data-test="account-initial"]').text()).toBe('C')
    auth.setUser(makeMe({ avatarUrl: 'http://cdn/new.webp' }))
    await flushPromises()
    expect(w.get('[data-test="account-avatar"]').attributes('src')).toBe('http://cdn/new.webp')
    expect(w.find('[data-test="account-initial"]').exists()).toBe(false)
    w.unmount()
  })

  it('a broken avatar image falls back to the initial', async () => {
    const { w } = await mountHeader('http://cdn/broken.webp')
    await w.get('[data-test="account-avatar"]').trigger('error')
    expect(w.find('[data-test="account-avatar"]').exists()).toBe(false)
    expect(w.get('[data-test="account-initial"]').text()).toBe('C')
    w.unmount()
  })
})

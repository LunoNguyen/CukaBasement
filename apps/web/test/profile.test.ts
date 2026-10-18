import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { i18n } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRoute } from './fakeApi'
import { card, publicUser } from './fixtures'

let fake: FakeFetch | undefined
let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  fake?.restore()
  fake = undefined
  document.body.innerHTML = ''
})

const ok = (body: unknown) => ({ status: 200, body })
const page = (items: unknown[], nextCursor: string | null = null) => ok({ items, nextCursor })

async function mountAt(path: string, loggedIn: boolean) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.ready = true
  if (loggedIn) auth.setSession({ accessToken: 't', user: makeMe() })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const base = (extra: Record<string, FakeRoute> = {}): Record<string, FakeRoute> => ({
  'GET /api/users/mai': ok(
    publicUser({
      id: 'u2',
      username: 'mai',
      displayName: 'Mai',
      bio: 'Xin chào',
      links: [
        { platform: 'pixiv', url: 'https://pixiv.net/u/1' },
        { platform: 'x', url: 'https://x.com/mai' },
        { platform: 'other', label: 'Cửa hàng', url: 'https://shop.example/mai' },
        { platform: 'myspace' as never, url: 'https://myspace.example/mai' },
        { platform: 'kofi', url: 'javascript:alert(1)' },
      ],
      stats: { followerCount: 12, followingCount: 4, postCount: 9 },
    }),
  ),
  'GET /api/users/mai/posts': page([card({ title: 'Bài của Mai' })]),
  'GET /api/users/mai/bookmarks': page([]),
  ...extra,
})

describe('Profile page', () => {
  it('renders stats and follow button (hidden on own profile)', async () => {
    fake = installFakeFetch(base({ 'GET /api/users/cuka': ok(publicUser()), 'GET /api/users/cuka/posts': page([]) }))
    const w = await mountAt('/u/mai', true)
    expect(w.text()).toContain('Mai')
    expect(w.text()).toContain('@mai')
    expect(w.text()).toContain('Xin chào')
    expect(w.get('[data-test="stat-followers"]').text()).toContain('12')
    expect(w.get('[data-test="stat-following"]').text()).toContain('4')
    expect(w.get('[data-test="stat-posts"]').text()).toContain('9')
    expect(w.text()).toContain('Bài của Mai')
    // In the saved order; other/unknown platforms get a generic icon, non-http(s) links are dropped.
    const links = w.findAll('[data-test="social-link"]')
    expect(links.map((l) => l.text())).toEqual(['pixiv', 'X', 'Cửa hàng', 'myspace.example'])
    expect(links[1]!.attributes('href')).toBe('https://x.com/mai')
    expect(links.map((l) => l.find('[data-test="link-icon"]').exists())).toEqual([false, false, true, true])
    for (const l of links) {
      expect(l.attributes('rel')).toBe('noopener noreferrer nofollow')
      expect(l.attributes('target')).toBe('_blank')
    }
    expect(w.find('[data-test="follow"]').exists()).toBe(true)
    // fallback initial letter, no broken img
    expect(w.get('[data-test="avatar"]').text()).toBe('M')

    wrapper!.unmount()
    const own = await mountAt('/u/cuka', true)
    expect(own.text()).toContain('Cuka')
    expect(own.find('[data-test="follow"]').exists()).toBe(false)
  })

  it('reloads when the session changes', async () => {
    fake = installFakeFetch(base())
    const w = await mountAt('/u/mai', false)
    expect(fake.callsTo('GET /api/users/mai')).toHaveLength(1)
    useAuth().setSession({ accessToken: 't', user: makeMe() })
    await flushPromises()
    expect(fake.callsTo('GET /api/users/mai')).toHaveLength(2)
    expect(fake.callsTo('GET /api/users/mai')[1]!.headers.authorization).toBe('Bearer t')
    expect(w.text()).toContain('Mai')
  })

  it('unknown user shows the not-found page', async () => {
    fake = installFakeFetch({ 'GET /api/users/ghost': { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } } })
    const w = await mountAt('/u/ghost', false)
    expect(w.text()).toContain('Không tìm thấy trang')
  })

  it('bookmarks tab keeps paging past empty pages', async () => {
    fake = installFakeFetch(
      base({
        'GET /api/users/mai/bookmarks': [page([], 'c1'), page([card({ id: 'b1', title: 'Đã lưu 1' })], null)],
      }),
    )
    const w = await mountAt('/u/mai', false)
    const tabs = w.findAll('[role="tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['Bài đăng', 'Đã lưu'])
    await tabs[1]!.trigger('click')
    await flushPromises()
    expect(fake.callsTo('GET /api/users/mai/bookmarks').length).toBe(2)
    expect(w.text()).toContain('Đã lưu 1')
  })
})

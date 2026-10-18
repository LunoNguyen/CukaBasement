import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { i18n } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch } from './fakeApi'
import { card } from './fixtures'

let fake: FakeFetch | undefined
afterEach(() => {
  fake?.restore()
  fake = undefined
})

const tags = [
  { name: 'fanart', display: 'Fanart', postCount: 3 },
  { name: 'oc', display: 'OC', postCount: 1 },
]
const ok = (items: unknown[], nextCursor: string | null = null) => ({ status: 200, body: { items, nextCursor } })

async function mountAt(path: string, loggedIn = false) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.ready = true
  if (loggedIn) auth.setSession({ accessToken: 't', user: makeMe() })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  const w = mount(App, { global: { plugins: [pinia, router, i18n] } })
  await flushPromises()
  return { w, router }
}

describe('Home', () => {
  it('hides Following tab when logged out, shows featured tags from API', async () => {
    fake = installFakeFetch({
      'GET /api/tags/featured': { status: 200, body: tags },
      'GET /api/feed/home': ok([card()]),
    })
    const { w } = await mountAt('/')
    expect(w.findAll('[role="tab"]').map((t) => t.text())).toEqual(['Mới nhất'])
    const chips = w.findAll('[data-test="featured-tag"]')
    expect(chips.map((c) => c.text())).toEqual(['Fanart', 'OC'])
    expect(chips[0]!.attributes('href')).toBe('/tags/fanart')
    expect(w.text()).toContain('Mèo')
    expect(fake.callsTo('GET /api/feed/following')).toHaveLength(0)
  })

  it('logged out: a hero with the tagline and sign-up; logged in: no hero. The footer carries the tagline on every page', async () => {
    fake = installFakeFetch({ 'GET /api/tags/featured': { status: 200, body: [] }, 'GET /api/feed/home': ok([]) })
    let { w } = await mountAt('/')
    const hero = w.get('[data-test="home-hero"]')
    expect(hero.get('h1').text()).toBe('Vẽ thật.Ghi công thật.')
    expect(hero.text()).toContain('Real art. Real credit.')
    expect(hero.get('[data-test="hero-register"]').attributes('href')).toBe('/register')
    expect(w.get('[data-test="footer"]').text()).toContain('Ghi công thật.')
    expect(w.get('[data-test="empty-art"]').attributes('aria-hidden')).toBe('true')
    w.unmount()
    ;({ w } = await mountAt('/', true))
    expect(w.find('[data-test="home-hero"]').exists()).toBe(false)
    expect(w.find('[data-test="footer"]').exists()).toBe(true)
    w.unmount()
  })

  it('logged in: Following tab loads /api/feed/following', async () => {
    fake = installFakeFetch({
      'GET /api/tags/featured': { status: 200, body: [] },
      'GET /api/feed/home': ok([card()]),
      'GET /api/feed/following': ok([card({ id: 'p2', title: 'Chó' })]),
    })
    const { w } = await mountAt('/', true)
    const tabs = w.findAll('[role="tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['Mới nhất', 'Đang theo dõi'])
    await tabs[1]!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Chó')
  })

  it('after 5 extra empty pages the scroll trigger stops until "Tải thêm" is clicked', async () => {
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
          observers.push(cb)
        }
        observe() {}
        disconnect() {}
      },
    )
    fake = installFakeFetch({ 'GET /api/tags/featured': { status: 200, body: [] }, 'GET /api/feed/home': ok([], 'more') })
    const { w } = await mountAt('/')
    expect(fake.callsTo('GET /api/feed/home')).toHaveLength(6)
    expect(observers.length).toBeGreaterThan(0)
    observers.at(-1)!([{ isIntersecting: true }])
    await flushPromises()
    expect(fake.callsTo('GET /api/feed/home')).toHaveLength(6)
    const more = w.findAll('button').find((b) => b.text() === 'Tải thêm')!
    await more.trigger('click')
    await flushPromises()
    expect(fake.callsTo('GET /api/feed/home')).toHaveLength(12)
    w.unmount()
  })

  it('shows an empty state when the feed is empty', async () => {
    fake = installFakeFetch({ 'GET /api/tags/featured': { status: 200, body: [] }, 'GET /api/feed/home': ok([]) })
    const { w } = await mountAt('/')
    expect(w.text()).toContain('Chưa có bài đăng nào')
  })
})

describe('Tag page', () => {
  it('loads /api/search?tag=', async () => {
    fake = installFakeFetch({ 'GET /api/search': ok([card()]) })
    const { w } = await mountAt('/tags/fanart')
    expect(fake.callsTo('GET /api/search')[0]!.query.get('tag')).toBe('fanart')
    expect(w.text()).toContain('#fanart')
    expect(w.text()).toContain('Mèo')
  })
})

describe('Search page', () => {
  it('builds query ?q=&type= and renders results', async () => {
    fake = installFakeFetch({ 'GET /api/search': ok([card()]) })
    const { w, router } = await mountAt('/search')
    expect(fake.callsTo('GET /api/search')).toHaveLength(0)
    await w.get('input[type="search"]').setValue('mèo')
    await w.get('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ q: 'mèo' })
    await w.get('[data-test="type-manga"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ q: 'mèo', type: 'manga' })
    const last = fake.callsTo('GET /api/search').at(-1)!
    expect(last.query.get('q')).toBe('mèo')
    expect(last.query.get('type')).toBe('manga')
    expect(w.text()).toContain('Mèo')
  })

  it('reads q and type from the URL on load', async () => {
    fake = installFakeFetch({ 'GET /api/search': ok([card()]) })
    await mountAt('/search?q=cat&type=video')
    const c = fake.callsTo('GET /api/search')[0]!
    expect(c.query.get('q')).toBe('cat')
    expect(c.query.get('type')).toBe('video')
  })
})

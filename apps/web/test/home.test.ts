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
const lt = (vi: string, en = '') => ({ vi, en })

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

const banner = { title: lt('Hibiki Du Ca'), text: lt('VTuber của NIJIGEN'), image: null, link: { label: lt('Giới thiệu'), href: '/gioi-thieu' } }
const bannerImage = { fileId: 'f'.repeat(24), alt: lt('Du Ca cười'), decorative: false, src: 'http://cdn/b.webp', srcset: 'http://cdn/b.webp 640w', width: 1600, height: 400 }
const ranked = (n: number) => Array.from({ length: n }, (_, i) => ({ ...card({ id: `r${i + 1}`, title: `Hạng ${i + 1}` }), rank: i + 1, score: 20 - i }))

/** Every request "/" makes, answered; `over` replaces some. */
function homeRoutes(over: Record<string, unknown> = {}) {
  return {
    'GET /api/site/banner': { status: 200, body: { banner } },
    'GET /api/tags/featured': { status: 200, body: tags },
    'GET /api/feed/ranking': { status: 200, body: { items: ranked(3) } },
    'GET /api/feed/home': ok([card()]),
    ...over,
  } as Parameters<typeof installFakeFetch>[0]
}

describe('Home (/): the fanart gallery', () => {
  it('a small banner about Du Ca with its link; without a picture it is text on a grey band', async () => {
    fake = installFakeFetch(homeRoutes())
    const { w } = await mountAt('/')
    const b = w.get('[data-test="home-banner"]')
    expect(b.get('h1').text()).toBe('Hibiki Du Ca')
    expect(b.text()).toContain('VTuber của NIJIGEN')
    expect(b.get('a[href="/gioi-thieu"]').text()).toContain('Giới thiệu')
    expect(b.find('img').exists()).toBe(false)
    expect(b.classes()).toContain('bg-[var(--c-surface-2)]')
    w.unmount()
  })

  it('the banner picture, with its alt text, when it has one', async () => {
    fake = installFakeFetch(homeRoutes({ 'GET /api/site/banner': { status: 200, body: { banner: { ...banner, image: bannerImage } } } }))
    const { w } = await mountAt('/')
    const img = w.get('[data-test="home-banner"] img')
    expect(img.attributes()).toMatchObject({ src: 'http://cdn/b.webp', alt: 'Du Ca cười', srcset: 'http://cdn/b.webp 640w' })
    w.unmount()
  })

  it('featured tags, the type filter, the day ranking (10) and the latest feed; Following hidden when logged out', async () => {
    fake = installFakeFetch(homeRoutes())
    const { w } = await mountAt('/')
    const chips = w.findAll('[data-test="featured-tag"]')
    expect(chips.map((c) => c.text())).toEqual(['#Fanart', '#OC'])
    expect(chips[0]!.attributes('href')).toBe('/tags/fanart')
    expect(w.findAll('[data-test^="type-filter-"]').map((c) => c.text())).toEqual(['Tất cả', 'Tranh', 'Truyện tranh', 'Video', 'Âm thanh'])
    const r = fake.callsTo('GET /api/feed/ranking')[0]!
    expect(r.query.get('period')).toBe('day')
    expect(r.query.get('limit')).toBe('10')
    expect(r.query.get('type')).toBeNull()
    expect(w.findAll('[data-test="ranking-row"] [data-test="rank"]').map((x) => x.text())).toEqual(['1', '2', '3'])
    expect(w.get('[data-test="ranking-all"]').attributes('href')).toBe('/ranking?period=day')
    expect(w.findAll('[data-test="feed-tabs"] [role="tab"]').map((t) => t.text())).toEqual(['Mới nhất'])
    expect(w.get('[data-test="feed"]').text()).toContain('Mèo')
    expect(fake.callsTo('GET /api/feed/following')).toHaveLength(0)
    w.unmount()
  })

  it('switching the ranking tab asks for that period and updates "see all"', async () => {
    fake = installFakeFetch(homeRoutes())
    const { w } = await mountAt('/')
    await w.get('[data-test="ranking-period-week"]').trigger('click')
    await flushPromises()
    expect(fake.callsTo('GET /api/feed/ranking').at(-1)!.query.get('period')).toBe('week')
    expect(w.get('[data-test="ranking-period-week"]').attributes('aria-selected')).toBe('true')
    expect(w.get('[data-test="ranking-all"]').attributes('href')).toBe('/ranking?period=week')
    w.unmount()
  })

  it('the type filter goes into ?type= and applies to the ranking and the feed', async () => {
    fake = installFakeFetch(homeRoutes())
    const { w, router } = await mountAt('/')
    await w.get('[data-test="type-filter-video"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ type: 'video' })
    expect(fake.callsTo('GET /api/feed/ranking').at(-1)!.query.get('type')).toBe('video')
    expect(fake.callsTo('GET /api/feed/home').at(-1)!.query.get('type')).toBe('video')
    expect(w.get('[data-test="type-filter-video"]').attributes('aria-pressed')).toBe('true')
    expect(w.get('[data-test="ranking-all"]').attributes('href')).toBe('/ranking?period=day&type=video')
    await w.get('[data-test="type-filter-all"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(fake.callsTo('GET /api/feed/home').at(-1)!.query.get('type')).toBeNull()
    w.unmount()
  })

  it('reads ?type= on load', async () => {
    fake = installFakeFetch(homeRoutes())
    await mountAt('/?type=manga')
    expect(fake.callsTo('GET /api/feed/ranking')[0]!.query.get('type')).toBe('manga')
    expect(fake.callsTo('GET /api/feed/home')[0]!.query.get('type')).toBe('manga')
  })

  it('nothing posted yet: empty ranking and empty feed say so; the banner still shows', async () => {
    fake = installFakeFetch(homeRoutes({ 'GET /api/feed/ranking': { status: 200, body: { items: [] } }, 'GET /api/feed/home': ok([]), 'GET /api/tags/featured': { status: 200, body: [] } }))
    const { w } = await mountAt('/')
    expect(w.get('[data-test="home-banner"]').text()).toContain('Hibiki Du Ca')
    expect(w.get('[data-test="ranking-row"]').text()).toContain('Chưa có tác phẩm nào được xếp hạng')
    expect(w.find('[data-test="ranking-row"] [data-test="rank"]').exists()).toBe(false)
    expect(w.get('[data-test="feed"]').text()).toContain('Chưa có bài đăng nào')
    expect(w.find('[data-test="featured-tag"]').exists()).toBe(false)
    w.unmount()
  })

  it('a banner the admin cleared, or one that fails to load, leaves no empty band', async () => {
    fake = installFakeFetch(homeRoutes({ 'GET /api/site/banner': { status: 200, body: { banner: null } } }))
    const { w } = await mountAt('/')
    expect(w.find('[data-test="home-banner"]').exists()).toBe(false)
    expect(w.get('h1').text()).toBe('CukaBasement')
    w.unmount()
  })

  it('logged in: the Following tab loads /api/feed/following with the type filter', async () => {
    fake = installFakeFetch(homeRoutes({ 'GET /api/feed/following': ok([card({ id: 'p2', title: 'Chó' })]) }))
    const { w } = await mountAt('/?type=audio', true)
    const tabs = w.findAll('[data-test="feed-tabs"] [role="tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['Mới nhất', 'Đang theo dõi'])
    await tabs[1]!.trigger('click')
    await flushPromises()
    expect(w.get('[data-test="feed"]').text()).toContain('Chó')
    expect(fake.callsTo('GET /api/feed/following').at(-1)!.query.get('type')).toBe('audio')
    w.unmount()
  })

  it('/posts and /feed redirect to "/" keeping the query', async () => {
    fake = installFakeFetch(homeRoutes())
    const { router, w } = await mountAt('/posts?type=video')
    expect(router.currentRoute.value.fullPath).toBe('/?type=video')
    await router.push('/feed')
    expect(router.currentRoute.value.path).toBe('/')
    expect(w.get('[data-test="nav-home"]').classes()).toContain('!text-[var(--c-text)]')
    w.unmount()
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
    fake = installFakeFetch(homeRoutes({ 'GET /api/feed/home': ok([], 'more') }))
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
    vi.unstubAllGlobals()
  })
})

describe('Ranking page (/ranking)', () => {
  it('a 50-item ranked grid for the period and type in the URL; tabs and filter update the URL', async () => {
    fake = installFakeFetch({ 'GET /api/feed/ranking': { status: 200, body: { items: ranked(50) } } })
    const { w, router } = await mountAt('/ranking?period=week&type=manga')
    const first = fake.callsTo('GET /api/feed/ranking')[0]!
    expect([first.query.get('period'), first.query.get('type'), first.query.get('limit')]).toEqual(['week', 'manga', '50'])
    expect(w.get('h1').text()).toBe('Xếp hạng')
    const ranks = w.findAll('[data-test="ranking-grid"] [data-test="rank"]')
    expect(ranks).toHaveLength(50)
    expect(ranks[0]!.text()).toBe('1')
    expect(ranks[49]!.text()).toBe('50')
    expect(w.get('[data-test="ranking-period-week"]').attributes('aria-selected')).toBe('true')
    await w.get('[data-test="ranking-period-month"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ period: 'month', type: 'manga' })
    expect(fake.callsTo('GET /api/feed/ranking').at(-1)!.query.get('period')).toBe('month')
    await w.get('[data-test="type-filter-all"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ period: 'month' })
    w.unmount()
  })

  it('defaults to the day; an unknown period falls back to it; empty says so', async () => {
    fake = installFakeFetch({ 'GET /api/feed/ranking': { status: 200, body: { items: [] } } })
    const { w } = await mountAt('/ranking?period=year&type=nope')
    const q = fake.callsTo('GET /api/feed/ranking')[0]!.query
    expect(q.get('period')).toBe('day')
    expect(q.get('type')).toBeNull()
    expect(w.text()).toContain('Chưa có tác phẩm nào được xếp hạng')
    w.unmount()
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

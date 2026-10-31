import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import type { HomeSection } from '@cuka/shared'
import { i18n, setLocale } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRoute } from './fakeApi'
import { card } from './fixtures'
import { IMG, landingSections, lt, publicLanding, resolved, VID, VID_M } from './homepageFixture'

let fake: FakeFetch | undefined
let wrapper: VueWrapper | undefined
let media: Record<string, boolean> = {}
const play = vi.fn(() => Promise.resolve())
const pause = vi.fn()
const scrolled: Element[] = []

beforeEach(() => {
  media = {}
  scrolled.length = 0
  play.mockClear()
  pause.mockClear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: !!media[q], media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: play })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause })
  Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: () => {} })
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: function (this: Element) {
      scrolled.push(this)
    },
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  fake?.restore()
  fake = undefined
  document.body.innerHTML = ''
  setLocale('vi')
  vi.useRealTimers()
  delete (window as { matchMedia?: unknown }).matchMedia
})

const REDUCE = '(prefers-reduced-motion: reduce)'
const PHONE = '(max-width: 767px)'

/** /gioi-thieu with the former landing blocks (and anything else `home` holds) as its published sections. */
async function mountHome(home = publicLanding(), opts: { admin?: boolean; loggedIn?: boolean; routes?: Record<string, FakeRoute> } = {}) {
  fake = installFakeFetch({
    'GET /api/site/pages/intro': { status: 200, body: { ...home, page: 'intro' } },
    'GET /api/feed/showcase': { status: 200, body: { items: [card(), card({ id: 'p2', title: 'Chó' }), card({ id: 'p3', title: 'Gà' })], nextCursor: null } },
    'GET /api/notifications/unread-count': { status: 200, body: { count: 3 } },
    ...opts.routes,
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.ready = true
  if (opts.loggedIn || opts.admin) auth.setSession({ accessToken: 't', user: makeMe(opts.admin ? { role: 'admin' } : {}) })
  const router = createAppRouter(createMemoryHistory())
  await router.push('/gioi-thieu')
  wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  await flushPromises()
  return { w: wrapper, router }
}

const blocks = (w: VueWrapper) => w.findAll('[data-test="intro-block"]')

describe('Introduction page (/gioi-thieu): the former landing screens as normal blocks', () => {
  it('renders the blocks in order as one normal-scrolling page: no snapping, dots, menu, vibe or footer', async () => {
    const { w } = await mountHome()
    expect(blocks(w).map((p) => p.attributes('data-section'))).toEqual(['heroVideo', 'releases', 'spotlight'])
    expect(w.text()).not.toContain('Bí mật')
    expect(w.text()).not.toContain('Một căn hầm ấm áp')
    expect(w.find('[data-test="fullpage"]').exists()).toBe(false)
    expect(w.find('[data-test="dot-nav"]').exists()).toBe(false)
    expect(w.find('[data-test="landing-chrome"]').exists()).toBe(false)
    expect(document.documentElement.classList.contains('fp-snap')).toBe(false)
    // The site header and footer, one h1 (the name, the one Fraunces heading), the hero at most 60% of the screen.
    expect(w.find('[data-test="brand"]').exists()).toBe(true)
    expect(w.find('[data-test="footer"]').exists()).toBe(true)
    expect(w.findAll('h1').map((h) => h.text())).toEqual(['Hibiki Du Ca'])
    expect(w.get('h1').classes()).toContain('font-display')
    expect(w.get('[data-test="fp-hero"]').classes()).toContain('max-h-[60vh]')
    for (const h of w.findAll('h2')) expect(h.classes()).not.toContain('font-display')
    expect(document.title).toBe('Giới thiệu · Hibiki Du Ca · CukaBasement')
  })

  it('loads nothing from outside the site: API calls only, no iframes', async () => {
    const { w } = await mountHome()
    expect(fake!.calls.every((c) => c.path.startsWith('/api/'))).toBe(true)
    expect(w.find('iframe').exists()).toBe(false)
    expect(w.html()).not.toMatch(/youtube\.com\/embed|ytimg|fonts\.g/)
  })

  it('hero video: muted inline loop, poster frame, plays only as allowed, with a pause button', async () => {
    const { w } = await mountHome()
    const video = w.get('[data-test="fp-hero-video"]')
    const el = video.element as HTMLVideoElement
    expect(el.muted).toBe(true)
    expect(el.loop).toBe(true)
    expect(video.attributes()).toHaveProperty('playsinline')
    expect(video.attributes('aria-hidden')).toBeUndefined()
    expect(video.element.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(video.get('source').attributes()).toMatchObject({ src: `http://cdn/${VID}/video.mp4?v=1`, type: 'video/mp4' })
    // The poster is the frame render wide enough for the screen (jsdom: 1024px).
    expect(video.attributes('poster')).toBe(`http://cdn/${VID}/md.webp?v=1`)
    expect(play).toHaveBeenCalled()
    const toggle = w.get('[data-test="fp-hero-toggle"]')
    expect(toggle.text()).toBe('Tạm dừng video')
    await toggle.trigger('click')
    expect(pause).toHaveBeenCalled()
    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(toggle.text()).toBe('Phát video')
    // The link goes out in a new tab.
    expect(w.get('[data-test="fp-now-playing"]').attributes()).toMatchObject({ href: 'https://www.youtube.com/@hibikiduca', target: '_blank', rel: 'noopener noreferrer' })
  })

  it('hero video: the phone clip on small screens; a hidden tab pauses it', async () => {
    media[PHONE] = true
    const { w } = await mountHome()
    expect(w.get('[data-test="fp-hero-video"] source').attributes('src')).toBe(`http://cdn/${VID_M}/video.mp4?v=1`)
    pause.mockClear()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(pause).toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })

  it('reduced motion: the video waits on its poster with a play button; no rotation', async () => {
    media[REDUCE] = true
    vi.useFakeTimers()
    const { w } = await mountHome()
    expect(play).not.toHaveBeenCalled()
    expect(w.get('[data-test="fp-hero-toggle"]').text()).toBe('Phát video')
    await w.get('[data-test="fp-hero-toggle"]').trigger('click')
    expect(play).toHaveBeenCalled()
    vi.advanceTimersByTime(20_000)
    await flushPromises()
    expect(w.get('[data-test="spotlight-count"]').text()).toBe('01 / 03')
  })

  it('hero without a ready video: the image slideshow, else plain text on the grey surface', async () => {
    const withSlides = landingSections().map((s) => (s.type === 'heroVideo' ? { ...s, data: { ...s.data, video: null, videoMobile: null, images: [{ fileId: IMG, alt: lt('Du Ca'), decorative: false }] } } : s)) as HomeSection[]
    let { w } = await mountHome(publicLanding(withSlides, {}))
    expect(w.find('[data-test="fp-hero-video"]').exists()).toBe(false)
    expect(w.findAll('[data-test="fp-hero-slide"]')).toHaveLength(1)
    wrapper!.unmount()
    fake!.restore()
    ;({ w } = await mountHome(publicLanding(landingSections(), {})))
    expect(w.find('[data-test="fp-hero-video"]').exists()).toBe(false)
    expect(w.get('[data-test="fp-hero"]').classes()).toContain('bg-[var(--c-surface-2)]')
    expect(w.find('[data-test="fp-hero"] img').exists()).toBe(false)
    expect(w.find('[data-test="fp-hero-toggle"]').exists()).toBe(false)
  })

  it('releases: the hovered or focused cover opens (16:9 picture), the others dim; links keep their targets', async () => {
    const { w } = await mountHome()
    const items = () => w.get('[data-test="releases-row"]').findAll('[data-test="release-item"]')
    expect(items()).toHaveLength(4)
    const links = items().map((i) => i.get('a'))
    expect(links.map((a) => a.attributes('href'))).toEqual(['https://open.spotify.com/track/1', '/posts/p2', 'https://youtu.be/dQw4w9WgXcQ', '/posts/p4'])
    expect(links[0]!.attributes()).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' })
    expect(links[0]!.text()).toContain('Bài một')
    expect(links[0]!.text()).toContain('(mở thẻ mới)')
    await links[0]!.trigger('mouseenter')
    expect(items()[0]!.attributes('data-active')).toBe('true')
    expect(Number((items()[0]!.element as HTMLElement).style.flexGrow)).toBeGreaterThan(1)
    expect((items()[1]!.element as HTMLElement).style.flexGrow).toBe('1')
    const imgs = items()[0]!.findAll('img')
    expect(imgs[0]!.classes()).toContain('opacity-0')
    expect(imgs[1]!.attributes('src')).toBe(resolved('b'.repeat(24)).src)
    expect(imgs[1]!.classes()).toContain('opacity-100')
    await links[2]!.trigger('focus')
    expect(items()[2]!.attributes('data-active')).toBe('true')
    expect(items()[0]!.attributes('data-active')).toBeUndefined()
    await w.get('[data-test="releases-row"]').trigger('mouseleave')
    expect(items().some((i) => i.attributes('data-active'))).toBe(false)
  })

  it('releases on phones: cover flow with previous/next, swipe and progress', async () => {
    const { w } = await mountHome()
    const flow = w.get('[data-test="releases-flow"]')
    const count = () => flow.get('[data-test="flow-count"]').text()
    expect(count()).toBe('01 / 04')
    expect(flow.get('[data-test="flow-current"]').attributes('href')).toBe('https://open.spotify.com/track/1')
    expect(flow.findAll('[data-test="flow-card"]').filter((c) => c.attributes('aria-hidden') !== 'true')).toHaveLength(1)
    await flow.get('[data-test="flow-next"]').trigger('click')
    expect(count()).toBe('02 / 04')
    expect((flow.get('[data-test="flow-progress"]').element as HTMLElement).style.width).toBe('50%')
    await flow.get('[data-test="flow-prev"]').trigger('click')
    await flow.get('[data-test="flow-prev"]').trigger('click')
    expect(count()).toBe('04 / 04')
    const stage = flow.get('[data-test="flow-card"]').element.parentElement!
    stage.dispatchEvent(Object.assign(new Event('touchstart'), { touches: [{ clientX: 300 }] }))
    stage.dispatchEvent(Object.assign(new Event('touchend'), { changedTouches: [{ clientX: 200 }] }))
    await flushPromises()
    expect(count()).toBe('01 / 04')
  })

  it('releases from the newest fanart: the showcase, each cover linking to its post', async () => {
    const sections = landingSections().map((s) => (s.type === 'releases' ? { ...s, data: { ...s.data, source: 'latestFanart', count: 3, items: [] } } : s)) as HomeSection[]
    const { w } = await mountHome(publicLanding(sections))
    expect(fake!.callsTo('GET /api/feed/showcase')[0]!.query.get('limit')).toBe('3')
    const links = w.get('[data-test="releases-row"]').findAll('a')
    expect(links.map((a) => a.attributes('href'))).toEqual(['/posts/p1', '/posts/p2', '/posts/p3'])
    expect(links[0]!.attributes('target')).toBeUndefined()
    expect(w.get('[data-test="releases-all"]').attributes('href')).toBe('/')
  })

  it('spotlight: cross-fades every N seconds; pointing or focusing holds it; it has a pause button', async () => {
    vi.useFakeTimers()
    const { w } = await mountHome()
    const sp = () => w.get('[data-test="fp-spotlight"]')
    const count = () => sp().get('[data-test="spotlight-count"]').text()
    const bgs = () => sp().findAll('[data-test="spotlight-bg"]')
    expect(count()).toBe('01 / 03')
    expect(sp().get('[data-test="spotlight-caption"]').text()).toBe('08/08/2021')
    expect(sp().get('[data-test="spotlight-link"]').attributes('href')).toBe('/gioi-thieu')
    vi.advanceTimersByTime(4000)
    await flushPromises()
    expect(count()).toBe('02 / 03')
    expect(bgs()[1]!.classes()).toContain('opacity-100')
    expect(bgs()[0]!.classes()).toContain('opacity-0')
    // Thumbnails: black and white except the current one (the item without a picture shows its letter).
    const thumbs = sp().findAll('[data-test="spotlight-thumb"]')
    expect(thumbs[0]!.get('img').classes()).toContain('grayscale')
    expect(thumbs[1]!.get('img').classes()).not.toContain('grayscale')

    const names = sp().findAll('[data-test="spotlight-name"]')
    await names[2]!.trigger('mouseenter')
    expect(count()).toBe('03 / 03')
    expect(names[2]!.attributes('aria-current')).toBe('true')
    vi.advanceTimersByTime(12_000)
    await flushPromises()
    expect(count()).toBe('03 / 03')
    await names[2]!.element.parentElement!.parentElement!.parentElement!.dispatchEvent(new Event('mouseleave'))
    await flushPromises()
    vi.advanceTimersByTime(4000)
    await flushPromises()
    expect(count()).toBe('01 / 03')

    await names[1]!.trigger('focus')
    expect(count()).toBe('02 / 03')
    vi.advanceTimersByTime(12_000)
    await flushPromises()
    expect(count()).toBe('02 / 03')
    await names[1]!.trigger('blur')
    names[1]!.element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    await flushPromises()

    const toggle = sp().get('[data-test="spotlight-toggle"]')
    await toggle.trigger('click')
    expect(toggle.attributes()).toMatchObject({ 'aria-pressed': 'true', 'aria-label': 'Tiếp tục tự chuyển' })
    vi.advanceTimersByTime(20_000)
    await flushPromises()
    expect(count()).toBe('02 / 03')
    await sp().get('[data-test="spotlight-next"]').trigger('click')
    expect(count()).toBe('03 / 03')
  })

  it('English texts with Vietnamese fallback', async () => {
    setLocale('en')
    const { w } = await mountHome()
    expect(w.get('[data-test="fp-hero"]').text()).toContain('A goddess who loves Vietnamese food')
    expect(w.get('[data-test="fp-releases"] h2').text()).toBe('New release')
    expect(w.get('[data-test="fp-spotlight"]').text()).toContain('Original model')
    expect(w.get('[data-test="fp-now-playing"]').text()).toContain('YouTube channel')
  })

  it('a page holding both opening blocks (moved landing hero + old long-form hero): still one h1', async () => {
    const { allSections } = await import('./homepageFixture')
    const sections = [...landingSections().filter((x) => x.type === 'heroVideo'), ...allSections()]
    const { w } = await mountHome({ ...publicLanding(sections) })
    expect(blocks(w).map((p) => p.attributes('data-section'))).toEqual(['heroVideo', 'hero', 'about', 'profile', 'timeline', 'gallery', 'videos', 'links', 'fanart', 'banner'])
    expect(w.findAll('h1')).toHaveLength(1)
    expect(w.get('[data-test="landing-hero"] h2').text()).toBe('Hibiki Du Ca')
  })



})

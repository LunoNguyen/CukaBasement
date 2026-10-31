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

async function mountHome(home = publicLanding(), opts: { admin?: boolean; loggedIn?: boolean; routes?: Record<string, FakeRoute> } = {}) {
  fake = installFakeFetch({
    'GET /api/site/pages/home': { status: 200, body: home },
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
  await router.push('/')
  wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  await flushPromises()
  return { w: wrapper, router }
}

const panels = (w: VueWrapper) => w.findAll('[data-test="fp-panel"]')
const press = (key: string, target: EventTarget = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

describe('Landing page (/) as full screens', () => {
  it('renders one screen per visible section, in order, under the site header (shown on every route)', async () => {
    const { w, router } = await mountHome()
    expect(panels(w).map((p) => p.attributes('data-section'))).toEqual(['heroVideo', 'releases', 'spotlight', 'vibe', 'footer'])
    expect(w.text()).not.toContain('Bí mật')
    expect(w.find('[data-test="brand"]').exists()).toBe(true)
    expect(w.find('[data-test="landing-chrome"]').exists()).toBe(true)
    expect(document.documentElement.classList.contains('fp-snap')).toBe(true)
    // One h1: the huge name. Landmarks: the floating header, main, the screen dots and the footer.
    expect(w.findAll('h1').map((h) => h.text())).toEqual(['Hibiki Du Ca'])
    expect(w.find('header[data-test="landing-chrome"]').exists()).toBe(true)
    expect(w.find('main [data-test="fullpage"]').exists()).toBe(true)
    expect(w.find('footer[data-test="fp-footer"]').exists()).toBe(true)
    expect(document.title).toBe('Hibiki Du Ca · CukaBasement')

    // Other pages keep the normal header and footer, and stop snapping.
    await router.push('/posts')
    await flushPromises()
    expect(w.find('[data-test="brand"]').exists()).toBe(true)
    expect(document.documentElement.classList.contains('fp-snap')).toBe(false)
  })

  it('loads nothing from outside the site: API calls only, no iframes', async () => {
    const { w } = await mountHome()
    expect(fake!.calls.every((c) => c.path.startsWith('/api/'))).toBe(true)
    expect(w.find('iframe').exists()).toBe(false)
    expect(w.html()).not.toMatch(/youtube\.com\/embed|ytimg|fonts\.g/)
  })

  it('dot navigation names every screen, marks the current one and scrolls to the chosen one', async () => {
    const { w } = await mountHome()
    const dots = w.findAll('[data-test="dot"]')
    expect(dots.map((d) => d.attributes('aria-label'))).toEqual(['Hibiki Du Ca', 'Mới phát hành', 'Những phiên bản của Du Ca', 'CukaBasement', 'Liên hệ'])
    expect(w.get('[data-test="dot-nav"]').attributes('aria-label')).toBe('Các màn hình của trang')
    expect(dots[0]!.attributes('aria-current')).toBe('true')
    await dots[2]!.trigger('click')
    expect(scrolled.at(-1)).toBe(panels(w)[2]!.element)
    expect(w.findAll('[data-test="dot"]')[2]!.attributes('aria-current')).toBe('true')
    expect(w.findAll('[data-test="dot"]')[0]!.attributes('aria-current')).toBeUndefined()
    expect(document.activeElement).toBe(panels(w)[2]!.element)
  })

  it('keyboard: PageDown/arrows/Home/End move a screen at a time, but not while typing', async () => {
    const { w } = await mountHome()
    press('PageDown')
    await flushPromises()
    expect(scrolled.at(-1)).toBe(panels(w)[1]!.element)
    press('ArrowDown')
    expect(scrolled.at(-1)).toBe(panels(w)[2]!.element)
    press('ArrowUp')
    expect(scrolled.at(-1)).toBe(panels(w)[1]!.element)
    press('End')
    expect(scrolled.at(-1)).toBe(panels(w)[4]!.element)
    press('Home')
    expect(scrolled.at(-1)).toBe(panels(w)[0]!.element)
    const input = document.createElement('input')
    document.body.appendChild(input)
    const n = scrolled.length
    press('PageDown', input)
    expect(scrolled).toHaveLength(n)
  })

  it('menu: full-screen dialog with focus kept inside; Esc closes and returns focus to the button', async () => {
    const { w } = await mountHome()
    const btn = w.get('[data-test="menu-button"]')
    expect(btn.attributes()).toMatchObject({ 'aria-expanded': 'false', 'aria-controls': 'landing-menu', 'aria-label': 'Mở menu' })
    await btn.trigger('click')
    await flushPromises()
    const menu = w.get('[data-test="landing-menu"]')
    expect(menu.attributes()).toMatchObject({ role: 'dialog', 'aria-modal': 'true', id: 'landing-menu' })
    expect(btn.attributes('aria-expanded')).toBe('true')
    expect(document.documentElement.classList.contains('fp-menu-open')).toBe(true)
    expect(menu.findAll('[data-test="menu-link"]').map((a) => [a.text().replace(/^\d+/, ''), a.attributes('href')])).toEqual([
      ['Trang chủ', '/'],
      ['Giới thiệu', '/gioi-thieu'],
      ['Bài đăng', '/posts'],
      ['Đăng bài', '/upload'],
    ])
    expect(menu.find('[data-test="menu-search"]').exists()).toBe(true)
    expect(menu.find('[data-test="lang-en"]').exists()).toBe(true)
    expect(menu.find('[data-test="theme-toggle"]').exists()).toBe(true)
    expect(menu.get('[data-test="menu-login"]').attributes('href')).toBe('/login')
    expect(menu.get('[data-test="menu-register"]').attributes('href')).toBe('/register')
    // Focus starts on the close button; Tab wraps at both ends.
    const close = menu.get('[data-test="menu-close"]').element as HTMLElement
    expect(document.activeElement).toBe(close)
    const focusables = [...menu.element.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input')]
    focusables.at(-1)!.focus()
    menu.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(focusables[0])
    menu.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(focusables.at(-1))
    // Screen keys are left alone while the menu is open.
    const n = scrolled.length
    press('PageDown', close)
    expect(scrolled).toHaveLength(n)

    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(w.find('[data-test="landing-menu"]').exists()).toBe(false)
    expect(btn.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(btn.element)
    expect(document.documentElement.classList.contains('fp-menu-open')).toBe(false)
  })

  it('menu: account links for a signed-in admin, search goes to /search, following a link closes it', async () => {
    const { w, router } = await mountHome(publicLanding(), { admin: true })
    await w.get('[data-test="menu-button"]').trigger('click')
    await flushPromises()
    const menu = w.get('[data-test="landing-menu"]')
    expect(menu.get('[data-test="menu-admin"]').attributes('href')).toBe('/admin')
    expect(menu.get('[data-test="menu-notifications"]').text()).toContain('3')
    expect(menu.find('[data-test="menu-login"]').exists()).toBe(false)
    await menu.get('[data-test="menu-search"]').setValue('mèo')
    await menu.get('[data-test="menu-search"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/search?q=m%C3%A8o')
    expect(w.find('[data-test="landing-menu"]').exists()).toBe(false)
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
    // "Now playing" links out in a new tab.
    expect(w.get('[data-test="fp-now-playing"]').attributes()).toMatchObject({ href: 'https://www.youtube.com/@hibikiduca', target: '_blank', rel: 'noopener noreferrer' })
    expect(w.get('[data-test="fp-now-playing"]').classes()).toContain('mix-blend-difference')
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

  it('hero without a ready video: the image slideshow, else the basement art', async () => {
    const withSlides = landingSections().map((s) => (s.type === 'heroVideo' ? { ...s, data: { ...s.data, video: null, videoMobile: null, images: [{ fileId: IMG, alt: lt('Du Ca'), decorative: false }] } } : s)) as HomeSection[]
    let { w } = await mountHome(publicLanding(withSlides, {}))
    expect(w.find('[data-test="fp-hero-video"]').exists()).toBe(false)
    expect(w.findAll('[data-test="fp-hero-slide"]')).toHaveLength(1)
    wrapper!.unmount()
    fake!.restore()
    ;({ w } = await mountHome(publicLanding(landingSections(), {})))
    expect(w.find('[data-test="fp-hero-video"]').exists()).toBe(false)
    expect(w.find('[data-test="fp-hero-art"]').exists()).toBe(true)
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
    expect(w.get('[data-test="releases-all"]').attributes('href')).toBe('/posts')
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

  it('vibe links to the Introduction page; footer has site links, e-mail, social links and back to top', async () => {
    const { w } = await mountHome()
    expect(w.get('[data-test="vibe-cta"]').attributes('href')).toBe('/gioi-thieu')
    const footer = w.get('[data-test="fp-footer"]')
    expect(footer.get('[data-test="footer-intro"]').attributes('href')).toBe('/gioi-thieu')
    expect(footer.get('[data-test="footer-email"]').attributes('href')).toBe('mailto:lienhe@cuka.test')
    expect(footer.get('[data-test="footer-social"]').attributes()).toMatchObject({ href: 'https://www.youtube.com/@hibikiduca', target: '_blank', rel: 'noopener noreferrer' })
    expect(footer.text()).toContain('© CukaBasement')
    await footer.get('[data-test="footer-top"]').trigger('click')
    expect(scrolled.at(-1)).toBe(panels(w)[0]!.element)
  })

  it('English texts with Vietnamese fallback', async () => {
    setLocale('en')
    const { w } = await mountHome()
    expect(w.get('[data-test="fp-hero"]').text()).toContain('A goddess who loves Vietnamese food')
    expect(w.get('[data-test="fp-releases"] h2').text()).toBe('New release')
    expect(w.get('[data-test="fp-spotlight"]').text()).toContain('Original model')
    expect(w.get('[data-test="fp-now-playing"]').text()).toContain('YouTube channel')
  })

  it('an older long-form homepage still renders, one screen per section', async () => {
    const { allSections } = await import('./homepageFixture')
    const { w } = await mountHome({ ...publicLanding(allSections()), videos: {} })
    expect(panels(w).map((p) => p.attributes('data-section'))).toEqual(['hero', 'about', 'profile', 'timeline', 'gallery', 'videos', 'links', 'fanart', 'banner'])
    expect(w.findAll('h1')).toHaveLength(1)
    expect(w.find('[data-test="landing-hero"] h1').exists()).toBe(true)
  })

  it('API down: a fallback screen that still leads to the posts, with the menu', async () => {
    const { w } = await mountHome(publicLanding(), { routes: { 'GET /api/site/pages/home': { status: 500, body: { error: { code: 'INTERNAL' } } } } })
    expect(w.get('h1').text()).toBe('CukaBasement')
    expect(w.findAll('a').some((a) => a.attributes('href') === '/posts')).toBe(true)
    expect(w.find('[data-test="menu-button"]').exists()).toBe(true)
  })
})

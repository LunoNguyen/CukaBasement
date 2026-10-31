import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { i18n, setLocale } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch } from './fakeApi'
import { card } from './fixtures'
import { allSections, IMG, lt, publicHome } from './homepageFixture'

let fake: FakeFetch | undefined
afterEach(() => {
  fake?.restore()
  fake = undefined
  setLocale('vi')
  vi.useRealTimers()
})

async function mountLanding(home = publicHome(), loggedIn = false, extra: Record<string, unknown> = {}) {
  fake = installFakeFetch({
    'GET /api/site/pages/intro': { status: 200, body: home },
    'GET /api/feed/showcase': { status: 200, body: { items: [card(), card({ id: 'p2', title: 'Chó' })], nextCursor: null } },
    ...(extra as Record<string, { status: number }>),
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.ready = true
  if (loggedIn) auth.setSession({ accessToken: 't', user: makeMe() })
  const router = createAppRouter(createMemoryHistory())
  await router.push('/gioi-thieu')
  const w = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  await flushPromises()
  return { w, router }
}

describe('Introduction page (/gioi-thieu)', () => {
  it('renders every section type from the published homepage, in order, without the hidden one', async () => {
    const { w } = await mountLanding()
    const order = w.findAll('[data-test^="landing-"]').map((e) => e.attributes('data-test'))
    expect(order).toEqual([
      'landing-sections',
      'landing-hero',
      'landing-about',
      'landing-profile',
      'landing-timeline',
      'landing-gallery',
      'landing-videos',
      'landing-links',
      'landing-link',
      'landing-link',
      'landing-fanart',
      'landing-banner',
    ])
    expect(w.text()).not.toContain('Mục bị ẩn')
    // One normal-scrolling page in the site column: no snapping, no full screens.
    expect(w.get('main').classes()).toContain('max-w-[1280px]')
    expect(w.find('[data-test="fullpage"]').exists()).toBe(false)
    expect(document.documentElement.classList.contains('fp-snap')).toBe(false)
    w.unmount()
  })

  it('hero: one h1, CTAs as internal and external links, responsive images with the first eager', async () => {
    const { w } = await mountLanding()
    const hero = w.get('[data-test="landing-hero"]')
    expect(w.findAll('h1')).toHaveLength(1)
    expect(hero.get('h1').text()).toBe('Hibiki Du Ca')
    const ctas = hero.findAll('[data-test="hero-cta"]')
    expect(ctas[0]!.attributes('href')).toBe('/posts')
    expect(ctas[0]!.attributes('target')).toBeUndefined()
    expect(ctas[1]!.attributes()).toMatchObject({ href: 'https://www.youtube.com/@hibikiduca', target: '_blank', rel: 'noopener noreferrer' })
    const imgs = hero.findAll('img')
    expect(imgs).toHaveLength(2)
    expect(imgs[0]!.attributes()).toMatchObject({ alt: 'Du Ca cười', loading: 'eager', sizes: '(min-width: 1280px) 1232px, 100vw' })
    expect(imgs[0]!.attributes('srcset')).toContain('2400w')
    expect(imgs[1]!.attributes('loading')).toBe('lazy')
    expect(hero.find('[data-test="hero-pause"]').exists()).toBe(true)
    // Section headings are h2 under the single h1.
    expect(w.findAll('h2').map((h) => h.text())).toContain('Hồ sơ Du Ca')
    expect(document.title).toBe('Giới thiệu · Hibiki Du Ca · CukaBasement')
    // The normal site header, with the Introduction link marked current.
    expect(w.get('[data-test="nav-intro"]').classes()).toContain('!text-[var(--c-text)]')
    expect(w.find('[data-test="landing-chrome"]').exists()).toBe(false)
    w.unmount()
  })

  it('slideshow advances on its own and can be paused', async () => {
    vi.useFakeTimers()
    const { w } = await mountLanding()
    const slides = () => w.get('[data-test="landing-hero"]').findAll('.absolute.inset-0.transition-opacity')
    expect(slides()[0]!.classes()).toContain('opacity-100')
    vi.advanceTimersByTime(6600)
    await flushPromises()
    expect(slides()[1]!.classes()).toContain('opacity-100')
    await w.get('[data-test="hero-pause"]').trigger('click')
    vi.advanceTimersByTime(20000)
    await flushPromises()
    expect(slides()[1]!.classes()).toContain('opacity-100')
    w.unmount()
  })

  it('markdown renders bold, italic and safe links only; markup stays text', async () => {
    const { w } = await mountLanding()
    const about = w.get('[data-test="landing-about"]')
    expect(about.get('strong').text()).toBe('nữ thần')
    expect(about.get('em').text()).toBe('khám phá')
    const links = about.findAll('a')
    expect(links.map((a) => a.attributes('href'))).toEqual(['https://www.youtube.com/@hibikiduca', '/posts'])
    expect(about.find('script').exists()).toBe(false)
    expect(about.text()).toContain('<script>alert(1)</script>')
    expect(about.html()).not.toContain('href="javascript:')
    // No picture: the text alone, no decoration in its place.
    expect(about.find('img').exists()).toBe(false)
    expect(about.find('figure').exists()).toBe(false)
    w.unmount()
  })

  it('profile facts, timeline items, gallery carousel and link cards', async () => {
    const { w } = await mountLanding()
    expect(w.findAll('[data-test="profile-fact"]').map((f) => f.text())).toEqual(['Sinh nhật14 tháng 2', 'Ra mắt08/08/2021'])
    expect(w.findAll('[data-test="timeline-item"]')).toHaveLength(2)
    const gallery = w.get('[data-test="landing-gallery"]')
    expect(gallery.get('[data-layout]').attributes('data-layout')).toBe('carousel')
    expect(gallery.findAll('[data-test="gallery-item"]')).toHaveLength(2)
    expect(gallery.findAll('a').map((a) => a.attributes('href'))).toEqual(['/posts'])
    expect(gallery.find('button[aria-label="Tiếp"]').exists()).toBe(true)
    const link = w.findAll('[data-test="landing-link"]')
    expect(link[0]!.attributes()).toMatchObject({ href: 'https://www.youtube.com/@hibikiduca', target: '_blank', rel: 'noopener noreferrer' })
    expect(link[0]!.text()).toContain('YouTube')
    expect(link[1]!.text()).toContain('x.com')
    w.unmount()
  })

  it('YouTube embeds load nothing from YouTube until play is pressed, then use youtube-nocookie', async () => {
    const { w } = await mountLanding()
    const videos = w.get('[data-test="landing-videos"]')
    expect(videos.find('iframe').exists()).toBe(false)
    expect(videos.html()).not.toMatch(/ytimg|youtube\.com\/embed/)
    await videos.get('[data-test="yt-play"]').trigger('click')
    expect(videos.get('iframe').attributes('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0')
    expect(videos.get('iframe').attributes('title')).toBe('Debut stream')
    w.unmount()
  })

  it('fanart strip loads the showcase with the configured count and links to the gallery', async () => {
    const { w } = await mountLanding()
    expect(fake!.callsTo('GET /api/feed/showcase')[0]!.query.get('limit')).toBe('6')
    const fanart = w.get('[data-test="landing-fanart"]')
    expect(fanart.text()).toContain('Mèo')
    expect(fanart.get('[data-test="fanart-all"]').attributes('href')).toBe('/')
    w.unmount()
  })

  it('banner highlights hashtags and has its call to action', async () => {
    const { w } = await mountLanding()
    const banner = w.get('[data-test="landing-banner"]')
    expect(banner.get('blockquote span').text()).toBe('#DuCaArt')
    expect(banner.get('[data-test="banner-cta"]').attributes('href')).toBe('/upload')
    w.unmount()
  })

  it('English shows the English text and falls back to Vietnamese where it is empty', async () => {
    setLocale('en')
    const { w } = await mountLanding()
    expect(w.get('[data-test="landing-hero"]').text()).toContain('A goddess who loves Vietnamese food')
    expect(w.findAll('h2').map((h) => h.text())).toContain('Du Ca profile')
    expect(w.get('[data-test="landing-about"] h2').text()).toBe('Nữ thần đi lạc')
    expect(w.get('[data-test="landing-hero"] img').attributes('alt')).toBe('Du Ca smiling')
    w.unmount()
  })

  it('sections without pictures still render; empty lists are left out for visitors', async () => {
    const sections = allSections().map((s) => {
      if (s.type === 'hero') return { ...s, data: { ...s.data, images: [] } }
      if (s.type === 'gallery' || s.type === 'videos') return { ...s, data: { ...s.data, items: [] } }
      return s
    }) as ReturnType<typeof allSections>
    const { w } = await mountLanding({ ...publicHome(sections), images: {} })
    expect(w.get('[data-test="landing-hero"]').find('img').exists()).toBe(false)
    expect(w.get('[data-test="landing-hero"] h1').text()).toBe('Hibiki Du Ca')
    expect(w.find('[data-test="landing-gallery"]').exists()).toBe(false)
    expect(w.find('[data-test="landing-videos"]').exists()).toBe(false)
    expect(w.find('[data-test="site-image"]').exists()).toBe(false)
    w.unmount()
  })

  it('an image chosen but not processed yet is skipped (no broken img)', async () => {
    const { w } = await mountLanding({ ...publicHome(), images: { [IMG]: publicHome().images[IMG]! } })
    expect(w.get('[data-test="landing-hero"]').findAll('img')).toHaveLength(1)
    expect(w.get('[data-test="landing-hero"]').find('[data-test="hero-pause"]').exists()).toBe(false)
    w.unmount()
  })

  it('logged out: ends with the sign-up invitation; logged in: no invitation', async () => {
    let { w } = await mountLanding()
    expect(w.get('[data-test="intro-join"]').get('a[href="/register"]').classes().some((c) => c.includes('bg-[var(--c-primary)]'))).toBe(true)
    w.unmount()
    ;({ w } = await mountLanding(publicHome(), true))
    expect(w.find('[data-test="intro-join"]').exists()).toBe(false)
    w.unmount()
  })

  it('API down: a fallback welcome that still leads to the gallery', async () => {
    const { w } = await mountLanding(publicHome(), false, { 'GET /api/site/pages/intro': { status: 500, body: { error: { code: 'INTERNAL' } } } })
    expect(w.get('h1').text()).toBe('CukaBasement')
    expect(w.findAll('main a').some((a) => a.attributes('href') === '/' && a.text() === 'Xem fanart')).toBe(true)
    w.unmount()
  })

  it('the small section line is a muted subtitle under the H2, never a pink label above it', async () => {
    const { w } = await mountLanding()
    for (const sel of ['landing-about', 'landing-profile', 'landing-fanart']) {
      const h2 = w.get(`[data-test="${sel}"] h2`).element
      const sub = h2.nextElementSibling as HTMLElement
      expect(sub?.getAttribute('data-test'), sel).toBe('section-subtitle')
      expect(sub.className).toContain('text-[var(--c-muted)]')
      expect(h2.previousElementSibling, sel).toBeNull()
    }
    expect(w.get('[data-test="landing-profile"] [data-test="section-subtitle"]').text()).toBe('Hồ sơ')
    expect(w.html()).not.toMatch(/text-xs font-semibold text-\[var\(--c-accent-strong\)\]/)
    w.unmount()
  })

  it('a section title with markup is shown as text', async () => {
    const sections = [{ id: 'a', type: 'about', visible: true, data: { eyebrow: lt(''), heading: lt('<img src=x onerror=alert(1)>'), body: lt(''), image: null, imageSide: 'right' } }] as ReturnType<typeof allSections>
    const { w } = await mountLanding(publicHome(sections))
    expect(w.get('[data-test="landing-about"] h2').text()).toBe('<img src=x onerror=alert(1)>')
    expect(w.get('[data-test="landing-about"]').find('img').exists()).toBe(false)
    w.unmount()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import type { HomeSection } from '@cuka/shared'
import { i18n, setLocale } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import type { HomeDraftDto, MusicStatusDto, PageYouTubeDto, PublicHomeDto, YouTubeVideoDto } from '@/api/types'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRequest, type FakeRoute } from './fakeApi'
import { lt } from './homepageFixture'

const CH = 'UC5RSxmHP5c4pU9Og1Pxx4wg'
const A = 'aaaaaaaaaa1'
const B = 'bbbbbbbbbb2'
const C = 'ccccccccc_3'
const D = 'ddddddddd-4'

let fake: FakeFetch | undefined
let wrapper: VueWrapper | undefined
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} }),
  })
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => {} })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  fake?.restore()
  fake = undefined
  document.body.innerHTML = ''
  document.documentElement.className = ''
  setLocale('vi')
  vi.restoreAllMocks()
  delete (window as { matchMedia?: unknown }).matchMedia
})

const ok = (body: unknown) => ({ status: 200, body })

function music(over: Record<string, unknown> = {}): HomeSection {
  return {
    id: 'music',
    type: 'music',
    visible: true,
    data: {
      eyebrow: lt('Hibiki Du Ca'),
      heading: lt('Âm nhạc', 'Music'),
      channelId: CH,
      newest: { label: lt('MV mới', 'New MV'), auto: false, keyword: '', items: [{ url: `https://youtu.be/${A}`, title: lt('Tên admin đặt'), date: '2026-10-20', views: null }, { url: `https://www.youtube.com/watch?v=${B}`, title: lt(''), date: '', views: null }] },
      popular: { label: lt(''), auto: false, items: [{ url: `https://youtu.be/${C}`, title: lt(''), date: '', views: 1500000 }, { url: `https://youtu.be/${B}`, title: lt(''), date: '', views: null }] },
      channel: { label: lt(''), auto: true, items: [] },
      ...over,
    },
  } as HomeSection
}

const thumb = (id: string): YouTubeVideoDto['thumb'] => ({ src: `http://cdn/cuka-public/youtube/${id}/w480.webp?v=1`, srcset: `http://cdn/cuka-public/youtube/${id}/w480.webp?v=1 480w`, width: 480, height: 270 })
function yt(over: Partial<PageYouTubeDto> = {}): PageYouTubeDto {
  return {
    feeds: { music: { newest: [], popular: [], channel: [D, A, C] } },
    videos: {
      [A]: { title: 'Tên YouTube A', publishedAt: '2026-10-19T10:00:00.000Z', views: 12000, thumb: thumb(A) },
      [B]: { title: 'Karaoke B', publishedAt: '2026-10-01T10:00:00.000Z', views: 3400, thumb: thumb(B) },
      [C]: { title: 'Cover C', publishedAt: '2026-09-01T10:00:00.000Z', views: 800, thumb: null },
      [D]: { title: 'Vlog D', publishedAt: '2026-10-25T10:00:00.000Z', views: null, thumb: thumb(D) },
    },
    ...over,
  }
}

function home(sections: HomeSection[] = [music()], youtube: PageYouTubeDto = yt()): PublicHomeDto {
  return { page: 'intro', sections, images: {}, videos: {}, youtube, publishedAt: '2026-10-01T00:00:00.000Z' }
}

async function mountHome(h = home()) {
  fake = installFakeFetch({ 'GET /api/site/pages/intro': ok(h), 'GET /api/feed/showcase': ok({ items: [], nextCursor: null }) })
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuth().ready = true
  const router = createAppRouter(createMemoryHistory())
  await router.push('/gioi-thieu')
  wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const tabs = () => [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
const selected = () => tabs().find((t) => t.getAttribute('aria-selected') === 'true')!

describe('Music block on the Introduction page', () => {
  it('is a block with a title and three ARIA tabs; arrows, Home and End move between them', async () => {
    const w = await mountHome()
    expect(w.find('[data-section="music"]').exists()).toBe(true)
    expect(w.get('[data-test="fp-music"] h2').text()).toBe('Âm nhạc')
    expect(document.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Loại video')
    expect(tabs().map((t) => t.textContent!.replace(/\d+/g, '').trim())).toEqual(['MV mới', 'MV phổ biến', 'Video kênh'])
    expect(selected().textContent).toContain('MV mới')
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1])
    const panel = document.querySelector('[role="tabpanel"]')!
    expect(panel.getAttribute('aria-labelledby')).toBe(selected().id)
    expect(tabs()[0]!.getAttribute('aria-controls')).toBe(panel.id)

    tabs()[0]!.focus()
    key(tabs()[0]!, 'ArrowRight')
    await flushPromises()
    expect(selected().textContent).toContain('MV phổ biến')
    expect(document.activeElement).toBe(selected())
    expect(w.find('[data-test="music-ranking"]').exists()).toBe(true)
    key(selected(), 'End')
    await flushPromises()
    expect(selected().textContent).toContain('Video kênh')
    key(selected(), 'ArrowRight')
    await flushPromises()
    expect(selected().textContent).toContain('MV mới')
    key(selected(), 'ArrowLeft')
    await flushPromises()
    expect(selected().textContent).toContain('Video kênh')
    key(selected(), 'Home')
    await flushPromises()
    expect(selected().textContent).toContain('MV mới')
  })

  it('MV mới features the newest large; overrides win; ranked MV phổ biến with view counts; channel row with prev/next', async () => {
    const w = await mountHome()
    const featured = w.get('[data-test="music-featured"]')
    expect(featured.text()).toContain('Tên admin đặt')
    expect(featured.text()).toContain('20/10/2026')
    expect(featured.text()).not.toContain('Tên YouTube A')
    expect(featured.attributes('aria-label')).toBe('Phát video: Tên admin đặt')
    expect(w.findAll('[data-test="music-item"]').map((b) => b.text())).toEqual([expect.stringContaining('Karaoke B')])

    await w.get('[data-test="music-tab-popular"]').trigger('click')
    const ranked = w.findAll('[data-test="music-rank-item"]')
    expect(ranked).toHaveLength(2)
    expect(ranked[0]!.attributes('aria-label')).toBe('Hạng 1: Phát video: Cover C')
    expect(ranked[0]!.text()).toMatch(/1,5\s?Tr lượt xem/)
    expect(ranked[1]!.text()).toMatch(/3,4\s?N lượt xem/)
    // No thumbnail stored yet: the branded placeholder.
    expect(ranked[0]!.find('[data-test="music-placeholder"]').exists()).toBe(true)

    await w.get('[data-test="music-tab-channel"]').trigger('click')
    expect(w.findAll('[data-test="music-channel-item"]').map((b) => b.text())).toEqual([expect.stringContaining('Vlog D'), expect.stringContaining('Tên YouTube A'), expect.stringContaining('Cover C')])
    const row = w.get('[data-test="music-row"]').element as HTMLElement
    const scrollBy = vi.fn()
    row.scrollBy = scrollBy as never
    await w.get('[data-test="music-next"]').trigger('click')
    await w.get('[data-test="music-prev"]').trigger('click')
    expect(scrollBy.mock.calls.map((c) => Math.sign((c[0] as { left: number }).left))).toEqual([1, -1])
    expect(w.get('[data-test="music-channel-link"]').attributes('href')).toBe(`https://www.youtube.com/channel/${CH}`)
  })

  it('nothing from YouTube before a click; the player dialog loads youtube-nocookie, traps focus, Esc closes and returns focus', async () => {
    const w = await mountHome()
    // Every URL the page would load (src, srcset entries, stylesheet links), by host.
    const hosts = () =>
      [...document.querySelectorAll('img, iframe, script, link, video, source')].flatMap((e) =>
        [e.getAttribute('src'), e.getAttribute('href'), ...(e.getAttribute('srcset') ?? '').split(',').map((p) => p.trim().split(/\s+/)[0])]
          .filter((u): u is string => !!u)
          .map((u) => new URL(u, 'http://localhost').hostname),
      )
    for (const g of ['newest', 'popular', 'channel']) {
      await w.get(`[data-test="music-tab-${g}"]`).trigger('click')
      expect(document.querySelector('iframe')).toBeNull()
      expect(hosts().length).toBeGreaterThan(0)
      for (const host of hosts()) expect(host, host).toMatch(/^(cdn|localhost)$/)
    }
    await w.get('[data-test="music-tab-newest"]').trigger('click')
    const featured = w.get('[data-test="music-featured"]').element as HTMLElement
    featured.focus()
    featured.click()
    await flushPromises()
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Tên admin đặt')
    const iframe = document.querySelector('[data-test="music-iframe"]')!
    expect(iframe.getAttribute('src')).toBe(`https://www.youtube-nocookie.com/embed/${A}?autoplay=1&rel=0`)
    expect(iframe.getAttribute('title')).toBe('Tên admin đặt')
    const watch = document.querySelector('[data-test="music-watch"]')!
    expect(watch.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${A}`)
    expect(watch.getAttribute('target')).toBe('_blank')
    expect(watch.textContent).toContain('Xem trên YouTube')
    const close = document.querySelector<HTMLElement>('[data-test="music-close"]')!
    expect(document.activeElement).toBe(close)
    expect(document.documentElement.classList.contains('fp-dialog-open')).toBe(true)

    // Tab from the last control wraps to the first, Shift+Tab from the first to the last.
    ;(watch as HTMLElement).focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(close)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(watch)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.querySelector('[data-test="music-iframe"]')).toBeNull()
    expect(document.activeElement).toBe(featured)
    expect(document.documentElement.classList.contains('fp-dialog-open')).toBe(false)

    // The close button and a click on the backdrop close it too.
    await w.get('[data-test="music-item"]').trigger('click')
    await flushPromises()
    expect(document.querySelector('[data-test="music-iframe"]')!.getAttribute('src')).toContain(B)
    document.querySelector<HTMLElement>('[data-test="music-close"]')!.click()
    await flushPromises()
    expect(document.querySelector('[data-test="music-lightbox"]')).toBeNull()
  })

  it('visitors see only tabs with videos; a section with none is left out', async () => {
    const w = await mountHome(home([music({ popular: { label: lt(''), auto: false, items: [] } })], yt({ feeds: { music: { newest: [], popular: [], channel: [] } } })))
    expect(tabs().map((t) => t.dataset.test)).toEqual(['music-tab-newest'])
    expect(w.find('[data-test="music-empty"]').exists()).toBe(false)
    wrapper!.unmount()
    wrapper = undefined
    fake!.restore()
    const empty = music({ newest: { label: lt(''), auto: false, keyword: '', items: [] }, popular: { label: lt(''), auto: false, items: [] } })
    const about = { id: 'v', type: 'about', visible: true, data: { eyebrow: lt(''), heading: lt('Xin chào'), body: lt(''), image: null, imageSide: 'right' } } as HomeSection
    const w2 = await mountHome(home([empty, about], { feeds: { music: { newest: [], popular: [], channel: [] } }, videos: {} }))
    expect(w2.find('[data-section="music"]').exists()).toBe(false)
    expect(w2.find('[data-section="about"]').exists()).toBe(true)
  })

  it('English: tab names and titles fall back sensibly', async () => {
    setLocale('en')
    const w = await mountHome()
    expect(w.get('[data-test="fp-music"] h2').text()).toBe('Music')
    expect(tabs().map((t) => t.textContent!.replace(/\d+/g, '').trim())).toEqual(['New MV', 'Popular MVs', 'Channel videos'])
    // The admin title has no English: the Vietnamese one is shown; an item with none takes YouTube's.
    expect(w.get('[data-test="music-featured"]').text()).toContain('Tên admin đặt')
    expect(w.get('[data-test="music-featured"]').text()).toContain('20 Oct 2026')
  })
})

// --- Admin form ------------------------------------------------------------------------------------------------------

function draft(sections: HomeSection[], o: Partial<HomeDraftDto> = {}): HomeDraftDto {
  return {
    page: 'intro',
    revision: 2,
    sections,
    updatedAt: '2026-10-01T00:00:00Z',
    updatedBy: { username: 'root' },
    publishedAt: '2026-10-01T00:00:00Z',
    publishedBy: { username: 'root' },
    unpublished: false,
    images: {},
    videos: {},
    youtube: yt(),
    ...o,
  }
}
const saveEcho = (req: FakeRequest) => {
  const body = req.body as { revision: number; sections: HomeSection[] }
  return ok(draft(body.sections, { revision: body.revision + 1, unpublished: true }))
}
const statusOf = (apiKey: boolean, feeds: MusicStatusDto['feeds'] = []): MusicStatusDto => ({ apiKey, feeds })

async function mountEditor(sections: HomeSection[], routes: Record<string, FakeRoute> = {}) {
  fake = installFakeFetch({
    'GET /api/admin/site/pages/intro/draft': ok(draft(sections)),
    'PUT /api/admin/site/pages/intro/draft': saveEcho,
    'GET /api/admin/site/images': ok([]),
    'GET /api/feed/showcase': ok({ items: [], nextCursor: null }),
    'GET /api/admin/site/music': ok(statusOf(false, [{ key: `channel:${CH}`, count: 3, fetchedAt: '2026-10-27T08:00:00Z', attemptAt: '2026-10-27T09:00:00Z', error: 'www.youtube.com: HTTP 500', errorAt: '2026-10-27T09:00:00Z' }])),
    'POST /api/admin/site/music/refresh': { status: 202, body: { queued: true } },
    ...routes,
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.ready = true
  auth.setSession({ accessToken: 't', user: makeMe({ id: 'u1', role: 'admin' }) })
  const router = createAppRouter(createMemoryHistory())
  await router.push('/admin?tab=home')
  wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  await vi.waitFor(async () => {
    await flushPromises()
    expect(wrapper!.find('[data-test="music-form"]').exists()).toBe(true)
  })
  await flushPromises()
  return wrapper
}
const lastSaved = () => fake!.callsTo('PUT /api/admin/site/pages/intro/draft').at(-1)!.body as { sections: HomeSection[] }

describe('Admin → Trang chủ: music section form', () => {
  it('three tab panels; without an API key only the channel tab can be automatic; sync status and errors are shown', async () => {
    const w = await mountEditor([music()])
    for (const g of ['newest', 'popular', 'channel']) expect(w.find(`[data-test="music-group-${g}"]`).exists()).toBe(true)
    const autoNewest = w.get('[data-test="f-music-auto-newest"]').element as HTMLInputElement
    expect(autoNewest.disabled).toBe(true)
    expect((w.get('[data-test="f-music-auto-popular"]').element as HTMLInputElement).disabled).toBe(true)
    expect(w.get('[data-test="music-needs-key-popular"]').text()).toContain('YOUTUBE_API_KEY')
    const autoChannel = w.get('[data-test="f-music-auto-channel"]').element as HTMLInputElement
    expect(autoChannel.disabled).toBe(false)
    expect(autoChannel.checked).toBe(true)
    expect(w.get('[data-test="music-status-channel"]').text()).toContain('3 video')
    expect(w.get('[data-test="music-error-channel"]').text()).toContain('HTTP 500')
    expect(w.get('[data-test="music-api-key"]').text()).toContain('chưa có YOUTUBE_API_KEY')
    // The preview draws the stored data.
    expect(w.get('[data-test="home-preview"] [data-test="music-featured"]').text()).toContain('Tên admin đặt')

    await w.get('[data-test="f-music-auto-channel"]').setValue(false)
    await w.get('[data-test="home-save"]').trigger('click')
    await flushPromises()
    expect((lastSaved().sections[0]!.data as { channel: { auto: boolean } }).channel.auto).toBe(false)
  })

  it('rows: add a video with title/date/views overrides, reorder and remove; invalid links block the save', async () => {
    const w = await mountEditor([music()])
    const group = () => w.get('[data-test="music-items-newest"]')
    expect(group().findAll('[data-test="item-row"]')).toHaveLength(2)
    await group().get('[data-test="item-add"]').trigger('click')
    const rowsN = () => group().findAll('[data-test="item-row"]')
    expect(rowsN()).toHaveLength(3)
    await rowsN()[2]!.get('[data-test="f-music-url"]').setValue('https://www.youtube.com/@hibikiduca')
    expect(rowsN()[2]!.text()).toContain('Không phải liên kết video YouTube')
    await w.get('[data-test="home-save"]').trigger('click')
    await flushPromises()
    expect(fake!.callsTo('PUT /api/admin/site/pages/intro/draft')).toHaveLength(0)
    expect(w.get('[data-test="home-problem"]').text()).toContain('Âm nhạc')

    await rowsN()[2]!.get('[data-test="f-music-url"]').setValue(`https://youtu.be/${D}`)
    await rowsN()[2]!.get('[data-test="f-music-title"]').setValue('MV mới tinh')
    await rowsN()[2]!.get('[data-test="f-music-date"]').setValue('2026-10-26')
    await rowsN()[2]!.get('[data-test="f-music-views"]').setValue('4200')
    await rowsN()[2]!.get('[data-test="item-up"]').trigger('click')
    await rowsN()[2]!.get('[data-test="item-remove"]').trigger('click')
    await w.get('[data-test="home-save"]').trigger('click')
    await flushPromises()
    const items = (lastSaved().sections[0]!.data as { newest: { items: unknown[] } }).newest.items
    expect(items).toEqual([
      { url: `https://youtu.be/${A}`, title: lt('Tên admin đặt'), date: '2026-10-20', views: null },
      { url: `https://youtu.be/${D}`, title: lt('MV mới tinh'), date: '2026-10-26', views: 4200 },
    ])
  })

  it('with an API key the MV tabs can be automatic (newest with a title keyword); "Làm mới ngay" queues a refresh', async () => {
    const w = await mountEditor([music()], { 'GET /api/admin/site/music': ok(statusOf(true)) })
    const autoPopular = w.get('[data-test="f-music-auto-popular"]')
    expect((autoPopular.element as HTMLInputElement).disabled).toBe(false)
    await autoPopular.setValue(true)
    await w.get('[data-test="f-music-auto-newest"]').setValue(true)
    await w.get('[data-test="f-music-keyword"]').setValue('Official')
    expect(w.get('[data-test="music-status-popular"]').text()).toContain('Chưa lấy lần nào')
    await w.get('[data-test="music-refresh"]').trigger('click')
    await flushPromises()
    expect(fake!.callsTo('POST /api/admin/site/music/refresh')).toHaveLength(1)
    expect(document.body.textContent).toContain('Đã yêu cầu làm mới')
    await w.get('[data-test="home-save"]').trigger('click')
    await flushPromises()
    expect(lastSaved().sections[0]!.data).toMatchObject({ newest: { auto: true, keyword: 'Official' }, popular: { auto: true } })
  })

  it('the preview shows empty tabs with a hint for the admin; a new music section starts on Du Ca\'s channel', async () => {
    const empty = music({ newest: { label: lt(''), auto: false, keyword: '', items: [] }, popular: { label: lt(''), auto: false, items: [] } })
    const w = await mountEditor([empty], { 'GET /api/admin/site/pages/intro/draft': ok(draft([empty], { youtube: { feeds: {}, videos: {} } })) })
    const preview = w.get('[data-test="home-preview"]')
    expect(preview.findAll('[role="tab"]')).toHaveLength(3)
    expect(preview.get('[data-test="music-empty"]').text()).toContain('Chưa có MV nào')
    await preview.get('[data-test="music-tab-channel"]').trigger('click')
    expect(preview.get('[data-test="music-empty"]').text()).toContain('Chưa có video nào từ kênh')

    await w.get('[data-test="add-type"]').setValue('music')
    await w.get('[data-test="add-section"]').trigger('click')
    await flushPromises()
    expect((w.get('[data-test="f-channel-id"]').element as HTMLInputElement).value).toBe(CH)
    await w.get('[data-test="f-channel-id"]').setValue('@hibikiduca')
    expect(w.text()).toContain('Không phải ID kênh')
  })
})

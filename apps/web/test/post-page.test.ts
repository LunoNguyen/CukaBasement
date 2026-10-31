import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { i18n } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import type { MeDto, PostDto } from '@/api/types'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRoute } from './fakeApi'
import { comment, media, postDto, publicUser } from './fixtures'

let fake: FakeFetch | undefined
let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  fake?.restore()
  fake = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

const lb = () => document.body.querySelector<HTMLElement>('[data-test="lightbox"]')
const ok = (body: unknown) => ({ status: 200, body })
const page = (items: unknown[], nextCursor: string | null = null) => ok({ items, nextCursor })
const other = () => makeMe({ id: 'u2', profile: { ...makeMe().profile, username: 'other', displayName: 'Other' } })

function routes(post: PostDto | FakeRoute, extra: Record<string, FakeRoute> = {}): Record<string, FakeRoute> {
  return {
    'GET /api/posts/p1': 'id' in post ? ok(post) : (post as FakeRoute),
    'GET /api/posts/p1/comments': page([]),
    'GET /api/users/cuka': ok(publicUser()),
    'GET /api/users/cuka/posts': page([]),
    ...extra,
  }
}

async function mountPost(user: MeDto | null = null, path = '/posts/p1') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.ready = true
  if (user) auth.setSession({ accessToken: 't', user })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  await flushPromises()
  return { w: wrapper, router }
}

describe('Post page — media', () => {
  it('null media → placeholder, polls every 5s, stops when url arrives (fake timers)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = postDto({ media: [media({ status: 'processing', thumbSmUrl: null, thumbMdUrl: null })] })
    fake = installFakeFetch(routes([ok(pending), ok(pending), ok(postDto())]))
    const { w } = await mountPost()
    expect(w.text()).toContain('Đang xử lý…')
    expect(w.find('[data-test="media-main"]').exists()).toBe(false)
    expect(fake.callsTo('GET /api/posts/p1')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(fake.callsTo('GET /api/posts/p1')).toHaveLength(2)
    expect(w.text()).toContain('Đang xử lý…')

    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(fake.callsTo('GET /api/posts/p1')).toHaveLength(3)
    expect(w.get('[data-test="media-main"]').attributes('src')).toBe('http://cdn/md.webp')

    await vi.advanceTimersByTimeAsync(30000)
    await flushPromises()
    expect(fake.callsTo('GET /api/posts/p1')).toHaveLength(3)
  })

  it('polls at most 12 times while media stays null', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = postDto({ media: [media({ status: 'processing', thumbSmUrl: null, thumbMdUrl: null })] })
    fake = installFakeFetch(routes(pending))
    await mountPost()
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(5000)
      await flushPromises()
    }
    expect(fake.callsTo('GET /api/posts/p1')).toHaveLength(13)
  })

  it('stops polling the old post when the route id changes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = postDto({ media: [media({ status: 'processing', thumbSmUrl: null, thumbMdUrl: null })] })
    fake = installFakeFetch(routes(pending, { 'GET /api/posts/p2': ok(postDto({ id: 'p2', title: 'Chó' })), 'GET /api/posts/p2/comments': page([]) }))
    const { w, router } = await mountPost()
    await router.push('/posts/p2')
    await flushPromises()
    expect(w.text()).toContain('Chó')
    await vi.advanceTimersByTimeAsync(30000)
    await flushPromises()
    expect(fake.callsTo('GET /api/posts/p1')).toHaveLength(1)
    expect(fake.callsTo('GET /api/posts/p2')).toHaveLength(1)
  })

  it('blurred r18 shows overlay with login button when logged out', async () => {
    fake = installFakeFetch(routes(postDto({ rating: 'r18', media: [media({ thumbMdUrl: 'http://cdn/blur.webp', blurred: true })] })))
    const { w } = await mountPost()
    expect(w.get('[data-test="media-main"]').attributes('src')).toBe('http://cdn/blur.webp')
    const overlay = w.get('[data-test="r18-overlay"]')
    expect(overlay.text()).toContain('Nội dung R18')
    const login = overlay.get('a')
    expect(login.text()).toBe('Đăng nhập')
    expect(login.attributes('href')).toBe('/login?next=/posts/p1')
  })

  it('blurred r18 for a logged-in viewer links to settings', async () => {
    fake = installFakeFetch(routes(postDto({ rating: 'r18', media: [media({ thumbMdUrl: 'http://cdn/blur.webp', blurred: true })] })))
    const { w } = await mountPost(other())
    const link = w.get('[data-test="r18-overlay"] a')
    expect(link.text()).toBe('Bật hiển thị R18 trong Cài đặt')
    expect(link.attributes('href')).toBe('/settings')
  })

  it('the explicit original control opens the original; 404 shows the restricted toast', async () => {
    const win = { opener: {}, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
    fake = installFakeFetch(routes(postDto(), { 'GET /api/posts/p1/files/f1/url': [ok({ url: 'http://s3/orig.png' }), { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }] }))
    const { w } = await mountPost()
    await w.get('[data-test="open-original"]').trigger('click')
    await flushPromises()
    expect(win.location.href).toBe('http://s3/orig.png')
    await w.get('[data-test="open-original"]').trigger('click')
    await flushPromises()
    expect(win.close).toHaveBeenCalled()
    expect(w.text()).toContain('Chỉ người đăng và kiểm duyệt viên được tải bản gốc')
  })

  it('video play fetches file url then sets <video src>', async () => {
    fake = installFakeFetch(
      routes(postDto({ type: 'video', media: [media({ kind: 'video', thumbMdUrl: 'http://cdn/md.webp', previewUrl: 'http://cdn/poster.webp' })] }), {
        'GET /api/posts/p1/files/f1/url': ok({ url: 'http://s3/clip.mp4' }),
      }),
    )
    const { w } = await mountPost()
    const video = w.get('video')
    expect(video.attributes('poster')).toBe('http://cdn/poster.webp')
    expect(video.attributes('controls')).toBeDefined()
    expect(video.attributes('src')).toBeUndefined()
    expect(fake.callsTo('GET /api/posts/p1/files/f1/url')).toHaveLength(0)
    expect(w.find('[data-test="play"]').exists()).toBe(false)
    // The native control's play fires `play` on the element even without a source.
    await video.trigger('play')
    await flushPromises()
    expect(fake.callsTo('GET /api/posts/p1/files/f1/url')).toHaveLength(1)
    expect(w.get('video').attributes('src')).toBe('http://s3/clip.mp4')
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    await video.trigger('play')
    await flushPromises()
    expect(fake.callsTo('GET /api/posts/p1/files/f1/url')).toHaveLength(1)
  })

  it('audio native play fetches the url too', async () => {
    fake = installFakeFetch(routes(postDto({ type: 'audio', media: [media({ kind: 'audio', thumbSmUrl: null })] }), { 'GET /api/posts/p1/files/f1/url': ok({ url: 'http://s3/a.mp3' }) }))
    const { w } = await mountPost()
    await w.get('audio').trigger('play')
    await flushPromises()
    expect(w.get('audio').attributes('src')).toBe('http://s3/a.mp3')
  })

  it('a media error (expired url) re-fetches once and restores currentTime', async () => {
    fake = installFakeFetch(
      routes(postDto({ type: 'video', media: [media({ kind: 'video', thumbMdUrl: 'http://cdn/md.webp', previewUrl: 'http://cdn/poster.webp' })] }), {
        'GET /api/posts/p1/files/f1/url': [ok({ url: 'http://s3/old.mp4' }), ok({ url: 'http://s3/new.mp4' }), ok({ url: 'http://s3/third.mp4' })],
      }),
    )
    const { w } = await mountPost()
    const video = w.get('video')
    const el = video.element as HTMLVideoElement
    Object.defineProperty(el, 'currentTime', { value: 0, writable: true, configurable: true })
    await video.trigger('play')
    await flushPromises()
    el.currentTime = 42
    await video.trigger('error')
    await flushPromises()
    expect(fake.callsTo('GET /api/posts/p1/files/f1/url')).toHaveLength(2)
    expect(video.attributes('src')).toBe('http://s3/new.mp4')
    el.currentTime = 0 // a new source starts from zero
    await video.trigger('loadedmetadata')
    expect(el.currentTime).toBe(42)

    // A second consecutive failure is not retried again.
    await video.trigger('error')
    await flushPromises()
    expect(fake.callsTo('GET /api/posts/p1/files/f1/url')).toHaveLength(2)
    expect(w.text()).toContain('Đã xảy ra lỗi, vui lòng thử lại sau')
  })

  it('originals open from a keyboard-focusable button with a label', async () => {
    const win = { opener: {}, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
    fake = installFakeFetch(routes(postDto(), { 'GET /api/posts/p1/files/f1/url': ok({ url: 'http://s3/orig.png' }) }))
    const { w } = await mountPost()
    const btn = w.get('[data-test="open-original"]')
    expect(btn.element.tagName).toBe('BUTTON')
    expect(btn.attributes('type')).toBe('button')
    expect(btn.attributes('aria-label')).toBe('Mở bản gốc: Mèo')
    ;(btn.element as HTMLButtonElement).focus()
    expect(document.activeElement).toBe(btn.element)
    // jsdom has no keyboard activation behaviour: Enter on a native <button> is delivered as a click.
    await btn.trigger('keydown', { key: 'Enter' })
    await btn.trigger('click')
    await flushPromises()
    expect(win.location.href).toBe('http://s3/orig.png')
  })

  it('manga pages are buttons that open the lightbox at that page, not the original', async () => {
    const open = vi.spyOn(window, 'open')
    fake = installFakeFetch(
      routes(postDto({ type: 'manga', media: [media({ thumbMdUrl: 'http://cdn/1.webp' }), media({ fileId: 'f2', position: 1, thumbMdUrl: 'http://cdn/2.webp' })] })),
    )
    const { w } = await mountPost()
    const buttons = w.findAll('[data-test="zoom-open"]')
    expect(buttons.map((b) => b.attributes('aria-label'))).toEqual(['Xem ảnh lớn: Mèo — trang 1', 'Xem ảnh lớn: Mèo — trang 2'])
    await buttons[1]!.trigger('click')
    await flushPromises()
    expect(open).not.toHaveBeenCalled()
    expect(fake.callsTo('GET /api/posts/p1/files/f2/url')).toHaveLength(0)
    expect(lb()!.querySelector('[data-test="lightbox-img"]')!.getAttribute('src')).toBe('http://cdn/2.webp')
    expect(lb()!.querySelector('[data-test="lightbox-indicator"]')!.textContent!.trim()).toBe('2 / 2')
  })

  it('failed files show a failure state, not processing', async () => {
    fake = installFakeFetch(routes(postDto({ media: [media({ status: 'failed', thumbSmUrl: null, thumbMdUrl: null })] })))
    const { w } = await mountPost()
    expect(w.text()).toContain('Xử lý tệp thất bại')
    expect(w.text()).not.toContain('Đang xử lý…')
  })

  it('manga renders every page vertically', async () => {
    fake = installFakeFetch(
      routes(postDto({ type: 'manga', media: [media({ thumbMdUrl: 'http://cdn/1.webp' }), media({ fileId: 'f2', position: 1, thumbMdUrl: 'http://cdn/2.webp' })] })),
    )
    const { w } = await mountPost()
    expect(w.findAll('[data-test="manga-page"]').map((i) => i.attributes('src'))).toEqual(['http://cdn/1.webp', 'http://cdn/2.webp'])
  })
})

describe('Post page — gallery and lightbox', () => {
  const gallery = (o: Partial<PostDto> = {}) =>
    postDto({
      media: [1, 2, 3, 4].map((n) =>
        media({ fileId: `f${n}`, position: n - 1, isCover: n === 1, thumbSmUrl: `http://cdn/s${n}.webp`, thumbMdUrl: `http://cdn/md${n}.webp`, previewUrl: n === 2 ? null : `http://cdn/p${n}.webp` }),
      ),
      ...o,
    })
  const key = (el: Element, k: string, o: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }))
  const q = (sel: string) => lb()!.querySelector<HTMLElement>(sel)!

  it('overlay prev/next buttons and the "n / total" indicator; navigation wraps at both ends', async () => {
    fake = installFakeFetch(routes(gallery()))
    const { w } = await mountPost()
    const prev = w.get('[data-test="media-prev"]')
    const next = w.get('[data-test="media-next"]')
    expect(prev.element.tagName).toBe('BUTTON')
    expect(prev.attributes('aria-label')).toBe('Ảnh trước')
    expect(next.attributes('aria-label')).toBe('Ảnh sau')
    expect(w.get('[data-test="page-indicator"]').text()).toBe('1 / 4')
    expect(w.get('[data-test="page-indicator"]').attributes('aria-label')).toBe('Ảnh 1 trên 4')
    await next.trigger('click')
    expect(w.get('[data-test="media-main"]').attributes('src')).toBe('http://cdn/md2.webp')
    expect(w.get('[data-test="page-indicator"]').text()).toBe('2 / 4')
    expect(w.findAll('[data-test="gallery-thumb"]')[1]!.attributes('aria-current')).toBe('true')
    await prev.trigger('click')
    await prev.trigger('click')
    expect(w.get('[data-test="page-indicator"]').text()).toBe('4 / 4')
    expect(w.get('[data-test="media-main"]').attributes('src')).toBe('http://cdn/md4.webp')
    await next.trigger('click')
    expect(w.get('[data-test="page-indicator"]').text()).toBe('1 / 4')
    await w.findAll('[data-test="gallery-thumb"]')[2]!.trigger('click')
    expect(w.get('[data-test="page-indicator"]').text()).toBe('3 / 4')
  })

  it('a single image has no arrows, indicator or strip', async () => {
    fake = installFakeFetch(routes(postDto()))
    const { w } = await mountPost()
    expect(w.find('[data-test="media-prev"]').exists()).toBe(false)
    expect(w.find('[data-test="page-indicator"]').exists()).toBe(false)
    expect(w.find('[data-test="gallery-strip"]').exists()).toBe(false)
  })

  it('←/→ navigate while focus is inside the gallery, but not from elsewhere on the page', async () => {
    fake = installFakeFetch(routes(gallery()))
    const { w } = await mountPost()
    const indicator = () => w.get('[data-test="page-indicator"]').text()
    key(document.body, 'ArrowRight')
    await flushPromises()
    expect(indicator()).toBe('1 / 4')
    const main = w.get('[data-test="zoom-open"]').element as HTMLElement
    main.focus()
    key(main, 'ArrowRight')
    await flushPromises()
    expect(indicator()).toBe('2 / 4')
    key(w.get('[data-test="gallery-thumb"]').element, 'ArrowLeft')
    await flushPromises()
    expect(indicator()).toBe('1 / 4')
    key(main, 'ArrowLeft')
    await flushPromises()
    expect(indicator()).toBe('4 / 4')
  })

  it('clicking the image opens the lightbox (best public variant), not the original; Esc closes and restores focus and scroll', async () => {
    const open = vi.spyOn(window, 'open')
    fake = installFakeFetch(routes(gallery()))
    const { w } = await mountPost()
    const main = w.get('[data-test="zoom-open"]')
    expect(main.attributes('aria-label')).toBe('Xem ảnh lớn: Mèo — trang 1')
    ;(main.element as HTMLElement).focus()
    await w.get('[data-test="media-main"]').trigger('click')
    await flushPromises()
    expect(open).not.toHaveBeenCalled()
    expect(fake.callsTo('GET /api/posts/p1/files/f1/url')).toHaveLength(0)
    const dialog = lb()!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('Trình xem ảnh: Mèo')
    expect(q('[data-test="lightbox-img"]').getAttribute('src')).toBe('http://cdn/p1.webp')
    expect(q('[data-test="lightbox-indicator"]').textContent!.trim()).toBe('1 / 4')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.activeElement).toBe(q('[data-test="lightbox-close"]'))
    key(document.activeElement!, 'Escape')
    await flushPromises()
    expect(lb()).toBeNull()
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(main.element)
  })

  it('lightbox prev/next and arrow keys move through images and keep the page viewer in step; falls back to thumb_md', async () => {
    fake = installFakeFetch(routes(gallery()))
    const { w } = await mountPost()
    await w.get('[data-test="zoom-open"]').trigger('click')
    await flushPromises()
    q('[data-test="lightbox-next"]').click()
    await flushPromises()
    expect(q('[data-test="lightbox-img"]').getAttribute('src')).toBe('http://cdn/md2.webp')
    expect(q('[data-test="lightbox-prev"]').getAttribute('aria-label')).toBe('Ảnh trước')
    key(lb()!, 'ArrowRight')
    await flushPromises()
    expect(q('[data-test="lightbox-indicator"]').textContent!.trim()).toBe('3 / 4')
    key(lb()!, 'ArrowLeft')
    key(lb()!, 'ArrowLeft')
    key(lb()!, 'ArrowLeft')
    await flushPromises()
    expect(q('[data-test="lightbox-indicator"]').textContent!.trim()).toBe('4 / 4')
    q('[data-test="lightbox-close"]').click()
    await flushPromises()
    expect(lb()).toBeNull()
    expect(w.get('[data-test="page-indicator"]').text()).toBe('4 / 4')
  })

  it('zoom: buttons, wheel, ctrl+wheel, double-click toggles 1x/2x, keys; reset on page change', async () => {
    fake = installFakeFetch(routes(gallery()))
    const { w } = await mountPost()
    await w.get('[data-test="zoom-open"]').trigger('click')
    await flushPromises()
    const level = () => q('[data-test="zoom-level"]').textContent!.trim()
    expect(level()).toBe('100%')
    expect(q('[data-test="zoom-out"]').hasAttribute('disabled')).toBe(true)
    expect(q('[data-test="zoom-in"]').getAttribute('aria-label')).toBe('Phóng to')
    q('[data-test="zoom-in"]').click()
    await flushPromises()
    expect(level()).toBe('150%')
    expect(q('[data-test="lightbox-img"]').style.transform).toContain('scale(1.5)')
    q('[data-test="zoom-out"]').click()
    await flushPromises()
    expect(level()).toBe('100%')

    const img = q('[data-test="lightbox-img"]')
    img.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await flushPromises()
    expect(level()).toBe('200%')
    img.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await flushPromises()
    expect(level()).toBe('100%')

    const wheel = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true })
    q('[data-test="lightbox-stage"]').dispatchEvent(wheel)
    await flushPromises()
    expect(wheel.defaultPrevented).toBe(true)
    expect(parseInt(level())).toBeGreaterThan(100)
    q('[data-test="lightbox-stage"]').dispatchEvent(new WheelEvent('wheel', { deltaY: 5000, ctrlKey: true, bubbles: true, cancelable: true }))
    await flushPromises()
    expect(level()).toBe('100%')

    key(lb()!, '+')
    await flushPromises()
    expect(level()).toBe('150%')
    key(lb()!, 'ArrowRight')
    await flushPromises()
    expect(level()).toBe('100%')
  })

  it('focus is trapped inside the lightbox', async () => {
    fake = installFakeFetch(routes(gallery()))
    const { w } = await mountPost()
    await w.get('[data-test="zoom-open"]').trigger('click')
    await flushPromises()
    const last = q('[data-test="lightbox-next"]')
    last.focus()
    key(last, 'Tab')
    expect(document.activeElement).toBe(q('[data-test="zoom-level"]'))
    key(document.activeElement!, 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('the lightbox has an explicit original control that keeps the download permission behaviour', async () => {
    const win = { opener: {}, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
    fake = installFakeFetch(routes(gallery(), { 'GET /api/posts/p1/files/f2/url': { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } } }))
    const { w } = await mountPost()
    await w.get('[data-test="media-next"]').trigger('click')
    await w.get('[data-test="zoom-open"]').trigger('click')
    await flushPromises()
    expect(q('[data-test="lightbox-original"]').getAttribute('aria-label')).toBe('Mở bản gốc: Mèo — trang 2')
    q('[data-test="lightbox-original"]').click()
    await flushPromises()
    expect(fake.callsTo('GET /api/posts/p1/files/f2/url')).toHaveLength(1)
    expect(win.close).toHaveBeenCalled()
    expect(w.text()).toContain('Chỉ người đăng và kiểm duyệt viên được tải bản gốc')
  })

  it('blurred r18: no lightbox, arrows, strip or original control, and nothing but the blurred cover reaches the DOM', async () => {
    const blurredPost = postDto({
      rating: 'r18',
      media: [1, 2, 3].map((n) => media({ fileId: `f${n}`, position: n - 1, isCover: n === 1, thumbSmUrl: 'http://cdn/blur.webp', thumbMdUrl: 'http://cdn/blur.webp', blurred: true })),
    })
    const open = vi.spyOn(window, 'open')
    fake = installFakeFetch(routes(blurredPost))
    const { w } = await mountPost()
    for (const t of ['zoom-open', 'media-prev', 'page-indicator', 'gallery-thumb', 'open-original']) expect(w.find(`[data-test="${t}"]`).exists()).toBe(false)
    await w.get('[data-test="media-main"]').trigger('click')
    key(w.get('[data-test="media-main"]').element, 'ArrowRight')
    await flushPromises()
    expect(lb()).toBeNull()
    expect(open).not.toHaveBeenCalled()
    expect(fake.callsTo('GET /api/posts/p1/files/f1/url')).toHaveLength(0)
    const srcs = Array.from(document.querySelectorAll('img')).map((i) => i.getAttribute('src'))
    expect(srcs.filter((s) => s?.startsWith('http://cdn/') && s !== 'http://cdn/blur.webp')).toEqual([])
  })

  it('the lightbox itself refuses blurred files', async () => {
    const { default: MediaLightbox } = await import('@/components/post/MediaLightbox.vue')
    wrapper = mount(MediaLightbox, {
      props: { open: true, index: 0, title: 'x', items: [media({ thumbMdUrl: 'http://cdn/blur.webp', previewUrl: 'http://cdn/p.webp', blurred: true })] },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    await flushPromises()
    expect(lb()).toBeNull()
  })
})

describe('Post page — credit and owner tools', () => {
  it('compact credit block: "Art by Funo · @funo_yun · X", the repost and no-AI chips; own work shows © @username; no sticker', async () => {
    const repost = postDto({
      credit: { isOwnWork: false, artistName: 'Funo', artistHandle: 'funo_yun', platform: 'x', sourceUrl: 'https://x.com/funo_yun/status/1', permissionNote: 'đã hỏi qua DM' },
    })
    fake = installFakeFetch(routes(repost))
    let { w } = await mountPost()
    const credit = w.get('[data-test="credit"]')
    expect(credit.attributes('aria-labelledby')).toBe(credit.get('h2').attributes('id'))
    expect(credit.get('h2').text()).toBe('Nguồn tác phẩm')
    expect(credit.get('[data-test="credit-line"]').text()).toBe('Art by Funo · @funo_yun · X')
    expect(credit.get('[data-test="credit-name"]').element.tagName).toBe('STRONG')
    // The old hang-tag sticker is gone: no logo, no shadow, no display font.
    expect(credit.find('svg[viewBox="0 0 100 100"]').exists()).toBe(false)
    expect(credit.classes().some((c) => c.startsWith('shadow'))).toBe(false)
    expect(credit.html()).not.toContain('font-display')
    expect(credit.get('[data-test="credit-name"]').text()).toBe('Funo')
    expect(credit.get('[data-test="credit-handle"]').text()).toBe('@funo_yun · X')
    expect(credit.get('[data-test="credit-kind"]').text()).toBe('Đăng lại · đã xin phép')
    expect(credit.get('[data-test="no-ai"]').text()).toBe('Không dùng AI')
    expect(credit.text()).toContain('Ghi chú xin phép: đã hỏi qua DM')
    expect(credit.get('[data-test="source-link"]').attributes('href')).toBe('https://x.com/funo_yun/status/1')
    w.unmount()
    fake.restore()

    fake = installFakeFetch(routes(postDto()))
    ;({ w } = await mountPost())
    const own = w.get('[data-test="credit"]')
    expect(own.get('[data-test="credit-name"]').text()).toBe('Cuka')
    expect(own.get('[data-test="credit-handle"]').text()).toBe('© @cuka')
    expect(own.get('[data-test="credit-line"]').text()).toBe('Art by Cuka · © @cuka')
    expect(own.get('[data-test="credit-handle"] a').attributes('href')).toBe('/u/cuka')
    expect(own.get('[data-test="credit-kind"]').text()).toBe('Tác phẩm gốc')
    expect(own.find('[data-test="no-ai"]').exists()).toBe(true)
    expect(own.find('[data-test="source-link"]').exists()).toBe(false)
  })

  it('a name-only repost credit shows the name once and the platform alone underneath', async () => {
    const repost = postDto({
      credit: { isOwnWork: false, artistName: 'Ruri', artistHandle: '', platform: 'pixiv', sourceUrl: 'https://pixiv.net/a/1', permissionNote: '' },
    })
    fake = installFakeFetch(routes(repost))
    const { w } = await mountPost()
    expect(w.get('[data-test="credit-name"]').text()).toBe('Ruri')
    expect(w.get('[data-test="credit-handle"]').text()).toBe('pixiv')
    expect(w.get('[data-test="credit-line"]').text()).toBe('Art by Ruri · pixiv')
  })

  it('shows type and rating badges; R18 uses the pink tint', async () => {
    fake = installFakeFetch(routes(postDto({ rating: 'r18' })))
    const { w } = await mountPost()
    expect(w.get('[data-test="type-badge"]').text()).toBe('Tranh')
    expect(w.get('[data-test="rating-badge"]').text()).toBe('R18')
    expect(w.get('[data-test="rating-badge"]').classes()).toContain('badge-r18')
  })

  it('owner sees pending badge and edit/delete; others do not', async () => {
    fake = installFakeFetch(routes(postDto({ review: { status: 'pending' } })))
    let { w } = await mountPost(makeMe())
    expect(w.text()).toContain('Đang chờ duyệt')
    expect(w.get('[data-test="edit-post"]').attributes('href')).toBe('/posts/p1/edit')
    expect(w.find('[data-test="delete-post"]').exists()).toBe(true)
    w.unmount()

    ;({ w } = await mountPost(other()))
    expect(w.text()).not.toContain('Đang chờ duyệt')
    expect(w.find('[data-test="edit-post"]').exists()).toBe(false)
    expect(w.find('[data-test="delete-post"]').exists()).toBe(false)
  })

  it('reloads when the session changes: logout drops owner data, login brings it back', async () => {
    const pending = postDto({ review: { status: 'pending' }, viewerState: { liked: true, bookmarked: false } })
    fake = installFakeFetch(
      routes((req) =>
        req.headers.authorization ? ok(pending) : { status: 404, body: { error: { code: 'POST_NOT_FOUND', message: 'x' } } },
      ),
    )
    const { w } = await mountPost(makeMe())
    expect(w.text()).toContain('Đang chờ duyệt')
    const auth = useAuth()
    auth.clear()
    await flushPromises()
    expect(fake.callsTo('GET /api/posts/p1')).toHaveLength(2)
    expect(fake.callsTo('GET /api/posts/p1')[1]!.headers.authorization).toBeUndefined()
    expect(w.text()).not.toContain('Đang chờ duyệt')
    expect(w.text()).toContain('Không tìm thấy bài đăng')

    auth.setSession({ accessToken: 't2', user: makeMe() })
    await flushPromises()
    expect(fake.callsTo('GET /api/posts/p1')).toHaveLength(3)
    expect(w.text()).toContain('Đang chờ duyệt')
  })

  it('owner sees the rejection reason', async () => {
    fake = installFakeFetch(routes(postDto({ review: { status: 'rejected', reason: 'Thiếu nguồn' } })))
    const { w } = await mountPost(makeMe())
    expect(w.text()).toContain('Bị từ chối: Thiếu nguồn')
  })

  it('review badge only for pending/rejected', async () => {
    fake = installFakeFetch(routes(postDto({ review: { status: 'approved', reason: 'cũ' } })))
    let { w } = await mountPost(makeMe())
    expect(w.find('[data-test="review-badge"]').exists()).toBe(false)
    w.unmount()

    // A status this client does not know about (added server-side later) is not shown as a rejection.
    fake.restore()
    fake = installFakeFetch(routes(postDto({ review: { status: 'escalated' as never } })))
    ;({ w } = await mountPost(makeMe()))
    expect(w.find('[data-test="review-badge"]').exists()).toBe(false)
    expect(w.text()).not.toContain('Bị từ chối')
  })

  it('delete confirms, calls DELETE and goes to the gallery', async () => {
    fake = installFakeFetch(routes(postDto(), { 'DELETE /api/posts/p1': { status: 204 }, 'GET /api/feed/home': page([]), 'GET /api/tags/featured': ok([]) }))
    const { w, router } = await mountPost(makeMe())
    await w.get('[data-test="delete-post"]').trigger('click')
    expect(fake.callsTo('DELETE /api/posts/p1')).toHaveLength(0)
    ;(document.querySelector('[data-test="confirm-delete"]') as HTMLElement).click()
    await flushPromises()
    expect(fake.callsTo('DELETE /api/posts/p1')).toHaveLength(1)
    expect(router.currentRoute.value.path).toBe('/')
    expect(w.text()).toContain('Đã xóa bài đăng')
  })
})

describe('Post page — interactions', () => {
  it('like is optimistic and reverts on 500', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    fake = installFakeFetch(
      routes(postDto(), {
        'POST /api/posts/p1/like': async () => {
          await gate
          return { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }
        },
      }),
    )
    const { w } = await mountPost(other())
    const like = () => w.get('[data-test="like"]')
    expect(like().attributes('aria-pressed')).toBe('false')
    expect(like().text()).toContain('7')
    await like().trigger('click')
    expect(like().attributes('aria-pressed')).toBe('true')
    expect(like().text()).toContain('8')
    release()
    await flushPromises()
    expect(like().attributes('aria-pressed')).toBe('false')
    expect(like().text()).toContain('7')
    expect(w.text()).toContain('Đã xảy ra lỗi, vui lòng thử lại sau')
  })

  it('bookmark private sends isPrivate', async () => {
    fake = installFakeFetch(routes(postDto(), { 'POST /api/posts/p1/bookmark': ok({ bookmarked: true, bookmarks: 3 }) }))
    const { w } = await mountPost(other())
    await w.get('[data-test="bookmark-menu"]').trigger('click')
    await w.get('[data-test="bookmark-private"]').trigger('click')
    await flushPromises()
    expect(fake.callsTo('POST /api/posts/p1/bookmark')[0]!.body).toEqual({ isPrivate: true })
    expect(w.get('[data-test="bookmark"]').attributes('aria-pressed')).toBe('true')
    expect(w.get('[data-test="bookmark"]').text()).toContain('3')
  })

  it('bookmark menu closes on Escape and on outside click', async () => {
    fake = installFakeFetch(routes(postDto()))
    const { w } = await mountPost(other())
    await w.get('[data-test="bookmark-menu"]').trigger('click')
    expect(w.find('[data-test="bookmark-private"]').exists()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(w.find('[data-test="bookmark-private"]').exists()).toBe(false)

    await w.get('[data-test="bookmark-menu"]').trigger('click')
    expect(w.find('[data-test="bookmark-private"]').exists()).toBe(true)
    ;(w.get('h1').element as HTMLElement).click()
    await flushPromises()
    expect(w.find('[data-test="bookmark-private"]').exists()).toBe(false)
    expect(fake.callsTo('POST /api/posts/p1/bookmark')).toHaveLength(0)
  })

  it('share opens the system share sheet when there is one; closing it copies nothing', async () => {
    const shareFn = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: shareFn, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      fake = installFakeFetch(routes(postDto()))
      const { w } = await mountPost()
      const btn = w.get('[data-test="share"]')
      expect(btn.element.tagName).toBe('BUTTON')
      expect(btn.text()).toContain('Chia sẻ')
      await btn.trigger('click')
      await flushPromises()
      expect(shareFn).toHaveBeenCalledWith({ title: 'Mèo', url: `${location.origin}/og/posts/p1` })
      expect(writeText).not.toHaveBeenCalled()

      shareFn.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
      await btn.trigger('click')
      await flushPromises()
      expect(writeText).not.toHaveBeenCalled()
      expect(w.text()).not.toContain('Đã sao chép liên kết')
    } finally {
      Reflect.deleteProperty(navigator, 'share')
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('share falls back to copying the link when the share sheet fails', async () => {
    const shareFn = vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: shareFn, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      fake = installFakeFetch(routes(postDto()))
      const { w } = await mountPost()
      await w.get('[data-test="share"]').trigger('click')
      await flushPromises()
      expect(writeText).toHaveBeenCalledWith(`${location.origin}/og/posts/p1`)
      expect(w.text()).toContain('Đã sao chép liên kết')
    } finally {
      Reflect.deleteProperty(navigator, 'share')
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('share copies the OG link where there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    fake = installFakeFetch(routes(postDto()))
    const { w } = await mountPost()
    await w.get('[data-test="share"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/og/posts/p1`)
    expect(w.text()).toContain('Đã sao chép liên kết')
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('report ai_art posts reason; second time 409 shows "Bạn đã báo cáo bài này"', async () => {
    fake = installFakeFetch(
      routes(postDto(), {
        'POST /api/posts/p1/report': [ok({ reported: true }), { status: 409, body: { error: { code: 'REPORT_ALREADY_EXISTS', message: 'x' } } }],
      }),
    )
    const { w } = await mountPost(other())
    const submit = async () => {
      await w.get('[data-test="report"]').trigger('click')
      const radio = document.querySelector('input[value="ai_art"]') as HTMLInputElement
      expect(radio.closest('label')!.textContent).toContain('Tranh AI')
      radio.click()
      ;(document.querySelector('[data-test="report-form"]') as HTMLFormElement).dispatchEvent(new Event('submit'))
      await flushPromises()
    }
    await submit()
    expect(fake.callsTo('POST /api/posts/p1/report')[0]!.body).toEqual({ reason: 'ai_art', detail: '' })
    await submit()
    expect(w.text()).toContain('Bạn đã báo cáo bài này')
  })

  it('report is hidden on own post; logged out gets a login prompt', async () => {
    fake = installFakeFetch(routes(postDto()))
    let { w } = await mountPost(makeMe())
    expect(w.find('[data-test="report"]').exists()).toBe(false)
    w.unmount()

    ;({ w } = await mountPost())
    await w.get('[data-test="report"]').trigger('click')
    const link = document.querySelector('[data-test="login-prompt"] a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/login?next=/posts/p1')
    expect(document.querySelector('[data-test="report-form"]')).toBeNull()
  })
})

describe('Post page — author', () => {
  it('shows author card with follow button and more posts excluding current', async () => {
    const { card } = await import('./fixtures')
    fake = installFakeFetch(
      routes(postDto(), {
        'GET /api/users/cuka/posts': page([card({ id: 'p1' }), card({ id: 'p2', title: 'Chó' })]),
        'POST /api/users/cuka/follow': ok({ following: true, followerCount: 4 }),
      }),
    )
    const { w } = await mountPost(other())
    expect(w.text()).toContain('Bài khác của tác giả')
    const more = w.get('[data-test="more-by-author"]')
    expect([...new Set(more.findAll('a[href^="/posts/"]').map((a) => a.attributes('href')))]).toEqual(['/posts/p2'])
    await w.get('[data-test="follow"]').trigger('click')
    await flushPromises()
    expect(fake.callsTo('POST /api/users/cuka/follow')).toHaveLength(1)
    expect(w.get('[data-test="follow"]').text()).toBe('Đang theo dõi')
    expect(w.get('[data-test="user-card"]').text()).toContain('4')
  })

  it('follow button is hidden for self', async () => {
    fake = installFakeFetch(routes(postDto()))
    const { w } = await mountPost(makeMe())
    expect(w.find('[data-test="user-card"]').exists()).toBe(true)
    expect(w.find('[data-test="follow"]').exists()).toBe(false)
  })
})

describe('Post page — comments', () => {
  it('reply button hidden on replies (one level)', async () => {
    const reply = comment({ id: 'c2', parentId: 'c1', body: 'Cảm ơn' })
    fake = installFakeFetch(routes(postDto(), { 'GET /api/posts/p1/comments': page([comment({ replies: [reply] })]) }))
    const { w } = await mountPost(other())
    const items = w.findAll('[data-test="comment"]')
    expect(items).toHaveLength(2)
    expect(items[0]!.find('[data-test="reply"]').exists()).toBe(true)
    expect(items[1]!.find('[data-test="reply"]').exists()).toBe(false)
  })

  it('posts a reply with parentId and appends it', async () => {
    fake = installFakeFetch(
      routes(postDto(), {
        'GET /api/posts/p1/comments': page([comment()]),
        'POST /api/posts/p1/comments': (req) => ok(comment({ id: 'c9', parentId: 'c1', body: (req.body as { body: string }).body })),
      }),
    )
    const { w } = await mountPost(other())
    await w.get('[data-test="reply"]').trigger('click')
    await w.get('[data-test="reply-form"] textarea').setValue('Hay')
    await w.get('[data-test="reply-form"]').trigger('submit')
    await flushPromises()
    expect(fake.callsTo('POST /api/posts/p1/comments')[0]!.body).toEqual({ body: 'Hay', parentId: 'c1' })
    expect(w.findAll('[data-test="comment"]')).toHaveLength(2)
  })

  it('posts a top-level comment and enforces the max length', async () => {
    fake = installFakeFetch(routes(postDto(), { 'POST /api/posts/p1/comments': (req) => ok(comment({ id: 'c9', body: (req.body as { body: string }).body })) }))
    const { w } = await mountPost(other())
    const ta = w.get('[data-test="comment-form"] textarea')
    expect(ta.attributes('maxlength')).toBe('1000')
    await ta.setValue('Xinh')
    await w.get('[data-test="comment-form"]').trigger('submit')
    await flushPromises()
    expect(fake.callsTo('POST /api/posts/p1/comments')[0]!.body).toEqual({ body: 'Xinh' })
    expect(w.text()).toContain('Xinh')
  })

  it('unverified users see a hint instead of the form', async () => {
    fake = installFakeFetch(routes(postDto()))
    const { w } = await mountPost(makeMe({ id: 'u2', emailVerified: false }))
    expect(w.find('[data-test="comment-form"]').exists()).toBe(false)
    expect(w.get('[data-test="verify-hint"]').text()).toContain('Gửi lại email')
  })

  it('hidden comment renders the hidden label; own comment can be deleted', async () => {
    const mine = comment({ id: 'c3', body: 'Của tôi', author: { id: 'u2', username: 'other', displayName: 'Other', avatarUrl: null } })
    fake = installFakeFetch(
      routes(postDto(), {
        'GET /api/posts/p1/comments': page([comment({ status: 'hidden', body: '' }), mine]),
        'DELETE /api/comments/c3': { status: 204 },
      }),
    )
    const { w } = await mountPost(other())
    const items = w.findAll('[data-test="comment"]')
    expect(items[0]!.text()).toContain('Bình luận đã bị ẩn')
    expect(items[0]!.find('[data-test="delete-comment"]').exists()).toBe(false)
    await items[1]!.get('[data-test="delete-comment"]').trigger('click')
    await flushPromises()
    expect(fake.callsTo('DELETE /api/comments/c3')).toHaveLength(0)
    ;(document.querySelector('[data-test="confirm-comment"]') as HTMLElement).click()
    await flushPromises()
    expect(fake.callsTo('DELETE /api/comments/c3')).toHaveLength(1)
    expect(w.text()).not.toContain('Của tôi')
  })

  it('staff can hide a comment after confirming; it then shows as hidden', async () => {
    fake = installFakeFetch(
      routes(postDto(), {
        'GET /api/posts/p1/comments': page([comment({ id: 'c1', body: 'Spam' })]),
        'POST /api/mod/comments/c1/hide': ok({ id: 'c1', status: 'hidden' }),
      }),
    )
    let { w } = await mountPost(other())
    expect(w.find('[data-test="hide-comment"]').exists()).toBe(false)
    w.unmount()

    ;({ w } = await mountPost(makeMe({ id: 'm1', role: 'moderator' })))
    await w.get('[data-test="hide-comment"]').trigger('click')
    expect(fake.callsTo('POST /api/mod/comments/c1/hide')).toHaveLength(0)
    ;(document.querySelector('[data-test="confirm-comment"]') as HTMLElement).click()
    await flushPromises()
    expect(fake.callsTo('POST /api/mod/comments/c1/hide')).toHaveLength(1)
    expect(w.get('[data-test="comment"]').text()).toContain('Bình luận đã bị ẩn')
    expect(w.find('[data-test="hide-comment"]').exists()).toBe(false)
  })

  it('hiding a peer comment shows CANNOT_MODERATE_PEER', async () => {
    fake = installFakeFetch(
      routes(postDto(), {
        'GET /api/posts/p1/comments': page([comment({ id: 'c1' })]),
        'POST /api/mod/comments/c1/hide': { status: 403, body: { error: { code: 'CANNOT_MODERATE_PEER', message: 'x' } } },
      }),
    )
    const { w } = await mountPost(makeMe({ id: 'm1', role: 'moderator' }))
    await w.get('[data-test="hide-comment"]').trigger('click')
    ;(document.querySelector('[data-test="confirm-comment"]') as HTMLElement).click()
    await flushPromises()
    expect(w.text()).toContain('Không thể kiểm duyệt nội dung của kiểm duyệt viên/quản trị viên khác')
    expect(w.get('[data-test="comment"]').text()).not.toContain('Bình luận đã bị ẩn')
  })
})

describe('Post page — staff moderation', () => {
  const mod = () => makeMe({ id: 'm1', role: 'moderator' })
  const modResult = (visibility: string) => ok({ id: 'p1', review: { status: 'approved', by: null, at: null }, visibility })

  it('staff hide a public post, then restore it; non-staff see neither', async () => {
    fake = installFakeFetch(
      routes(postDto(), { 'POST /api/mod/posts/p1/hide': modResult('removed'), 'POST /api/mod/posts/p1/restore': modResult('public') }),
    )
    let { w } = await mountPost(other())
    expect(w.find('[data-test="mod-hide"]').exists()).toBe(false)
    expect(w.find('[data-test="mod-restore"]').exists()).toBe(false)
    w.unmount()

    ;({ w } = await mountPost(mod()))
    expect(w.find('[data-test="mod-restore"]').exists()).toBe(false)
    await w.get('[data-test="mod-hide"]').trigger('click')
    await flushPromises()
    expect(fake.callsTo('POST /api/mod/posts/p1/hide')).toHaveLength(1)
    expect(w.get('[data-test="visibility-badge"]').text()).toBe('Bài đã bị ẩn')
    await w.get('[data-test="mod-restore"]').trigger('click')
    await flushPromises()
    expect(fake.callsTo('POST /api/mod/posts/p1/restore')).toHaveLength(1)
    expect(w.find('[data-test="visibility-badge"]').exists()).toBe(false)
    expect(w.find('[data-test="mod-hide"]').exists()).toBe(true)
  })

  it('hidden_by_reports offers restore; CANNOT_MODERATE_PEER is shown and nothing changes', async () => {
    fake = installFakeFetch(
      routes(postDto({ visibility: 'hidden_by_reports' }), {
        'POST /api/mod/posts/p1/restore': { status: 403, body: { error: { code: 'CANNOT_MODERATE_PEER', message: 'x' } } },
      }),
    )
    const { w } = await mountPost(mod())
    expect(w.find('[data-test="mod-hide"]').exists()).toBe(false)
    await w.get('[data-test="mod-restore"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Không thể kiểm duyệt nội dung của kiểm duyệt viên/quản trị viên khác')
    expect(w.get('[data-test="visibility-badge"]').text()).toBe('Bài đã bị ẩn')
  })

  it('owner sees the hidden badge; other viewers do not', async () => {
    fake = installFakeFetch(routes(postDto({ visibility: 'removed' })))
    let { w } = await mountPost(makeMe())
    expect(w.get('[data-test="visibility-badge"]').text()).toBe('Bài đã bị ẩn')
    w.unmount()
    ;({ w } = await mountPost(other()))
    expect(w.find('[data-test="visibility-badge"]').exists()).toBe(false)
  })
})

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

  it('clicking the image opens the original; 404 shows the restricted toast', async () => {
    const win = { opener: {}, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
    fake = installFakeFetch(routes(postDto(), { 'GET /api/posts/p1/files/f1/url': [ok({ url: 'http://s3/orig.png' }), { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }] }))
    const { w } = await mountPost()
    await w.get('[data-test="media-main"]').trigger('click')
    await flushPromises()
    expect(win.location.href).toBe('http://s3/orig.png')
    await w.get('[data-test="media-main"]').trigger('click')
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

  it('manga pages are buttons that open the original', async () => {
    const win = { opener: {}, location: { href: '' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
    fake = installFakeFetch(
      routes(postDto({ type: 'manga', media: [media({ thumbMdUrl: 'http://cdn/1.webp' }), media({ fileId: 'f2', position: 1, thumbMdUrl: 'http://cdn/2.webp' })] }), {
        'GET /api/posts/p1/files/f2/url': ok({ url: 'http://s3/p2.png' }),
      }),
    )
    const { w } = await mountPost()
    const buttons = w.findAll('[data-test="open-original"]')
    expect(buttons.map((b) => b.attributes('aria-label'))).toEqual(['Mở bản gốc: Mèo — trang 1', 'Mở bản gốc: Mèo — trang 2'])
    await buttons[1]!.trigger('click')
    await flushPromises()
    expect(win.location.href).toBe('http://s3/p2.png')
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

describe('Post page — credit and owner tools', () => {
  it('repost credit shows "Art by @funo_yun · X"; own work shows © @username', async () => {
    const repost = postDto({
      credit: { isOwnWork: false, artistName: 'Funo', artistHandle: 'funo_yun', platform: 'x', sourceUrl: 'https://x.com/funo_yun/status/1', permissionNote: '' },
    })
    fake = installFakeFetch(routes(repost))
    let { w } = await mountPost()
    const credit = w.get('[data-test="credit"]')
    expect(credit.text()).toContain('Art by @funo_yun · X')
    expect(credit.get('[data-test="source-link"]').attributes('href')).toBe('https://x.com/funo_yun/status/1')
    w.unmount()
    fake.restore()

    fake = installFakeFetch(routes(postDto()))
    ;({ w } = await mountPost())
    expect(w.get('[data-test="credit"]').text()).toContain('© @cuka')
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

  it('delete confirms, calls DELETE and goes home', async () => {
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

  it('share copies the OG link', async () => {
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
    expect(more.findAll('a[href^="/posts/"]').map((a) => a.attributes('href'))).toEqual(['/posts/p2'])
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
    expect(fake.callsTo('DELETE /api/comments/c3')).toHaveLength(1)
    expect(w.text()).not.toContain('Của tôi')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { i18n } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRequest, type FakeRoute } from './fakeApi'
import { installFakeXhr } from './fakeXhr'
import { media, postDto, publicUser } from './fixtures'

let fake: FakeFetch | undefined
let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  fake?.restore()
  fake = undefined
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const ok = (body: unknown) => ({ status: 200, body })

function file(name: string, type = 'image/png'): File {
  return new File([new Uint8Array(8)], name, { type })
}

function routes(extra: Record<string, FakeRoute> = {}): Record<string, FakeRoute> {
  let seq = 0
  const r: Record<string, FakeRoute> = {
    'POST /api/uploads': (req: FakeRequest) => {
      const b = req.body as { mime: string; size: number }
      return ok({ fileId: `F${++seq}`, url: 'http://minio.local/originals', fields: { key: `k${seq}`, 'Content-Type': b.mime }, maxBytes: b.size })
    },
    'GET /api/tags/suggest': ok([]),
    // The post page after a successful submit.
    'GET /api/posts/pNew': ok(postDto({ id: 'pNew' })),
    'GET /api/posts/pNew/comments': ok({ items: [], nextCursor: null }),
    'GET /api/users/cuka': ok(publicUser()),
    'GET /api/users/cuka/posts': ok({ items: [], nextCursor: null }),
    ...extra,
  }
  for (let i = 1; i <= 4; i++) {
    r[`POST /api/uploads/F${i}/complete`] = ok({ id: `F${i}`, kind: 'image', mimeType: 'image/png', sizeBytes: 8, status: 'processing', originalName: 'a.png' })
  }
  return r
}

async function mountAt(path: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.ready = true
  auth.setSession({ accessToken: 't', user: makeMe() })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  await flushPromises()
  return { w: wrapper, router }
}

async function addFiles(w: VueWrapper, files: File[]) {
  const input = w.get('[data-test="file-input"]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await flushPromises()
}

const submitBtn = (w: VueWrapper) => w.get('[data-test="submit"]')
const disabled = (w: VueWrapper) => (submitBtn(w).element as HTMLButtonElement).disabled

/** A file and every required field filled in as own work. */
async function fillValid(w: VueWrapper, files = [file('a.png')]) {
  await addFiles(w, files)
  await w.get('[data-test="title"]').setValue('Mèo con')
  await w.get('[data-test="ai-declaration"]').setValue(true)
}

describe('Upload page', () => {
  it('repost without artist/platform/link blocks submit; own work does not', async () => {
    installFakeXhr()
    fake = installFakeFetch(routes())
    const { w } = await mountAt('/upload')
    expect(disabled(w)).toBe(true)
    await fillValid(w)
    expect(disabled(w)).toBe(false)

    await w.get('[data-test="credit-repost"]').setValue(true)
    expect(w.text()).toContain('chỉ bạn và kiểm duyệt viên thấy')
    expect(disabled(w)).toBe(true)
    await w.get('[data-test="artist-name"]').setValue('Họa sĩ A')
    expect(disabled(w)).toBe(true)
    await w.get('[data-test="platform"]').setValue('pixiv')
    expect(disabled(w)).toBe(true)
    await w.get('[data-test="source-url"]').setValue('ftp://x')
    expect(disabled(w)).toBe(true)
    await w.get('[data-test="source-url"]').setValue('https://pixiv.net/artworks/1')
    expect(disabled(w)).toBe(false)

    await w.get('[data-test="credit-own"]').setValue(true)
    expect(w.find('[data-test="artist-name"]').exists()).toBe(false)
    expect(disabled(w)).toBe(false)
  })

  it('ameoduca tag with rating all blocks submit with message', async () => {
    installFakeXhr()
    fake = installFakeFetch(routes())
    const { w } = await mountAt('/upload')
    await fillValid(w)
    const tagInput = w.get('[data-test="tag-input"]')
    await tagInput.setValue('#ameoDuCa')
    await tagInput.trigger('keydown', { key: 'Enter' })
    expect(w.get('[data-test="tag-chip"]').text()).toContain('ameoduca')
    expect(w.text()).toContain('Tag #ameoDuCa bắt buộc gắn R18')
    expect(disabled(w)).toBe(true)

    await w.get('[data-test="rating-r18"]').setValue(true)
    expect(w.text()).not.toContain('Tag #ameoDuCa bắt buộc gắn R18')
    expect(disabled(w)).toBe(false)
  })

  it('submit sends aiDeclaration true, credit, files with single cover; navigates to post', async () => {
    installFakeXhr()
    fake = installFakeFetch(routes({ 'POST /api/posts': ok(postDto({ id: 'pNew' })) }))
    const { w, router } = await mountAt('/upload')
    await fillValid(w, [file('a.png'), file('b.png')])
    await w.get('[data-test="description"]').setValue('Một con mèo')
    const tagInput = w.get('[data-test="tag-input"]')
    await tagInput.setValue('Fan Art')
    await tagInput.trigger('keydown', { key: 'Enter' })
    const items = w.findAll('[data-test="queue-item"]')
    expect(items[0]!.text()).toContain('Ảnh bìa')
    await items[1]!.get('[data-test="set-cover"]').trigger('click')
    expect(w.findAll('[data-test="queue-item"]')[1]!.text()).toContain('Ảnh bìa')
    expect(disabled(w)).toBe(false)

    await submitBtn(w).trigger('click')
    await flushPromises()
    const [req] = fake.callsTo('POST /api/posts')
    expect(req!.body).toEqual({
      type: 'illustration',
      title: 'Mèo con',
      description: 'Một con mèo',
      rating: 'all',
      tags: ['fan_art'],
      credit: { isOwnWork: true, artistName: '', artistHandle: '', platform: 'other', sourceUrl: '', permissionNote: '' },
      aiDeclaration: true,
      files: [
        { fileId: 'F1', position: 0, isCover: false },
        { fileId: 'F2', position: 1, isCover: true },
      ],
    })
    expect(router.currentRoute.value.path).toBe('/posts/pNew')
    expect(w.text()).toContain('Đã đăng, đang chờ duyệt')
  })
})

describe('Tag input', () => {
  it('suggests tags after a 250 ms debounce and adds the picked one', async () => {
    installFakeXhr()
    fake = installFakeFetch(routes({ 'GET /api/tags/suggest': ok([{ name: 'fanart', display: 'FanArt', postCount: 3 }]) }))
    const { w } = await mountAt('/upload')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await w.get('[data-test="tag-input"]').setValue('fa')
      await w.get('[data-test="tag-input"]').setValue('fan')
      await vi.advanceTimersByTimeAsync(249)
      expect(fake.callsTo('GET /api/tags/suggest')).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1)
      await flushPromises()
      const calls = fake.callsTo('GET /api/tags/suggest')
      expect(calls.map((c) => c.query.get('q'))).toEqual(['fan'])
      await w.get('[data-test="tag-suggestion"]').trigger('click')
      expect(w.get('[data-test="tag-chip"]').text()).toContain('#fanart')
      expect(w.find('[data-test="tag-suggestion"]').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Edit post page', () => {
  it('edit page PATCH sends only changed fields and shows re-review warning when files change', async () => {
    installFakeXhr()
    const original = postDto({
      media: [media({ fileId: 'f1', position: 0, isCover: true }), media({ fileId: 'f2', position: 1, isCover: false })],
    })
    fake = installFakeFetch(
      routes({
        'GET /api/posts/p1': ok(original),
        'GET /api/posts/p1/comments': ok({ items: [], nextCursor: null }),
        'PATCH /api/posts/p1': ok(original),
      }),
    )
    const { w, router } = await mountAt('/posts/p1/edit')
    expect((w.get('[data-test="title"]').element as HTMLInputElement).value).toBe('Mèo')
    expect(w.findAll('[data-test="queue-item"]')).toHaveLength(2)
    expect(w.text()).not.toContain('Thay đổi tệp sẽ cần duyệt lại')
    // Nothing changed yet.
    await w.get('[data-test="ai-declaration"]').setValue(true)
    expect(disabled(w)).toBe(true)

    await w.get('[data-test="title"]').setValue('Mèo mới')
    expect(disabled(w)).toBe(false)
    expect(w.text()).not.toContain('Thay đổi tệp sẽ cần duyệt lại')

    // Reordering keeps the same files: no re-review.
    await w.findAll('[data-test="move-down"]')[0]!.trigger('click')
    expect(w.text()).not.toContain('Thay đổi tệp sẽ cần duyệt lại')
    await w.findAll('[data-test="move-up"]')[1]!.trigger('click')

    await w.findAll('[data-test="remove-file"]')[1]!.trigger('click')
    expect(w.text()).toContain('Thay đổi tệp sẽ cần duyệt lại')
    await addFiles(w, [file('c.png')])

    await submitBtn(w).trigger('click')
    await flushPromises()
    const [req] = fake.callsTo('PATCH /api/posts/p1')
    expect(req!.body).toEqual({
      title: 'Mèo mới',
      files: [
        { fileId: 'f1', position: 0, isCover: true },
        { fileId: 'F1', position: 1, isCover: false },
      ],
    })
    expect(router.currentRoute.value.path).toBe('/posts/p1')
  })

  it('edit page PATCH with only a title change sends only the title', async () => {
    installFakeXhr()
    const original = postDto()
    fake = installFakeFetch(
      routes({
        'GET /api/posts/p1': ok(original),
        'GET /api/posts/p1/comments': ok({ items: [], nextCursor: null }),
        'PATCH /api/posts/p1': ok(original),
      }),
    )
    const { w } = await mountAt('/posts/p1/edit')
    await w.get('[data-test="title"]').setValue('Khác')
    await w.get('[data-test="ai-declaration"]').setValue(true)
    await submitBtn(w).trigger('click')
    await flushPromises()
    expect(fake.callsTo('PATCH /api/posts/p1')[0]!.body).toEqual({ title: 'Khác' })
  })
})

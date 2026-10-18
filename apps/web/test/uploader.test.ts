import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { i18n } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import { defineComponent, h } from 'vue'
import { useUploader, validateFile, type QueueItem } from '@/composables/useUploader'
import FileQueueItem from '@/components/upload/FileQueueItem.vue'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRequest, type FakeRoute } from './fakeApi'
import { FakeXhr, installFakeXhr } from './fakeXhr'

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

function file(name: string, type: string, size = 10): File {
  const f = new File([new Uint8Array(Math.min(size, 16))], name, { type })
  if (size > 16) Object.defineProperty(f, 'size', { value: size })
  return f
}

/** Presign answers F1, F2, … in call order; every complete answers `processing`. */
function uploadRoutes(n = 6): Record<string, FakeRoute> {
  let seq = 0
  const routes: Record<string, FakeRoute> = {
    'POST /api/uploads': (req: FakeRequest) => {
      const b = req.body as { name: string; size: number; mime: string }
      return { status: 200, body: { fileId: `F${++seq}`, url: 'http://minio.local/originals', fields: { key: `k${seq}`, 'Content-Type': b.mime, policy: 'pol' }, maxBytes: b.size } }
    },
  }
  for (let i = 1; i <= n; i++) {
    routes[`POST /api/uploads/F${i}/complete`] = { status: 200, body: { id: `F${i}`, kind: 'image', mimeType: 'image/png', sizeBytes: 10, status: 'processing', originalName: 'a.png' } }
  }
  return routes
}

function login() {
  setActivePinia(createPinia())
  const auth = useAuth()
  auth.ready = true
  auth.setSession({ accessToken: 't', user: makeMe() })
}

describe('validateFile', () => {
  it('validateFile rejects 52428801 bytes and .exe; accepts png/mp4/psd/clip', () => {
    expect(validateFile(file('big.png', 'image/png', 52428801))).toEqual({ ok: false, reason: 'too_large' })
    expect(validateFile(file('ok.png', 'image/png', 52428800))).toEqual({ ok: true, kind: 'image' })
    expect(validateFile(file('virus.exe', 'application/x-msdownload'))).toEqual({ ok: false, reason: 'type' })
    expect(validateFile(file('a.mp4', 'video/mp4'))).toEqual({ ok: true, kind: 'video' })
    // Browsers often report no type for these: the whitelist mime for the extension is used.
    expect(validateFile(file('a.psd', ''))).toEqual({ ok: true, kind: 'source' })
    expect(validateFile(file('a.clip', ''))).toEqual({ ok: true, kind: 'source' })
    expect(validateFile(file('a.png', 'image/png', 100), 50)).toEqual({ ok: false, reason: 'too_large' })
  })

  it('invalid file shows "Tối đa 50 MB" and makes no request (Review Focus 3)', async () => {
    login()
    installFakeXhr()
    fake = installFakeFetch({ ...uploadRoutes(), 'GET /api/tags/suggest': { status: 200, body: [] } })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/upload')
    wrapper = mount(App, { global: { plugins: [router, i18n] }, attachTo: document.body })
    await flushPromises()

    const input = wrapper.get('[data-test="file-input"]')
    Object.defineProperty(input.element, 'files', { value: [file('big.png', 'image/png', 52428801), file('x.exe', 'application/x-msdownload')], configurable: true })
    await input.trigger('change')
    await flushPromises()

    expect(wrapper.text()).toContain('Tối đa 50 MB')
    expect(wrapper.text()).toContain('Định dạng tệp không được hỗ trợ')
    expect(fake.calls.filter((c) => c.path.startsWith('/api/uploads'))).toHaveLength(0)
    expect(FakeXhr.instances).toHaveLength(0)
  })
})

describe('useUploader', () => {
  it('uploader: presign → multipart POST with fields then file → complete; status processing', async () => {
    login()
    installFakeXhr(false)
    fake = installFakeFetch(uploadRoutes())
    const up = useUploader()
    const f = file('cat.png', 'image/png', 1234)
    up.add([f])
    expect(up.queue.value[0]).toMatchObject({ kind: 'image', status: 'uploading' })
    await flushPromises()

    expect(fake.callsTo('POST /api/uploads')[0]!.body).toEqual({ name: 'cat.png', size: 1234, mime: 'image/png' })
    expect(FakeXhr.instances).toHaveLength(1)
    const xhr = FakeXhr.instances[0]!
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('http://minio.local/originals')
    expect([...xhr.body!.keys()]).toEqual(['key', 'Content-Type', 'policy', 'file'])
    expect(xhr.body!.get('Content-Type')).toBe('image/png')
    expect(xhr.body!.get('file')).toBe(f)
    expect(fake.callsTo('POST /api/uploads/F1/complete')).toHaveLength(0)

    xhr.respond(204)
    await flushPromises()
    expect(fake.callsTo('POST /api/uploads/F1/complete')).toHaveLength(1)
    expect(up.queue.value[0]).toMatchObject({ status: 'processing', fileId: 'F1', progress: 1 })
    expect(up.allDone.value).toBe(true)
  })

  it('uploader runs at most 3 uploads at once', async () => {
    login()
    installFakeXhr(false)
    fake = installFakeFetch(uploadRoutes())
    const up = useUploader()
    up.add([1, 2, 3, 4, 5].map((i) => file(`p${i}.png`, 'image/png')))
    await flushPromises()

    expect(FakeXhr.pending).toHaveLength(3)
    expect(fake.callsTo('POST /api/uploads')).toHaveLength(3)
    expect(up.queue.value.map((q) => q.status)).toEqual(['uploading', 'uploading', 'uploading', 'queued', 'queued'])
    expect(up.allDone.value).toBe(false)

    FakeXhr.pending[0]!.respond()
    await flushPromises()
    expect(FakeXhr.pending).toHaveLength(3)
    expect(fake.callsTo('POST /api/uploads')).toHaveLength(4)

    while (FakeXhr.pending.length) {
      FakeXhr.pending.forEach((x) => x.respond())
      await flushPromises()
    }
    expect(fake.callsTo('POST /api/uploads')).toHaveLength(5)
    expect(up.queue.value.every((q) => q.status === 'processing')).toBe(true)
    expect(up.allDone.value).toBe(true)
  })

  it('remove, move and setCover edit the queue', async () => {
    login()
    installFakeXhr()
    fake = installFakeFetch(uploadRoutes())
    const up = useUploader()
    up.add([file('a.png', 'image/png'), file('b.png', 'image/png'), file('c.png', 'image/png')])
    await flushPromises()
    const [a, b, c] = up.queue.value.map((q) => q.id)
    up.move(c!, -1)
    expect(up.queue.value.map((q) => q.id)).toEqual([a, c, b])
    up.move(a!, -1)
    expect(up.queue.value.map((q) => q.id)).toEqual([a, c, b])
    up.setCover(b!)
    expect(up.queue.value.map((q) => q.isCover)).toEqual([false, false, true])
    up.remove(c!)
    expect(up.queue.value.map((q) => q.id)).toEqual([a, b])
  })
})

describe('useUploader lifecycle and limits', () => {
  it('unmount mid-upload aborts XHRs and stops further presign/complete calls', async () => {
    login()
    installFakeXhr(false)
    fake = installFakeFetch(uploadRoutes())
    let up!: ReturnType<typeof useUploader>
    const Host = defineComponent({
      setup() {
        up = useUploader()
        return () => h('div')
      },
    })
    wrapper = mount(Host)
    up.add([1, 2, 3, 4].map((i) => file(`p${i}.png`, 'image/png')))
    await flushPromises()
    expect(FakeXhr.pending).toHaveLength(3)
    expect(fake.callsTo('POST /api/uploads')).toHaveLength(3)

    wrapper.unmount()
    wrapper = undefined
    await flushPromises()
    expect(FakeXhr.instances.every((x) => x.aborted)).toBe(true)
    expect(fake.callsTo('POST /api/uploads')).toHaveLength(3)
    expect(fake.calls.filter((c) => c.path.endsWith('/complete'))).toHaveLength(0)
    expect(FakeXhr.instances).toHaveLength(3)
  })

  it('caps the queue at maxFilesPerPost (50): extras are invalid with a message', async () => {
    login()
    installFakeXhr()
    fake = installFakeFetch(uploadRoutes())
    const existing: QueueItem[] = Array.from({ length: 49 }, (_, i) => ({
      id: `m-${i}`, file: null, name: '', kind: 'image', progress: 1, status: 'ready', fileId: `e${i}`, isCover: i === 0, existing: true,
    }))
    const up = useUploader(existing)
    up.add([file('a.png', 'image/png'), file('b.png', 'image/png'), file('bad.exe', 'application/x-msdownload')])
    const added = up.queue.value.slice(49)
    expect(added.map((q) => [q.status, q.error])).toEqual([
      ['uploading', undefined],
      ['invalid', 'too_many'],
      ['invalid', 'type'],
    ])
    await flushPromises()
    expect(fake.callsTo('POST /api/uploads')).toHaveLength(1)

    wrapper = mount(FileQueueItem, { props: { item: added[1]!, cover: false, first: false, last: true }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('Tối đa 50 tệp mỗi bài')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import type { HomeSection } from '@cuka/shared'
import { i18n } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import type { HomeDraftDto } from '@/api/types'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRequest, type FakeRoute } from './fakeApi'
import { allSections, IMG, IMG2, lt, resolved } from './homepageFixture'

let fake: FakeFetch | undefined
let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  fake?.restore()
  fake = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const ok = (body: unknown) => ({ status: 200, body })

/** The shared fixture, minus its deliberately unsafe Markdown link (the editor would refuse to save it). */
const sectionsOk = () =>
  allSections().map((s) => (s.type === 'about' ? ({ ...s, data: { ...s.data, body: lt('Một **nữ thần** thích *khám phá*.') } } as HomeSection) : s))

function draft(sections: HomeSection[] = sectionsOk().slice(0, 3), o: Partial<HomeDraftDto> = {}): HomeDraftDto {
  return {
    revision: 4,
    sections,
    updatedAt: '2026-10-01T00:00:00Z',
    updatedBy: { username: 'root' },
    publishedAt: '2026-10-01T00:00:00Z',
    publishedBy: { username: 'root' },
    unpublished: false,
    images: { [IMG]: resolved(IMG), [IMG2]: resolved(IMG2) },
    ...o,
  }
}

/** Echoes a saved draft back with the next revision, like the API. */
const saveEcho = (req: FakeRequest) => {
  const body = req.body as { revision: number; sections: HomeSection[] }
  return ok(draft(body.sections, { revision: body.revision + 1, unpublished: true }))
}

async function mountEditor(routes: Record<string, FakeRoute> = {}) {
  fake = installFakeFetch({
    'GET /api/admin/site/home/draft': ok(draft()),
    'PUT /api/admin/site/home/draft': saveEcho,
    'GET /api/feed/showcase': ok({ items: [], nextCursor: null }),
    'GET /api/admin/site/images': ok([]),
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
    expect(wrapper!.find('[data-test="section-list"]').exists()).toBe(true)
  })
  return { w: wrapper, router }
}

const rows = (w: VueWrapper) => w.findAll('[data-test="section-row"]')
const rowTypes = (w: VueWrapper) => rows(w).map((r) => r.get('[data-test="section-select"] span').text())
const button = (sel: string) => document.body.querySelector<HTMLElement>(sel)!
const lastSaved = () => fake!.callsTo('PUT /api/admin/site/home/draft').at(-1)!.body as { revision: number; sections: HomeSection[] }

describe('Admin → Trang chủ (homepage editor)', () => {
  it('lists the draft sections and previews them with the landing components', async () => {
    const { w } = await mountEditor()
    expect(rowTypes(w)).toEqual(['Ảnh bìa (hero)', 'Giới thiệu', 'Hồ sơ'])
    const preview = w.get('[data-test="home-preview"]')
    expect(preview.get('[data-test="landing-hero"] h1').text()).toBe('Hibiki Du Ca')
    expect(preview.find('[data-test="landing-profile"]').exists()).toBe(true)
    expect(w.get('[data-test="home-status"]').text()).toBe('Đang hiển thị đúng bản nháp')
    expect((w.get('[data-test="home-save"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('editing a field updates the preview live and marks the draft unsaved', async () => {
    const { w } = await mountEditor()
    await w.get('[data-test="f-title"]').setValue('Du Ca mới')
    expect(w.get('[data-test="home-preview"] [data-test="landing-hero"] h1').text()).toBe('Du Ca mới')
    expect(w.get('[data-test="home-status"]').text()).toBe('Có thay đổi chưa lưu')
    // Editing English leaves Vietnamese alone; the preview follows the editing language.
    await w.get('[data-test="edit-lang-en"]').trigger('click')
    await w.get('[data-test="f-title"]').setValue('New Du Ca')
    expect(w.get('[data-test="home-preview"] h1').text()).toBe('New Du Ca')
    await w.get('[data-test="home-save"]').trigger('click')
    await flushPromises()
    expect(lastSaved().revision).toBe(4)
    expect((lastSaved().sections[0]!.data as { title: unknown }).title).toEqual({ vi: 'Du Ca mới', en: 'New Du Ca' })
    expect(w.get('[data-test="home-status"]').text()).toBe('Bản nháp chưa xuất bản')
  })

  it('adds, reorders, duplicates, hides and deletes sections; the save carries the new order', async () => {
    const { w } = await mountEditor()
    // Add a fanart section after the selected (first) one.
    await w.get('[data-test="add-type"]').setValue('fanart')
    await w.get('[data-test="add-section"]').trigger('click')
    expect(rowTypes(w)).toEqual(['Ảnh bìa (hero)', 'Fanart mới', 'Giới thiệu', 'Hồ sơ'])
    await w.get('[data-test="f-heading"]').setValue('Tranh mới')
    // Move it down, duplicate it, hide the copy.
    await rows(w)[1]!.get('[data-test="section-down"]').trigger('click')
    expect(rowTypes(w)[2]).toBe('Fanart mới')
    await w.get('[data-test="section-duplicate"]').trigger('click')
    expect(rowTypes(w)).toHaveLength(5)
    await rows(w)[3]!.get('[data-test="section-visible"]').trigger('click')
    // Delete "Hồ sơ" (confirmed in a dialog).
    await rows(w)[4]!.get('[data-test="section-select"]').trigger('click')
    await w.get('[data-test="section-delete"]').trigger('click')
    await flushPromises()
    button('[data-test="delete-confirm"]').click()
    await flushPromises()
    expect(rowTypes(w)).toEqual(['Ảnh bìa (hero)', 'Giới thiệu', 'Fanart mới', 'Fanart mới'])

    await w.get('[data-test="home-save"]').trigger('click')
    await flushPromises()
    const saved = lastSaved().sections
    expect(saved.map((s) => s.type)).toEqual(['hero', 'about', 'fanart', 'fanart'])
    expect(saved.map((s) => s.visible)).toEqual([true, true, true, false])
    expect(new Set(saved.map((s) => s.id)).size).toBe(4)
    // The hidden copy is not in the preview.
    expect(w.findAll('[data-test="home-preview"] [data-test="landing-fanart"]')).toHaveLength(1)
  })

  it('item lists: remove one gallery image row and reorder the rest', async () => {
    const gallery = sectionsOk().find((s) => s.type === 'gallery')!
    const { w } = await mountEditor({ 'GET /api/admin/site/home/draft': ok(draft([gallery])) })
    const items = () => w.get('[data-test="gallery-items"]').findAll('[data-test="item-row"]')
    expect(items()).toHaveLength(2)
    await items()[0]!.get('[data-test="item-down"]').trigger('click')
    await items()[1]!.get('[data-test="item-remove"]').trigger('click')
    expect(items()).toHaveLength(1)
    expect(w.findAll('[data-test="home-preview"] [data-test="gallery-item"]')).toHaveLength(1)
    await w.get('[data-test="home-save"]').trigger('click')
    await flushPromises()
    const data = lastSaved().sections[0]!.data as { items: Array<{ image: { fileId: string } }> }
    expect(data.items.map((i) => i.image.fileId)).toEqual([IMG2])
  })

  it('an invalid draft is not sent: the problem section is selected and explained', async () => {
    const { w } = await mountEditor()
    await rows(w)[2]!.get('[data-test="section-select"]').trigger('click')
    await w.get('[data-test="f-heading"]').setValue('')
    await rows(w)[0]!.get('[data-test="section-select"]').trigger('click')
    await w.get('[data-test="home-save"]').trigger('click')
    await flushPromises()
    expect(fake!.callsTo('PUT /api/admin/site/home/draft')).toHaveLength(0)
    expect(w.get('[data-test="home-problem"]').text()).toContain('Hồ sơ')
    expect(w.get('[data-test="section-editor"] h2').text()).toBe('Hồ sơ')
  })

  it('publish saves pending changes first, then publishes that revision', async () => {
    const { w } = await mountEditor({
      'POST /api/admin/site/home/publish': (req) => ok(draft(lastSaved().sections, { revision: (req.body as { revision: number }).revision, unpublished: false })),
    })
    await w.get('[data-test="f-title"]').setValue('Lên sóng')
    await w.get('[data-test="home-publish"]').trigger('click')
    await flushPromises()
    button('[data-test="publish-confirm"]').click()
    await flushPromises()
    expect(fake!.callsTo('PUT /api/admin/site/home/draft')).toHaveLength(1)
    expect(fake!.callsTo('POST /api/admin/site/home/publish')[0]!.body).toEqual({ revision: 5 })
    expect(w.get('[data-test="home-status"]').text()).toBe('Đang hiển thị đúng bản nháp')
  })

  it('discard resets the draft to the published version', async () => {
    const { w } = await mountEditor({
      'GET /api/admin/site/home/draft': ok(draft(sectionsOk().slice(0, 2), { unpublished: true })),
      'POST /api/admin/site/home/discard': ok(draft(sectionsOk().slice(0, 1), { revision: 5 })),
    })
    await w.get('[data-test="home-discard"]').trigger('click')
    await flushPromises()
    button('[data-test="discard-confirm"]').click()
    await flushPromises()
    expect(fake!.callsTo('POST /api/admin/site/home/discard')[0]!.body).toEqual({ revision: 4 })
    expect(rowTypes(w)).toEqual(['Ảnh bìa (hero)'])
  })

  it('a stale revision (409) offers to reload the draft', async () => {
    const { w } = await mountEditor({
      'PUT /api/admin/site/home/draft': { status: 409, body: { error: { code: 'REVISION_CONFLICT', message: 'x', details: { revision: 9 } } } },
    })
    await w.get('[data-test="f-title"]').setValue('Của tôi')
    await w.get('[data-test="home-save"]').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Một quản trị viên khác vừa sửa bản nháp')
    await w.get('[data-test="home-reload"]').trigger('click')
    await flushPromises()
    expect(fake!.callsTo('GET /api/admin/site/home/draft')).toHaveLength(2)
    expect(w.get('[data-test="f-title"]').element).toHaveProperty('value', 'Hibiki Du Ca')
  })

  it('unsaved changes: leaving asks first (and stays on cancel)', async () => {
    const { w, router } = await mountEditor()
    await w.get('[data-test="f-title"]').setValue('Chưa lưu')
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await router.push('/posts').catch(() => {})
    await flushPromises()
    expect(ask).toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/admin')
    // Another admin tab is a query change: guarded too.
    await router.replace({ query: { tab: 'logs' } }).catch(() => {})
    expect(router.currentRoute.value.query.tab).toBe('home')
    ask.mockReturnValue(true)
    await router.push('/posts')
    expect(router.currentRoute.value.path).toBe('/posts')
  })

  it('image picker: choose from the library, alt text required unless decorative', async () => {
    const about = { ...sectionsOk()[1]!, data: { ...(sectionsOk()[1]!.data as object), image: null } } as HomeSection
    const { w } = await mountEditor({
      'GET /api/admin/site/home/draft': ok(draft([about])),
      'GET /api/admin/site/images': ok([
        { id: IMG2, status: 'ready', originalName: 'du-ca.png', sizeBytes: 2048, width: 2400, height: 1600, createdAt: '2026-10-01T00:00:00Z', used: false, image: resolved(IMG2) },
      ]),
    })
    await w.get('[data-test="image-choose"]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(document.body.querySelectorAll('[data-test="library-item"]')).toHaveLength(1)
    })
    button('[data-test="library-pick"]').click()
    await flushPromises()
    expect(w.get('[data-test="image-field-preview"]').attributes('src')).toBe(resolved(IMG2).src)
    expect(w.get('[data-test="home-preview"] [data-test="landing-about"] img').attributes('src')).toBe(resolved(IMG2).src)
    // No alt text yet: saving is refused with the field named.
    await w.get('[data-test="home-save"]').trigger('click')
    await flushPromises()
    expect(fake!.callsTo('PUT /api/admin/site/home/draft')).toHaveLength(0)
    expect(w.get('[data-test="home-problem"]').text()).toContain('alt')
    await w.get('[data-test="image-alt"]').setValue('Du Ca vẫy tay')
    await w.get('[data-test="home-save"]').trigger('click')
    await flushPromises()
    expect((lastSaved().sections[0]!.data as { image: unknown }).image).toEqual({ fileId: IMG2, alt: lt('Du Ca vẫy tay'), decorative: false })
  })

  it('library uploads go up as site images and unused ones can be deleted', async () => {
    const about = sectionsOk()[1]!
    const { w } = await mountEditor({
      'GET /api/admin/site/home/draft': ok(draft([about])),
      'GET /api/admin/site/images': ok([
        { id: IMG2, status: 'ready', originalName: 'cu.png', sizeBytes: 2048, width: 10, height: 10, createdAt: '2026-10-01T00:00:00Z', used: false, image: resolved(IMG2) },
        { id: IMG, status: 'ready', originalName: 'dang-dung.png', sizeBytes: 2048, width: 10, height: 10, createdAt: '2026-10-01T00:00:00Z', used: true, image: resolved(IMG) },
      ]),
      ['DELETE /api/admin/site/images/' + IMG2]: { status: 204 },
      'POST /api/uploads': { status: 400, body: { error: { code: 'FILE_TOO_LARGE' } } },
    })
    await w.get('[data-test="image-choose"]').trigger('click')
    await vi.waitFor(async () => {
      await flushPromises()
      expect(document.body.querySelectorAll('[data-test="library-item"]')).toHaveLength(2)
    })
    const deletes = document.body.querySelectorAll<HTMLButtonElement>('[data-test="library-delete"]')
    expect(deletes[1]!.disabled).toBe(true)
    deletes[0]!.click()
    await flushPromises()
    button('[data-test="library-delete-confirm"]').click()
    await flushPromises()
    expect(fake!.callsTo('DELETE /api/admin/site/images/' + IMG2)).toHaveLength(1)
    expect(document.body.querySelectorAll('[data-test="library-item"]')).toHaveLength(1)

    const input = document.body.querySelector<HTMLInputElement>('[data-test="library-input"]')!
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'moi.png', { type: 'image/png' })] })
    input.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(fake!.callsTo('POST /api/uploads')[0]!.body).toEqual({ name: 'moi.png', size: 1, mime: 'image/png', purpose: 'site' })
  })
})

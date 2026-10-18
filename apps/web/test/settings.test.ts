import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { i18n, setLocale } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRequest, type FakeResponse, type FakeRoute } from './fakeApi'
import { FakeCropper } from './cropperMock'
import { FakeXhr, installFakeXhr } from './fakeXhr'

vi.mock('cropperjs', async () => ({ default: (await import('./cropperMock')).FakeCropper }))

/** Lets the (mocked) cropper start on the picked image and presses "Dùng ảnh này". */
async function confirmCropper() {
  document.body.querySelector<HTMLImageElement>('[data-test="cropper-image"]')!.dispatchEvent(new Event('load'))
  await flushPromises()
  document.body.querySelector<HTMLButtonElement>('[data-test="cropper-confirm"]')!.click()
  await flushPromises()
}

let fake: FakeFetch | undefined
let wrapper: VueWrapper | undefined
let auth: ReturnType<typeof useAuth>
beforeEach(() => {
  FakeCropper.resetAll()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  fake?.restore()
  fake = undefined
  vi.unstubAllGlobals()
  setLocale('vi')
  document.body.innerHTML = ''
})

const ok = (body: unknown) => ({ status: 200, body })
const err = (status: number, code: string) => ({ status, body: { error: { code, message: 'raw server text' } } })

async function mountSettings(user = makeMe()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  auth = useAuth()
  auth.ready = true
  auth.setSession({ accessToken: 't', user })
  const router = createAppRouter(createMemoryHistory())
  await router.push('/settings')
  wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('Settings page', () => {
  it('showR18 without birthDate shows AGE_REQUIRED message', async () => {
    fake = installFakeFetch({ 'PATCH /api/me/settings': err(400, 'AGE_REQUIRED') })
    const w = await mountSettings()
    await w.get('[data-test="show-r18"]').setValue(true)
    await w.get('[data-test="save-r18"]').trigger('click')
    await flushPromises()
    expect(fake.callsTo('PATCH /api/me/settings')[0]!.body).toEqual({ showR18: true })
    expect(w.text()).toContain('Bạn cần đủ 18 tuổi và nhập ngày sinh')
    expect(w.text()).not.toContain('raw server text')
  })

  it('R18 save sends birthDate and updates the store', async () => {
    fake = installFakeFetch({ 'PATCH /api/me/settings': ok(makeMe({ showR18: true, birthDate: '2000-01-02' })) })
    const w = await mountSettings()
    await w.get('[data-test="birthdate"]').setValue('2000-01-02')
    await w.get('[data-test="show-r18"]').setValue(true)
    await w.get('[data-test="save-r18"]').trigger('click')
    await flushPromises()
    expect(fake.callsTo('PATCH /api/me/settings')[0]!.body).toEqual({ birthDate: '2000-01-02', showR18: true })
    expect(auth.user!.showR18).toBe(true)
  })

  it('locale change calls PATCH /me/settings and switches UI language', async () => {
    fake = installFakeFetch({ 'PATCH /api/me/settings': ok(makeMe({ locale: 'en' })) })
    const w = await mountSettings()
    await w.get('[data-test="locale-en"]').setValue(true)
    await flushPromises()
    expect(fake.callsTo('PATCH /api/me/settings')[0]!.body).toEqual({ locale: 'en' })
    expect(i18n.global.locale.value).toBe('en')
    expect(w.text()).toContain('Profile')
  })

  it('profile form validates links and bio counter, saves independently', async () => {
    fake = installFakeFetch({ 'PATCH /api/me': ok(makeMe()) })
    const w = await mountSettings()
    await w.get('[data-test="bio"]').setValue('hello')
    expect(w.get('[data-test="bio-count"]').text()).toContain('5/500')
    await w.get('[data-test="add-link"]').trigger('click')
    await w.get('[data-test="link-url"]').setValue('javascript:alert(1)')
    expect(w.text()).toContain('Liên kết phải bắt đầu bằng http:// hoặc https://')
    expect((w.get('[data-test="save-profile"]').element as HTMLButtonElement).disabled).toBe(true)
    await w.get('[data-test="link-url"]').setValue(' https://x.com/cuka ')
    await w.get('[data-test="save-profile"]').trigger('click')
    await flushPromises()
    expect(fake.callsTo('PATCH /api/me')[0]!.body).toEqual({
      displayName: 'Cuka',
      bio: 'hello',
      links: [{ platform: 'x', url: 'https://x.com/cuka' }],
    })
  })

  describe('links', () => {
    const rows = (w: VueWrapper) =>
      w.findAll('[data-test="link-row"]').map((r) => ({
        platform: (r.get('[data-test="link-platform"]').element as HTMLSelectElement).value,
        url: (r.get('[data-test="link-url"]').element as HTMLInputElement).value,
      }))
    const saved = [
      { platform: 'x' as const, url: 'https://x.com/a' },
      { platform: 'pixiv' as const, url: 'https://pixiv.net/u/1' },
      { platform: 'other' as const, label: 'Shop', url: 'https://shop.example' },
    ]
    const withLinks = () => makeMe({ profile: { ...makeMe().profile, links: saved } })

    it('shows the saved list in order; up/down reorder, remove drops a row, the save sends the new order', async () => {
      fake = installFakeFetch({ 'PATCH /api/me': ok(withLinks()) })
      const w = await mountSettings(withLinks())
      expect(rows(w).map((r) => r.platform)).toEqual(['x', 'pixiv', 'other'])
      expect((w.get('[data-test="link-label"]').element as HTMLInputElement).value).toBe('Shop')
      const up = w.findAll('[data-test="link-up"]')
      expect((up[0]!.element as HTMLButtonElement).disabled).toBe(true)
      expect((w.findAll('[data-test="link-down"]')[2]!.element as HTMLButtonElement).disabled).toBe(true)
      await up[2]!.trigger('click')
      expect(rows(w).map((r) => r.platform)).toEqual(['x', 'other', 'pixiv'])
      await w.findAll('[data-test="link-down"]')[0]!.trigger('click')
      expect(rows(w).map((r) => r.platform)).toEqual(['other', 'x', 'pixiv'])
      await w.findAll('[data-test="link-remove"]')[2]!.trigger('click')
      expect(rows(w).map((r) => r.platform)).toEqual(['other', 'x'])
      await w.get('[data-test="save-profile"]').trigger('click')
      await flushPromises()
      expect(fake.callsTo('PATCH /api/me')[0]!.body).toMatchObject({ links: [saved[2], saved[0]] })
    })

    it('other needs a label; the label input shows only for other', async () => {
      fake = installFakeFetch({ 'PATCH /api/me': ok(makeMe()) })
      const w = await mountSettings()
      await w.get('[data-test="add-link"]').trigger('click')
      expect(w.find('[data-test="link-label"]').exists()).toBe(false)
      await w.get('[data-test="link-platform"]').setValue('other')
      await w.get('[data-test="link-url"]').setValue('https://shop.example')
      expect(w.text()).toContain('Nhập tên cho liên kết (tối đa 40 ký tự)')
      expect((w.get('[data-test="save-profile"]').element as HTMLButtonElement).disabled).toBe(true)
      expect(w.get('[data-test="link-label"]').attributes('maxlength')).toBe('40')
      await w.get('[data-test="link-label"]').setValue('  Shop ')
      await w.get('[data-test="save-profile"]').trigger('click')
      await flushPromises()
      expect(fake.callsTo('PATCH /api/me')[0]!.body).toMatchObject({ links: [{ platform: 'other', label: 'Shop', url: 'https://shop.example' }] })
    })

    it('a label typed for other is not sent once the platform changes; blank rows are dropped', async () => {
      fake = installFakeFetch({ 'PATCH /api/me': ok(makeMe()) })
      const w = await mountSettings()
      await w.get('[data-test="add-link"]').trigger('click')
      await w.get('[data-test="link-platform"]').setValue('other')
      await w.get('[data-test="link-label"]').setValue('Shop')
      await w.get('[data-test="link-url"]').setValue('https://bsky.app/a')
      await w.get('[data-test="link-platform"]').setValue('bluesky')
      await w.get('[data-test="add-link"]').trigger('click')
      expect(w.findAll('[role="alert"]')).toHaveLength(0)
      await w.get('[data-test="save-profile"]').trigger('click')
      await flushPromises()
      expect(fake.callsTo('PATCH /api/me')[0]!.body).toMatchObject({ links: [{ platform: 'bluesky', url: 'https://bsky.app/a' }] })
    })

    it('add is disabled at 10 links', async () => {
      fake = installFakeFetch({})
      const nine = Array.from({ length: 9 }, (_, i) => ({ platform: 'x' as const, url: `https://x.com/${i}` }))
      const w = await mountSettings(makeMe({ profile: { ...makeMe().profile, links: nine } }))
      const add = w.get('[data-test="add-link"]')
      expect((add.element as HTMLButtonElement).disabled).toBe(false)
      expect(add.text()).toBe('+ Thêm liên kết')
      await add.trigger('click')
      expect(w.findAll('[data-test="link-row"]')).toHaveLength(10)
      expect((add.element as HTMLButtonElement).disabled).toBe(true)
      expect(w.get('[data-test="links-max"]').text()).toBe('Tối đa 10 liên kết')
      await add.trigger('click')
      expect(w.findAll('[data-test="link-row"]')).toHaveLength(10)
    })

    it('lists every platform with its name and English messages', async () => {
      fake = installFakeFetch({})
      setLocale('en')
      const w = await mountSettings()
      await w.get('[data-test="add-link"]').trigger('click')
      const options = w.findAll('[data-test="link-platform"] option').map((o) => o.text())
      expect(options).toEqual(['X', 'Facebook', 'YouTube', 'pixiv', 'TikTok', 'Threads', 'VGen', 'Instagram', 'Bluesky', 'Twitch', 'Ko-fi', 'DeviantArt', 'Other'])
      await w.get('[data-test="link-url"]').setValue('ftp://a')
      expect(w.text()).toContain('The link must start with http:// or https://')
      expect(w.text()).toContain('+ Add link')
    })
  })

  it('password change posts both passwords', async () => {
    fake = installFakeFetch({ 'POST /api/me/password': { status: 204 } })
    const w = await mountSettings()
    await w.get('[data-test="current-password"]').setValue('oldpassword')
    await w.get('[data-test="new-password"]').setValue('newpassword1')
    await w.get('[data-test="save-password"]').trigger('click')
    await flushPromises()
    expect(fake.callsTo('POST /api/me/password')[0]!.body).toEqual({ currentPassword: 'oldpassword', newPassword: 'newpassword1' })
  })

  it('password change logs in again with the new password (the change revokes every refresh token)', async () => {
    fake = installFakeFetch({
      'POST /api/me/password': { status: 204 },
      'POST /api/auth/login': ok({ accessToken: 'after-change', user: makeMe() }),
    })
    const w = await mountSettings()
    await w.get('[data-test="current-password"]').setValue('oldpassword')
    await w.get('[data-test="new-password"]').setValue('newpassword1')
    await w.get('[data-test="save-password"]').trigger('click')
    await flushPromises()
    expect(fake.callsTo('POST /api/auth/login')[0]!.body).toEqual({ email: 'cuka@example.com', password: 'newpassword1' })
    expect(auth.token).toBe('after-change')
    expect(w.text()).toContain('Đã lưu')
  })

  it('password change: a failed re-login clears the session and goes to /login with a toast', async () => {
    fake = installFakeFetch({
      'POST /api/me/password': { status: 204 },
      'POST /api/auth/login': err(500, 'INTERNAL'),
    })
    const w = await mountSettings()
    const router = (w.vm as unknown as { $router: import('vue-router').Router }).$router
    await w.get('[data-test="current-password"]').setValue('oldpassword')
    await w.get('[data-test="new-password"]').setValue('newpassword1')
    await w.get('[data-test="save-password"]').trigger('click')
    await flushPromises()
    expect(auth.isLoggedIn).toBe(false)
    expect(router.currentRoute.value.path).toBe('/login')
    expect(w.text()).toContain('Đã đổi mật khẩu. Vui lòng đăng nhập lại.')
  })

  describe('avatar', () => {
    const routes = (patch: FakeRoute): Record<string, FakeRoute> => ({
      'POST /api/uploads': (req: FakeRequest) => {
        const b = req.body as { mime: string; size: number }
        return ok({ fileId: 'F1', url: 'http://minio.local/o', fields: { key: 'k', 'Content-Type': b.mime }, maxBytes: b.size })
      },
      'POST /api/uploads/F1/complete': ok({ id: 'F1', kind: 'image', mimeType: 'image/png', sizeBytes: 8, status: 'processing', originalName: 'a.png' }),
      'PATCH /api/me': patch,
    })
    const pick = async (w: VueWrapper, name: string, type = 'image/png', field = 'avatar', body: Uint8Array<ArrayBuffer> = new Uint8Array(8)) => {
      const input = w.get(`[data-test="${field}-input"]`)
      Object.defineProperty(input.element, 'files', { value: [new File([body], name, { type })], configurable: true })
      await input.trigger('change')
      await flushPromises()
    }
    const cropperImage = () => document.body.querySelector<HTMLImageElement>('[data-test="cropper-image"]')
    /** Lets the (mocked) cropper start on the image and presses "Dùng ảnh này". */
    const confirmCrop = async () => {
      cropperImage()!.dispatchEvent(new Event('load'))
      await flushPromises()
      document.body.querySelector<HTMLButtonElement>('[data-test="cropper-confirm"]')!.click()
      await flushPromises()
    }

    it('avatar upload then PATCH /me with avatarFileId', async () => {
      installFakeXhr()
      fake = installFakeFetch(routes(ok(makeMe({ profile: { ...makeMe().profile, avatarFileId: 'F1' } }))))
      const w = await mountSettings()
      await pick(w, 'a.png')
      await confirmCrop()
      expect(fake.callsTo('PATCH /api/me')[0]!.body).toEqual({ avatarFileId: 'F1' })
      expect(auth.user!.profile.avatarFileId).toBe('F1')
      expect(w.get('[data-test="avatar-preview"]').attributes('src')).toBe('blob:preview')
    })

    it('FILE_NOT_READY shows the in-use message', async () => {
      installFakeXhr()
      fake = installFakeFetch(routes(err(400, 'FILE_NOT_READY')))
      const w = await mountSettings()
      await pick(w, 'a.png')
      await confirmCrop()
      expect(w.text()).toContain('Ảnh đang được dùng trong một bài đăng')
    })

    it('picking a PNG opens the cropper (1:1 for the avatar) and uploads nothing yet', async () => {
      installFakeXhr()
      fake = installFakeFetch(routes(ok(makeMe())))
      const w = await mountSettings()
      await pick(w, 'a.png')
      expect(cropperImage()).not.toBeNull()
      expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain('Dùng ảnh này')
      cropperImage()!.dispatchEvent(new Event('load'))
      await flushPromises()
      expect(FakeCropper.last.options).toMatchObject({ aspectRatio: 1 })
      expect(fake.callsTo('POST /api/uploads')).toHaveLength(0)
    })

    it('banner field crops at 4:1', async () => {
      installFakeXhr()
      fake = installFakeFetch(routes(ok(makeMe())))
      const w = await mountSettings()
      await pick(w, 'b.jpg', 'image/jpeg', 'banner')
      cropperImage()!.dispatchEvent(new Event('load'))
      await flushPromises()
      expect(FakeCropper.last.options).toMatchObject({ aspectRatio: 4 })
    })

    it('confirm uploads the cropped blob (not the original) and previews it', async () => {
      installFakeXhr()
      fake = installFakeFetch(routes(ok(makeMe({ profile: { ...makeMe().profile, avatarFileId: 'F1' } }))))
      const w = await mountSettings()
      await pick(w, 'a.png')
      await confirmCrop()
      expect(fake.callsTo('POST /api/uploads')[0]!.body).toEqual({ name: 'a.png', size: 'cropped-bytes'.length, mime: 'image/png' })
      const sent = FakeXhr.instances[0]!.body!.get('file') as File
      expect(sent.size).toBe('cropped-bytes'.length)
      expect(FakeCropper.last.canvasOptions[0]).toMatchObject({ width: 512, height: 512 })
      expect(fake.callsTo('PATCH /api/me')[0]!.body).toEqual({ avatarFileId: 'F1' })
      expect(cropperImage()).toBeNull()
      expect(w.get('[data-test="avatar-preview"]').attributes('src')).toBe('blob:preview')
    })

    it('cancel in the cropper uploads nothing and keeps the old image', async () => {
      installFakeXhr()
      fake = installFakeFetch(routes(ok(makeMe())))
      const w = await mountSettings(makeMe({ avatarUrl: 'http://cdn/old.webp' }))
      await pick(w, 'a.png')
      cropperImage()!.dispatchEvent(new Event('load'))
      await flushPromises()
      document.body.querySelector<HTMLButtonElement>('[data-test="cropper-cancel"]')!.click()
      await flushPromises()
      expect(cropperImage()).toBeNull()
      expect(fake.callsTo('POST /api/uploads')).toHaveLength(0)
      expect(fake.callsTo('PATCH /api/me')).toHaveLength(0)
      expect(w.get('[data-test="avatar-preview"]').attributes('src')).toBe('http://cdn/old.webp')
    })

    it('a GIF opens the cropper in animated mode (no rotate/flip); the original goes up with the chosen box', async () => {
      installFakeXhr()
      fake = installFakeFetch(routes(ok(makeMe())))
      const w = await mountSettings()
      await pick(w, 'a.gif', 'image/gif')
      expect(cropperImage()).not.toBeNull()
      cropperImage()!.dispatchEvent(new Event('load'))
      await flushPromises()
      expect(FakeCropper.last.options).toMatchObject({ aspectRatio: 1, rotatable: false, scalable: false })
      expect(document.body.querySelector('[data-test="cropper-rotate"]')).toBeNull()
      expect(document.body.querySelector('[data-test="cropper-flip"]')).toBeNull()
      expect(document.body.querySelector('[data-test="cropper-animated-note"]')!.textContent).toContain('giữ nguyên chuyển động')
      FakeCropper.last.natural = { naturalWidth: 400, naturalHeight: 200 }
      FakeCropper.last.data = { x: 100, y: 20, width: 150, height: 150 }
      document.body.querySelector<HTMLButtonElement>('[data-test="cropper-confirm"]')!.click()
      await flushPromises()
      expect(FakeCropper.last.canvasOptions).toHaveLength(0)
      expect(fake.callsTo('POST /api/uploads')[0]!.body).toEqual({ name: 'a.gif', size: 8, mime: 'image/gif' })
      expect((FakeXhr.instances[0]!.body!.get('file') as File).size).toBe(8)
      expect(fake.callsTo('PATCH /api/me')[0]!.body).toEqual({ avatarFileId: 'F1', avatarCrop: { x: 0.25, y: 0.1, w: 0.375, h: 0.75 } })
      expect(w.find('[data-test="avatar-animated-note"]').exists()).toBe(false)
    })

    it('an animated WebP is cropped in animated mode too; a still WebP is exported as before', async () => {
      installFakeXhr()
      fake = installFakeFetch(routes(ok(makeMe())))
      const w = await mountSettings()
      // RIFF....WEBPVP8X with the animation flag (0x02) set.
      const webp = (flags: number) => {
        const b = new Uint8Array(30)
        b.set(new TextEncoder().encode('RIFF'), 0)
        b.set(new TextEncoder().encode('WEBPVP8X'), 8)
        b[20] = flags
        return b
      }
      await pick(w, 'anim.webp', 'image/webp', 'banner', webp(0x02))
      FakeCropper.resetAll()
      await confirmCropper()
      expect(FakeCropper.last.options).toMatchObject({ aspectRatio: 4, rotatable: false })
      expect(FakeCropper.last.canvasOptions).toHaveLength(0)
      expect(fake.callsTo('PATCH /api/me')[0]!.body).toEqual({ bannerFileId: 'F1', bannerCrop: { x: 0, y: 0, w: 1, h: 1 } })
      await pick(w, 'still.webp', 'image/webp', 'banner', webp(0x10))
      await confirmCropper()
      expect(FakeCropper.last.options).toMatchObject({ rotatable: true })
      expect(document.body.querySelector('[data-test="cropper-animated-note"]')).toBeNull()
      expect(FakeCropper.last.canvasOptions[0]).toMatchObject({ width: 1600, height: 400 })
      expect(fake.callsTo('PATCH /api/me')[1]!.body).toEqual({ bannerFileId: 'F1' })
    })

    it('rejects non-image files without uploading', async () => {
      installFakeXhr()
      fake = installFakeFetch(routes(ok(makeMe())))
      const w = await mountSettings()
      await pick(w, 'a.zip', 'application/zip')
      expect(fake.callsTo('POST /api/uploads')).toHaveLength(0)
      expect(w.text()).toContain('Chỉ nhận tệp ảnh')
    })
  })

  describe('fix round 1', () => {
    it('header switch persists when logged in; failure keeps the old locale', async () => {
      fake = installFakeFetch({ 'PATCH /api/me/settings': [err(500, 'INTERNAL'), ok(makeMe({ locale: 'en' }))] })
      const w = await mountSettings()
      await w.get('[data-test="lang-en"]').trigger('click')
      await flushPromises()
      expect(fake.callsTo('PATCH /api/me/settings')[0]!.body).toEqual({ locale: 'en' })
      expect(i18n.global.locale.value).toBe('vi')
      expect((w.get('[data-test="locale-vi"]').element as HTMLInputElement).checked).toBe(true)
      expect((w.get('[data-test="locale-en"]').element as HTMLInputElement).checked).toBe(false)
      await w.get('[data-test="lang-en"]').trigger('click')
      await flushPromises()
      expect(i18n.global.locale.value).toBe('en')
      expect(auth.user!.locale).toBe('en')
      expect((w.get('[data-test="locale-en"]').element as HTMLInputElement).checked).toBe(true)
    })

    it('settings radios stay on the old locale when the save fails', async () => {
      fake = installFakeFetch({ 'PATCH /api/me/settings': err(500, 'INTERNAL') })
      const w = await mountSettings()
      await w.get('[data-test="locale-en"]').setValue(true)
      await flushPromises()
      expect(i18n.global.locale.value).toBe('vi')
      expect((w.get('[data-test="locale-vi"]').element as HTMLInputElement).checked).toBe(true)
    })

    it('shows the current avatar from the session (no extra profile request); local preview wins; failed save clears it', async () => {
      installFakeXhr()
      fake = installFakeFetch({
        'POST /api/uploads': ok({ fileId: 'F1', url: 'http://minio.local/o', fields: { key: 'k' }, maxBytes: 8 }),
        'POST /api/uploads/F1/complete': ok({ id: 'F1', kind: 'image', mimeType: 'image/gif', sizeBytes: 8, status: 'processing', originalName: 'a.gif' }),
        'PATCH /api/me': err(400, 'FILE_NOT_READY'),
      })
      const w = await mountSettings(makeMe({ avatarUrl: 'http://cdn/a.webp', bannerUrl: null }))
      expect(fake.callsTo('GET /api/users/cuka')).toHaveLength(0)
      expect(w.get('[data-test="avatar-preview"]').attributes('src')).toBe('http://cdn/a.webp')
      expect(w.find('[data-test="banner-preview"]').exists()).toBe(false)
      const input = w.get('[data-test="avatar-input"]')
      Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array(8)], 'a.gif', { type: 'image/gif' })], configurable: true })
      await input.trigger('change')
      await flushPromises()
      await confirmCropper()
      expect(fake.callsTo('PATCH /api/me')).toHaveLength(1)
      expect(w.get('[data-test="avatar-preview"]').attributes('src')).toBe('http://cdn/a.webp')
    })

    it('banner preview box is 4:1; a versioned (?v=) image URL is used as-is', async () => {
      fake = installFakeFetch({})
      const w = await mountSettings(makeMe({ avatarUrl: 'http://cdn/a.webp?v=1', bannerUrl: 'http://cdn/b.webp?v=2' }))
      const banner = w.get('[data-test="banner-preview"]')
      expect(banner.attributes('src')).toBe('http://cdn/b.webp?v=2')
      expect(banner.element.parentElement!.className).toContain('h-12 w-48')
      expect(w.get('[data-test="avatar-preview"]').attributes('src')).toBe('http://cdn/a.webp?v=1')
    })

    it('after an avatar save the header updates from the response and /me is polled every 3 s until the URL appears', async () => {
      vi.useFakeTimers()
      try {
        installFakeXhr()
        const withAvatar = makeMe({ avatarUrl: 'http://cdn/F1/thumb_md.webp', profile: { ...makeMe().profile, avatarFileId: 'F1' } })
        const pending = makeMe({ profile: { ...makeMe().profile, displayName: 'Saved', avatarFileId: 'F1' } })
        fake = installFakeFetch({
          'POST /api/uploads': ok({ fileId: 'F1', url: 'http://minio.local/o', fields: { key: 'k' }, maxBytes: 8 }),
          'POST /api/uploads/F1/complete': ok({ id: 'F1', kind: 'image', mimeType: 'image/gif', sizeBytes: 8, status: 'processing', originalName: 'a.gif' }),
          'PATCH /api/me': ok(pending),
          'GET /api/me': [ok(pending), ok(withAvatar)],
        })
        const w = await mountSettings()
        const input = w.get('[data-test="avatar-input"]')
        Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array(8)], 'a.gif', { type: 'image/gif' })], configurable: true })
        await input.trigger('change')
        await flushPromises()
        await confirmCropper()
        expect(auth.user!.profile.displayName).toBe('Saved')
        expect(w.find('[data-test="account-avatar"]').exists()).toBe(false)
        expect(fake.callsTo('GET /api/me')).toHaveLength(0)
        await vi.advanceTimersByTimeAsync(3000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(3000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(2)
        expect(auth.user!.avatarUrl).toBe('http://cdn/F1/thumb_md.webp')
        expect(w.get('[data-test="account-avatar"]').attributes('src')).toBe('http://cdn/F1/thumb_md.webp')
        await vi.advanceTimersByTimeAsync(30_000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(2)
      } finally {
        vi.useRealTimers()
      }
    })

    /** Picks `name` in the `testId` image field; the upload is accepted as `processing` with id `fileId`. */
    async function pickImage(w: VueWrapper, testId: 'avatar' | 'banner', name = 'a.gif') {
      const input = w.get(`[data-test="${testId}-input"]`)
      Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array(8)], name, { type: 'image/gif' })], configurable: true })
      await input.trigger('change')
      await flushPromises()
      await confirmCropper()
    }
    const uploadRoutes = (fileId: string): Record<string, FakeResponse> => ({
      'POST /api/uploads': ok({ fileId, url: 'http://minio.local/o', fields: { key: 'k' }, maxBytes: 8 }),
      [`POST /api/uploads/${fileId}/complete`]: ok({ id: fileId, kind: 'image', mimeType: 'image/gif', sizeBytes: 8, status: 'processing', originalName: 'a.gif' }),
    })

    it('polling /me gives up after about 3 minutes (10 tries 3 s apart, then 15 tries 10 s apart)', async () => {
      vi.useFakeTimers()
      try {
        installFakeXhr()
        const pending = makeMe({ profile: { ...makeMe().profile, bannerFileId: 'F1' } })
        fake = installFakeFetch({ ...uploadRoutes('F1'), 'PATCH /api/me': ok(pending), 'GET /api/me': ok(pending) })
        const w = await mountSettings()
        await pickImage(w, 'banner', 'b.gif')
        await vi.advanceTimersByTimeAsync(30_000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(10)
        await vi.advanceTimersByTimeAsync(150_000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(25)
        await vi.advanceTimersByTimeAsync(600_000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(25)
      } finally {
        vi.useRealTimers()
      }
    })

    // Regression: the poll lived in the settings page, so leaving the page (or a worker slower than 30 s) left the
    // header on the initial until a full reload.
    it('keeps polling after leaving the settings page, so the header still picks up the published avatar', async () => {
      vi.useFakeTimers()
      try {
        installFakeXhr()
        const withAvatar = makeMe({ avatarUrl: 'http://cdn/F1/thumb_md.webp?v=1', profile: { ...makeMe().profile, avatarFileId: 'F1' } })
        const pending = makeMe({ profile: { ...makeMe().profile, avatarFileId: 'F1' } })
        // Published only after 40 s: past the old 30 s budget.
        const replies: FakeResponse[] = [...Array<FakeResponse>(11).fill(ok(pending)), ok(withAvatar)]
        fake = installFakeFetch({ ...uploadRoutes('F1'), 'PATCH /api/me': ok(pending), 'GET /api/me': replies })
        const w = await mountSettings()
        await pickImage(w, 'avatar')
        await vi.advanceTimersByTimeAsync(3000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(1)
        await w.vm.$router.push('/')
        await flushPromises()
        expect(w.find('[data-test="profile-form"]').exists()).toBe(false)
        await vi.advanceTimersByTimeAsync(27_000)
        expect(w.find('[data-test="account-avatar"]').exists()).toBe(false)
        await vi.advanceTimersByTimeAsync(20_000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(12)
        expect(auth.user!.avatarUrl).toBe('http://cdn/F1/thumb_md.webp?v=1')
        expect(w.get('[data-test="account-avatar"]').attributes('src')).toBe('http://cdn/F1/thumb_md.webp?v=1')
        await vi.advanceTimersByTimeAsync(60_000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(12)
      } finally {
        vi.useRealTimers()
      }
    })

    it('an avatar and a banner saved together share one poll that runs until both are published', async () => {
      vi.useFakeTimers()
      try {
        installFakeXhr()
        const base = makeMe().profile
        const both = { ...base, avatarFileId: 'F1', bannerFileId: 'F2' }
        fake = installFakeFetch({
          ...uploadRoutes('F1'),
          ...uploadRoutes('F2'),
          'POST /api/uploads': [uploadRoutes('F1')['POST /api/uploads']!, uploadRoutes('F2')['POST /api/uploads']!],
          'PATCH /api/me': [ok(makeMe({ profile: { ...base, avatarFileId: 'F1' } })), ok(makeMe({ profile: both }))],
          'GET /api/me': [
            ok(makeMe({ avatarUrl: 'http://cdn/a.webp', profile: both })),
            ok(makeMe({ avatarUrl: 'http://cdn/a.webp', profile: both })),
            ok(makeMe({ avatarUrl: 'http://cdn/a.webp', bannerUrl: 'http://cdn/b.webp', profile: both })),
          ],
        })
        const w = await mountSettings()
        await pickImage(w, 'avatar')
        await pickImage(w, 'banner', 'b.gif')
        expect(fake.callsTo('PATCH /api/me')).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(3000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(1)
        expect(w.get('[data-test="account-avatar"]').attributes('src')).toBe('http://cdn/a.webp')
        await vi.advanceTimersByTimeAsync(6000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(3)
        expect(auth.user!.bannerUrl).toBe('http://cdn/b.webp')
        await vi.advanceTimersByTimeAsync(60_000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(3)
      } finally {
        vi.useRealTimers()
      }
    })

    it('logging out stops the poll', async () => {
      vi.useFakeTimers()
      try {
        installFakeXhr()
        const pending = makeMe({ profile: { ...makeMe().profile, avatarFileId: 'F1' } })
        fake = installFakeFetch({ ...uploadRoutes('F1'), 'PATCH /api/me': ok(pending), 'GET /api/me': ok(pending) })
        const w = await mountSettings()
        await pickImage(w, 'avatar')
        await vi.advanceTimersByTimeAsync(3000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(1)
        auth.clear()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('R18 form re-syncs from the returned user', async () => {
      fake = installFakeFetch({ 'PATCH /api/me/settings': ok(makeMe({ showR18: false, birthDate: '2001-05-06' })) })
      const w = await mountSettings()
      await w.get('[data-test="show-r18"]').setValue(true)
      await w.get('[data-test="save-r18"]').trigger('click')
      await flushPromises()
      expect((w.get('[data-test="show-r18"]').element as HTMLInputElement).checked).toBe(false)
      expect((w.get('[data-test="birthdate"]').element as HTMLInputElement).value).toBe('2001-05-06')
    })

    it('image buttons have distinct accessible names', async () => {
      fake = installFakeFetch({})
      const w = await mountSettings()
      const names = w.findAll('[data-test$="-choose"]').map((b) => b.attributes('aria-label'))
      expect(names).toEqual(['Chọn ảnh: Ảnh đại diện', 'Chọn ảnh: Ảnh bìa'])
    })
  })
})

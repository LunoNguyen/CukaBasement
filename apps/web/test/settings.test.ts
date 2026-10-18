import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { i18n, setLocale } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRequest, type FakeRoute } from './fakeApi'
import { installFakeXhr } from './fakeXhr'

let fake: FakeFetch | undefined
let wrapper: VueWrapper | undefined
let auth: ReturnType<typeof useAuth>
beforeEach(() => {
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
    await w.get('[data-test="link-x"]').setValue('javascript:alert(1)')
    expect((w.get('[data-test="save-profile"]').element as HTMLButtonElement).disabled).toBe(true)
    await w.get('[data-test="link-x"]').setValue('https://x.com/cuka')
    await w.get('[data-test="save-profile"]').trigger('click')
    await flushPromises()
    expect(fake.callsTo('PATCH /api/me')[0]!.body).toEqual({
      displayName: 'Cuka',
      bio: 'hello',
      socialLinks: { x: 'https://x.com/cuka', facebook: '', youtube: '', pixiv: '' },
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
    const pick = async (w: VueWrapper, name: string, type = 'image/png') => {
      const input = w.get('[data-test="avatar-input"]')
      Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array(8)], name, { type })], configurable: true })
      await input.trigger('change')
      await flushPromises()
    }

    it('avatar upload then PATCH /me with avatarFileId', async () => {
      installFakeXhr()
      fake = installFakeFetch(routes(ok(makeMe({ profile: { ...makeMe().profile, avatarFileId: 'F1' } }))))
      const w = await mountSettings()
      await pick(w, 'a.png')
      expect(fake.callsTo('PATCH /api/me')[0]!.body).toEqual({ avatarFileId: 'F1' })
      expect(auth.user!.profile.avatarFileId).toBe('F1')
      expect(w.get('[data-test="avatar-preview"]').attributes('src')).toBe('blob:preview')
    })

    it('FILE_NOT_READY shows the in-use message', async () => {
      installFakeXhr()
      fake = installFakeFetch(routes(err(400, 'FILE_NOT_READY')))
      const w = await mountSettings()
      await pick(w, 'a.png')
      expect(w.text()).toContain('Ảnh đang được dùng trong một bài đăng')
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
      expect(w.get('[data-test="avatar-preview"]').attributes('src')).toBe('http://cdn/a.webp')
    })

    it('after an avatar save the header updates from the response and /me is polled every 3 s (≤10 times) until the URL appears', async () => {
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

    it('polling /me gives up after 10 tries', async () => {
      vi.useFakeTimers()
      try {
        installFakeXhr()
        const pending = makeMe({ profile: { ...makeMe().profile, bannerFileId: 'F1' } })
        fake = installFakeFetch({
          'POST /api/uploads': ok({ fileId: 'F1', url: 'http://minio.local/o', fields: { key: 'k' }, maxBytes: 8 }),
          'POST /api/uploads/F1/complete': ok({ id: 'F1', kind: 'image', mimeType: 'image/gif', sizeBytes: 8, status: 'processing', originalName: 'b.gif' }),
          'PATCH /api/me': ok(pending),
          'GET /api/me': ok(pending),
        })
        const w = await mountSettings()
        const input = w.get('[data-test="banner-input"]')
        Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array(8)], 'b.gif', { type: 'image/gif' })], configurable: true })
        await input.trigger('change')
        await flushPromises()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(fake.callsTo('GET /api/me')).toHaveLength(10)
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

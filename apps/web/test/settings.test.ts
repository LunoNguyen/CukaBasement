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

async function mountSettings() {
  const pinia = createPinia()
  setActivePinia(pinia)
  auth = useAuth()
  auth.ready = true
  auth.setSession({ accessToken: 't', user: makeMe() })
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
})

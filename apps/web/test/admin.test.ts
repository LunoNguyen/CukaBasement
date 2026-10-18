import { afterEach, beforeEach, describe, expect, it, vi as vitest } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { MOD_ACTIONS, ROLES, USER_STATUSES } from '@cuka/shared'
import { i18n } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import type { AdminLogDto, AdminUserDto } from '@/api/types'
import App from '@/App.vue'
import vi from '@/i18n/vi'
import en from '@/i18n/en'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRoute } from './fakeApi'

let fake: FakeFetch | undefined
let wrapper: VueWrapper | undefined
beforeEach(() => vitest.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  fake?.restore()
  fake = undefined
  document.body.innerHTML = ''
  vitest.useRealTimers()
})

const ok = (body: unknown) => ({ status: 200, body })
const err = (status: number, code: string) => ({ status, body: { error: { code, message: 'raw' } } })

async function mountAt(path: string, routes: Record<string, FakeRoute>) {
  fake = installFakeFetch(routes)
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.ready = true
  auth.setSession({ accessToken: 't', user: makeMe({ id: 'u1', role: 'admin' }) })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  await flushPromises()
  return { w: wrapper, router }
}

const stats = { followerCount: 0, followingCount: 0, postCount: 0 }
const user = (o: Partial<AdminUserDto> = {}): AdminUserDto => ({
  id: 'u2', email: 'bob@example.com', username: 'bob', displayName: 'Bob', role: 'user', status: 'active',
  emailVerified: true, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null, stats: stats as AdminUserDto['stats'], ...o,
})
const users = (...items: AdminUserDto[]) => ok({ items, nextCursor: null })
const log = (o: Partial<AdminLogDto> = {}): AdminLogDto => ({
  id: 'l1', actor: { username: 'root' }, action: 'approve', targetType: 'post', targetId: 'p1', note: '', createdAt: '2026-01-01T00:00:00Z', ...o,
})
const settings = { reportHideThreshold: 5, reportAiHideThreshold: 3, maxFileBytes: 52428800, maxFilesPerPost: 50, dailyUploadQuotaBytes: 2147483648 }
const modal = () => document.body.querySelector('[role="dialog"]') as HTMLElement
async function setVal(el: Element, v: string, ev = 'input') {
  ;(el as HTMLInputElement).value = v
  el.dispatchEvent(new Event(ev))
  await flushPromises()
}

describe('Admin pages', () => {
  it('every MOD_ACTIONS value has a vi and en label', () => {
    for (const a of MOD_ACTIONS) {
      expect((vi.admin.actions as Record<string, string>)[a], a).toBeTruthy()
      expect((en.admin.actions as Record<string, string>)[a], a).toBeTruthy()
    }
    for (const r of ROLES) {
      expect((vi.admin.roles as Record<string, string>)[r]).toBeTruthy()
      expect((en.admin.roles as Record<string, string>)[r]).toBeTruthy()
    }
    for (const s of USER_STATUSES) {
      expect((vi.admin.statuses as Record<string, string>)[s]).toBeTruthy()
      expect((en.admin.statuses as Record<string, string>)[s]).toBeTruthy()
    }
  })

  it('ban user posts status banned with note and updates the row', async () => {
    const { w } = await mountAt('/admin', {
      'GET /api/admin/users': users(user({ id: 'u1', username: 'cuka' }), user()),
      'POST /api/admin/users/u2/status': ok(user({ status: 'banned' })),
    })
    const row = w.findAll('[data-test="user-row"]')[1]!
    await setVal(row.find('[data-test="status-select"]').element, 'banned', 'change')
    expect(fake!.callsTo('POST /api/admin/users/u2/status')).toHaveLength(0)
    await setVal(modal().querySelector('textarea')!, 'spam')
    modal().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo('POST /api/admin/users/u2/status')[0]!.body).toEqual({ status: 'banned', note: 'spam' })
    expect(w.findAll('[data-test="user-row"]')[1]!.text()).toContain(vi.admin.statuses.banned)
    expect(modal()).toBeNull()
  })

  it('own row has status and role controls disabled', async () => {
    const { w } = await mountAt('/admin', { 'GET /api/admin/users': users(user({ id: 'u1', username: 'cuka', role: 'admin' }), user()) })
    const rows = w.findAll('[data-test="user-row"]')
    expect((rows[0]!.find('[data-test="status-select"]').element as HTMLSelectElement).disabled).toBe(true)
    expect((rows[0]!.find('[data-test="role-select"]').element as HTMLSelectElement).disabled).toBe(true)
    expect((rows[1]!.find('[data-test="role-select"]').element as HTMLSelectElement).disabled).toBe(false)
  })

  it('role change needs confirmation then posts role', async () => {
    const { w } = await mountAt('/admin', {
      'GET /api/admin/users': users(user()),
      'POST /api/admin/users/u2/role': ok(user({ role: 'moderator' })),
    })
    await setVal(w.find('[data-test="role-select"]').element, 'moderator', 'change')
    expect(fake!.callsTo('POST /api/admin/users/u2/role')).toHaveLength(0)
    modal().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo('POST /api/admin/users/u2/role')[0]!.body).toEqual({ role: 'moderator' })
    expect(w.find('[data-test="user-row"]').text()).toContain(vi.admin.roles.moderator)
  })

  it('LAST_ADMIN shows vi message and keeps the old value', async () => {
    const { w } = await mountAt('/admin', {
      'GET /api/admin/users': users(user({ role: 'admin' })),
      'POST /api/admin/users/u2/role': err(409, 'LAST_ADMIN'),
    })
    await setVal(w.find('[data-test="role-select"]').element, 'user', 'change')
    modal().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(document.body.textContent).toContain('Không thể thay đổi quản trị viên cuối cùng')
    expect(w.find('[data-test="user-row"]').text()).toContain(vi.admin.roles.admin)
    expect((w.find('[data-test="role-select"]').element as HTMLSelectElement).value).toBe('admin')
  })

  it('search debounces 300 ms and ignores a stale response', async () => {
    let release!: () => void
    const slow = new Promise<void>((r) => (release = r))
    const { w } = await mountAt('/admin', {
      'GET /api/admin/users': (req) => {
        const q = req.query.get('q')
        if (q === 'a') return slow.then(() => ({ status: 200, body: { items: [user({ id: 'x', username: 'stale' })], nextCursor: null } }))
        if (q === 'ab') return { status: 200, body: { items: [user({ id: 'y', username: 'fresh' })], nextCursor: null } }
        return { status: 200, body: { items: [], nextCursor: null } }
      },
    })
    expect(fake!.callsTo('GET /api/admin/users')).toHaveLength(1)
    await setVal(w.find('[data-test="user-q"]').element, 'a')
    vitest.advanceTimersByTime(299)
    expect(fake!.callsTo('GET /api/admin/users')).toHaveLength(1)
    vitest.advanceTimersByTime(1)
    await flushPromises()
    expect(fake!.callsTo('GET /api/admin/users')).toHaveLength(2)
    await setVal(w.find('[data-test="user-q"]').element, 'ab')
    vitest.advanceTimersByTime(300)
    await flushPromises()
    release()
    await flushPromises()
    expect(w.text()).toContain('fresh')
    expect(w.text()).not.toContain('stale')
  })

  it('role and status filters are sent as query params', async () => {
    const { w } = await mountAt('/admin', { 'GET /api/admin/users': users() })
    await setVal(w.find('[data-test="filter-role"]').element, 'moderator', 'change')
    await setVal(w.find('[data-test="filter-status"]').element, 'banned', 'change')
    const last = fake!.callsTo('GET /api/admin/users').at(-1)!
    expect(last.query.get('role')).toBe('moderator')
    expect(last.query.get('status')).toBe('banned')
  })

  it('settings form converts MB to bytes and rejects > 50 MB client-side', async () => {
    const { w } = await mountAt('/admin?tab=settings', {
      'GET /api/admin/settings': ok(settings),
      'PATCH /api/admin/settings': (req) => ok({ ...settings, ...(req.body as object) }),
    })
    expect((w.find('[data-test="set-maxFileBytes"]').element as HTMLInputElement).value).toBe('50')
    expect((w.find('[data-test="set-dailyUploadQuotaBytes"]').element as HTMLInputElement).value).toBe('2')
    await setVal(w.find('[data-test="set-maxFileBytes"]').element, '51')
    w.find('form').element.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo('PATCH /api/admin/settings')).toHaveLength(0)
    expect(w.text()).toContain(vi.admin.settings.maxFileTooBig.replace('{max}', '50'))
    await setVal(w.find('[data-test="set-maxFileBytes"]').element, '10')
    await setVal(w.find('[data-test="set-dailyUploadQuotaBytes"]').element, '3')
    w.find('form').element.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo('PATCH /api/admin/settings')[0]!.body).toEqual({ maxFileBytes: 10485760, dailyUploadQuotaBytes: 3221225472 })
  })

  it('settings shows API error in vi', async () => {
    const { w } = await mountAt('/admin?tab=settings', {
      'GET /api/admin/settings': ok(settings),
      'PATCH /api/admin/settings': err(400, 'VALIDATION_FAILED'),
    })
    await setVal(w.find('[data-test="set-maxFilesPerPost"]').element, '20')
    w.find('form').element.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(document.body.textContent).toContain(vi.errors.VALIDATION_FAILED)
  })

  it('logs show system as Hệ thống, label actions, link posts, and filter by action', async () => {
    const { w } = await mountAt('/admin?tab=logs', {
      'GET /api/admin/logs': ok({
        items: [
          log(),
          log({ id: 'l2', actor: 'system', action: 'auto_hide', targetType: 'post', targetId: 'p7' }),
          log({ id: 'l3', action: 'ban', targetType: 'user', targetId: 'u9', note: 'spam' }),
        ],
        nextCursor: null,
      }),
    })
    const rows = w.findAll('[data-test="log-row"]')
    expect(rows[1]!.text()).toContain('Hệ thống')
    expect(rows[1]!.text()).toContain(vi.admin.actions.auto_hide)
    expect(rows[0]!.find('a').attributes('href')).toBe('/posts/p1')
    expect(rows[2]!.find('a').exists()).toBe(false)
    expect(rows[2]!.text()).toContain('u9')
    expect(rows[2]!.text()).toContain('spam')
    await setVal(w.find('[data-test="log-action"]').element, 'ban', 'change')
    expect(fake!.callsTo('GET /api/admin/logs').at(-1)!.query.get('action')).toBe('ban')
  })

  it('settings accepts fractional GB/MB exactly, form has no blocking constraints', async () => {
    const { w } = await mountAt('/admin?tab=settings', {
      'GET /api/admin/settings': ok(settings),
      'PATCH /api/admin/settings': (req) => ok({ ...settings, ...(req.body as object) }),
    })
    expect(w.find('form').attributes('novalidate')).toBeDefined()
    expect(w.find('[data-test="set-dailyUploadQuotaBytes"]').attributes('min')).toBeUndefined()
    await setVal(w.find('[data-test="set-dailyUploadQuotaBytes"]').element, '0.5')
    w.find('form').element.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo('PATCH /api/admin/settings')[0]!.body).toEqual({ dailyUploadQuotaBytes: 536870912 })
    await setVal(w.find('[data-test="set-dailyUploadQuotaBytes"]').element, '3')
    await setVal(w.find('[data-test="set-dailyUploadQuotaBytes"]').element, '2')
    w.find('form').element.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo('PATCH /api/admin/settings')[1]!.body).toEqual({ dailyUploadQuotaBytes: 2147483648 })
  })

  it('settings rejects values that are not safe integers in bytes', async () => {
    const { w } = await mountAt('/admin?tab=settings', { 'GET /api/admin/settings': ok(settings), 'PATCH /api/admin/settings': ok(settings) })
    await setVal(w.find('[data-test="set-dailyUploadQuotaBytes"]').element, '99999999999')
    w.find('form').element.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo('PATCH /api/admin/settings')).toHaveLength(0)
    expect(w.text()).toContain(vi.admin.settings.invalid)
  })

  it('row selects are labelled with the username', async () => {
    const { w } = await mountAt('/admin', { 'GET /api/admin/users': users(user({ username: 'alice' })) })
    expect(w.find('[data-test="role-select"]').attributes('aria-label')).toBe('Vai trò của @alice')
    expect(w.find('[data-test="status-select"]').attributes('aria-label')).toBe('Trạng thái của @alice')
  })

  it('CANNOT_CHANGE_OWN_ROLE shows vi message', async () => {
    const { w } = await mountAt('/admin', { 'GET /api/admin/users': users(user()), 'POST /api/admin/users/u2/role': err(403, 'CANNOT_CHANGE_OWN_ROLE') })
    await setVal(w.find('[data-test="role-select"]').element, 'moderator', 'change')
    modal().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(document.body.textContent).toContain('Bạn không thể tự đổi vai trò của mình')
  })

  it('tab lives in the query string', async () => {
    const { w, router } = await mountAt('/admin', { 'GET /api/admin/users': users(), 'GET /api/admin/logs': ok({ items: [], nextCursor: null }) })
    await w.findAll('[role="tab"]')[2]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('logs')
  })
})

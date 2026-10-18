import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { i18n } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import type { NotificationDto } from '@/api/types'
import App from '@/App.vue'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRoute } from './fakeApi'

let fake: FakeFetch | undefined
let wrapper: VueWrapper | undefined
let visibility: 'visible' | 'hidden' = 'visible'

beforeEach(() => {
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  fake?.restore()
  fake = undefined
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const ok = (body: unknown) => ({ status: 200, body })
const note = (o: Partial<NotificationDto> = {}): NotificationDto => ({
  id: 'n1', type: 'like', actor: { username: 'mai', displayName: 'Mai', avatarUrl: null },
  post: { id: 'p1', title: 'Mèo' }, commentId: null, readAt: null, createdAt: '2026-01-01T00:00:00Z', ...o,
})

async function mountAt(path: string, routes: Record<string, FakeRoute>, useFake = false) {
  fake = installFakeFetch(routes)
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.ready = true
  auth.setSession({ accessToken: 't', user: makeMe() })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  if (useFake) await vi.advanceTimersByTimeAsync(0)
  else await flushPromises()
  return { w: wrapper, auth }
}

describe('Notification bell', () => {
  it('polls every 60s only while visible and stops after logout (fake timers)', async () => {
    vi.useFakeTimers()
    let count = 3
    const { w, auth } = await mountAt('/', { 'GET /api/notifications/unread-count': () => ok({ count }) }, true)
    const calls = () => fake!.callsTo('GET /api/notifications/unread-count').length
    expect(calls()).toBe(1)
    expect(w.get('[data-test="bell"]').attributes('aria-label')).toBe('Thông báo, 3 chưa đọc')
    expect(w.get('[data-test="bell-badge"]').text()).toBe('3')

    count = 120
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls()).toBe(2)
    expect(w.get('[data-test="bell-badge"]').text()).toBe('99+')

    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(180_000)
    expect(calls()).toBe(2)

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls()).toBe(3)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls()).toBe(4)

    auth.clear()
    await vi.advanceTimersByTimeAsync(0)
    expect(w.find('[data-test="bell"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(180_000)
    expect(calls()).toBe(4)
  })

  it('hides the badge when nothing is unread', async () => {
    const { w } = await mountAt('/', { 'GET /api/notifications/unread-count': ok({ count: 0 }) })
    expect(w.find('[data-test="bell-badge"]').exists()).toBe(false)
  })
})

describe('Notifications page', () => {
  it('renders post_rejected with reason and handles post: null', async () => {
    const { w } = await mountAt('/notifications', {
      'GET /api/notifications/unread-count': ok({ count: 3 }),
      'GET /api/notifications': ok({
        items: [
          note({ id: 'a', type: 'post_rejected', actor: null, reason: 'Thiếu nguồn', post: { id: 'p9', title: 'Tranh' } }),
          note({ id: 'b', type: 'like', post: null }),
          note({ id: 'c', type: 'follow', post: null, readAt: '2026-01-02T00:00:00Z' }),
        ],
        nextCursor: null,
      }),
      'POST /api/notifications/read': { status: 204 },
    })
    const rows = w.findAll('[data-test="notification"]')
    expect(rows[0]!.text()).toContain('Bài «Tranh» bị từ chối: Thiếu nguồn')
    expect(rows[0]!.find('a').attributes('href')).toBe('/posts/p9')
    expect(rows[1]!.text()).toContain('Mai đã thích bài «(bài đã xóa)»')
    expect(rows[1]!.find('a').exists()).toBe(false)
    expect(rows[2]!.text()).toContain('Mai đã theo dõi bạn')
    expect(rows[2]!.find('a').attributes('href')).toBe('/u/mai')
    expect(rows[0]!.classes()).toContain('is-unread')
    expect(rows[2]!.classes()).not.toContain('is-unread')
    // visible unread ones are marked read, once
    const reads = fake!.callsTo('POST /api/notifications/read')
    expect(reads.map((r) => r.body)).toEqual([{ ids: ['a', 'b'] }])
    expect(w.get('[data-test="bell-badge"]').text()).toBe('1')
  })

  it('mark all read posts {all:true} and clears badge', async () => {
    const { w } = await mountAt('/notifications', {
      'GET /api/notifications/unread-count': ok({ count: 5 }),
      'GET /api/notifications': ok({ items: [note({ id: 'a' })], nextCursor: 'c2' }),
      'POST /api/notifications/read': { status: 204 },
    })
    expect(w.get('[data-test="bell-badge"]').text()).toBe('4')
    await w.get('[data-test="mark-all"]').trigger('click')
    await flushPromises()
    expect(fake!.callsTo('POST /api/notifications/read').at(-1)!.body).toEqual({ all: true })
    expect(w.find('[data-test="bell-badge"]').exists()).toBe(false)
    expect(w.find('.is-unread').exists()).toBe(false)
  })
})

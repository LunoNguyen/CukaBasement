import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { i18n } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import type { HiddenCommentDto, ReportGroupDto } from '@/api/types'
import App from '@/App.vue'
import vi from '@/i18n/vi'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRoute } from './fakeApi'
import { author, card } from './fixtures'

let fake: FakeFetch | undefined
let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  fake?.restore()
  fake = undefined
  document.body.innerHTML = ''
})

const ok = (body: unknown) => ({ status: 200, body })
const err = (status: number, code: string) => ({ status, body: { error: { code, message: 'raw' } } })

async function mountAt(path: string, routes: Record<string, FakeRoute>) {
  fake = installFakeFetch(routes)
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.ready = true
  auth.setSession({ accessToken: 't', user: makeMe({ role: 'moderator' }) })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  await flushPromises()
  return { w: wrapper, router }
}

const queue = (...items: ReturnType<typeof card>[]) => ok({ items, nextCursor: null })
const group = (o: Partial<ReportGroupDto> = {}): ReportGroupDto => ({
  post: card({ id: 'p9', title: 'Bài bị báo' }),
  total: 4,
  aiArt: 1,
  reasons: { ai_art: 1, stolen_art: 0, unmarked_r18: 0, spam: 3, other: 0 },
  latest: [{ reason: 'spam', detail: 'quảng cáo', reporter: { username: 'mai' }, createdAt: '2026-01-01T00:00:00Z' }],
  ...o,
})
const hidden = (o: Partial<HiddenCommentDto> = {}): HiddenCommentDto => ({
  id: 'c1', body: 'bình luận ẩn', status: 'hidden', parentId: null, post: { id: 'p1', title: 'Mèo' }, author, createdAt: '2026-01-02T00:00:00Z', ...o,
})
const btn = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text() === text)!
const modal = () => document.body.querySelector('[role="dialog"]') as HTMLElement

describe('Moderation pages', () => {
  it('approve removes item from queue and posts to /mod/posts/:id/approve', async () => {
    const { w } = await mountAt('/mod', {
      'GET /api/mod/queue': queue(card({ id: 'p1', title: 'Mèo' }), card({ id: 'p2', title: 'Chó' })),
      'POST /api/mod/posts/p1/approve': ok({ id: 'p1' }),
    })
    expect(fake!.callsTo('GET /api/mod/queue')[0]!.query.get('status')).toBe('pending')
    expect(w.text()).toContain('Mèo')
    await w.findAll('[data-test="queue-item"]')[0]!.findAll('button').find((b) => b.text() === vi.mod.approve)!.trigger('click')
    await flushPromises()
    expect(fake!.callsTo('POST /api/mod/posts/p1/approve')).toHaveLength(1)
    expect(w.text()).not.toContain('Mèo')
    expect(w.text()).toContain('Chó')
    expect(fake!.callsTo('GET /api/mod/queue')).toHaveLength(1)
  })

  it('reject requires a reason', async () => {
    const { w } = await mountAt('/mod', {
      'GET /api/mod/queue': queue(card({ id: 'p1', title: 'Mèo' })),
      'POST /api/mod/posts/p1/reject': ok({ id: 'p1' }),
    })
    await btn(w, vi.mod.reject).trigger('click')
    await flushPromises()
    const form = modal().querySelector('form')!
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo('POST /api/mod/posts/p1/reject')).toHaveLength(0)
    const ta = modal().querySelector('textarea')!
    expect(ta.maxLength).toBe(500)
    ta.value = 'Vi phạm'
    ta.dispatchEvent(new Event('input'))
    form.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo('POST /api/mod/posts/p1/reject')[0]!.body).toEqual({ reason: 'Vi phạm' })
    expect(w.text()).not.toContain('Mèo')
  })

  it('reports tab shows ai_art count first and resolve keep calls API', async () => {
    const { w } = await mountAt('/mod?tab=reports', {
      'GET /api/mod/reports': ok({ items: [group()] }),
      'POST /api/mod/reports/posts/p9/resolve': ok({ ok: true }),
    })
    const counts = w.findAll('[data-test="reason-count"]').map((e) => e.text())
    expect(counts[0]).toContain(vi.post.reasons.ai_art)
    expect(counts[0]).toContain('1')
    expect(counts[1]).toContain(vi.post.reasons.spam)
    expect(w.text()).toContain('quảng cáo')
    await btn(w, vi.mod.keep).trigger('click')
    await flushPromises()
    expect(fake!.callsTo('POST /api/mod/reports/posts/p9/resolve')[0]!.body).toEqual({ decision: 'keep' })
    expect(w.text()).not.toContain('Bài bị báo')
  })

  it('CANNOT_MODERATE_PEER shows vi message', async () => {
    const { w } = await mountAt('/mod', {
      'GET /api/mod/queue': queue(card({ id: 'p1', title: 'Mèo' })),
      'POST /api/mod/posts/p1/hide': err(403, 'CANNOT_MODERATE_PEER'),
    })
    await btn(w, vi.mod.hide).trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('Không thể kiểm duyệt nội dung của kiểm duyệt viên/quản trị viên khác')
    expect(w.text()).toContain('Mèo')
  })

  it('credit edit modal PATCHes /mod/posts/:id/credit', async () => {
    const { w } = await mountAt('/mod', {
      'GET /api/mod/queue': queue(card({ id: 'p1', title: 'Mèo' })),
      'PATCH /api/mod/posts/p1/credit': ok({ id: 'p1' }),
    })
    await btn(w, vi.mod.editCredit).trigger('click')
    await flushPromises()
    ;(modal().querySelector('[data-test="credit-repost"]') as HTMLInputElement).dispatchEvent(new Event('change'))
    await flushPromises()
    const set = async (sel: string, v: string, ev = 'input') => {
      const el = modal().querySelector(sel) as HTMLInputElement
      el.value = v
      el.dispatchEvent(new Event(ev))
      await flushPromises()
    }
    await set('[data-test="artist-name"]', ' Mai ')
    await set('[data-test="platform"]', 'pixiv', 'change')
    await set('[data-test="source-url"]', 'https://pixiv.net/1')
    modal().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    const body = fake!.callsTo('PATCH /api/mod/posts/p1/credit')[0]!.body as { credit?: unknown }
    expect(body).toMatchObject({ isOwnWork: false, artistName: 'Mai', platform: 'pixiv', sourceUrl: 'https://pixiv.net/1' })
  })

  it('hidden comments tab restores a comment and the tab lives in the URL', async () => {
    const { w, router } = await mountAt('/mod', {
      'GET /api/mod/queue': queue(),
      'GET /api/mod/comments': ok({ items: [hidden()], nextCursor: null }),
      'POST /api/mod/comments/c1/restore': { status: 204 },
    })
    await btn(w, vi.mod.tabs.comments).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBe('comments')
    expect(fake!.callsTo('GET /api/mod/comments')[0]!.query.get('status')).toBe('hidden')
    await btn(w, vi.mod.restore).trigger('click')
    await flushPromises()
    expect(fake!.callsTo('POST /api/mod/comments/c1/restore')).toHaveLength(1)
    expect(w.text()).not.toContain('bình luận ẩn')
  })
})

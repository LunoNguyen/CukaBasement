import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { i18n } from '@/i18n'
import { createAppRouter } from '@/router'
import PostCard from '@/components/post/PostCard.vue'
import CreditLine from '@/components/post/CreditLine.vue'
import type { PostCardDto } from '@/api/types'
import { author, card, media } from './fixtures'
import { useAuth } from '@/stores/auth'
import { installFakeFetch, makeMe, type FakeFetch } from './fakeApi'

let fake: FakeFetch | undefined
afterEach(() => {
  fake?.restore()
  fake = undefined
})

function mountCard(post: PostCardDto, opts: { loggedIn?: boolean; rank?: number } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuth().ready = true
  if (opts.loggedIn) useAuth().setSession({ accessToken: 't', user: makeMe() })
  return mount(PostCard, { props: { post, rank: opts.rank }, global: { plugins: [pinia, createAppRouter(createMemoryHistory()), i18n] } })
}

describe('PostCard', () => {
  it('a square, centre-cropped cover linking to the post; title and author (avatar + name) below', () => {
    const w = mountCard(card({ author: { ...author, avatarUrl: 'http://cdn/a.webp' } }))
    const img = w.get('[data-test="card-link"] img')
    expect(img.attributes('src')).toBe('http://cdn/t.webp')
    expect(img.attributes('loading')).toBe('lazy')
    expect(img.attributes('alt')).toBe('Mèo')
    expect(img.classes()).toContain('object-cover')
    const link = w.get('[data-test="card-link"]')
    expect(link.attributes('href')).toBe('/posts/p1')
    expect(link.classes()).toEqual(expect.arrayContaining(['aspect-square', 'rounded-lg']))
    expect(w.get('[data-test="card-title"]').text()).toBe('Mèo')
    const by = w.get('[data-test="card-author"]')
    expect(by.attributes('href')).toBe('/u/cuka')
    expect(by.text()).toBe('Cuka')
    expect(by.get('img').classes()).toContain('rounded-full')
    // No masonry: every cover is the same square, whatever its own shape.
    expect(link.attributes('style') ?? '').not.toContain('aspect-ratio')
  })

  it('heart: logged out it links to login; logged in it likes, then unlikes', async () => {
    const out = mountCard(card())
    expect(out.get('[data-test="card-like"]').attributes('href')).toBe('/login?next=/posts/p1')
    fake = installFakeFetch({
      'POST /api/posts/p1/like': { status: 200, body: { liked: true, likes: 8 } },
      'DELETE /api/posts/p1/like': { status: 200, body: { liked: false, likes: 7 } },
    })
    const w = mountCard(card(), { loggedIn: true })
    const heart = w.get('[data-test="card-like"]')
    expect(heart.element.tagName).toBe('BUTTON')
    expect(heart.attributes('aria-pressed')).toBe('false')
    await heart.trigger('click')
    await flushPromises()
    expect(fake.callsTo('POST /api/posts/p1/like')).toHaveLength(1)
    expect(heart.attributes('aria-pressed')).toBe('true')
    await heart.trigger('click')
    await flushPromises()
    expect(fake.callsTo('DELETE /api/posts/p1/like')).toHaveLength(1)
    expect(heart.attributes('aria-pressed')).toBe('false')
  })

  it('a rank badge when ranked; 1–3 stand out in the accent', () => {
    expect(mountCard(card()).find('[data-test="rank"]').exists()).toBe(false)
    const top = mountCard(card(), { rank: 2 }).get('[data-test="rank"]')
    expect(top.text()).toBe('2')
    expect(top.classes()).toContain('bg-[var(--c-accent)]')
    expect(mountCard(card(), { rank: 7 }).get('[data-test="rank"]').classes()).not.toContain('bg-[var(--c-accent)]')
  })

  it('renders placeholder (no <img>) when cover url is null (Review Focus 5)', () => {
    expect(mountCard(card({ cover: media({ thumbSmUrl: null }) })).find('img').exists()).toBe(false)
    expect(mountCard(card({ cover: null })).find('img').exists()).toBe(false)
  })

  it('the placeholder says the media is still processing', () => {
    expect(mountCard(card({ cover: media({ thumbSmUrl: null }) })).text()).toContain('Đang xử lý')
    expect(mountCard(card()).text()).not.toContain('Đang xử lý')
  })

  it('shows a repost credit as plain text under the title (no link nested in the card link)', () => {
    const credit = { isOwnWork: false, artistName: 'Funo', artistHandle: '@funo_yun', platform: 'x' as const, sourceUrl: 'https://x.com/funo_yun/status/1', permissionNote: '' }
    const w = mountCard(card({ credit }))
    expect(w.get('[data-test="card-credit"]').text()).toBe('Art by @funo_yun · X')
    expect(w.get('[data-test="card-credit"]').element.tagName).not.toBe('A')
    expect(mountCard(card()).find('[data-test="card-credit"]').exists()).toBe(false)
  })

  it('shows the red R18 badge for R18 posts (blurred or not)', () => {
    expect(mountCard(card({ cover: media({ blurred: true }) })).text()).toContain('R18')
    expect(mountCard(card({ rating: 'r18' })).get('.badge-r18').text()).toBe('R18')
    expect(mountCard(card()).text()).not.toContain('R18')
  })

  it('shows page count only when more than one page', () => {
    expect(mountCard(card({ pageCount: 5 })).get('[data-test="pages"]').text()).toBe('5')
    expect(mountCard(card()).find('[data-test="pages"]').exists()).toBe(false)
  })

  it('shows a type icon for video and audio', () => {
    expect(mountCard(card({ type: 'video' })).find('[data-test="type-icon"]').exists()).toBe(true)
    expect(mountCard(card({ type: 'audio' })).find('[data-test="type-icon"]').exists()).toBe(true)
    expect(mountCard(card()).find('[data-test="type-icon"]').exists()).toBe(false)
  })
})

describe('CreditLine', () => {
  const props = (credit: object) => ({
    props: { credit: { ...card().credit, ...credit }, author },
    global: { plugins: [i18n] },
  })

  it('own work shows © @username', () => {
    expect(mount(CreditLine, props({})).text()).toBe('© @cuka')
  })

  it('repost shows "Art by @_rurisuisen · X" linked to sourceUrl with rel noopener', () => {
    const w = mount(CreditLine, props({
      isOwnWork: false, artistName: 'Ruri', artistHandle: '_rurisuisen', platform: 'x', sourceUrl: 'https://x.com/_rurisuisen/status/1',
    }))
    expect(w.text()).toBe('Art by @_rurisuisen · X')
    const a = w.get('a')
    expect(a.attributes('href')).toBe('https://x.com/_rurisuisen/status/1')
    expect(a.attributes('target')).toBe('_blank')
    expect(a.attributes('rel')).toBe('noopener noreferrer nofollow')
  })

  it('falls back to artistName and omits the label for platform other', () => {
    const w = mount(CreditLine, props({ isOwnWork: false, artistName: 'Ruri', artistHandle: '', platform: 'other', sourceUrl: 'https://e.com/a' }))
    expect(w.text()).toBe('Art by Ruri')
  })
})

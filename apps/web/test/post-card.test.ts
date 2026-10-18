import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory } from 'vue-router'
import { i18n } from '@/i18n'
import { createAppRouter } from '@/router'
import PostCard from '@/components/post/PostCard.vue'
import CreditLine from '@/components/post/CreditLine.vue'
import type { PostCardDto } from '@/api/types'
import { author, card, media } from './fixtures'

const mountCard = (post: PostCardDto) =>
  mount(PostCard, { props: { post }, global: { plugins: [createAppRouter(createMemoryHistory()), i18n] } })

describe('PostCard', () => {
  it('renders a lazy image with the title as alt and links to the post', () => {
    const w = mountCard(card())
    const img = w.get('img')
    expect(img.attributes('src')).toBe('http://cdn/t.webp')
    expect(img.attributes('loading')).toBe('lazy')
    expect(img.attributes('alt')).toBe('Mèo')
    expect(w.element.tagName).toBe('A')
    expect(w.attributes('href')).toBe('/posts/p1')
    expect(w.text()).toContain('Mèo')
    expect(w.text()).toContain('Cuka')
    expect(w.text()).toContain('7')
  })

  it('renders placeholder (no <img>) when cover url is null (Review Focus 5)', () => {
    expect(mountCard(card({ cover: media({ thumbSmUrl: null }) })).find('img').exists()).toBe(false)
    expect(mountCard(card({ cover: null })).find('img').exists()).toBe(false)
  })

  it('shows R18 badge when cover.blurred', () => {
    expect(mountCard(card({ cover: media({ blurred: true }) })).text()).toContain('R18')
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

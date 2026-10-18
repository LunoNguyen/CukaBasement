import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useCursorList } from '@/composables/useCursorList'
import type { Page } from '@/api/types'

type Item = { id: string }
const page = (ids: string[], nextCursor: string | null): Page<Item> => ({ items: ids.map((id) => ({ id })), nextCursor })

describe('useCursorList', () => {
  it('continues past an empty page with a cursor (Review Focus 4)', async () => {
    const pages: Record<string, Page<Item>> = { start: page([], 'a'), a: page([], 'b'), b: page(['p1'], null) }
    const fetchPage = vi.fn(async (c: string | null) => pages[c ?? 'start']!)
    const l = useCursorList(fetchPage)
    await l.loadMore()
    expect(l.items.value).toEqual([{ id: 'p1' }])
    expect(l.done.value).toBe(true)
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('stops after 5 extra empty pages and is not done', async () => {
    const fetchPage = vi.fn(async () => page([], 'more'))
    const l = useCursorList(fetchPage)
    await l.loadMore()
    expect(fetchPage).toHaveBeenCalledTimes(6)
    expect(l.done.value).toBe(false)
    expect(l.items.value).toEqual([])
  })

  it('dedupes items with the same id across pages', async () => {
    const pages = [page(['a', 'b'], 'c1'), page(['b', 'c'], null)]
    let i = 0
    const l = useCursorList(async () => pages[i++]!)
    await l.loadMore()
    await l.loadMore()
    expect(l.items.value.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(l.done.value).toBe(true)
  })

  it('ignores loadMore while loading and after done', async () => {
    let release!: () => void
    const fetchPage = vi.fn(
      () => new Promise<Page<Item>>((r) => (release = () => r(page(['a'], null)))),
    )
    const l = useCursorList(fetchPage)
    const p = l.loadMore()
    void l.loadMore()
    expect(l.loading.value).toBe(true)
    release()
    await p
    await l.loadMore()
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('exposes errors and reset clears state', async () => {
    const l = useCursorList(async () => {
      throw new Error('x')
    })
    await l.loadMore()
    expect(l.error.value).not.toBeNull()
    expect(l.loading.value).toBe(false)
    l.reset()
    expect(l.error.value).toBeNull()
    expect(l.items.value).toEqual([])
  })

  it('discards a response that arrives after reset', async () => {
    let release!: (p: Page<Item>) => void
    const l = useCursorList(() => new Promise<Page<Item>>((r) => (release = r)))
    const p = l.loadMore()
    l.reset()
    release(page(['stale'], null))
    await p
    expect(l.items.value).toEqual([])
    expect(l.done.value).toBe(false)
  })

  it('resets itself when its scope is disposed (unmount): a late response is dropped', async () => {
    let release!: (p: Page<Item>) => void
    const fetchPage = vi.fn(() => new Promise<Page<Item>>((r) => (release = r)))
    const scope = effectScope()
    const l = scope.run(() => useCursorList(fetchPage))!
    const p = l.loadMore()
    scope.stop()
    release(page([], 'more'))
    await p
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(l.items.value).toEqual([])
    expect(l.loading.value).toBe(false)
  })

  it('after a capped-out empty run, auto-loading stops until an explicit loadMore', async () => {
    const fetchPage = vi.fn(async () => page([], 'more'))
    const l = useCursorList(fetchPage)
    await l.autoLoadMore()
    expect(fetchPage).toHaveBeenCalledTimes(6)
    expect(l.stalled.value).toBe(true)
    await l.autoLoadMore()
    expect(fetchPage).toHaveBeenCalledTimes(6)
    await l.loadMore()
    expect(fetchPage).toHaveBeenCalledTimes(12)
    fetchPage.mockResolvedValueOnce(page(['a'], 'next'))
    await l.loadMore()
    expect(l.stalled.value).toBe(false)
    await l.autoLoadMore() // allowed again: one page plus 5 empty follow-ups
    expect(fetchPage).toHaveBeenCalledTimes(19)
  })
})

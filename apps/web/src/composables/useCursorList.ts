import { ref, type Ref } from 'vue'
import { ApiError } from '@/api/client'
import type { Page } from '@/api/types'

/** Extra fetches allowed in one `loadMore` when pages come back empty but a cursor remains. */
const MAX_EMPTY_FOLLOWUPS = 5

export function useCursorList<T extends { id: string }>(fetchPage: (cursor: string | null) => Promise<Page<T>>) {
  const items = ref<T[]>([]) as Ref<T[]>
  const loading = ref(false)
  const done = ref(false)
  const error = ref<ApiError | null>(null)
  let cursor: string | null = null
  let generation = 0

  async function loadMore(): Promise<void> {
    if (loading.value || done.value) return
    const gen = generation
    loading.value = true
    error.value = null
    try {
      for (let extra = 0; ; extra++) {
        const page = await fetchPage(cursor)
        if (gen !== generation) return
        const seen = new Set(items.value.map((i) => i.id))
        const fresh = page.items.filter((i) => !seen.has(i.id) && seen.add(i.id))
        items.value = [...items.value, ...fresh]
        cursor = page.nextCursor
        if (cursor === null) {
          done.value = true
          return
        }
        if (page.items.length > 0 || extra >= MAX_EMPTY_FOLLOWUPS) return
      }
    } catch (e) {
      if (gen !== generation) return
      error.value = e instanceof ApiError ? e : new ApiError('INTERNAL', 0)
    } finally {
      if (gen === generation) loading.value = false
    }
  }

  function reset() {
    generation++
    items.value = []
    cursor = null
    done.value = false
    error.value = null
    loading.value = false
  }

  return { items, loading, done, error, loadMore, reset }
}

import { onBeforeUnmount, watch, type Ref } from 'vue'

/** Calls `onHit` whenever `el` comes within 600px of the viewport. No-op without IntersectionObserver. */
export function useInfiniteTrigger(el: Ref<HTMLElement | null>, onHit: () => void) {
  let observer: IntersectionObserver | null = null

  const stop = watch(
    el,
    (node) => {
      observer?.disconnect()
      observer = null
      if (!node || typeof IntersectionObserver === 'undefined') return
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) onHit()
        },
        { rootMargin: '600px' },
      )
      observer.observe(node)
    },
    { immediate: true, flush: 'post' },
  )

  onBeforeUnmount(() => {
    stop()
    observer?.disconnect()
    observer = null
  })
}

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/** Whether the visitor asked for less motion (checked once on mount; false where matchMedia is missing). */
export function useReducedMotion(): Ref<boolean> {
  const reduced = ref(false)
  onMounted(() => {
    try {
      reduced.value = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    } catch {
      /* ignore */
    }
  })
  return reduced
}

/** Whether a media query matches, kept up to date. */
export function useMedia(query: string): Ref<boolean> {
  const matches = ref(false)
  let mql: MediaQueryList | undefined
  const update = () => (matches.value = !!mql?.matches)
  onMounted(() => {
    try {
      mql = window.matchMedia?.(query)
    } catch {
      mql = undefined
    }
    update()
    mql?.addEventListener?.('change', update)
  })
  onBeforeUnmount(() => mql?.removeEventListener?.('change', update))
  return matches
}

/**
 * Whether `el` is at least `threshold` visible in the viewport. Without IntersectionObserver (old browsers, tests)
 * it counts as visible, so nothing that depends on it is stuck.
 */
export function useInView(el: Ref<HTMLElement | null>, threshold = 0.35): Ref<boolean> {
  const inView = ref(typeof IntersectionObserver === 'undefined')
  let io: IntersectionObserver | undefined
  onMounted(() => {
    if (typeof IntersectionObserver === 'undefined' || !el.value) return
    io = new IntersectionObserver((entries) => {
      for (const e of entries) inView.value = e.isIntersecting && e.intersectionRatio >= threshold
    }, { threshold: [0, threshold] })
    io.observe(el.value)
  })
  onBeforeUnmount(() => io?.disconnect())
  return inView
}

/** Whether the browser tab is visible (media and autoplay pause while it is hidden). */
export function usePageVisible(): Ref<boolean> {
  const visible = ref(true)
  const update = () => (visible.value = document.visibilityState !== 'hidden')
  onMounted(() => {
    update()
    document.addEventListener('visibilitychange', update)
  })
  onBeforeUnmount(() => document.removeEventListener('visibilitychange', update))
  return visible
}

import type { Directive } from 'vue'

/**
 * `v-reveal`: fades an element up the first time it scrolls into view. Without IntersectionObserver, or when the
 * visitor prefers reduced motion, nothing is hidden at all (the CSS only animates under `no-preference`).
 */
export const vReveal: Directive<HTMLElement> = {
  mounted(el) {
    if (typeof IntersectionObserver === 'undefined') return
    try {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    } catch {
      /* ignore */
    }
    el.classList.add('reveal')
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          el.classList.add('is-visible')
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    io.observe(el)
    ;(el as HTMLElement & { _reveal?: IntersectionObserver })._reveal = io
  },
  unmounted(el) {
    ;(el as HTMLElement & { _reveal?: IntersectionObserver })._reveal?.disconnect()
  },
}

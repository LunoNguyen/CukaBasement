<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SpotlightData } from '@cuka/shared'
import Halftone from '../Halftone.vue'
import SmartLink from '../SmartLink.vue'
import { useLanding } from '../context'
import { useInView, usePageVisible, useReducedMotion } from '../motion'
import { panelImage } from './media'

/**
 * Like an agency's "Our artists": each item's picture fills the screen and they cross-fade every `intervalSec`
 * seconds. Pointing at or focusing a name or thumbnail shows it and holds the rotation; there is a pause button
 * too (WCAG 2.2.2). Thumbnails are black and white except the current one. Phones: previous/next and a progress bar.
 * Reduced motion: no rotation and no fades.
 */
const props = defineProps<{ data: SpotlightData }>()
const { t } = useI18n()
const { tx, images, preview } = useLanding()
const headingId = useId()

const root = ref<HTMLElement | null>(null)
const inView = useInView(root, 0.3)
const pageVisible = usePageVisible()
const reduced = useReducedMotion()

const items = computed(() =>
  props.data.items.map((it, i) => ({
    key: `${i}`,
    name: tx(it.name),
    caption: tx(it.caption),
    href: it.href,
    bg: panelImage(it.background, images.value, tx),
    thumb: panelImage(it.thumb, images.value, tx) ?? panelImage(it.background, images.value, tx),
  })),
)
const n = computed(() => items.value.length)
const cur = ref(0)
const held = ref(false)
const wanted = ref(true)
/** Bumped on every change so the progress bar restarts its fill. */
const tick = ref(0)
const running = computed(() => n.value > 1 && wanted.value && !held.value && inView.value && pageVisible.value && !preview)

let timer: ReturnType<typeof setInterval> | undefined
function restart() {
  if (timer) clearInterval(timer)
  timer = undefined
  tick.value++
  if (running.value) timer = setInterval(() => show((cur.value + 1) % n.value, false), props.data.intervalSec * 1000)
}
function show(i: number, user = true) {
  if (!n.value) return
  cur.value = ((i % n.value) + n.value) % n.value
  if (user) restart()
  else tick.value++
}
watch(running, restart)
watch(() => props.data.intervalSec, restart)
watch(n, (count) => {
  if (cur.value >= count) cur.value = 0
  restart()
})
onMounted(() => {
  if (reduced.value) wanted.value = false
  restart()
})
onBeforeUnmount(() => timer && clearInterval(timer))

function hold(i: number) {
  held.value = true
  if (i !== cur.value) show(i)
}
function release() {
  held.value = false
}
function onFocusOut(e: FocusEvent) {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) release()
}
const pad = (i: number) => String(i + 1).padStart(2, '0')
const art = ['tr', 'bl', 'br', 'tl', 'c'] as const
</script>

<template>
  <section ref="root" data-test="fp-spotlight" :aria-labelledby="headingId" class="relative isolate flex flex-1 flex-col overflow-hidden bg-[var(--c-cellar-deep)] text-[#f3ebe6]">
    <!-- Backgrounds -->
    <div class="absolute inset-0 -z-10" aria-hidden="true">
      <div
        v-for="(it, i) in items"
        :key="it.key"
        class="absolute inset-0 transition-opacity duration-[1200ms] ease-out motion-reduce:transition-none"
        :class="i === cur ? 'opacity-100' : 'opacity-0'"
        data-test="spotlight-bg"
      >
        <img v-if="it.bg" :src="it.bg.src" :srcset="it.bg.srcset" sizes="100vw" alt="" :loading="i === 0 ? 'eager' : 'lazy'" decoding="async" class="h-full w-full object-cover" :class="i === cur ? 'fp-kenburns' : ''" />
        <div v-else class="relative h-full w-full bg-[#17110e]">
          <Halftone class="absolute inset-0 h-full w-full opacity-35" :from="art[i % art.length]" :size="9 + (i % 3) * 2" />
          <span class="absolute right-[6%] bottom-[-6%] font-display text-[clamp(16rem,42vw,44rem)] leading-none font-semibold text-transparent italic [-webkit-text-stroke:1.5px_rgb(255_122_144/0.55)]">{{ it.name.charAt(0) }}</span>
        </div>
      </div>
      <div class="absolute inset-0 bg-[#0f0b09]/45" />
      <div class="absolute inset-y-0 left-0 w-full bg-[#0f0b09]/30 md:w-[58%]" />
    </div>

    <div class="relative flex flex-1 flex-col justify-between gap-8 px-5 pt-24 pb-8 sm:px-10 sm:pb-10 md:pr-20 lg:pr-24">
      <header class="flex flex-col gap-3">
        <p v-if="tx(data.eyebrow)" class="flex items-center gap-3 font-mono text-[11px] tracking-[0.2em] text-[#f3ebe6]/80 uppercase">
          <span class="h-px w-8 bg-[var(--c-cellar-accent)]" aria-hidden="true" />{{ tx(data.eyebrow) }}
        </p>
        <h2 :id="headingId" class="font-display text-[clamp(2.4rem,6vw,6rem)] leading-[0.9] font-semibold tracking-[-0.04em] uppercase">{{ tx(data.heading) }}</h2>
      </header>

      <div class="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <!-- Names (desktop: all; phone: the current one) -->
        <div class="flex min-w-0 flex-col gap-5" @mouseleave="release" @focusout="onFocusOut">
          <ol class="hidden flex-col md:flex" data-test="spotlight-names">
            <li v-for="(it, i) in items" :key="it.key">
              <button
                type="button"
                class="group flex min-h-11 items-baseline gap-4 py-1 text-left transition-opacity duration-300"
                :class="i === cur ? 'opacity-100' : 'opacity-45 hover:opacity-80'"
                :aria-current="i === cur ? 'true' : undefined"
                data-test="spotlight-name"
                @mouseenter="hold(i)"
                @focus="hold(i)"
                @click="hold(i)"
              >
                <span class="w-7 font-mono text-[11px] tracking-[0.14em]" :class="i === cur ? 'text-[var(--c-cellar-accent)]' : ''" aria-hidden="true">{{ pad(i) }}</span>
                <span class="font-display text-[clamp(1.75rem,3.4vw,3.5rem)] leading-[1.02] font-semibold tracking-[-0.03em]">{{ it.name }}</span>
              </button>
            </li>
          </ol>
          <p class="font-display text-[clamp(2.25rem,10vw,3.5rem)] leading-none font-semibold tracking-[-0.03em] md:hidden" aria-hidden="true">{{ items[cur]?.name }}</p>
          <div class="flex min-h-11 flex-wrap items-center gap-x-5 gap-y-2" aria-live="polite">
            <p v-if="items[cur]?.caption" class="font-mono text-xs tracking-[0.12em] text-[#f3ebe6]/85 uppercase" data-test="spotlight-caption">{{ items[cur]!.caption }}</p>
            <SmartLink v-if="items[cur]?.href" :href="items[cur]!.href" class="group inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[#f3ebe6] underline-offset-4 hover:underline" data-test="spotlight-link">
              {{ t('landing.fp.discover', { name: items[cur]!.name }) }}
              <svg viewBox="0 0 24 24" class="size-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </SmartLink>
          </div>
        </div>

        <div class="flex flex-col gap-4 lg:items-end">
          <!-- Thumbnails: a pointer shortcut to the names above (hidden from assistive tech, which has the list). -->
          <div class="hidden gap-2 md:flex" aria-hidden="true" @mouseleave="release">
            <button
              v-for="(it, i) in items"
              :key="it.key"
              type="button"
              tabindex="-1"
              class="relative aspect-[3/4] w-[clamp(4rem,6vw,6.5rem)] overflow-hidden rounded-[2px] border transition-[border-color,transform] duration-300"
              :class="i === cur ? 'border-[#f3ebe6] -translate-y-1' : 'border-transparent'"
              data-test="spotlight-thumb"
              @mouseenter="hold(i)"
              @click="hold(i)"
            >
              <img v-if="it.thumb" :src="it.thumb.src" :srcset="it.thumb.srcset" sizes="7rem" alt="" loading="lazy" decoding="async" class="h-full w-full object-cover transition-[filter] duration-500" :class="i === cur ? '' : 'grayscale'" />
              <span v-else class="flex h-full w-full items-center justify-center bg-[#231a15] font-display text-2xl italic transition-colors" :class="i === cur ? 'text-[var(--c-cellar-accent)]' : 'text-[#a89a90]'">{{ it.name.charAt(0) }}</span>
            </button>
          </div>
          <div class="flex items-center gap-3">
            <button type="button" class="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#f3ebe6]/40 md:hidden" :aria-label="t('landing.prev')" data-test="spotlight-prev" @click="show(cur - 1)">
              <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
            </button>
            <div class="h-px w-full min-w-24 flex-1 bg-[#f3ebe6]/25 lg:w-56 lg:flex-none" aria-hidden="true">
              <div :key="tick" class="h-full bg-[var(--c-cellar-accent)]" :class="running ? 'fp-fill' : ''" :style="running ? { animationDuration: `${data.intervalSec}s` } : { width: `${((cur + 1) / Math.max(n, 1)) * 100}%` }" data-test="spotlight-progress" />
            </div>
            <span class="font-mono text-xs tracking-[0.14em] text-[#f3ebe6]/80" data-test="spotlight-count">{{ pad(cur) }} / {{ String(n).padStart(2, '0') }}</span>
            <button type="button" class="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#f3ebe6]/40 md:hidden" :aria-label="t('landing.next')" data-test="spotlight-next" @click="show(cur + 1)">
              <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
            <button
              v-if="n > 1"
              type="button"
              class="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#f3ebe6]/40 hover:border-[#f3ebe6]"
              :aria-label="wanted ? t('landing.fp.pauseRotation') : t('landing.fp.playRotation')"
              :aria-pressed="!wanted"
              data-test="spotlight-toggle"
              @click="wanted = !wanted"
            >
              <svg v-if="wanted" viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
              <svg v-else viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

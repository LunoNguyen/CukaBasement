<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SpotlightData } from '@cuka/shared'
import SmartLink from './SmartLink.vue'
import { useLanding } from './context'
import { useInView, usePageVisible, useReducedMotion } from './motion'
import { panelImage } from './media'

/**
 * "Looks": the items' pictures cross-fade every `intervalSec` seconds beside the list of names. Pointing at or
 * focusing a name or thumbnail shows it and holds the rotation; there is a pause button too (WCAG 2.2.2). Thumbnails
 * are black and white except the current one. Phones: previous/next. Reduced motion: no rotation and no fades.
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
/** Whether any look has a picture: without one the block is the list alone. */
const pictured = computed(() => items.value.some((it) => it.bg || it.thumb))
</script>

<template>
  <section ref="root" data-test="fp-spotlight" :aria-labelledby="headingId" class="flex flex-col gap-6 border-t border-[var(--c-border)] py-10 sm:py-12">
    <header class="flex flex-col gap-1">
      <h2 :id="headingId" class="text-xl font-bold sm:text-2xl">{{ tx(data.heading) }}</h2>
      <p v-if="tx(data.eyebrow)" data-test="section-subtitle" class="text-[13px] text-[var(--c-muted)]">{{ tx(data.eyebrow) }}</p>
    </header>

    <div class="grid gap-6" :class="pictured ? 'md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-10' : 'max-w-2xl'">
      <!-- The pictures, cross-fading (left out while no look has one) -->
      <div v-if="pictured" class="relative aspect-[4/3] overflow-hidden rounded-lg bg-[var(--c-surface-2)]" aria-hidden="true">
        <div
          v-for="(it, i) in items"
          :key="it.key"
          class="absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none"
          :class="i === cur ? 'opacity-100' : 'opacity-0'"
          data-test="spotlight-bg"
        >
          <img v-if="it.bg" :src="it.bg.src" :srcset="it.bg.srcset" sizes="(min-width: 768px) 60vw, 100vw" alt="" :loading="i === 0 ? 'eager' : 'lazy'" decoding="async" class="h-full w-full object-cover" />
          <span v-else class="flex h-full w-full items-center justify-center text-6xl font-bold text-[var(--c-muted)]">{{ it.name.charAt(0) }}</span>
        </div>
      </div>

      <div class="flex min-w-0 flex-col justify-between gap-6">
        <!-- Names (wide screens: all; phones: the current one) -->
        <div class="flex min-w-0 flex-col gap-3" @mouseleave="release" @focusout="onFocusOut">
          <ol class="hidden flex-col border-t border-[var(--c-border)] md:flex" data-test="spotlight-names">
            <li v-for="(it, i) in items" :key="it.key" class="border-b border-[var(--c-border)]">
              <button
                type="button"
                class="flex min-h-12 w-full items-center gap-3 text-left transition-colors"
                :class="i === cur ? 'text-[var(--c-text)]' : 'text-[var(--c-muted)] hover:text-[var(--c-text)]'"
                :aria-current="i === cur ? 'true' : undefined"
                data-test="spotlight-name"
                @mouseenter="hold(i)"
                @focus="hold(i)"
                @click="hold(i)"
              >
                <span class="w-6 text-xs tabular-nums" :class="i === cur ? 'text-[var(--c-accent-strong)]' : ''" aria-hidden="true">{{ pad(i) }}</span>
                <span class="text-base font-bold">{{ it.name }}</span>
              </button>
            </li>
          </ol>
          <p class="text-lg font-bold md:hidden" aria-hidden="true">{{ items[cur]?.name }}</p>
          <div class="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1" aria-live="polite">
            <p v-if="items[cur]?.caption" class="text-[13px] text-[var(--c-muted)]" data-test="spotlight-caption">{{ items[cur]!.caption }}</p>
            <SmartLink v-if="items[cur]?.href" :href="items[cur]!.href" class="link inline-flex min-h-9 items-center text-[13px]" data-test="spotlight-link">
              {{ t('landing.fp.discover', { name: items[cur]!.name }) }}
            </SmartLink>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <!-- Thumbnails: a pointer shortcut to the names above (hidden from assistive tech, which has the list). -->
          <div v-if="pictured" class="hidden gap-2 md:flex" aria-hidden="true" @mouseleave="release">
            <button
              v-for="(it, i) in items"
              :key="it.key"
              type="button"
              tabindex="-1"
              class="relative aspect-square w-14 overflow-hidden rounded border-2 transition-colors"
              :class="i === cur ? 'border-[var(--c-accent)]' : 'border-transparent'"
              data-test="spotlight-thumb"
              @mouseenter="hold(i)"
              @click="hold(i)"
            >
              <img v-if="it.thumb" :src="it.thumb.src" :srcset="it.thumb.srcset" sizes="3.5rem" alt="" loading="lazy" decoding="async" class="h-full w-full object-cover" :class="i === cur ? '' : 'grayscale'" />
              <span v-else class="flex h-full w-full items-center justify-center bg-[var(--c-surface-2)] text-sm font-bold" :class="i === cur ? 'text-[var(--c-accent-strong)]' : 'text-[var(--c-muted)]'">{{ it.name.charAt(0) }}</span>
            </button>
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="icon-btn border border-[var(--c-border)] md:hidden" :aria-label="t('landing.prev')" data-test="spotlight-prev" @click="show(cur - 1)">
              <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
            </button>
            <button type="button" class="icon-btn border border-[var(--c-border)] md:hidden" :aria-label="t('landing.next')" data-test="spotlight-next" @click="show(cur + 1)">
              <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
            </button>
            <div class="h-0.5 min-w-16 flex-1 bg-[var(--c-border)]" aria-hidden="true">
              <div :key="tick" class="h-full bg-[var(--c-accent)]" :class="running ? 'fp-fill' : ''" :style="running ? { animationDuration: `${data.intervalSec}s` } : { width: `${((cur + 1) / Math.max(n, 1)) * 100}%` }" data-test="spotlight-progress" />
            </div>
            <span class="text-xs text-[var(--c-muted)] tabular-nums" data-test="spotlight-count">{{ pad(cur) }} / {{ String(n).padStart(2, '0') }}</span>
            <button
              v-if="n > 1"
              type="button"
              class="icon-btn border border-[var(--c-border)]"
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

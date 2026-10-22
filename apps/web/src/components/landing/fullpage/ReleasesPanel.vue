<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isExternalHref, type ReleasesData } from '@cuka/shared'
import { fanartShowcase } from '@/api/endpoints/site'
import type { PostCardDto } from '@/api/types'
import Spinner from '@/components/common/Spinner.vue'
import SmartLink from '../SmartLink.vue'
import { useLanding } from '../context'
import { type PanelImage, panelImage } from './media'

/**
 * "New release": a row of square covers filling the width; the hovered or focused one widens into its 16:9 picture
 * while the others narrow and dim (desktop). On phones a cover-flow carousel: the current cover large in the middle,
 * two smaller on each side, with swipe, previous/next and a progress bar. Covers are hand-picked or the newest fanart.
 */
const props = defineProps<{ data: ReleasesData }>()
const { t, locale } = useI18n()
const { tx, images } = useLanding()
const headingId = useId()

interface Card {
  key: string
  title: string
  href: string
  date: string
  cover: PanelImage | undefined
  wide: PanelImage | undefined
}

const posts = ref<PostCardDto[]>([])
const state = ref<'loading' | 'ready' | 'error'>('ready')

async function load() {
  if (props.data.source !== 'latestFanart') return
  state.value = 'loading'
  try {
    posts.value = (await fanartShowcase(props.data.count)).items
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}
onMounted(load)
watch(() => [props.data.source, props.data.count], load)

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale.value === 'en' ? 'en-GB' : 'vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })

const cards = computed<Card[]>(() => {
  if (props.data.source === 'latestFanart') {
    return posts.value.map((p) => {
      const c = p.cover
      const src = c?.thumbMdUrl ?? c?.previewUrl ?? null
      const pic = src ? { src, alt: '', width: c?.width, height: c?.height } : undefined
      const wide = c?.previewUrl ? { src: c.previewUrl, alt: '', width: c.width, height: c.height } : pic
      return { key: p.id, title: p.title, href: `/posts/${p.id}`, date: fmtDate(p.createdAt), cover: pic, wide }
    })
  }
  return props.data.items.map((it, i) => ({
    key: `${i}-${it.cover.fileId}`,
    title: tx(it.title),
    href: it.href,
    date: it.date,
    cover: panelImage(it.cover, images.value, tx),
    wide: panelImage(it.wide, images.value, tx),
  }))
})
const n = computed(() => cards.value.length)
const pad = (i: number) => String(i + 1).padStart(2, '0')

// --- Desktop accordion -------------------------------------------------------------------------------------------
const active = ref<number | null>(null)
const row = ref<HTMLElement | null>(null)
const rowWidth = ref(0)
const rowHeight = ref(0)
let ro: ResizeObserver | undefined
function measure() {
  const el = row.value
  if (!el) return
  rowWidth.value = el.clientWidth
  rowHeight.value = el.clientHeight
}
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !row.value) return
  ro = new ResizeObserver(measure)
  ro.observe(row.value)
  measure()
})
onBeforeUnmount(() => ro?.disconnect())

/** How much the open cover grows so it becomes 16:9 at the row's height (the others share what is left). */
const openGrow = computed(() => {
  const w = rowWidth.value
  const h = rowHeight.value
  const count = n.value
  if (!w || !h || count < 2) return 2.4
  const target = (16 / 9) * h
  const rest = (w - target) / (count - 1)
  if (rest <= 0) return 4
  return Math.min(4, Math.max(1.4, target / rest))
})
function onRowFocusOut(e: FocusEvent) {
  if (!row.value?.contains(e.relatedTarget as Node | null)) active.value = null
}

// --- Phone cover flow ---------------------------------------------------------------------------------------------
const cur = ref(0)
watch(n, (count) => {
  if (cur.value >= count) cur.value = 0
})
const go = (i: number) => (cur.value = ((i % n.value) + n.value) % n.value)
const prev = () => go(cur.value - 1)
const next = () => go(cur.value + 1)
/** Signed distance of card `i` from the current one, going round the shorter way. */
function offset(i: number): number {
  const count = n.value
  let d = (i - cur.value) % count
  if (d > count / 2) d -= count
  if (d < -count / 2) d += count
  return d
}
function flowStyle(i: number) {
  const d = offset(i)
  const a = Math.abs(d)
  return {
    transform: `translateX(calc(-50% + ${d * 56}%)) scale(${1 - Math.min(a, 3) * 0.17})`,
    zIndex: String(10 - a),
    opacity: a > 2 ? '0' : String(1 - a * 0.22),
    pointerEvents: a > 2 ? ('none' as const) : undefined,
  }
}
let touchX: number | null = null
const onTouchStart = (e: TouchEvent) => (touchX = e.touches[0]?.clientX ?? null)
function onTouchEnd(e: TouchEvent) {
  if (touchX === null) return
  const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX
  touchX = null
  if (Math.abs(dx) < 40) return
  if (dx < 0) next()
  else prev()
}
</script>

<template>
  <section data-test="fp-releases" :aria-labelledby="headingId" class="relative isolate flex flex-1 flex-col justify-center gap-8 overflow-hidden bg-[var(--c-cellar)] px-5 pt-24 pb-10 text-[var(--c-cellar-text)] sm:px-10 md:gap-10 md:pr-20 md:pb-14 lg:pr-24">
    <header class="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div class="flex min-w-0 flex-col gap-3">
        <p v-if="tx(data.eyebrow)" class="flex items-center gap-3 font-mono text-[11px] tracking-[0.2em] text-[var(--c-cellar-muted)] uppercase">
          <span class="h-px w-8 bg-[var(--c-cellar-accent)]" aria-hidden="true" />{{ tx(data.eyebrow) }}
        </p>
        <h2 :id="headingId" class="font-display text-[clamp(2.9rem,8.6vw,9rem)] leading-[0.86] font-semibold tracking-[-0.045em] uppercase">{{ tx(data.heading) }}</h2>
      </div>
      <div class="flex items-center gap-5">
        <span v-if="n" class="hidden font-mono text-xs tracking-[0.16em] text-[var(--c-cellar-muted)] md:inline" aria-hidden="true">{{ active === null ? '—' : pad(active) }} / {{ String(n).padStart(2, '0') }}</span>
        <RouterLink v-if="data.source === 'latestFanart'" to="/posts" data-test="releases-all" class="group inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--c-cellar-text)]/35 px-5 text-sm font-semibold hover:border-[var(--c-cellar-text)]">
          {{ t('landing.seeAll') }}
          <svg viewBox="0 0 24 24" class="size-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </RouterLink>
      </div>
    </header>

    <div v-if="state === 'loading'" class="flex justify-center py-16 text-[var(--c-cellar-muted)]"><Spinner /></div>
    <div v-else-if="!n" class="flex flex-col items-start gap-4 rounded-[1.75rem] border border-dashed border-[var(--c-cellar-line)] p-8" data-test="releases-empty">
      <p class="font-display text-2xl font-semibold">{{ t(state === 'error' ? 'landing.fanartError' : 'landing.fanartEmpty') }}</p>
      <RouterLink to="/upload" class="font-semibold text-[var(--c-cellar-accent)] underline-offset-4 hover:underline">{{ t('landing.fanartShare') }}</RouterLink>
    </div>

    <template v-else>
      <!-- Desktop: expanding row -->
      <ul
        ref="row"
        data-test="releases-row"
        class="hidden w-full gap-2 md:flex"
        :style="{ height: `min(calc((100vw - 8.5rem - ${(n - 1) * 0.5}rem) / ${n}), 56svh)` }"
        @mouseleave="active = null"
        @focusout="onRowFocusOut"
      >
        <li
          v-for="(c, i) in cards"
          :key="c.key"
          class="relative min-w-0 basis-0 overflow-hidden rounded-[2px] bg-[var(--c-cellar-surface)] transition-[flex-grow] duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
          :style="{ flexGrow: active === i ? openGrow : 1 }"
          :data-active="active === i ? 'true' : undefined"
          data-test="release-item"
        >
          <SmartLink :href="c.href" class="group absolute inset-0 block focus-visible:outline-offset-[-4px]" @mouseenter="active = i" @focus="active = i">
            <img v-if="c.cover" :src="c.cover.src" :srcset="c.cover.srcset" sizes="(min-width: 768px) 40vw, 100vw" :alt="c.cover.alt" loading="lazy" decoding="async" class="absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-700 motion-reduce:transition-none" :class="active === i && c.wide ? 'scale-[1.04] opacity-0' : 'opacity-100'" />
            <span v-else class="absolute inset-0 flex items-center justify-center font-display text-7xl text-[var(--c-cellar-accent)] italic" aria-hidden="true">{{ c.title.charAt(0) }}</span>
            <img v-if="c.wide && c.wide !== c.cover" :src="c.wide.src" :srcset="c.wide.srcset" sizes="60vw" alt="" loading="lazy" decoding="async" aria-hidden="true" class="absolute inset-0 h-full w-full object-cover transition-opacity duration-700 motion-reduce:transition-none" :class="active === i ? 'opacity-100' : 'opacity-0'" />
            <span class="absolute inset-0 bg-[#0f0b09] transition-opacity duration-500" :class="active !== null && active !== i ? 'opacity-60' : active === i ? 'opacity-25' : 'opacity-0'" aria-hidden="true" />
            <span class="absolute top-4 left-4 font-mono text-[11px] tracking-[0.16em] text-[#f3ebe6]/90" aria-hidden="true">{{ pad(i) }}</span>
            <span class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 text-[#f3ebe6] transition-[opacity,transform] duration-500 motion-reduce:transition-none" :class="active === i ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'">
              <span class="flex min-w-0 flex-col gap-1">
                <span v-if="c.date" class="font-mono text-[11px] tracking-[0.14em] opacity-80">{{ c.date }}</span>
                <span class="font-display text-[clamp(1.25rem,2vw,2rem)] leading-tight font-semibold">{{ c.title }}</span>
              </span>
              <svg viewBox="0 0 24 24" class="size-6 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
            </span>
            <span v-if="isExternalHref(c.href)" class="sr-only">{{ t('landing.fp.newTab') }}</span>
          </SmartLink>
        </li>
      </ul>

      <!-- Phone: cover flow -->
      <div class="flex flex-col gap-6 md:hidden" data-test="releases-flow" role="group" :aria-roledescription="t('landing.fp.carousel')" :aria-label="tx(data.heading)">
        <div class="relative h-[min(64vw,46svh)]" @touchstart.passive="onTouchStart" @touchend="onTouchEnd">
          <div
            v-for="(c, i) in cards"
            :key="c.key"
            class="absolute top-0 left-1/2 aspect-square h-full overflow-hidden rounded-[2px] bg-[var(--c-cellar-surface)] shadow-[0_24px_60px_rgb(0_0_0/0.45)] transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
            :style="flowStyle(i)"
            :aria-hidden="i === cur ? undefined : 'true'"
            data-test="flow-card"
          >
            <SmartLink v-if="i === cur" :href="c.href" class="absolute inset-0 block" data-test="flow-current">
              <img v-if="c.cover" :src="c.cover.src" :srcset="c.cover.srcset" sizes="70vw" :alt="c.cover.alt" decoding="async" class="h-full w-full object-cover" />
              <span class="sr-only">{{ c.title }}</span>
            </SmartLink>
            <button v-else type="button" tabindex="-1" class="absolute inset-0 block" @click="go(i)">
              <img v-if="c.cover" :src="c.cover.src" :srcset="c.cover.srcset" sizes="40vw" alt="" loading="lazy" decoding="async" class="h-full w-full object-cover brightness-[0.55]" />
            </button>
          </div>
        </div>
        <div class="flex flex-col items-center gap-1 text-center">
          <p v-if="cards[cur]?.date" class="font-mono text-[11px] tracking-[0.14em] text-[var(--c-cellar-muted)]">{{ cards[cur]!.date }}</p>
          <p class="font-display text-2xl leading-tight font-semibold" aria-hidden="true">{{ cards[cur]?.title }}</p>
        </div>
        <div class="flex items-center gap-4">
          <button type="button" class="flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--c-cellar-text)]/35" :aria-label="t('landing.prev')" data-test="flow-prev" @click="prev">
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
          </button>
          <div class="h-px flex-1 bg-[var(--c-cellar-line)]" aria-hidden="true">
            <div class="h-full bg-[var(--c-cellar-accent)] transition-[width] duration-500 motion-reduce:transition-none" :style="{ width: `${((cur + 1) / n) * 100}%` }" data-test="flow-progress" />
          </div>
          <span class="font-mono text-xs tracking-[0.14em] text-[var(--c-cellar-muted)]" aria-live="polite" data-test="flow-count">{{ pad(cur) }} / {{ String(n).padStart(2, '0') }}</span>
          <button type="button" class="flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--c-cellar-text)]/35" :aria-label="t('landing.next')" data-test="flow-next" @click="next">
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isExternalHref, type ReleasesData } from '@cuka/shared'
import { fanartShowcase } from '@/api/endpoints/site'
import type { PostCardDto } from '@/api/types'
import Spinner from '@/components/common/Spinner.vue'
import SmartLink from './SmartLink.vue'
import { useLanding } from './context'
import { type PanelImage, panelImage } from './media'

/**
 * "New release": a row of square covers filling the width; the hovered or focused one widens into its 16:9 picture
 * while the others narrow and dim (wide screens). On phones one cover at a time, with swipe, previous/next and a
 * progress line. Covers are hand-picked or the newest fanart.
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
  <section data-test="fp-releases" :aria-labelledby="headingId" class="flex flex-col gap-6 border-t border-[var(--c-border)] py-10 sm:py-12">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div class="flex min-w-0 flex-col gap-1">
        <p v-if="tx(data.eyebrow)" class="text-xs font-semibold text-[var(--c-accent-strong)]">{{ tx(data.eyebrow) }}</p>
        <h2 :id="headingId" class="text-xl font-bold sm:text-2xl">{{ tx(data.heading) }}</h2>
      </div>
      <RouterLink v-if="data.source === 'latestFanart'" to="/" data-test="releases-all" class="inline-flex min-h-9 items-center gap-0.5 text-sm text-[var(--c-muted)] hover:text-[var(--c-text)]">
        {{ t('landing.seeAll') }}
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
      </RouterLink>
    </header>

    <div v-if="state === 'loading'" class="flex justify-center py-12 text-[var(--c-muted)]"><Spinner /></div>
    <div v-else-if="!n" class="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--c-muted)]" data-test="releases-empty">
      <p>{{ t(state === 'error' ? 'landing.fanartError' : 'landing.fanartEmpty') }}</p>
      <RouterLink to="/upload" class="link">{{ t('landing.fanartShare') }}</RouterLink>
    </div>

    <template v-else>
      <!-- Wide screens: a row whose hovered or focused cover opens up (16:9 picture), the others dim. -->
      <ul
        ref="row"
        data-test="releases-row"
        class="hidden h-72 w-full gap-2 md:flex lg:h-80"
        @mouseleave="active = null"
        @focusout="onRowFocusOut"
      >
        <li
          v-for="(c, i) in cards"
          :key="c.key"
          class="relative min-w-0 basis-0 overflow-hidden rounded-lg bg-[var(--c-surface-2)] transition-[flex-grow] duration-500 ease-out motion-reduce:transition-none"
          :style="{ flexGrow: active === i ? openGrow : 1 }"
          :data-active="active === i ? 'true' : undefined"
          data-test="release-item"
        >
          <SmartLink :href="c.href" class="group absolute inset-0 block focus-visible:outline-offset-[-3px]" @mouseenter="active = i" @focus="active = i">
            <img v-if="c.cover" :src="c.cover.src" :srcset="c.cover.srcset" sizes="(min-width: 768px) 40vw, 100vw" :alt="c.cover.alt" loading="lazy" decoding="async" class="absolute inset-0 h-full w-full object-cover transition-opacity duration-500 motion-reduce:transition-none" :class="active === i && c.wide ? 'opacity-0' : 'opacity-100'" />
            <span v-else class="absolute inset-0 flex items-center justify-center text-4xl font-bold text-[var(--c-muted)]" aria-hidden="true">{{ c.title.charAt(0) }}</span>
            <img v-if="c.wide && c.wide !== c.cover" :src="c.wide.src" :srcset="c.wide.srcset" sizes="60vw" alt="" loading="lazy" decoding="async" aria-hidden="true" class="absolute inset-0 h-full w-full object-cover transition-opacity duration-500 motion-reduce:transition-none" :class="active === i ? 'opacity-100' : 'opacity-0'" />
            <span class="absolute inset-0 bg-black transition-opacity duration-300" :class="active !== null && active !== i ? 'opacity-40' : 'opacity-0'" aria-hidden="true" />
            <span class="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-linear-to-t from-black/70 to-transparent p-4 pt-10 text-white transition-opacity duration-300 motion-reduce:transition-none" :class="active === i ? 'opacity-100' : 'opacity-0'">
              <span v-if="c.date" class="text-xs text-white/80">{{ c.date }}</span>
              <span class="text-sm font-bold">{{ c.title }}</span>
            </span>
            <span v-if="isExternalHref(c.href)" class="sr-only">{{ t('landing.fp.newTab') }}</span>
          </SmartLink>
        </li>
      </ul>

      <!-- Phones: one cover at a time with previous / next, swipe and a progress line. -->
      <div class="flex flex-col gap-4 md:hidden" data-test="releases-flow" role="group" :aria-roledescription="t('landing.fp.carousel')" :aria-label="tx(data.heading)">
        <div class="relative aspect-square w-full" @touchstart.passive="onTouchStart" @touchend="onTouchEnd">
          <div
            v-for="(c, i) in cards"
            :key="c.key"
            class="absolute inset-0 overflow-hidden rounded-lg bg-[var(--c-surface-2)] transition-opacity duration-300 motion-reduce:transition-none"
            :class="i === cur ? 'opacity-100' : 'pointer-events-none opacity-0'"
            :aria-hidden="i === cur ? undefined : 'true'"
            data-test="flow-card"
          >
            <SmartLink v-if="i === cur" :href="c.href" class="absolute inset-0 block" data-test="flow-current">
              <img v-if="c.cover" :src="c.cover.src" :srcset="c.cover.srcset" sizes="100vw" :alt="c.cover.alt" decoding="async" class="h-full w-full object-cover" />
              <span class="sr-only">{{ c.title }}</span>
            </SmartLink>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-bold" aria-hidden="true">{{ cards[cur]?.title }}</p>
            <p v-if="cards[cur]?.date" class="text-xs text-[var(--c-muted)]">{{ cards[cur]!.date }}</p>
          </div>
          <span class="text-xs text-[var(--c-muted)] tabular-nums" aria-live="polite" data-test="flow-count">{{ pad(cur) }} / {{ String(n).padStart(2, '0') }}</span>
          <button type="button" class="icon-btn border border-[var(--c-border)]" :aria-label="t('landing.prev')" data-test="flow-prev" @click="prev">
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
          </button>
          <button type="button" class="icon-btn border border-[var(--c-border)]" :aria-label="t('landing.next')" data-test="flow-next" @click="next">
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </div>
        <div class="h-0.5 bg-[var(--c-border)]" aria-hidden="true">
          <div class="h-full bg-[var(--c-accent)] transition-[width] duration-300 motion-reduce:transition-none" :style="{ width: `${((cur + 1) / n) * 100}%` }" data-test="flow-progress" />
        </div>
      </div>
    </template>
  </section>
</template>

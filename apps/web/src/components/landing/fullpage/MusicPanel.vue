<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { type MusicData, type MusicGroup, MUSIC_GROUPS } from '@cuka/shared'
import { useLanding } from '../context'
import { useReducedMotion } from '../motion'
import MusicLightbox from './MusicLightbox.vue'
import MusicThumb from './MusicThumb.vue'
import { formatMusicDate, formatViews, type MusicVideo, musicTabs } from './music'

/**
 * "Âm nhạc / MV": a big title and three tabs of Du Ca's YouTube videos. "MV mới" features the newest MV large with
 * the next ones beside it, "MV phổ biến" ranks the most watched (1, 2, 3… with view counts), "Video kênh" is a
 * row to scroll (desktop) or swipe (phones) with previous/next. Pictures are our own copies; YouTube's player
 * loads only in the dialog once a video is chosen. Visitors see only tabs that have videos; the admin preview shows
 * the empty ones with a hint. The page's own colours (cream by day, cocoa by night).
 */
const props = defineProps<{ data: MusicData; sectionId: string }>()
const { t } = useI18n()
const { tx, youtube, locale, preview } = useLanding()
const headingId = useId()
const baseId = useId()
const reduced = useReducedMotion()

const lists = computed(() => musicTabs(props.data, props.sectionId, youtube.value, locale.value, t('landing.music.untitled')))
const tabs = computed(() => MUSIC_GROUPS.filter((g) => preview || lists.value[g].length > 0))
const current = ref<MusicGroup>('newest')
watch(
  tabs,
  (list) => {
    if (!list.includes(current.value)) current.value = list[0] ?? 'newest'
  },
  { immediate: true },
)
const label = (g: MusicGroup) => tx(props.data[g].label) || t(`landing.music.tabs.${g}`)
const videos = computed(() => lists.value[current.value])
const featured = computed(() => videos.value[0])
const rest = computed(() => videos.value.slice(1, 5))

const date = (v: MusicVideo) => formatMusicDate(v.date, locale.value)
const views = (v: MusicVideo) => (v.views !== null ? t('landing.music.views', { n: formatViews(v.views, locale.value) }) : '')
const meta = (v: MusicVideo) => [date(v), views(v)].filter(Boolean).join(' · ')
const pad = (i: number) => String(i + 1).padStart(2, '0')

// --- Tabs (WAI-ARIA tabs: arrows, Home and End move and select) -------------------------------------------------
const tabEls = ref<HTMLElement[]>([])
async function select(g: MusicGroup, focus = false) {
  current.value = g
  if (row.value) row.value.scrollLeft = 0
  if (focus) {
    await nextTick()
    tabEls.value[tabs.value.indexOf(g)]?.focus()
  }
}
function onTabKey(e: KeyboardEvent, i: number) {
  const n = tabs.value.length
  let to: number | null = null
  if (e.key === 'ArrowRight') to = (i + 1) % n
  else if (e.key === 'ArrowLeft') to = (i - 1 + n) % n
  else if (e.key === 'Home') to = 0
  else if (e.key === 'End') to = n - 1
  if (to === null) return
  e.preventDefault()
  e.stopPropagation()
  void select(tabs.value[to]!, true)
}

// --- Channel row ------------------------------------------------------------------------------------------------
const row = ref<HTMLElement | null>(null)
function scrollRow(dir: -1 | 1) {
  const el = row.value
  if (!el) return
  el.scrollBy?.({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: reduced.value ? 'auto' : 'smooth' })
}

// --- Player -----------------------------------------------------------------------------------------------------
const playing = ref<MusicVideo | null>(null)
const open = (v: MusicVideo) => (playing.value = v)
</script>

<template>
  <section data-test="fp-music" :aria-labelledby="headingId" class="relative isolate flex flex-1 flex-col gap-5 overflow-hidden px-5 pt-24 pb-8 max-md:max-h-[var(--fp-h,100svh)] text-[var(--c-text)] sm:px-10 md:gap-7 md:pr-20 md:pb-12 lg:pr-24">
    <header class="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
      <div class="flex min-w-0 flex-col gap-3">
        <p v-if="tx(data.eyebrow)" class="flex items-center gap-3 text-[11px] text-[var(--c-muted)]">
          <span class="h-px w-8 bg-[var(--c-accent)]" aria-hidden="true" />{{ tx(data.eyebrow) }}
        </p>
        <h2 :id="headingId" class="font-display text-[clamp(2.6rem,7cqw,7.25rem)] leading-[0.9] font-semibold tracking-[-0.045em]">{{ tx(data.heading) }}</h2>
      </div>
      <div v-if="tabs.length" role="tablist" :aria-label="t('landing.music.tabsLabel')" class="-mx-1 flex max-w-full gap-1 overflow-x-auto rounded-full border border-[var(--c-border)] bg-[var(--c-bg)]/70 p-1 [scrollbar-width:none]" data-test="music-tabs">
        <button
          v-for="(g, i) in tabs"
          :id="`${baseId}-tab-${g}`"
          :key="g"
          :ref="(el) => el && (tabEls[i] = el as HTMLElement)"
          type="button"
          role="tab"
          :aria-selected="current === g"
          :aria-controls="`${baseId}-panel`"
          :tabindex="current === g ? 0 : -1"
          class="min-h-11 shrink-0 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap transition-colors sm:px-5 sm:text-sm"
          :class="current === g ? 'bg-[var(--c-accent-strong)] text-[var(--c-bg)]' : 'text-[var(--c-muted)] hover:text-[var(--c-text)]'"
          :data-test="`music-tab-${g}`"
          @click="select(g)"
          @keydown="onTabKey($event, i)"
        >
          {{ label(g) }}<span class="ml-1.5 hidden sm:inline text-[10px] opacity-70" aria-hidden="true">{{ String(lists[g].length).padStart(2, '0') }}</span>
        </button>
      </div>
    </header>

    <div v-if="tabs.length" :id="`${baseId}-panel`" role="tabpanel" :aria-labelledby="`${baseId}-tab-${current}`" tabindex="0" class="flex min-h-0 flex-1 flex-col focus-visible:outline-offset-4 max-md:-mx-1 max-md:overflow-y-auto max-md:overscroll-contain max-md:px-1" :data-test="`music-panel-${current}`">
      <!-- Empty tab (admin preview only: visitors never see an empty tab) -->
      <div v-if="!videos.length" class="flex flex-1 flex-col items-start justify-center gap-3 rounded-[1.5rem] border border-dashed border-[var(--c-border)] p-8" data-test="music-empty">
        <p class="font-display text-2xl font-semibold">{{ t(`landing.music.empty.${current}`) }}</p>
        <p class="max-w-lg text-sm text-[var(--c-muted)]">{{ t('landing.music.emptyAdmin') }}</p>
      </div>

      <!-- MV mới: the newest large, the next ones beside it -->
      <div v-else-if="current === 'newest'" class="grid min-h-0 flex-1 content-start gap-5 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] md:gap-8">
        <button type="button" class="group flex min-w-0 flex-col gap-3 text-left" :aria-label="t('landing.music.play', { title: featured!.title })" data-test="music-featured" @click="open(featured!)">
          <span class="relative block w-full max-w-[calc((100svh-21rem)*16/9)] min-w-0">
            <MusicThumb :video="featured!" sizes="(min-width: 768px) 60vw, 100vw" play="lg" eager>
              <span class="absolute top-3 left-3 rounded-full bg-[var(--c-accent)] px-3 py-1 text-[10px] font-semibold text-white">{{ t('landing.music.latest') }}</span>
            </MusicThumb>
          </span>
          <span class="flex flex-col gap-1">
            <span v-if="meta(featured!)" class="text-[11px] text-[var(--c-muted)]">{{ meta(featured!) }}</span>
            <span class="line-clamp-2 font-display text-[clamp(1.35rem,2.4cqw,2.4rem)] leading-tight font-semibold text-balance">{{ featured!.title }}</span>
          </span>
        </button>
        <div v-if="rest.length" class="flex min-w-0 flex-col gap-3">
          <p class="hidden text-[11px] text-[var(--c-muted)] md:block">{{ t('landing.music.upNext') }}</p>
          <ul class="flex flex-col gap-2 md:gap-3">
            <!-- Phones show two, so the screen still fits. -->
            <li v-for="(v, i) in rest" :key="v.id" :class="i >= 2 ? 'max-md:hidden' : ''">
              <button type="button" class="group grid w-full grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 rounded-xl p-1.5 text-left hover:bg-[var(--c-surface-2)] md:grid-cols-[9.5rem_minmax(0,1fr)]" :aria-label="t('landing.music.play', { title: v.title })" data-test="music-item" @click="open(v)">
                <MusicThumb :video="v" sizes="160px" />
                <span class="flex min-w-0 flex-col gap-1">
                  <span class="line-clamp-2 text-sm leading-snug font-semibold md:text-base">{{ v.title }}</span>
                  <span v-if="meta(v)" class="text-[10px] text-[var(--c-muted)]">{{ meta(v) }}</span>
                </span>
              </button>
            </li>
          </ul>
        </div>
      </div>

      <!-- MV phổ biến: ranked -->
      <ol v-else-if="current === 'popular'" class="grid min-h-0 flex-1 content-start gap-x-5 gap-y-3 overflow-y-auto md:grid-cols-4 md:gap-y-6 md:overflow-visible" data-test="music-ranking">
        <li v-for="(v, i) in videos.slice(0, 8)" :key="v.id" class="min-w-0">
          <button type="button" class="group grid w-full grid-cols-[2.5rem_8rem_minmax(0,1fr)] items-center gap-3 text-left md:flex md:flex-col md:items-stretch md:gap-3" :aria-label="`${t('landing.music.rank', { n: i + 1 })}: ${t('landing.music.play', { title: v.title })}`" data-test="music-rank-item" @click="open(v)">
            <span class="font-display text-3xl leading-none font-semibold text-[var(--c-accent)] italic md:hidden" aria-hidden="true">{{ i + 1 }}</span>
            <MusicThumb :video="v" sizes="(min-width: 768px) 22vw, 128px">
              <span class="absolute top-2 left-3 hidden font-display text-[clamp(2rem,3.4cqw,3.4rem)] leading-none font-semibold text-white italic [text-shadow:0_2px_12px_rgb(0_0_0/0.5)] md:block" aria-hidden="true">{{ i + 1 }}</span>
            </MusicThumb>
            <span class="flex min-w-0 flex-col gap-1">
              <span class="line-clamp-2 text-sm leading-snug font-semibold md:text-base">{{ v.title }}</span>
              <span v-if="views(v) || date(v)" class="text-[10px] text-[var(--c-muted)]">{{ views(v) || date(v) }}</span>
            </span>
          </button>
        </li>
      </ol>

      <!-- Video kênh: a row to scroll or swipe -->
      <div v-else class="flex min-h-0 flex-1 flex-col justify-center gap-5">
        <ul ref="row" class="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto scroll-smooth px-5 pb-2 sm:scroll-px-10 md:scroll-px-0 [scrollbar-width:thin] motion-reduce:scroll-auto sm:-mx-10 sm:px-10 md:mx-0 md:px-0" :aria-label="label('channel')" data-test="music-row">
          <li v-for="v in videos" :key="v.id" class="w-[78%] shrink-0 snap-start sm:w-[42%] lg:w-[min(30%,26rem)]">
            <button type="button" class="group flex w-full flex-col gap-3 text-left" :aria-label="t('landing.music.play', { title: v.title })" data-test="music-channel-item" @click="open(v)">
              <MusicThumb :video="v" sizes="(min-width: 1024px) 26rem, (min-width: 640px) 42vw, 78vw" />
              <span class="flex flex-col gap-1">
                <span class="line-clamp-2 text-base leading-snug font-semibold">{{ v.title }}</span>
                <span v-if="meta(v)" class="text-[10px] text-[var(--c-muted)]">{{ meta(v) }}</span>
              </span>
            </button>
          </li>
        </ul>
        <div class="flex items-center gap-3">
          <button type="button" class="flex size-11 items-center justify-center rounded-full border border-[var(--c-border)] hover:border-[var(--c-accent-strong)]" :aria-label="t('landing.prev')" data-test="music-prev" @click="scrollRow(-1)">
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
          </button>
          <button type="button" class="flex size-11 items-center justify-center rounded-full border border-[var(--c-border)] hover:border-[var(--c-accent-strong)]" :aria-label="t('landing.next')" data-test="music-next" @click="scrollRow(1)">
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
          <a v-if="data.channelId" :href="`https://www.youtube.com/channel/${data.channelId}`" target="_blank" rel="noopener noreferrer" class="ml-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--c-border)] px-5 text-sm font-semibold hover:border-[var(--c-accent-strong)]" data-test="music-channel-link">
            {{ t('landing.music.channel') }}
            <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
            <span class="sr-only">{{ t('landing.fp.newTab') }}</span>
          </a>
        </div>
      </div>
    </div>
    <p class="text-[10px] text-[var(--c-muted)]">{{ t('landing.music.privacy') }}</p>

    <MusicLightbox :video="playing" :locale="locale" @close="playing = null" />
  </section>
</template>

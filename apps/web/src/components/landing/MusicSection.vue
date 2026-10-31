<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { type MusicData, type MusicGroup, MUSIC_GROUPS } from '@cuka/shared'
import { useLanding } from './context'
import { useReducedMotion } from './motion'
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
  <section data-test="fp-music" :aria-labelledby="headingId" class="flex flex-col gap-5 border-t border-[var(--c-border)] py-10 sm:py-12">
    <header class="flex flex-col gap-3">
      <div class="flex min-w-0 flex-col gap-1">
        <p v-if="tx(data.eyebrow)" class="text-xs font-semibold text-[var(--c-accent-strong)]">{{ tx(data.eyebrow) }}</p>
        <h2 :id="headingId" class="text-xl font-bold sm:text-2xl">{{ tx(data.heading) }}</h2>
      </div>
      <div v-if="tabs.length" role="tablist" :aria-label="t('landing.music.tabsLabel')" class="flex gap-6 overflow-x-auto shadow-[inset_0_-1px_0_var(--c-border)] [scrollbar-width:none]" data-test="music-tabs">
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
          class="min-h-11 shrink-0 border-b-2 text-sm font-semibold whitespace-nowrap transition-colors"
          :class="current === g ? 'border-[var(--c-accent)] text-[var(--c-text)]' : 'border-transparent text-[var(--c-muted)] hover:text-[var(--c-text)]'"
          :data-test="`music-tab-${g}`"
          @click="select(g)"
          @keydown="onTabKey($event, i)"
        >
          {{ label(g) }}<span class="ml-1 text-xs font-normal text-[var(--c-muted)]" aria-hidden="true">{{ lists[g].length }}</span>
        </button>
      </div>
    </header>

    <div v-if="tabs.length" :id="`${baseId}-panel`" role="tabpanel" :aria-labelledby="`${baseId}-tab-${current}`" tabindex="0" class="focus-visible:outline-offset-4" :data-test="`music-panel-${current}`">
      <!-- Empty tab (admin preview only: visitors never see an empty tab) -->
      <div v-if="!videos.length" class="flex flex-col items-center gap-1 py-10 text-center" data-test="music-empty">
        <p class="text-sm font-bold">{{ t(`landing.music.empty.${current}`) }}</p>
        <p class="max-w-lg text-[13px] text-[var(--c-muted)]">{{ t('landing.music.emptyAdmin') }}</p>
      </div>

      <!-- MV mới: the newest large, the next ones beside it -->
      <div v-else-if="current === 'newest'" class="grid gap-5 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] md:gap-8">
        <button type="button" class="group flex min-w-0 flex-col gap-2 text-left" :aria-label="t('landing.music.play', { title: featured!.title })" data-test="music-featured" @click="open(featured!)">
          <MusicThumb :video="featured!" sizes="(min-width: 768px) 60vw, 100vw" play="lg" eager>
            <span class="absolute top-2 left-2 rounded bg-[var(--c-primary)] px-1.5 text-xs leading-5 font-bold text-[var(--c-on-primary)]">{{ t('landing.music.latest') }}</span>
          </MusicThumb>
          <span class="flex flex-col gap-0.5">
            <span class="line-clamp-2 text-base font-bold group-hover:underline">{{ featured!.title }}</span>
            <span v-if="meta(featured!)" class="text-xs text-[var(--c-muted)]">{{ meta(featured!) }}</span>
          </span>
        </button>
        <div v-if="rest.length" class="flex min-w-0 flex-col gap-2">
          <p class="hidden text-xs font-semibold text-[var(--c-muted)] md:block">{{ t('landing.music.upNext') }}</p>
          <ul class="flex flex-col gap-1">
            <li v-for="(v, i) in rest" :key="v.id" :class="i >= 3 ? 'max-md:hidden' : ''">
              <button type="button" class="group grid w-full grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 rounded p-1 text-left hover:bg-[var(--c-surface-2)]" :aria-label="t('landing.music.play', { title: v.title })" data-test="music-item" @click="open(v)">
                <MusicThumb :video="v" sizes="128px" />
                <span class="flex min-w-0 flex-col gap-0.5">
                  <span class="line-clamp-2 text-[13px] leading-snug font-bold">{{ v.title }}</span>
                  <span v-if="meta(v)" class="text-xs text-[var(--c-muted)]">{{ meta(v) }}</span>
                </span>
              </button>
            </li>
          </ul>
        </div>
      </div>

      <!-- MV phổ biến: ranked -->
      <ol v-else-if="current === 'popular'" class="grid grid-cols-2 gap-x-2 gap-y-4 sm:gap-x-4 md:grid-cols-4" data-test="music-ranking">
        <li v-for="(v, i) in videos.slice(0, 8)" :key="v.id" class="min-w-0">
          <button type="button" class="group flex w-full flex-col gap-2 text-left" :aria-label="`${t('landing.music.rank', { n: i + 1 })}: ${t('landing.music.play', { title: v.title })}`" data-test="music-rank-item" @click="open(v)">
            <MusicThumb :video="v" sizes="(min-width: 768px) 22vw, 50vw">
              <span class="absolute top-0 left-0 flex h-8 min-w-8 items-center justify-center rounded-br-lg px-1.5 text-base leading-none font-bold" :class="i < 3 ? 'bg-[var(--c-accent)] text-[var(--c-on-primary)]' : 'bg-black/60 text-white'" aria-hidden="true">{{ i + 1 }}</span>
            </MusicThumb>
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="line-clamp-2 text-[13px] leading-snug font-bold group-hover:underline">{{ v.title }}</span>
              <span v-if="views(v) || date(v)" class="text-xs text-[var(--c-muted)]">{{ views(v) || date(v) }}</span>
            </span>
          </button>
        </li>
      </ol>

      <!-- Video kênh: a row to scroll or swipe -->
      <div v-else class="flex flex-col gap-3">
        <ul ref="row" class="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:thin] motion-reduce:scroll-auto" :aria-label="label('channel')" data-test="music-row">
          <li v-for="v in videos" :key="v.id" class="w-[70%] shrink-0 snap-start sm:w-[40%] lg:w-[calc((100%-3rem)/4)]">
            <button type="button" class="group flex w-full flex-col gap-2 text-left" :aria-label="t('landing.music.play', { title: v.title })" data-test="music-channel-item" @click="open(v)">
              <MusicThumb :video="v" sizes="(min-width: 1024px) 18rem, (min-width: 640px) 40vw, 70vw" />
              <span class="flex flex-col gap-0.5">
                <span class="line-clamp-2 text-[13px] leading-snug font-bold group-hover:underline">{{ v.title }}</span>
                <span v-if="meta(v)" class="text-xs text-[var(--c-muted)]">{{ meta(v) }}</span>
              </span>
            </button>
          </li>
        </ul>
        <div class="flex items-center gap-2">
          <button type="button" class="icon-btn border border-[var(--c-border)]" :aria-label="t('landing.prev')" data-test="music-prev" @click="scrollRow(-1)">
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
          </button>
          <button type="button" class="icon-btn border border-[var(--c-border)]" :aria-label="t('landing.next')" data-test="music-next" @click="scrollRow(1)">
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
          <a v-if="data.channelId" :href="`https://www.youtube.com/channel/${data.channelId}`" target="_blank" rel="noopener noreferrer" class="ml-auto inline-flex min-h-10 items-center gap-1 text-sm text-[var(--c-muted)] hover:text-[var(--c-text)]" data-test="music-channel-link">
            {{ t('landing.music.channel') }}
            <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
            <span class="sr-only">{{ t('landing.fp.newTab') }}</span>
          </a>
        </div>
      </div>
    </div>
    <p class="text-xs text-[var(--c-muted)]">{{ t('landing.music.privacy') }}</p>

    <MusicLightbox :video="playing" :locale="locale" @close="playing = null" />
  </section>
</template>

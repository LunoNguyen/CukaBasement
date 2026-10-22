<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { type HomeSection, pickText } from '@cuka/shared'
import type { SiteImageDto, SiteVideoDto } from '@/api/types'
import AboutSection from '../AboutSection.vue'
import BannerSection from '../BannerSection.vue'
import FanartSection from '../FanartSection.vue'
import GallerySection from '../GallerySection.vue'
import HeroSection from '../HeroSection.vue'
import LinksSection from '../LinksSection.vue'
import ProfileSection from '../ProfileSection.vue'
import TimelineSection from '../TimelineSection.vue'
import VideosSection from '../VideosSection.vue'
import { provideLanding } from '../context'
import DotNav from './DotNav.vue'
import FooterPanel from './FooterPanel.vue'
import HeroVideoPanel from './HeroVideoPanel.vue'
import ReleasesPanel from './ReleasesPanel.vue'
import SpotlightPanel from './SpotlightPanel.vue'
import VibePanel from './VibePanel.vue'
import type { PanelTone } from './media'

/**
 * The landing page as full screens: each section fills the viewport and the page snaps one screen at a time (native
 * CSS scroll snap, set on <html> by the page; a screen whose content is taller simply scrolls). A dot navigation on
 * the right and PageUp/PageDown/arrows/Home/End move between screens. The admin preview draws the same screens at a
 * fixed height, without snapping, keys or dots.
 */
const props = withDefaults(
  defineProps<{ sections: HomeSection[]; images: Record<string, SiteImageDto>; videos?: Record<string, SiteVideoDto>; locale?: string; preview?: boolean }>(),
  { videos: () => ({}), locale: undefined, preview: false },
)
const emit = defineEmits<{ active: [index: number, tone: PanelTone] }>()
const { t, locale: uiLocale } = useI18n()
const loc = computed(() => props.locale ?? uiLocale.value)
provideLanding({ locale: loc, images: computed(() => props.images), videos: computed(() => props.videos), preview: props.preview })
const tx = (v: Parameters<typeof pickText>[0]) => pickText(v, loc.value)

const DARK = new Set(['heroVideo', 'releases', 'spotlight', 'footer', 'hero', 'banner'])

/** Whether a section has anything to show a visitor (the preview keeps empty ones). */
function hasContent(s: HomeSection): boolean {
  if (s.type === 'releases') return s.data.source === 'latestFanart' || s.data.items.length > 0
  return !('items' in s.data) || s.data.items.length > 0
}

function nameOf(s: HomeSection): string {
  switch (s.type) {
    case 'heroVideo':
      return tx(s.data.name)
    case 'hero':
      return tx(s.data.title)
    case 'vibe':
      return tx(s.data.eyebrow) || t('landing.fp.vibe')
    case 'footer':
      return t('landing.fp.footer')
    case 'banner':
      return tx(s.data.eyebrow) || t('admin.home.types.banner')
    default:
      return tx(s.data.heading)
  }
}

const rows = computed(() => {
  let n = 0
  let light = 0
  const list = props.sections.filter((s) => s.visible && (props.preview || hasContent(s)))
  const firstHero = list.findIndex((s) => s.type === 'heroVideo' || s.type === 'hero')
  return list.map((s, i) => {
    const tone: PanelTone = DARK.has(s.type) ? 'dark' : 'page'
    const band: 'cream' | 'soft' = light++ % 2 === 0 ? 'cream' : 'soft'
    const index = DARK.has(s.type) || s.type === 'vibe' ? 0 : ++n
    return { s, tone, band, index, name: nameOf(s) || t(`admin.home.types.${s.type}`), level: (i === firstHero ? 1 : 2) as 1 | 2, short: false }
  })
})
const hasH1 = computed(() => rows.value.some((r) => r.level === 1))

// --- Which screen is in view ---------------------------------------------------------------------------------------
const panels = ref<HTMLElement[]>([])
const active = ref(0)
let io: IntersectionObserver | undefined

function observe() {
  io?.disconnect()
  if (props.preview || typeof IntersectionObserver === 'undefined') return
  // The screen crossing the middle of the viewport is the current one (works for taller screens too).
  io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const i = panels.value.indexOf(e.target as HTMLElement)
        if (i >= 0) active.value = i
      }
    },
    { rootMargin: '-50% 0px -50% 0px', threshold: 0 },
  )
  for (const p of panels.value) io.observe(p)
}
watch(
  () => rows.value.map((r) => r.s.id).join(),
  async () => {
    panels.value = []
    await nextTick()
    observe()
  },
)
watch(
  [active, rows],
  () => {
    const r = rows.value[active.value]
    if (r) emit('active', active.value, r.tone)
  },
  { immediate: true },
)

function reducedMotion(): boolean {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Scrolls screen `i` into view; `focus` moves keyboard focus there too (dot navigation). */
function goTo(i: number, focus = false) {
  const el = panels.value[Math.max(0, Math.min(i, panels.value.length - 1))]
  if (!el) return
  active.value = panels.value.indexOf(el)
  el.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: rows.value[active.value]?.short ? 'end' : 'start' })
  if (focus) el.focus({ preventScroll: true })
}

const TYPING = /^(INPUT|TEXTAREA|SELECT|OPTION)$/
function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
  const target = e.target as HTMLElement | null
  if (target && (TYPING.test(target.tagName) || target.isContentEditable || target.closest('[role="dialog"]'))) return
  if (document.documentElement.classList.contains('fp-menu-open')) return
  const el = panels.value[active.value]
  const rect = el?.getBoundingClientRect()
  const vh = window.innerHeight
  let to: number | null = null
  switch (e.key) {
    case 'PageDown':
    case 'ArrowDown':
      // A screen taller than the viewport is read to its end first.
      if (rect && rect.bottom > vh + 2) return
      to = active.value + 1
      break
    case 'PageUp':
    case 'ArrowUp':
      if (rect && rect.top < -2) return
      to = active.value - 1
      break
    case 'Home':
      to = 0
      break
    case 'End':
      to = panels.value.length - 1
      break
    default:
      return
  }
  e.preventDefault()
  goTo(to)
}

onMounted(() => {
  observe()
  if (!props.preview) window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  io?.disconnect()
  window.removeEventListener('keydown', onKey)
})

defineExpose({ goTo })
</script>

<template>
  <div data-test="fullpage" class="fp-root" :class="preview ? 'fp-preview' : ''">
    <h1 v-if="!hasH1" class="sr-only">{{ t('common.siteName') }}</h1>
    <slot name="chrome" />
    <div
      v-for="(r, i) in rows"
      :key="r.s.id"
      :ref="(el) => el && (panels[i] = el as HTMLElement)"
      class="fp-panel"
      :class="[r.short ? 'fp-short' : '', r.tone === 'dark' ? 'bg-[var(--c-cellar)]' : r.band === 'soft' ? 'bg-[var(--c-soft)]' : 'bg-[var(--c-bg)]']"
      :data-tone="r.tone"
      :data-section="r.s.type"
      :aria-current="!preview && i === active ? 'true' : undefined"
      tabindex="-1"
      data-test="fp-panel"
    >
      <HeroVideoPanel v-if="r.s.type === 'heroVideo'" :data="r.s.data" :level="r.level" />
      <ReleasesPanel v-else-if="r.s.type === 'releases'" :data="r.s.data" />
      <SpotlightPanel v-else-if="r.s.type === 'spotlight'" :data="r.s.data" />
      <VibePanel v-else-if="r.s.type === 'vibe'" :data="r.s.data" />
      <FooterPanel v-else-if="r.s.type === 'footer'" :data="r.s.data" @top="goTo(0, true)" />
      <!-- Long-form sections (an older homepage, or added by an admin) get a screen each and keep their layout. -->
      <div v-else class="flex flex-1 flex-col justify-center pt-12">
        <HeroSection v-if="r.s.type === 'hero'" :data="r.s.data" :level="r.level" />
        <AboutSection v-else-if="r.s.type === 'about'" :data="r.s.data" :index="r.index" :tone="r.band" />
        <ProfileSection v-else-if="r.s.type === 'profile'" :data="r.s.data" :index="r.index" :tone="r.band" />
        <TimelineSection v-else-if="r.s.type === 'timeline'" :data="r.s.data" :index="r.index" :tone="r.band" />
        <GallerySection v-else-if="r.s.type === 'gallery'" :data="r.s.data" :index="r.index" :tone="r.band" />
        <VideosSection v-else-if="r.s.type === 'videos'" :data="r.s.data" :index="r.index" :tone="r.band" />
        <LinksSection v-else-if="r.s.type === 'links'" :data="r.s.data" :index="r.index" :tone="r.band" />
        <FanartSection v-else-if="r.s.type === 'fanart'" :data="r.s.data" :index="r.index" :tone="r.band" />
        <BannerSection v-else-if="r.s.type === 'banner'" :data="r.s.data" />
      </div>
    </div>
    <DotNav v-if="!preview && rows.length > 1" :items="rows.map((r) => ({ name: r.name, tone: r.tone }))" :active="active" @go="(i) => goTo(i, true)" />
  </div>
</template>

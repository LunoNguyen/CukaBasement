<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HomeSection } from '@cuka/shared'
import type { PageYouTubeDto, SiteImageDto, SiteVideoDto } from '@/api/types'
import AboutSection from './AboutSection.vue'
import BannerSection from './BannerSection.vue'
import FanartSection from './FanartSection.vue'
import GallerySection from './GallerySection.vue'
import HeroSection from './HeroSection.vue'
import HeroVideoSection from './HeroVideoSection.vue'
import LinksSection from './LinksSection.vue'
import MusicSection from './MusicSection.vue'
import ProfileSection from './ProfileSection.vue'
import ReleasesSection from './ReleasesSection.vue'
import SpotlightSection from './SpotlightSection.vue'
import TimelineSection from './TimelineSection.vue'
import VideosSection from './VideosSection.vue'
import { provideLanding } from './context'
import { musicTabs } from './music'

/**
 * The Introduction page's sections in order, as one normal-scrolling page; the public page and the admin preview
 * both use it. The first opening block (heroVideo or hero) carries the page's h1, every other heading is an h2.
 * `vibe` and `footer` (sections of the old full-screen landing page) are not shown.
 */
const props = withDefaults(
  defineProps<{
    sections: HomeSection[]
    images: Record<string, SiteImageDto>
    videos?: Record<string, SiteVideoDto>
    youtube?: PageYouTubeDto
    locale?: string
    preview?: boolean
  }>(),
  { videos: () => ({}), youtube: () => ({ feeds: {}, videos: {} }), locale: undefined, preview: false },
)

const { t, locale: uiLocale } = useI18n()
const loc = computed(() => props.locale ?? uiLocale.value)
provideLanding({
  locale: loc,
  images: computed(() => props.images),
  videos: computed(() => props.videos),
  youtube: computed(() => props.youtube),
  preview: props.preview,
})

const HIDDEN_TYPES = new Set(['vibe', 'footer'])

/** Whether a section has anything to show a visitor (the editor preview keeps empty ones, with their hints). */
function hasContent(s: HomeSection): boolean {
  if (s.type === 'releases') return s.data.source === 'latestFanart' || s.data.items.length > 0
  if (s.type === 'music') return Object.values(musicTabs(s.data, s.id, props.youtube, loc.value, '')).some((l) => l.length > 0)
  return !('items' in s.data) || s.data.items.length > 0
}

const rows = computed(() => {
  const list = props.sections.filter((s) => s.visible && !HIDDEN_TYPES.has(s.type) && (props.preview || hasContent(s)))
  const first = list.findIndex((s) => s.type === 'heroVideo' || s.type === 'hero')
  return list.map((s, i) => ({ s, level: (i === first ? 1 : 2) as 1 | 2 }))
})
const hasH1 = computed(() => rows.value.some((r) => r.level === 1))
</script>

<template>
  <div data-test="landing-sections">
    <h1 v-if="!hasH1 && !preview" class="sr-only">{{ t('nav.intro') }}</h1>
    <div v-for="{ s, level } in rows" :key="s.id" data-test="intro-block" :data-section="s.type">
      <HeroVideoSection v-if="s.type === 'heroVideo'" :data="s.data" :level="level" />
      <HeroSection v-else-if="s.type === 'hero'" :data="s.data" :level="level" />
      <MusicSection v-else-if="s.type === 'music'" :data="s.data" :section-id="s.id" />
      <ReleasesSection v-else-if="s.type === 'releases'" :data="s.data" />
      <SpotlightSection v-else-if="s.type === 'spotlight'" :data="s.data" />
      <AboutSection v-else-if="s.type === 'about'" :data="s.data" />
      <ProfileSection v-else-if="s.type === 'profile'" :data="s.data" />
      <TimelineSection v-else-if="s.type === 'timeline'" :data="s.data" />
      <GallerySection v-else-if="s.type === 'gallery'" :data="s.data" />
      <VideosSection v-else-if="s.type === 'videos'" :data="s.data" />
      <LinksSection v-else-if="s.type === 'links'" :data="s.data" />
      <FanartSection v-else-if="s.type === 'fanart'" :data="s.data" />
      <BannerSection v-else-if="s.type === 'banner'" :data="s.data" />
    </div>
  </div>
</template>

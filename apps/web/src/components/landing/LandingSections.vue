<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HomeSection } from '@cuka/shared'
import type { SiteImageDto } from '@/api/types'
import AboutSection from './AboutSection.vue'
import BannerSection from './BannerSection.vue'
import FanartSection from './FanartSection.vue'
import GallerySection from './GallerySection.vue'
import HeroSection from './HeroSection.vue'
import LinksSection from './LinksSection.vue'
import ProfileSection from './ProfileSection.vue'
import TimelineSection from './TimelineSection.vue'
import VideosSection from './VideosSection.vue'
import { provideLanding } from './context'

/**
 * Renders homepage sections in order: the public page and the admin preview use this same component.
 * Light bands alternate cream / soft between the dark ones; sections are numbered after the hero ("01 — …").
 */
const props = withDefaults(defineProps<{ sections: HomeSection[]; images: Record<string, SiteImageDto>; locale?: string; preview?: boolean }>(), {
  locale: undefined,
  preview: false,
})

const { locale: uiLocale } = useI18n()
provideLanding({
  locale: computed(() => props.locale ?? uiLocale.value),
  images: computed(() => props.images),
  preview: props.preview,
})

const rows = computed(() => {
  let n = 0
  let light = 0
  return props.sections
    .filter((s) => s.visible)
    // An empty list section has nothing to show visitors; the editor preview keeps it with a hint.
    .filter((s) => props.preview || !('items' in s.data) || s.data.items.length > 0)
    .map((s) => {
      const dark = s.type === 'hero' || s.type === 'banner'
      const index = s.type === 'hero' || s.type === 'banner' ? 0 : ++n
      const tone: 'cream' | 'soft' = dark ? 'cream' : light++ % 2 === 0 ? 'cream' : 'soft'
      return { s, index, tone }
    })
})
</script>

<template>
  <div data-test="landing-sections">
    <template v-for="{ s, index, tone } in rows" :key="s.id">
      <HeroSection v-if="s.type === 'hero'" :data="s.data" />
      <AboutSection v-else-if="s.type === 'about'" :data="s.data" :index="index" :tone="tone" />
      <ProfileSection v-else-if="s.type === 'profile'" :data="s.data" :index="index" :tone="tone" />
      <TimelineSection v-else-if="s.type === 'timeline'" :data="s.data" :index="index" :tone="tone" />
      <GallerySection v-else-if="s.type === 'gallery'" :data="s.data" :index="index" :tone="tone" />
      <VideosSection v-else-if="s.type === 'videos'" :data="s.data" :index="index" :tone="tone" />
      <LinksSection v-else-if="s.type === 'links'" :data="s.data" :index="index" :tone="tone" />
      <FanartSection v-else-if="s.type === 'fanart'" :data="s.data" :index="index" :tone="tone" />
      <BannerSection v-else-if="s.type === 'banner'" :data="s.data" />
    </template>
  </div>
</template>

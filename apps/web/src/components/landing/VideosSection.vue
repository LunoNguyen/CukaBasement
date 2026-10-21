<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { VideosData } from '@cuka/shared'
import LandingSection from './LandingSection.vue'
import YouTubeEmbed from './YouTubeEmbed.vue'
import { useLanding } from './context'
import { vReveal } from './reveal'

defineProps<{ data: VideosData; index: number; tone: 'cream' | 'soft' }>()
const { t } = useI18n()
const { tx } = useLanding()
</script>

<template>
  <LandingSection data-test="landing-videos" :tone="tone" :index="index" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)">
    <p v-if="!data.items.length" class="text-[var(--c-muted)]">{{ t('landing.videosEmpty') }}</p>
    <div v-else class="grid gap-6 md:grid-cols-2" :class="data.items.length === 1 ? 'md:grid-cols-1' : ''">
      <div v-for="(v, i) in data.items" :key="i" v-reveal :class="data.items.length % 2 === 1 && i === 0 && data.items.length > 1 ? 'md:col-span-2' : ''">
        <YouTubeEmbed :url="v.url" :title="tx(v.title)" />
      </div>
    </div>
  </LandingSection>
</template>

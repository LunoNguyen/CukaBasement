<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { parseYouTubeId } from '@cuka/shared'
import Halftone from './Halftone.vue'

/**
 * Click-to-load YouTube player: until the visitor presses play nothing is requested from Google (the poster is
 * brand art, not a YouTube thumbnail); then a youtube-nocookie.com player replaces it and starts playing.
 */
const props = defineProps<{ url: string; title: string }>()
const { t } = useI18n()
const id = computed(() => parseYouTubeId(props.url))
const playing = ref(false)
const src = computed(() => `https://www.youtube-nocookie.com/embed/${id.value}?autoplay=1&rel=0`)
</script>

<template>
  <div v-if="id" class="relative aspect-video overflow-hidden rounded-2xl bg-[var(--c-cellar)]">
    <iframe
      v-if="playing"
      :src="src"
      :title="title || t('landing.video')"
      class="absolute inset-0 h-full w-full"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
      data-test="yt-iframe"
    />
    <button
      v-else
      type="button"
      data-test="yt-play"
      class="group absolute inset-0 flex flex-col items-start justify-end gap-3 p-5 text-left text-[var(--c-cellar-text)] sm:p-7"
      :aria-label="t('landing.playVideo', { title: title || t('landing.video') })"
      @click="playing = true"
    >
      <Halftone class="absolute inset-0 h-full w-full opacity-30" from="tr" :size="9" aria-hidden="true" />
      <span class="absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#fbf7f4] text-[#5b3a29] shadow-lg transition-transform group-hover:scale-105 sm:size-20">
        <svg viewBox="0 0 24 24" class="ml-1 size-7 sm:size-8" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      </span>
      <span class="relative font-mono text-[11px] tracking-[0.14em] text-[var(--c-cellar-muted)] uppercase">YouTube · {{ t('landing.loadsOnClick') }}</span>
      <span v-if="title" class="relative font-display text-xl leading-tight font-semibold sm:text-2xl">{{ title }}</span>
    </button>
  </div>
</template>

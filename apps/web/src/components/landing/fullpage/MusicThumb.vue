<script setup lang="ts">
import BrandMark from '@/components/brand/BrandMark.vue'
import Halftone from '../Halftone.vue'
import type { MusicVideo } from './music'

/**
 * A video's 16:9 picture: our own copy of the YouTube thumbnail (never loaded from YouTube), or a branded
 * placeholder when the server has none yet. Decorative: the button around it carries the name.
 */
withDefaults(defineProps<{ video: MusicVideo; sizes?: string; play?: 'lg' | 'sm' | 'none'; eager?: boolean }>(), { sizes: '40vw', play: 'sm', eager: false })
</script>

<template>
  <span class="relative block aspect-video overflow-hidden rounded-[0.6rem] bg-[#141414]" aria-hidden="true">
    <img
      v-if="video.thumb"
      :src="video.thumb.src"
      :srcset="video.thumb.srcset"
      :sizes="sizes"
      :width="video.thumb.width"
      :height="video.thumb.height"
      alt=""
      :loading="eager ? 'eager' : 'lazy'"
      decoding="async"
      class="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      data-test="music-thumb"
    />
    <span v-else class="absolute inset-0 flex items-center justify-center" data-test="music-placeholder">
      <Halftone class="absolute inset-0 h-full w-full opacity-35" from="tr" :size="8" />
      <BrandMark on-dark class="relative size-[22%] max-h-16 min-h-8 opacity-90" />
    </span>
    <span v-if="play !== 'none'" class="absolute inset-0 bg-gradient-to-t from-[#0f0b09]/55 via-transparent to-transparent" />
    <span
      v-if="play !== 'none'"
      class="absolute flex items-center justify-center rounded-full bg-[#fbf7f4] text-[#5b3a29] shadow-lg transition-transform group-hover:scale-110 group-focus-visible:scale-110 motion-reduce:transition-none"
      :class="play === 'lg' ? 'top-1/2 left-1/2 size-16 -translate-x-1/2 -translate-y-1/2 sm:size-20' : 'bottom-2.5 left-2.5 size-9'"
    >
      <svg viewBox="0 0 24 24" :class="play === 'lg' ? 'ml-1 size-7 sm:size-8' : 'ml-0.5 size-4'" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
    </span>
    <slot />
  </span>
</template>

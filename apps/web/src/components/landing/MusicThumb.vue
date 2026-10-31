<script setup lang="ts">
import type { MusicVideo } from './music'

/**
 * A video's 16:9 picture: our own copy of the YouTube thumbnail (never loaded from YouTube), or a branded
 * placeholder when the server has none yet. Decorative: the button around it carries the name.
 */
withDefaults(defineProps<{ video: MusicVideo; sizes?: string; play?: 'lg' | 'sm' | 'none'; eager?: boolean }>(), { sizes: '40vw', play: 'sm', eager: false })
</script>

<template>
  <span class="relative block aspect-video overflow-hidden rounded-lg bg-[#1f1f1f]" aria-hidden="true">
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
      class="absolute inset-0 h-full w-full object-cover transition-opacity group-hover:opacity-90"
      data-test="music-thumb"
    />
    <span v-else class="absolute inset-0 flex items-center justify-center" data-test="music-placeholder">
      <svg viewBox="0 0 24 24" class="size-8 text-[#a3a3a3]" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
    </span>
    
    <span
      v-if="play !== 'none'"
      class="absolute flex items-center justify-center rounded-full bg-black/60 text-white transition-colors group-hover:bg-black/80"
      :class="play === 'lg' ? 'top-1/2 left-1/2 size-14 -translate-x-1/2 -translate-y-1/2' : 'bottom-2 left-2 size-8'"
    >
      <svg viewBox="0 0 24 24" :class="play === 'lg' ? 'ml-1 size-6' : 'ml-0.5 size-4'" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
    </span>
    <slot />
  </span>
</template>

<script setup lang="ts">
import { useId } from 'vue'

/** The brand's halftone pink dots, fading out from a corner. Decorative only. */
withDefaults(defineProps<{ from?: 'tr' | 'bl' | 'br' | 'tl' | 'c'; size?: number }>(), { from: 'tr', size: 9 })
const id = useId()
const ORIGIN = { tr: [100, 0], bl: [0, 100], br: [100, 100], tl: [0, 0], c: [50, 50] } as const
</script>

<template>
  <svg aria-hidden="true" focusable="false" class="pointer-events-none" preserveAspectRatio="none" width="100%" height="100%">
    <defs>
      <pattern :id="`d-${id}`" :width="size" :height="size" patternUnits="userSpaceOnUse">
        <circle :cx="size / 2" :cy="size / 2" :r="size * 0.24" fill="var(--c-cellar-accent)" />
      </pattern>
      <radialGradient :id="`f-${id}`" :cx="`${ORIGIN[from][0]}%`" :cy="`${ORIGIN[from][1]}%`" r="75%">
        <stop offset="0" stop-color="#fff" stop-opacity="1" />
        <stop offset="1" stop-color="#fff" stop-opacity="0" />
      </radialGradient>
      <mask :id="`m-${id}`"><rect width="100%" height="100%" :fill="`url(#f-${id})`" /></mask>
    </defs>
    <rect width="100%" height="100%" :fill="`url(#d-${id})`" :mask="`url(#m-${id})`" />
  </svg>
</template>

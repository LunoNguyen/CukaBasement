<script setup lang="ts">
import BrandMark from '@/components/brand/BrandMark.vue'
import Halftone from './Halftone.vue'

/**
 * Stand-in for a picture the admin has not added yet: a dark arch with the halftone dots and either a big
 * monogram letter or the logo mark. Decorative only.
 */
defineProps<{ letter?: string }>()
</script>

<template>
  <div aria-hidden="true" class="relative isolate flex h-full w-full items-center justify-center overflow-hidden bg-[var(--c-cellar)]">
    <Halftone class="absolute inset-0 h-full w-full opacity-30" from="tr" :size="9" />
    <Halftone class="absolute inset-0 h-full w-full opacity-20" from="bl" :size="6" />
    <span v-if="letter" class="relative font-display text-[clamp(8rem,22vw,16rem)] leading-none font-semibold text-transparent italic [-webkit-text-stroke:1.5px_var(--c-cellar-accent)]">{{ letter }}</span>
    <BrandMark v-else on-dark class="relative size-24 opacity-95 sm:size-28" />
  </div>
</template>

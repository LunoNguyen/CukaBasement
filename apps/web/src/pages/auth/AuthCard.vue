<script setup lang="ts">
import BrandMark from '@/components/brand/BrandMark.vue'

defineProps<{ title: string }>()
</script>

<!-- One 400px panel in the middle of the page: logo, title, then the form. -->
<template>
  <div class="mx-auto mt-6 w-full max-w-[400px] rounded-lg border border-[var(--c-border)] bg-[var(--c-bg)] p-6 sm:mt-12 sm:p-8">
    <RouterLink to="/" class="mb-6 inline-flex" aria-label="CukaBasement"><BrandMark class="size-9" /></RouterLink>
    <h1 class="mb-6 text-xl font-bold">{{ title }}</h1>
    <slot />
  </div>
</template>

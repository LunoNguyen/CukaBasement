<script setup lang="ts">
import BrandMark from '@/components/brand/BrandMark.vue'
import BasementArt from '@/components/brand/BasementArt.vue'

defineProps<{ title: string }>()
</script>

<!-- Form on the left; from md up, the basement art (board 08) beside it. -->
<template>
  <div class="mx-auto mt-4 grid w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--c-border)] bg-[var(--c-bg)] shadow-[0_12px_40px_rgb(23_17_14/0.08)] sm:mt-8 md:max-w-3xl md:grid-cols-2">
    <section class="p-6 sm:p-8">
      <BrandMark class="mb-5 size-11" />
      <h1 class="mb-6 font-display text-3xl font-semibold tracking-tight text-[var(--c-accent-strong)]">{{ title }}</h1>
      <slot />
    </section>
    <div data-test="auth-art" class="relative hidden min-h-96 bg-[#141414] md:block">
      <BasementArt class="absolute inset-0 h-full w-full" />
    </div>
  </div>
</template>

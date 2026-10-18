<script setup lang="ts">
import BrandMark from '@/components/layout/BrandMark.vue'

defineProps<{ title: string }>()
</script>

<template>
  <section class="card mx-auto mt-8 w-full max-w-sm p-6 shadow-[0_12px_40px_rgb(23_17_14/0.08)] sm:p-8">
    <BrandMark class="mb-5 size-11" />
    <h1 class="mb-6 font-display text-3xl font-semibold tracking-tight text-[var(--c-primary)]">{{ title }}</h1>
    <slot />
  </section>
</template>

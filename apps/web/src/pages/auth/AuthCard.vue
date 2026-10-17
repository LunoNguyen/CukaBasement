<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <section class="mx-auto mt-6 w-full max-w-sm rounded border border-[var(--c-border)] bg-[var(--c-surface)] p-4">
    <h1 class="mb-4 text-xl font-bold text-[var(--c-primary)]">{{ title }}</h1>
    <slot />
  </section>
</template>

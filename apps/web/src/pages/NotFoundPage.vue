<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BasementArt from '@/components/brand/BasementArt.vue'

const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col items-center py-10 text-center">
    <BasementArt class="mb-6 h-44 w-full max-w-sm rounded-2xl" />
    <p class="eyebrow mb-2">404</p>
    <h1 class="font-display text-4xl font-semibold tracking-tight">{{ t('notFound.title') }}</h1>
    <p class="mt-2 text-[var(--c-muted)]">{{ t('notFound.body') }}</p>
    <RouterLink to="/" class="mt-5 inline-flex min-h-11 items-center rounded-full bg-[var(--c-accent-strong)] px-5 text-sm font-semibold text-[var(--c-bg)] hover:opacity-90">{{
      t('notFound.back')
    }}</RouterLink>
  </div>
</template>

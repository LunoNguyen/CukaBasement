<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BasementArt from '@/components/brand/BasementArt.vue'

const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col items-center py-10 text-center">
    <BasementArt class="mb-6 h-44 w-full max-w-sm rounded-2xl" />
    <p class="eyebrow mb-2">403</p>
    <h1 class="font-display text-4xl font-semibold tracking-tight">{{ t('forbidden.title') }}</h1>
    <p class="mt-2 text-[var(--c-muted)]">{{ t('forbidden.body') }}</p>
    <RouterLink to="/" class="mt-5 inline-flex min-h-11 items-center rounded-full border border-[var(--c-border)] bg-[var(--c-bg)] px-5 text-sm font-semibold hover:border-[var(--c-muted)]">{{
      t('notFound.back')
    }}</RouterLink>
  </div>
</template>

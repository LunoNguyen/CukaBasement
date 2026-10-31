<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col items-center py-16 text-center">
    <p class="mb-1 text-sm font-bold text-[var(--c-muted)] tabular-nums">404</p>
    <h1 class="text-2xl font-bold">{{ t('notFound.title') }}</h1>
    <p class="mt-2 text-sm text-[var(--c-muted)]">{{ t('notFound.body') }}</p>
    <RouterLink to="/" class="mt-6 inline-flex h-10 items-center rounded bg-[var(--c-accent-strong)] px-5 text-sm font-semibold text-[var(--c-on-primary)] hover:brightness-110">{{
      t('notFound.back')
    }}</RouterLink>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="py-10 text-center">
    <h1 class="font-display text-4xl font-semibold tracking-tight">{{ t('notFound.title') }}</h1>
    <p class="mt-2 text-[var(--c-muted)]">{{ t('notFound.body') }}</p>
    <RouterLink to="/" class="mt-4 inline-block text-[var(--c-accent)]">{{ t('notFound.back') }}</RouterLink>
  </div>
</template>

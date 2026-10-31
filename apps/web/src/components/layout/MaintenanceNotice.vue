<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <section data-test="maintenance" role="status" class="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
    <h1 class="text-xl font-bold">{{ t('maintenance.title') }}</h1>
    <p class="text-[var(--c-muted)]">{{ t('maintenance.body') }}</p>
  </section>
</template>

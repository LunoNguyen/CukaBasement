<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <span
    class="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--c-border)] border-t-[var(--c-accent)]"
    role="progressbar"
    :aria-label="t('common.loading')"
  />
</template>

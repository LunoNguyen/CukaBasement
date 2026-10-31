<script setup lang="ts">
import { useI18n } from 'vue-i18n'

/** A thin-stroke picture icon and one line of text. `art` only tags the icon for tests (older call sites). */
defineProps<{ art?: boolean }>()
const { t } = useI18n()
</script>

<template>
  <div data-test="empty" class="flex flex-col items-center gap-2 py-12 text-center text-sm text-[var(--c-muted)]">
    <svg :data-test="art ? 'empty-art' : undefined" viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="m20.5 16-4.5-4.5-8 8" />
    </svg>
    <div><slot>{{ t('common.empty') }}</slot></div>
  </div>
</template>

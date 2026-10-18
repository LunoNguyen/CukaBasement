<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BasementArt from '@/components/brand/BasementArt.vue'

/** `art` adds the small basement window above the text (lists and pages with nothing in them yet). */
withDefaults(defineProps<{ art?: boolean }>(), { art: false })
const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col items-center gap-4 py-12 text-center text-sm text-[var(--c-muted)]">
    <BasementArt v-if="art" data-test="empty-art" class="h-28 w-40 rounded-xl" />
    <div><slot>{{ t('common.empty') }}</slot></div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'

const { t } = useI18n()
const { theme, toggle } = useTheme()
</script>

<template>
  <button
    type="button"
    data-test="theme-toggle"
    class="rounded px-2 py-1 text-lg"
    :aria-label="t('nav.theme')"
    :title="t('nav.theme')"
    @click="toggle"
  >
    {{ theme === 'dark' ? '☀' : '☾' }}
  </button>
</template>

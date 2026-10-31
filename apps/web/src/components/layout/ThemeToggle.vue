<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'

/** A menu row that switches between the light and dark theme. */
const { t } = useI18n()
const { theme, toggle } = useTheme()
</script>

<template>
  <button type="button" data-test="theme-toggle" class="menu-item" :title="t('nav.theme')" @click="toggle">
    <svg v-if="theme === 'dark'" viewBox="0 0 24 24" class="h-5 w-5 shrink-0 text-[var(--c-muted)]" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </svg>
    <svg v-else viewBox="0 0 24 24" class="h-5 w-5 shrink-0 text-[var(--c-muted)]" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
    {{ theme === 'dark' ? t('nav.themeLight') : t('nav.themeDark') }}
  </button>
</template>

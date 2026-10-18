<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Locale } from '@/i18n'
import { useChangeLocale } from '@/composables/useChangeLocale'

const { locale, t } = useI18n()
const changeLocale = useChangeLocale()
const langs: Locale[] = ['vi', 'en']
</script>

<template>
  <div class="inline-flex rounded-full border border-[var(--c-border)] p-0.5" role="group" :aria-label="t('nav.language')">
    <button
      v-for="l in langs"
      :key="l"
      type="button"
      :data-test="'lang-' + l"
      :aria-pressed="locale === l"
      class="min-h-7 rounded-full px-2.5 font-mono text-[11px] font-medium uppercase transition-colors"
      :class="locale === l ? 'bg-[var(--c-primary)] text-[var(--c-bg)]' : 'text-[var(--c-muted)] hover:text-[var(--c-text)]'"
      @click="changeLocale(l)"
    >
      {{ l }}
    </button>
  </div>
</template>

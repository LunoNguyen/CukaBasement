<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Locale } from '@/i18n'
import { useChangeLocale } from '@/composables/useChangeLocale'

const { locale, t } = useI18n()
const changeLocale = useChangeLocale()
// Each language is named in itself, whatever the current locale.
const langs: { key: Locale; name: string }[] = [
  { key: 'vi', name: 'Tiếng Việt' },
  { key: 'en', name: 'English' },
]
</script>

<template>
  <div class="flex rounded border border-[var(--c-border)] p-0.5" role="group" :aria-label="t('nav.language')">
    <button
      v-for="l in langs"
      :key="l.key"
      type="button"
      :data-test="'lang-' + l.key"
      :aria-pressed="locale === l.key"
      class="touch-pad h-8 flex-1 rounded-sm px-2.5 text-[13px] whitespace-nowrap transition-colors"
      :class="locale === l.key ? 'bg-[var(--c-surface-2)] font-semibold text-[var(--c-text)]' : 'text-[var(--c-muted)] hover:text-[var(--c-text)]'"
      @click="changeLocale(l.key)"
    >
      {{ l.name }}
    </button>
  </div>
</template>

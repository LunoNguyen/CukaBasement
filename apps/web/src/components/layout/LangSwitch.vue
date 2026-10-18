<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Locale } from '@/i18n'
import { useChangeLocale } from '@/composables/useChangeLocale'

const { locale, t } = useI18n()
const changeLocale = useChangeLocale()
const langs: Locale[] = ['vi', 'en']
</script>

<template>
  <div class="inline-flex gap-1" role="group" :aria-label="t('nav.language')">
    <button
      v-for="l in langs"
      :key="l"
      type="button"
      :data-test="'lang-' + l"
      :aria-pressed="locale === l"
      class="rounded px-2 py-1 text-xs font-semibold uppercase"
      :class="locale === l ? 'bg-[var(--c-primary)] text-[var(--c-bg)]' : 'text-[var(--c-muted)]'"
      @click="changeLocale(l)"
    >
      {{ l }}
    </button>
  </div>
</template>

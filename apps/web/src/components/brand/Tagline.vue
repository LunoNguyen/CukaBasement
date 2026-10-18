<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

// Board panel 04: Fraunces 600, the last word in the accent, the other language underneath in mono.
// Meant for the dark "Hầm" panels: colours come from the cellar tokens.
withDefaults(defineProps<{ tag?: 'p' | 'h1' | 'h2'; size?: 'sm' | 'lg' }>(), { tag: 'p', size: 'lg' })
const { t, locale } = useI18n()
const otherLang = computed(() => (locale.value === 'vi' ? 'en' : 'vi'))
</script>

<template>
  <div data-test="tagline" class="flex flex-col">
    <component
      :is="tag"
      class="font-display font-semibold tracking-[-0.025em] text-[var(--c-cellar-text)]"
      :class="size === 'lg' ? 'text-4xl leading-[1.02] sm:text-5xl' : 'text-xl leading-tight'"
    >
      {{ t('brand.taglineLead') }}<br />{{ t('brand.taglineRest') }} <span class="text-[var(--c-cellar-accent)]">{{ t('brand.taglineAccent') }}</span>
    </component>
    <p :lang="otherLang" class="mt-3 font-mono text-xs tracking-[0.06em] text-[var(--c-cellar-muted)]">{{ t('brand.taglineOther') }}</p>
  </div>
</template>

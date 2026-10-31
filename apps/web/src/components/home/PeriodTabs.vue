<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RANKING_PERIODS, type RankingPeriod } from '@cuka/shared'

/** Day / week / month switch of the ranking (underlined like the other tabs). */
const model = defineModel<RankingPeriod>({ required: true })
const { t } = useI18n()
</script>

<template>
  <div role="tablist" class="flex gap-5">
    <button
      v-for="p in RANKING_PERIODS"
      :key="p"
      type="button"
      role="tab"
      :data-test="`ranking-period-${p}`"
      :aria-selected="model === p"
      class="min-h-11 border-b-2 text-sm font-semibold whitespace-nowrap transition-colors sm:min-h-9"
      :class="model === p ? 'border-[var(--c-accent)] text-[var(--c-text)]' : 'border-transparent text-[var(--c-muted)] hover:text-[var(--c-text)]'"
      @click="model = p"
    >
      {{ t(`home.periods.${p}`) }}
    </button>
  </div>
</template>

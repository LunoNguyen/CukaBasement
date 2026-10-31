<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PostType, RankingPeriod } from '@cuka/shared'
import { ranking, type RankedCardDto } from '@/api/endpoints/feed'
import Spinner from '@/components/common/Spinner.vue'
import PostCard from '@/components/post/PostCard.vue'
import PeriodTabs from './PeriodTabs.vue'

/** "Ranking": day / week / month tabs, the top 10 in one scrolling row, and a link to the full ranking. */
const props = defineProps<{ type: PostType | '' }>()
const { t } = useI18n()
const period = ref<RankingPeriod>('day')
const items = ref<RankedCardDto[]>([])
const loading = ref(true)
const failed = ref(false)

let seq = 0
async function load() {
  const mine = ++seq
  loading.value = true
  failed.value = false
  try {
    const res = await ranking({ period: period.value, type: props.type || undefined, limit: 10 })
    if (mine === seq) items.value = res.items
  } catch {
    if (mine === seq) {
      items.value = []
      failed.value = true
    }
  } finally {
    if (mine === seq) loading.value = false
  }
}
watch([period, () => props.type], load, { immediate: true })

const allLink = computed(() => ({ path: '/ranking', query: { period: period.value, ...(props.type ? { type: props.type } : {}) } }))
</script>

<template>
  <section data-test="ranking-row" aria-labelledby="ranking-heading" class="flex flex-col gap-3">
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
      <div class="flex items-end gap-6">
        <h2 id="ranking-heading" class="pb-2 text-base font-bold sm:text-lg">{{ t('home.ranking') }}</h2>
        <PeriodTabs v-model="period" />
      </div>
      <RouterLink data-test="ranking-all" :to="allLink" class="inline-flex min-h-9 items-center gap-0.5 text-sm text-[var(--c-muted)] hover:text-[var(--c-text)]">
        {{ t('home.seeAll') }}
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
      </RouterLink>
    </div>
    <div v-if="loading && !items.length" class="flex h-40 items-center justify-center"><Spinner /></div>
    <p v-else-if="failed" class="py-8 text-center text-sm text-[var(--c-muted)]">{{ t('home.rankingError') }}</p>
    <p v-else-if="!items.length" class="py-8 text-center text-sm text-[var(--c-muted)]">{{ t('home.rankingEmpty') }}</p>
    <ol
      v-else
      class="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:gap-4 sm:px-6 [scrollbar-width:thin]"
      :class="{ 'opacity-60': loading }"
    >
      <li v-for="p in items" :key="p.id" class="w-[42vw] max-w-48 shrink-0 snap-start sm:w-48">
        <PostCard :post="p" :rank="p.rank" />
      </li>
    </ol>
  </section>
</template>

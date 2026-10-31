<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { POST_TYPES, RANKING_PERIODS, type PostType, type RankingPeriod } from '@cuka/shared'
import { ranking, type RankedCardDto } from '@/api/endpoints/feed'
import EmptyState from '@/components/common/EmptyState.vue'
import Spinner from '@/components/common/Spinner.vue'
import PostGrid from '@/components/post/PostGrid.vue'
import PeriodTabs from '@/components/home/PeriodTabs.vue'
import TypeFilter from '@/components/home/TypeFilter.vue'

/** /ranking: the top 50 of the day, week or month (`?period=`), optionally of one type (`?type=`). */
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const period = computed<RankingPeriod>({
  get: () => {
    const q = route.query.period
    return typeof q === 'string' && (RANKING_PERIODS as readonly string[]).includes(q) ? (q as RankingPeriod) : 'day'
  },
  set: (p) => void router.replace({ query: { ...route.query, period: p } }),
})
const type = computed<PostType | ''>(() => {
  const q = route.query.type
  return typeof q === 'string' && (POST_TYPES as readonly string[]).includes(q) ? (q as PostType) : ''
})
function setType(v: PostType | '') {
  const { type: _drop, ...rest } = route.query
  void router.replace({ query: v ? { ...rest, type: v } : rest })
}

const items = ref<RankedCardDto[]>([])
const loading = ref(true)
const failed = ref(false)
let seq = 0
watch(
  [period, type],
  async () => {
    const mine = ++seq
    loading.value = true
    failed.value = false
    try {
      const res = await ranking({ period: period.value, type: type.value || undefined, limit: 50 })
      if (mine === seq) items.value = res.items
    } catch {
      if (mine === seq) {
        items.value = []
        failed.value = true
      }
    } finally {
      if (mine === seq) loading.value = false
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <h1 class="text-2xl font-bold">{{ t('home.ranking') }}</h1>
    <div class="flex flex-col gap-3 border-b border-[var(--c-border)] sm:flex-row sm:items-end sm:justify-between">
      <PeriodTabs v-model="period" />
      <TypeFilter class="pb-2" :type="type" @update:type="setType" />
    </div>
    <div v-if="loading && !items.length" class="flex justify-center py-12"><Spinner /></div>
    <EmptyState v-else-if="failed">{{ t('home.rankingError') }}</EmptyState>
    <EmptyState v-else-if="!items.length">{{ t('home.rankingEmpty') }}</EmptyState>
    <div v-else data-test="ranking-grid" :class="{ 'opacity-60': loading }">
      <PostGrid :items="items" />
    </div>
  </div>
</template>

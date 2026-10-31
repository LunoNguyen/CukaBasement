<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { REPORT_REASONS, type ReportReason } from '@cuka/shared'
import * as api from '@/api/endpoints/mod'
import type { ReportGroupDto } from '@/api/types'
import { useToast } from '@/stores/toast'
import { useErrorText } from '@/composables/useErrorText'
import Btn from '@/components/common/Btn.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import Spinner from '@/components/common/Spinner.vue'
import MediaPlaceholder from '@/components/post/MediaPlaceholder.vue'

const { t, locale } = useI18n()
const toast = useToast()
const errorText = useErrorText()

const groups = ref<ReportGroupDto[]>([])
const loading = ref(false)
const failed = ref<unknown>(null)
const resolving = ref<string | null>(null)

/** AI art first, then the other reasons as listed in the shared enum; zero counts are left out. */
function reasonCounts(g: ReportGroupDto): Array<{ reason: ReportReason; n: number }> {
  const order = ['ai_art', ...REPORT_REASONS.filter((r) => r !== 'ai_art')] as ReportReason[]
  return order.map((reason) => ({ reason, n: g.reasons[reason] ?? 0 })).filter((r) => r.n > 0)
}

async function load() {
  loading.value = true
  failed.value = null
  try {
    groups.value = (await api.reports()).items
  } catch (e) {
    failed.value = e
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function resolve(g: ReportGroupDto, decision: 'keep' | 'remove') {
  if (resolving.value) return
  resolving.value = g.post.id
  try {
    await api.resolve(g.post.id, decision)
    groups.value = groups.value.filter((x) => x.post.id !== g.post.id)
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    resolving.value = null
  }
}
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between gap-2">
      <p class="text-xs text-[var(--c-muted)]">{{ t('mod.keepHint') }}</p>
      <Btn variant="secondary" :loading="loading" @click="load">{{ t('mod.reload') }}</Btn>
    </div>
    <ul class="flex flex-col gap-3">
      <li v-for="g in groups" :key="g.post.id" data-test="report-group" class="flex flex-col gap-3 card p-3 sm:flex-row">
        <RouterLink :to="`/posts/${g.post.id}`" class="block aspect-[4/5] w-full shrink-0 overflow-hidden rounded sm:w-32">
          <img v-if="g.post.cover?.thumbSmUrl" :src="g.post.cover.thumbSmUrl" :alt="g.post.title" loading="lazy" class="h-full w-full object-cover" />
          <MediaPlaceholder v-else />
        </RouterLink>
        <div class="flex min-w-0 flex-1 flex-col gap-2 text-sm">
          <RouterLink :to="`/posts/${g.post.id}`" class="truncate font-semibold">{{ g.post.title }}</RouterLink>
          <div class="flex flex-wrap gap-2">
            <span class="text-xs text-[var(--c-muted)]">{{ t('mod.totalReports', { n: g.total }) }}</span>
            <span v-for="r in reasonCounts(g)" :key="r.reason" data-test="reason-count" class="badge">{{ t(`post.reasons.${r.reason}`) }}: {{ r.n }}</span>
          </div>
          <ul class="flex flex-col gap-1 text-xs">
            <li v-for="(l, i) in g.latest.slice(0, 5)" :key="i" data-test="report-latest">
              <span class="font-semibold">{{ t(`post.reasons.${l.reason}`) }}</span> · @{{ l.reporter.username }} ·
              <time :datetime="l.createdAt" class="text-[var(--c-muted)]">{{ new Date(l.createdAt).toLocaleString(locale) }}</time>
              <span v-if="l.detail" class="block text-[var(--c-muted)]">{{ l.detail }}</span>
            </li>
          </ul>
          <div class="mt-auto flex flex-wrap gap-2 pt-1">
            <Btn :loading="resolving === g.post.id" @click="resolve(g, 'keep')">{{ t('mod.keep') }}</Btn>
            <Btn variant="danger" :disabled="resolving === g.post.id" @click="resolve(g, 'remove')">{{ t('mod.remove') }}</Btn>
          </div>
        </div>
      </li>
    </ul>
    <p v-if="failed" class="py-6 text-center text-[var(--c-muted)]">{{ errorText(failed) }}</p>
    <div v-else-if="loading && groups.length === 0" class="flex justify-center py-6"><Spinner /></div>
    <EmptyState v-else-if="groups.length === 0">{{ t('mod.reportsEmpty') }}</EmptyState>
  </div>
</template>

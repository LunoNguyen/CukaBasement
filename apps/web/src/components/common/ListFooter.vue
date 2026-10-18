<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CursorList } from '@/composables/useCursorList'
import { useErrorText } from '@/composables/useErrorText'
import { useInfiniteTrigger } from '@/composables/useInfiniteTrigger'
import Btn from './Btn.vue'
import EmptyState from './EmptyState.vue'
import Spinner from './Spinner.vue'

/** Footer of a cursor list: error + retry, spinner, empty state, or "load more" (also a scroll trigger when `auto`). */
const props = defineProps<{ list: CursorList<{ id: string }>; emptyText: string; auto?: boolean; art?: boolean }>()
const { t } = useI18n()
const errorText = useErrorText()

const sentinel = ref<HTMLElement | null>(null)
if (props.auto) useInfiniteTrigger(sentinel, () => void props.list.autoLoadMore())
</script>

<template>
  <div v-if="list.error.value" class="py-6 text-center">
    <p class="mb-2 text-[var(--c-muted)]">{{ errorText(list.error.value) }}</p>
    <Btn variant="ghost" @click="list.loadMore()">{{ t('common.retry') }}</Btn>
  </div>
  <div v-else-if="list.loading.value" class="flex justify-center py-6"><Spinner /></div>
  <EmptyState v-else-if="list.done.value && list.items.value.length === 0" :art="art">{{ emptyText }}</EmptyState>
  <div v-else-if="!list.done.value" :key="list.items.value.length" ref="sentinel" class="flex justify-center py-6">
    <Btn variant="ghost" @click="list.loadMore()">{{ t('common.loadMore') }}</Btn>
  </div>
</template>

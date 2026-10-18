<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Page, PostCardDto } from '@/api/types'
import { useCursorList } from '@/composables/useCursorList'
import { useInfiniteTrigger } from '@/composables/useInfiniteTrigger'
import Btn from '@/components/common/Btn.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import Spinner from '@/components/common/Spinner.vue'
import PostGrid from './PostGrid.vue'

/** Infinite grid for one query; the parent remounts it (`:key`) when the query changes. */
const props = defineProps<{ fetchPage: (cursor: string | null) => Promise<Page<PostCardDto>>; emptyText: string }>()
const { t } = useI18n()

const list = useCursorList(props.fetchPage)
const sentinel = ref<HTMLElement | null>(null)
useInfiniteTrigger(sentinel, () => void list.loadMore())
onMounted(() => void list.loadMore())
</script>

<template>
  <div>
    <PostGrid :items="list.items.value" />
    <div v-if="list.error.value" class="py-6 text-center">
      <p class="mb-2 text-[var(--c-muted)]">{{ t('errors.' + list.error.value.code) }}</p>
      <Btn variant="ghost" @click="list.loadMore()">{{ t('common.retry') }}</Btn>
    </div>
    <div v-else-if="list.loading.value" class="flex justify-center py-6"><Spinner /></div>
    <EmptyState v-else-if="list.done.value && list.items.value.length === 0">{{ emptyText }}</EmptyState>
    <div v-else-if="!list.done.value" :key="list.items.value.length" ref="sentinel" class="flex justify-center py-6">
      <Btn variant="ghost" @click="list.loadMore()">{{ t('common.loadMore') }}</Btn>
    </div>
  </div>
</template>

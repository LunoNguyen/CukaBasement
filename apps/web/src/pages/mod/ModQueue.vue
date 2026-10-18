<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import * as api from '@/api/endpoints/mod'
import type { PostCardDto } from '@/api/types'
import { useCursorList } from '@/composables/useCursorList'
import { useErrorText } from '@/pages/auth/errorText'
import Btn from '@/components/common/Btn.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import Spinner from '@/components/common/Spinner.vue'
import ModQueueItem from './ModQueueItem.vue'

const { t } = useI18n()
const errorText = useErrorText()
const list = useCursorList<PostCardDto>(api.queue)
onMounted(() => void list.loadMore())

function remove(id: string) {
  list.items.value = list.items.value.filter((p) => p.id !== id)
}
function updated(post: PostCardDto) {
  list.items.value = list.items.value.map((p) => (p.id === post.id ? post : p))
}
</script>

<template>
  <div>
    <ul class="flex flex-col gap-3">
      <ModQueueItem v-for="p in list.items.value" :key="p.id" :post="p" @removed="remove(p.id)" @updated="updated" />
    </ul>
    <div v-if="list.error.value" class="py-6 text-center">
      <p class="mb-2 text-[var(--c-muted)]">{{ errorText(list.error.value) }}</p>
      <Btn variant="ghost" @click="list.loadMore()">{{ t('common.retry') }}</Btn>
    </div>
    <div v-else-if="list.loading.value" class="flex justify-center py-6"><Spinner /></div>
    <EmptyState v-else-if="list.done.value && list.items.value.length === 0">{{ t('mod.queueEmpty') }}</EmptyState>
    <div v-else-if="!list.done.value" class="flex justify-center py-6">
      <Btn variant="ghost" @click="list.loadMore()">{{ t('common.loadMore') }}</Btn>
    </div>
  </div>
</template>

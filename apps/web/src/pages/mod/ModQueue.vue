<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import * as api from '@/api/endpoints/mod'
import type { PostCardDto } from '@/api/types'
import { useCursorList } from '@/composables/useCursorList'
import ListFooter from '@/components/common/ListFooter.vue'
import ModQueueItem from './ModQueueItem.vue'

const { t } = useI18n()
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
    <ListFooter :list="list" :empty-text="t('mod.queueEmpty')" art />
  </div>
</template>

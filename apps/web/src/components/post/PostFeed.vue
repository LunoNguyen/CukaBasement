<script setup lang="ts">
import { onMounted } from 'vue'
import type { Page, PostCardDto } from '@/api/types'
import { useCursorList } from '@/composables/useCursorList'
import ListFooter from '@/components/common/ListFooter.vue'
import PostGrid from './PostGrid.vue'

/** Infinite grid for one query; the parent remounts it (`:key`) when the query changes. */
const props = defineProps<{ fetchPage: (cursor: string | null) => Promise<Page<PostCardDto>>; emptyText: string }>()
const list = useCursorList(props.fetchPage)
onMounted(() => void list.loadMore())
</script>

<template>
  <div data-test="feed">
    <PostGrid :items="list.items.value" />
    <ListFooter :list="list" :empty-text="emptyText" auto art />
  </div>
</template>

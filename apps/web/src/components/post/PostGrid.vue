<script setup lang="ts">
import type { PostCardDto } from '@/api/types'
import PostCard from './PostCard.vue'

defineProps<{ items: PostCardDto[] }>()
</script>

<template>
  <div class="columns-2 gap-4 sm:columns-3 lg:columns-4 2xl:columns-6">
    <PostCard v-for="p in items" :key="p.id" :post="p" />
  </div>
</template>

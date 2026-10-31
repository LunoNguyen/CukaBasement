<script setup lang="ts">
import type { PostCardDto } from '@/api/types'
import PostCard from './PostCard.vue'

/** An even grid of square tiles: 2 columns on phones, 3 from 640px, 4 from 1024px, 6 from 1280px. */
defineProps<{ items: Array<PostCardDto & { rank?: number }> }>()
</script>

<template>
  <div class="grid grid-cols-2 gap-x-2 gap-y-4 sm:grid-cols-3 sm:gap-x-4 sm:gap-y-6 lg:grid-cols-4 xl:grid-cols-6">
    <PostCard v-for="p in items" :key="p.id" :post="p" :rank="p.rank" />
  </div>
</template>

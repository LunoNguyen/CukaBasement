<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PostCardDto } from '@/api/types'
import MediaPlaceholder from './MediaPlaceholder.vue'

const props = defineProps<{ post: PostCardDto }>()
const { t } = useI18n()

const thumb = computed(() => props.post.cover?.thumbSmUrl ?? null)
const blurred = computed(() => props.post.cover?.blurred === true)
const typeIcon = computed(() => (props.post.type === 'video' ? '▶' : props.post.type === 'audio' ? '♪' : null))
</script>

<template>
  <RouterLink :to="`/posts/${post.id}`" class="mb-3 block break-inside-avoid overflow-hidden rounded border border-[var(--c-border)] bg-[var(--c-surface)]">
    <div class="relative aspect-[4/5] overflow-hidden">
      <img v-if="thumb" :src="thumb" :alt="post.title" loading="lazy" class="h-full w-full object-cover" />
      <MediaPlaceholder v-else />
      <span v-if="blurred" class="absolute top-1 left-1 rounded bg-[var(--c-accent)] px-1.5 text-xs font-bold text-white">R18</span>
      <span v-if="post.pageCount > 1" data-test="pages" class="absolute top-1 right-1 rounded bg-black/60 px-1.5 text-xs text-white">{{ post.pageCount }}</span>
      <span
        v-if="typeIcon"
        data-test="type-icon"
        :aria-label="t(`post.type.${post.type}`)"
        class="absolute right-1 bottom-1 rounded bg-black/60 px-1.5 text-xs text-white"
        >{{ typeIcon }}</span
      >
    </div>
    <div class="p-2 text-sm">
      <div class="truncate font-semibold">{{ post.title }}</div>
      <div class="flex justify-between gap-2 text-xs text-[var(--c-muted)]">
        <span class="truncate">{{ post.author.displayName || post.author.username }}</span>
        <span class="shrink-0">♥ {{ post.counts.likes }}</span>
      </div>
    </div>
  </RouterLink>
</template>

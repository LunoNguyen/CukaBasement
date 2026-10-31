<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { PLATFORM_LABELS, artistTag } from '@cuka/shared'
import type { PostCardDto } from '@/api/types'
import MediaPlaceholder from './MediaPlaceholder.vue'

const props = defineProps<{ post: PostCardDto }>()
const { t } = useI18n()

const thumb = computed(() => props.post.cover?.thumbSmUrl ?? null)
const blurred = computed(() => props.post.cover?.blurred === true)
/** The cover's own shape, kept within portrait/landscape bounds so the masonry stays readable. */
const aspect = computed(() => {
  const c = props.post.cover
  const ratio = c?.width && c?.height ? c.width / c.height : 4 / 5
  return String(Math.min(Math.max(ratio, 0.6), 1.5))
})
/** Shown with the placeholder: a cover without a thumbnail yet is still being processed. */
const coverStatus = computed(() => {
  const c = props.post.cover
  if (!c || thumb.value) return null
  return c.status === 'failed' ? t('post.failed') : t('post.processing')
})
/** Plain text: the whole card is a link, so the source link lives on the post page only. */
const creditText = computed(() => {
  const c = props.post.credit
  if (c.isOwnWork) return null
  const label = PLATFORM_LABELS[c.platform]
  return `${t('post.artBy')} ${artistTag(c)}${label ? ` · ${label}` : ''}`
})
const mediaType = computed(() => (props.post.type === 'video' || props.post.type === 'audio' ? props.post.type : null))
</script>

<template>
  <RouterLink :to="`/posts/${post.id}`" class="group mb-4 block break-inside-avoid">
    <div class="relative overflow-hidden rounded-xl bg-[var(--c-surface-2)] ring-[var(--c-accent)] transition group-hover:ring-2" :style="{ aspectRatio: aspect }">
      <img v-if="thumb" :src="thumb" :alt="post.title" loading="lazy" class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
      <template v-else>
        <MediaPlaceholder />
        <span v-if="coverStatus" data-test="card-status" class="absolute inset-x-0 bottom-2 text-center text-xs text-[var(--c-muted)]">{{ coverStatus }}</span>
      </template>
      <span v-if="blurred" class="badge badge-r18 absolute top-2 left-2">R18</span>
      <span v-if="post.pageCount > 1" class="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-[#17110e]/70 px-1.5 text-[11px] leading-5 text-white">
        <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="3" width="13" height="15" rx="2" /><path d="M16 21H5a2 2 0 0 1-2-2V7" /></svg>
        <span data-test="pages">{{ post.pageCount }}</span>
      </span>
      <span
        v-if="mediaType"
        data-test="type-icon"
        role="img"
        :aria-label="t(`post.type.${post.type}`)"
        class="absolute right-2 bottom-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#17110e]/70 text-white"
      >
        <svg v-if="mediaType === 'video'" viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        <svg v-else viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
      </span>
    </div>
    <div class="flex flex-col gap-0.5 px-0.5 pt-2 text-sm">
      <div class="truncate font-semibold group-hover:text-[var(--c-accent-strong)]">{{ post.title }}</div>
      <div v-if="creditText" data-test="card-credit" class="truncate text-xs text-[var(--c-muted)]">{{ creditText }}</div>
      <div class="flex items-center justify-between gap-2 text-xs text-[var(--c-muted)]">
        <span class="truncate">{{ post.author.displayName || post.author.username }}</span>
        <span class="inline-flex shrink-0 items-center gap-1">
          <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 text-[var(--c-accent)]" fill="currentColor" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
          {{ post.counts.likes }}
        </span>
      </div>
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PLATFORM_LABELS, artistTag } from '@cuka/shared'
import type { PostCardDto } from '@/api/types'
import { like, unlike } from '@/api/endpoints/interactions'
import { useErrorText } from '@/composables/useErrorText'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import MediaPlaceholder from './MediaPlaceholder.vue'

/** A gallery tile: a square, centre-cropped cover (pixiv-style), the title and the author below. */
const props = defineProps<{ post: PostCardDto; rank?: number }>()
const { t } = useI18n()
const auth = useAuth()
const toast = useToast()
const errorText = useErrorText()

const thumb = computed(() => props.post.cover?.thumbSmUrl ?? null)
const r18 = computed(() => props.post.rating === 'r18' || props.post.cover?.blurred === true)
/** Shown with the placeholder: a cover without a thumbnail yet is still being processed. */
const coverStatus = computed(() => {
  const c = props.post.cover
  if (!c || thumb.value) return null
  return c.status === 'failed' ? t('post.failed') : t('post.processing')
})
/** Plain text: the source link lives on the post page only. */
const creditText = computed(() => {
  const c = props.post.credit
  if (c.isOwnWork) return null
  const label = PLATFORM_LABELS[c.platform]
  return `${t('post.artBy')} ${artistTag(c)}${label ? ` · ${label}` : ''}`
})
const mediaType = computed(() => (props.post.type === 'video' || props.post.type === 'audio' ? props.post.type : null))
const authorName = computed(() => props.post.author.displayName || props.post.author.username)
const brokenAvatar = ref(false)

/**
 * Lists are cached for everyone, so a card does not know whether the viewer liked it: the heart starts empty, and
 * liking twice is harmless (the API keeps one like).
 */
const liked = ref(false)
const busy = ref(false)
async function toggleLike() {
  if (busy.value) return
  busy.value = true
  try {
    const res = liked.value ? await unlike(props.post.id) : await like(props.post.id)
    liked.value = res.liked
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    busy.value = false
  }
}

/** Hidden until hover on devices that hover; always shown on touch screens, and once liked. */
const heartClass = computed(() => [
  'absolute right-1 bottom-1 inline-flex h-10 w-10 items-center justify-center rounded text-white transition-opacity focus-visible:opacity-100 [filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.5))]',
  liked.value ? '' : '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100',
])
</script>

<template>
  <div class="group min-w-0" data-test="post-card">
    <div class="relative">
      <RouterLink
        :to="`/posts/${post.id}`"
        data-test="card-link"
        class="relative block aspect-square overflow-hidden rounded-lg bg-[var(--c-surface-2)]"
        :aria-label="post.title"
      >
        <img v-if="thumb" :src="thumb" :alt="post.title" loading="lazy" class="h-full w-full object-cover transition-opacity group-hover:opacity-90" />
        <template v-else>
          <MediaPlaceholder />
          <span v-if="coverStatus" data-test="card-status" class="absolute inset-x-0 bottom-2 text-center text-xs text-[var(--c-muted)]">{{ coverStatus }}</span>
        </template>
        <!-- R18 and the media type top-left (top-right beside a rank), the page count top-right. -->
        <span class="absolute top-1.5 flex gap-1" :class="rank ? 'right-1.5' : 'left-1.5'">
          <span v-if="r18" class="badge badge-r18">R18</span>
          <span
            v-if="mediaType"
            data-test="type-icon"
            role="img"
            :aria-label="t(`post.type.${post.type}`)"
            class="inline-flex h-5 items-center rounded bg-black/60 px-1.5 text-white"
          >
            <svg v-if="mediaType === 'video'" viewBox="0 0 24 24" class="h-3 w-3" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            <svg v-else viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>
          </span>
          <span v-if="post.pageCount > 1 && rank" class="inline-flex h-5 items-center gap-0.5 rounded bg-black/60 px-1.5 text-[11px] font-bold text-white">
            <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="3" width="13" height="15" rx="2" /><path d="M16 21H5a2 2 0 0 1-2-2V7" /></svg>
            <span data-test="pages">{{ post.pageCount }}</span>
          </span>
        </span>
        <span v-if="post.pageCount > 1 && !rank" class="absolute top-1.5 right-1.5 inline-flex h-5 items-center gap-0.5 rounded bg-black/60 px-1.5 text-[11px] font-bold text-white">
          <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="8" y="3" width="13" height="15" rx="2" /><path d="M16 21H5a2 2 0 0 1-2-2V7" /></svg>
          <span data-test="pages">{{ post.pageCount }}</span>
        </span>
        <span
          v-if="rank"
          data-test="rank"
          class="absolute top-0 left-0 flex h-9 min-w-9 items-center justify-center rounded-br-lg px-2 text-xl leading-none font-bold"
          :class="rank <= 3 ? 'bg-[var(--c-accent)] text-white' : 'bg-black/60 text-white'"
        >{{ rank }}</span>
      </RouterLink>
      <button
        v-if="auth.isLoggedIn"
        type="button"
        data-test="card-like"
        :class="heartClass"
        :aria-pressed="liked"
        :aria-label="liked ? t('post.unlike') : t('post.like')"
        @click="toggleLike"
      >
        <svg viewBox="0 0 24 24" class="h-6 w-6" :fill="liked ? 'var(--c-accent)' : 'none'" :stroke="liked ? 'var(--c-accent)' : 'currentColor'" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" /></svg>
      </button>
      <RouterLink v-else :to="{ path: '/login', query: { next: `/posts/${post.id}` } }" data-test="card-like" :class="heartClass" :aria-label="t('post.like')">
        <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" /></svg>
      </RouterLink>
    </div>
    <RouterLink :to="`/posts/${post.id}`" data-test="card-title" class="mt-2 block truncate text-sm font-bold hover:underline">{{ post.title }}</RouterLink>
    <p v-if="creditText" data-test="card-credit" class="truncate text-xs text-[var(--c-muted)]">{{ creditText }}</p>
    <RouterLink :to="`/u/${post.author.username}`" data-test="card-author" class="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-[var(--c-muted)] hover:text-[var(--c-text)]">
      <img v-if="post.author.avatarUrl && !brokenAvatar" :src="post.author.avatarUrl" alt="" loading="lazy" class="h-5 w-5 shrink-0 rounded-full bg-[var(--c-surface-2)] object-cover" @error="brokenAvatar = true" />
      <span v-else class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--c-surface-2)] text-[10px] font-bold text-[var(--c-text)]" aria-hidden="true">{{ authorName.charAt(0).toUpperCase() }}</span>
      <span class="truncate">{{ authorName }}</span>
    </RouterLink>
  </div>
</template>

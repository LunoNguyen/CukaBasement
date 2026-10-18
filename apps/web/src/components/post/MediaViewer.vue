<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import * as postsApi from '@/api/endpoints/posts'
import { ApiError } from '@/api/client'
import { useErrorText } from '@/composables/useErrorText'
import type { PostDto, PostMediaDto } from '@/api/types'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import MediaPlaceholder from './MediaPlaceholder.vue'

const props = defineProps<{ post: PostDto }>()
const { t } = useI18n()
const route = useRoute()
const auth = useAuth()
const toast = useToast()

const images = computed(() => props.post.media.filter((m) => m.kind === 'image'))
const players = computed(() => props.post.media.filter((m) => m.kind === 'video' || m.kind === 'audio'))
const downloads = computed(() => props.post.media.filter((m) => m.kind === 'source' || m.kind === 'archive'))
/** Every file of an r18 post is blurred for an ineligible viewer; only the cover is shown then. */
const blurred = computed(() => props.post.media.some((m) => m.blurred))
const cover = computed(() => props.post.media.find((m) => m.isCover) ?? props.post.media[0] ?? null)

const selected = ref(0)
const main = computed(() => images.value[Math.min(selected.value, images.value.length - 1)] ?? null)
watch(
  () => props.post.id,
  () => (selected.value = 0),
)

/** Playable sources, fetched on the element's first `play`: presigned URLs expire, so none is requested up front. */
const sources = reactive<Record<string, string>>({})
const fetching = new Set<string>()
/** Files whose URL was re-fetched after a media error, with the position to resume at; one retry per failure. */
const resumeAt = new Map<string, number>()

function statusText(m: PostMediaDto): string {
  return m.status === 'failed' ? t('post.failed') : t('post.processing')
}

const errorText = useErrorText()

/** The tab is opened before the request so popup blockers still see the click. */
async function openFile(m: PostMediaDto) {
  const win = window.open('', '_blank')
  try {
    const { url } = await postsApi.fileUrl(props.post.id, m.fileId)
    if (win) {
      win.opener = null
      win.location.href = url
    } else window.open(url, '_blank', 'noopener')
  } catch (e) {
    win?.close()
    const restricted = e instanceof ApiError && e.status === 404
    toast.push({ kind: 'error', text: restricted ? t('post.originalRestricted') : errorText(e) })
  }
}

async function fetchSource(m: PostMediaDto): Promise<boolean> {
  if (fetching.has(m.fileId)) return false
  fetching.add(m.fileId)
  try {
    sources[m.fileId] = (await postsApi.fileUrl(props.post.id, m.fileId)).url
    await nextTick()
    return true
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
    return false
  } finally {
    fetching.delete(m.fileId)
  }
}

/** Native play without a source: fetch it, then start playback on the same element. */
async function onPlay(m: PostMediaDto, e: Event) {
  if (sources[m.fileId]) return
  const el = e.target as HTMLMediaElement
  if (await fetchSource(m)) void el.play()?.catch(() => {})
}

/** Most likely the presigned URL expired: fetch a fresh one once and resume where playback stopped. */
async function onError(m: PostMediaDto, e: Event) {
  if (!sources[m.fileId]) return
  if (resumeAt.has(m.fileId)) {
    resumeAt.delete(m.fileId)
    toast.push({ kind: 'error', text: t('errors.INTERNAL') })
    return
  }
  const el = e.target as HTMLMediaElement
  resumeAt.set(m.fileId, el.currentTime || 0)
  delete sources[m.fileId]
  if (!(await fetchSource(m))) resumeAt.delete(m.fileId)
}

function onLoadedMetadata(m: PostMediaDto, e: Event) {
  const at = resumeAt.get(m.fileId)
  if (at === undefined) return
  const el = e.target as HTMLMediaElement
  el.currentTime = at
  void el.play()?.catch(() => {})
}

/** Playback reached `playing` on the fresh URL: a later expiry may retry again. */
function onPlaying(m: PostMediaDto) {
  resumeAt.delete(m.fileId)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="blurred" class="relative overflow-hidden rounded">
      <img v-if="cover?.thumbMdUrl" data-test="media-main" :src="cover.thumbMdUrl" :alt="post.title" class="w-full" />
      <div v-else class="aspect-[4/3]"><MediaPlaceholder /></div>
      <div data-test="r18-overlay" class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 p-3 text-center text-white">
        <p class="text-lg font-bold">{{ t('post.r18Title') }}</p>
        <RouterLink
          v-if="!auth.isLoggedIn"
          :to="{ path: '/login', query: { next: route.fullPath } }"
          class="inline-flex min-h-10 items-center rounded-full bg-[var(--c-accent)] px-4 text-sm font-semibold text-[#17110e]"
          >{{ t('post.r18Login') }}</RouterLink
        >
        <RouterLink v-else to="/settings" class="inline-flex min-h-10 items-center rounded-full bg-[var(--c-accent)] px-4 text-sm font-semibold text-[#17110e]">{{ t('post.r18Settings') }}</RouterLink>
      </div>
    </div>

    <template v-else>
      <template v-if="post.type === 'manga'">
        <template v-for="(m, i) in images" :key="m.fileId">
          <button
            v-if="m.thumbMdUrl"
            type="button"
            data-test="open-original"
            class="mx-auto block w-full max-w-3xl cursor-zoom-in"
            :aria-label="t('post.openOriginal', { name: t('post.pageAlt', { title: post.title, n: i + 1 }) })"
            @click="openFile(m)"
          >
            <img data-test="manga-page" :src="m.thumbMdUrl" :alt="t('post.pageAlt', { title: post.title, n: i + 1 })" loading="lazy" class="w-full" />
          </button>
          <div v-else class="mx-auto flex aspect-[3/4] w-full max-w-3xl flex-col"><MediaPlaceholder /><p class="py-2 text-center text-sm text-[var(--c-muted)]">{{ statusText(m) }}</p></div>
        </template>
      </template>

      <template v-else-if="main">
        <button
          v-if="main.thumbMdUrl"
          type="button"
          data-test="open-original"
          class="mx-auto block cursor-zoom-in"
          :aria-label="t('post.openOriginal', { name: post.title })"
          @click="openFile(main)"
        >
          <img data-test="media-main" :src="main.thumbMdUrl" :alt="post.title" class="max-h-[80vh] rounded" />
        </button>
        <div v-else class="flex aspect-[4/3] w-full flex-col"><MediaPlaceholder /><p class="py-2 text-center text-sm text-[var(--c-muted)]">{{ statusText(main) }}</p></div>
        <div v-if="images.length > 1" class="flex gap-2 overflow-x-auto">
          <button
            v-for="(m, i) in images"
            :key="m.fileId"
            type="button"
            data-test="gallery-thumb"
            class="h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2"
            :class="i === selected ? 'border-[var(--c-accent)]' : 'border-transparent'"
            :aria-label="t('post.pageAlt', { title: post.title, n: i + 1 })"
            @click="selected = i"
          >
            <img v-if="m.thumbSmUrl" :src="m.thumbSmUrl" alt="" class="h-full w-full object-cover" />
            <MediaPlaceholder v-else />
          </button>
        </div>
      </template>

      <div v-for="m in players" :key="m.fileId">
        <template v-if="m.kind === 'video'">
          <video
            v-if="m.previewUrl || m.thumbMdUrl"
            controls
            preload="none"
            :poster="m.previewUrl ?? m.thumbMdUrl ?? undefined"
            :src="sources[m.fileId]"
            class="w-full rounded"
            @play="onPlay(m, $event)"
            @error="onError(m, $event)"
            @loadedmetadata="onLoadedMetadata(m, $event)"
            @playing="onPlaying(m)"
          />
          <div v-else class="flex aspect-video w-full flex-col"><MediaPlaceholder /><p class="py-2 text-center text-sm text-[var(--c-muted)]">{{ statusText(m) }}</p></div>
        </template>
        <audio
          v-else
          controls
          preload="none"
          :src="sources[m.fileId]"
          class="w-full"
          @play="onPlay(m, $event)"
          @error="onError(m, $event)"
          @loadedmetadata="onLoadedMetadata(m, $event)"
          @playing="onPlaying(m)"
        />
      </div>

      <div v-if="downloads.length" class="flex flex-wrap gap-2">
        <button
          v-for="m in downloads"
          :key="m.fileId"
          type="button"
          data-test="download"
          class="inline-flex min-h-10 items-center rounded-full border border-[var(--c-border)] bg-[var(--c-surface)] px-4 text-sm hover:border-[var(--c-latte)]"
          @click="openFile(m)"
        >
          ⬇ {{ t('post.download') }}
        </button>
      </div>
    </template>
  </div>
</template>

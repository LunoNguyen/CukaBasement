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
import MediaLightbox from './MediaLightbox.vue'

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
const lightbox = ref(false)
const main = computed(() => images.value[Math.min(selected.value, images.value.length - 1)] ?? null)
watch(
  () => props.post.id,
  () => {
    selected.value = 0
    lightbox.value = false
  },
)

/** Prev/next wrap around, in the page viewer and the lightbox alike. */
function go(delta: number) {
  const n = images.value.length
  if (n < 2) return
  selected.value = (selected.value + delta + n) % n
}

/** ←/→ while focus is anywhere inside the gallery (its buttons); never a global listener. */
function onGalleryKey(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
  e.preventDefault()
  go(e.key === 'ArrowLeft' ? -1 : 1)
}

const strip = ref<HTMLElement | null>(null)
watch(selected, async (i) => {
  await nextTick()
  strip.value?.children[i]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
})

/** Clicking an image zooms it in a lightbox (public variants only); the original is a separate, explicit control. */
const mainName = computed(() => (images.value.length > 1 ? t('post.pageAlt', { title: props.post.title, n: selected.value + 1 }) : props.post.title))

function openLightbox(i: number) {
  selected.value = i
  lightbox.value = true
}

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
  <div class="flex min-w-0 flex-col gap-3">
    <div v-if="blurred" class="relative overflow-hidden rounded">
      <img v-if="cover?.thumbMdUrl" data-test="media-main" :src="cover.thumbMdUrl" :alt="post.title" class="w-full" />
      <div v-else class="aspect-[4/3]"><MediaPlaceholder /></div>
      <div data-test="r18-overlay" class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 p-3 text-center text-white">
        <p class="text-lg font-bold">{{ t('post.r18Title') }}</p>
        <RouterLink
          v-if="!auth.isLoggedIn"
          :to="{ path: '/login', query: { next: route.fullPath } }"
          class="inline-flex min-h-11 items-center rounded-full bg-[var(--c-accent)] px-4 text-sm font-semibold text-[#17110e]"
          >{{ t('post.r18Login') }}</RouterLink
        >
        <RouterLink v-else to="/settings" class="inline-flex min-h-11 items-center rounded-full bg-[var(--c-accent)] px-4 text-sm font-semibold text-[#17110e]">{{ t('post.r18Settings') }}</RouterLink>
      </div>
    </div>

    <template v-else>
      <template v-if="post.type === 'manga'">
        <template v-for="(m, i) in images" :key="m.fileId">
          <button
            v-if="m.thumbMdUrl"
            type="button"
            data-test="zoom-open"
            class="mx-auto block w-full max-w-3xl cursor-zoom-in"
            :aria-label="t('post.viewLarger', { name: t('post.pageAlt', { title: post.title, n: i + 1 }) })"
            @click="openLightbox(i)"
          >
            <img data-test="manga-page" :src="m.thumbMdUrl" :alt="t('post.pageAlt', { title: post.title, n: i + 1 })" loading="lazy" class="w-full" />
          </button>
          <div v-else class="mx-auto flex aspect-[3/4] w-full max-w-3xl flex-col"><MediaPlaceholder /><p class="py-2 text-center text-sm text-[var(--c-muted)]">{{ statusText(m) }}</p></div>
        </template>
      </template>

      <div v-else-if="main" role="group" data-test="gallery" :aria-label="t('post.gallery')" class="flex min-w-0 flex-col gap-3" @keydown="onGalleryKey">
        <div class="relative flex w-full items-center justify-center overflow-hidden rounded-xl bg-[var(--c-surface-2)]">
          <button
            v-if="main.thumbMdUrl"
            type="button"
            data-test="zoom-open"
            class="block max-w-full cursor-zoom-in"
            :aria-label="t('post.viewLarger', { name: mainName })"
            @click="openLightbox(selected)"
          >
            <img data-test="media-main" :src="main.thumbMdUrl" :alt="mainName" class="block max-h-[80vh] max-w-full object-contain" />
          </button>
          <div v-else class="flex aspect-[4/3] w-full flex-col"><MediaPlaceholder /><p class="py-2 text-center text-sm text-[var(--c-muted)]">{{ statusText(main) }}</p></div>

          <template v-if="images.length > 1">
            <p
              data-test="page-indicator"
              class="pointer-events-none absolute top-2 right-2 rounded-full bg-[#141414]/75 px-2.5 py-1 text-xs text-[#ededed] tabular-nums"
              :aria-label="t('post.pageOf', { n: selected + 1, total: images.length })"
            >
              {{ selected + 1 }} / {{ images.length }}
            </p>
            <button type="button" data-test="media-prev" class="icon-btn media-nav left-2" :aria-label="t('post.prevImage')" @click="go(-1)">
              <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
            </button>
            <button type="button" data-test="media-next" class="icon-btn media-nav right-2" :aria-label="t('post.nextImage')" @click="go(1)">
              <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </button>
          </template>
        </div>

        <div class="flex min-w-0 items-start gap-2">
          <div v-if="images.length > 1" ref="strip" data-test="gallery-strip" class="flex min-w-0 flex-1 gap-2 overflow-x-auto p-0.5">
            <button
              v-for="(m, i) in images"
              :key="m.fileId"
              type="button"
              data-test="gallery-thumb"
              class="h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2"
              :class="i === selected ? 'border-[var(--c-accent)]' : 'border-transparent opacity-80 hover:opacity-100'"
              :aria-label="t('post.pageAlt', { title: post.title, n: i + 1 })"
              :aria-current="i === selected ? 'true' : undefined"
              @click="selected = i"
            >
              <img v-if="m.thumbSmUrl" :src="m.thumbSmUrl" alt="" class="h-full w-full object-cover" />
              <MediaPlaceholder v-else />
            </button>
          </div>
          <button
            v-if="main.thumbMdUrl"
            type="button"
            data-test="open-original"
            class="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[var(--c-border)] bg-[var(--c-bg)] px-4 text-sm hover:border-[var(--c-muted)]"
            :aria-label="t('post.openOriginal', { name: mainName })"
            @click="openFile(main)"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
            {{ t('post.original') }}
          </button>
        </div>
      </div>

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
          class="inline-flex min-h-11 items-center rounded-full border border-[var(--c-border)] bg-[var(--c-bg)] px-4 text-sm hover:border-[var(--c-muted)]"
          @click="openFile(m)"
        >
          ⬇ {{ t('post.download') }}
        </button>
      </div>

      <MediaLightbox v-if="images.length" v-model:open="lightbox" v-model:index="selected" :items="images" :title="post.title" @original="openFile" />
    </template>
  </div>
</template>

<style scoped>
/* Overlay arrows on the main image: a cream disc that reads on any artwork. */
.media-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: color-mix(in srgb, var(--c-bg) 85%, transparent);
  box-shadow: 0 2px 8px rgb(23 17 14 / 0.18);
  backdrop-filter: blur(4px);
}
.media-nav:hover {
  background: var(--c-bg);
}
</style>

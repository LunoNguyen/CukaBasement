<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import * as postsApi from '@/api/endpoints/posts'
import { ApiError } from '@/api/client'
import type { PostDto, PostMediaDto } from '@/api/types'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import MediaPlaceholder from './MediaPlaceholder.vue'

const props = defineProps<{ post: PostDto }>()
const { t } = useI18n()
const route = useRoute()
const auth = useAuth()
const toast = useToast()
const root = ref<HTMLElement | null>(null)

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

/** Playable sources, fetched on demand: presigned URLs expire, so they are not requested up front. */
const sources = reactive<Record<string, string>>({})

function errorText(e: unknown): string {
  return t('errors.' + (e instanceof ApiError ? e.code : 'INTERNAL'))
}

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

async function play(m: PostMediaDto) {
  if (!sources[m.fileId]) {
    try {
      sources[m.fileId] = (await postsApi.fileUrl(props.post.id, m.fileId)).url
    } catch (e) {
      toast.push({ kind: 'error', text: errorText(e) })
      return
    }
    await nextTick()
  }
  const el = root.value?.querySelector<HTMLMediaElement>(`[data-file="${m.fileId}"]`)
  void el?.play()?.catch(() => {})
}
</script>

<template>
  <div ref="root" class="flex flex-col gap-3">
    <div v-if="blurred" class="relative overflow-hidden rounded">
      <img v-if="cover?.thumbMdUrl" data-test="media-main" :src="cover.thumbMdUrl" :alt="post.title" class="w-full" />
      <div v-else class="aspect-[4/3]"><MediaPlaceholder /></div>
      <div data-test="r18-overlay" class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 p-3 text-center text-white">
        <p class="text-lg font-bold">{{ t('post.r18Title') }}</p>
        <RouterLink
          v-if="!auth.isLoggedIn"
          :to="{ path: '/login', query: { next: route.fullPath } }"
          class="rounded bg-[var(--c-accent)] px-3 py-1.5 text-sm font-semibold"
          >{{ t('post.r18Login') }}</RouterLink
        >
        <RouterLink v-else to="/settings" class="rounded bg-[var(--c-accent)] px-3 py-1.5 text-sm font-semibold">{{ t('post.r18Settings') }}</RouterLink>
      </div>
    </div>

    <template v-else>
      <template v-if="post.type === 'manga'">
        <template v-for="(m, i) in images" :key="m.fileId">
          <img
            v-if="m.thumbMdUrl"
            data-test="manga-page"
            :src="m.thumbMdUrl"
            :alt="t('post.pageAlt', { title: post.title, n: i + 1 })"
            loading="lazy"
            class="mx-auto w-full max-w-3xl cursor-zoom-in"
            @click="openFile(m)"
          />
          <div v-else class="mx-auto flex aspect-[3/4] w-full max-w-3xl flex-col"><MediaPlaceholder /><p class="py-2 text-center text-sm text-[var(--c-muted)]">{{ t('post.processing') }}</p></div>
        </template>
      </template>

      <template v-else-if="main">
        <img v-if="main.thumbMdUrl" data-test="media-main" :src="main.thumbMdUrl" :alt="post.title" class="mx-auto max-h-[80vh] cursor-zoom-in rounded" @click="openFile(main)" />
        <div v-else class="flex aspect-[4/3] w-full flex-col"><MediaPlaceholder /><p class="py-2 text-center text-sm text-[var(--c-muted)]">{{ t('post.processing') }}</p></div>
        <div v-if="images.length > 1" class="flex gap-2 overflow-x-auto">
          <button
            v-for="(m, i) in images"
            :key="m.fileId"
            type="button"
            data-test="gallery-thumb"
            class="h-16 w-16 shrink-0 overflow-hidden rounded border-2"
            :class="i === selected ? 'border-[var(--c-accent)]' : 'border-transparent'"
            :aria-label="t('post.pageAlt', { title: post.title, n: i + 1 })"
            @click="selected = i"
          >
            <img v-if="m.thumbSmUrl" :src="m.thumbSmUrl" alt="" class="h-full w-full object-cover" />
            <MediaPlaceholder v-else />
          </button>
        </div>
      </template>

      <div v-for="m in players" :key="m.fileId" class="relative">
        <template v-if="m.kind === 'video'">
          <video v-if="m.previewUrl || m.thumbMdUrl" :data-file="m.fileId" controls :poster="m.previewUrl ?? m.thumbMdUrl ?? undefined" :src="sources[m.fileId]" class="w-full rounded" />
          <div v-else class="flex aspect-video w-full flex-col"><MediaPlaceholder /><p class="py-2 text-center text-sm text-[var(--c-muted)]">{{ t('post.processing') }}</p></div>
        </template>
        <audio v-else :data-file="m.fileId" controls :src="sources[m.fileId]" class="w-full" />
        <button
          v-if="!sources[m.fileId]"
          type="button"
          data-test="play"
          class="mt-2 rounded bg-[var(--c-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--c-bg)]"
          @click="play(m)"
        >
          ▶ {{ t('post.play') }}
        </button>
      </div>

      <div v-if="downloads.length" class="flex flex-wrap gap-2">
        <button
          v-for="m in downloads"
          :key="m.fileId"
          type="button"
          data-test="download"
          class="rounded border border-[var(--c-border)] px-3 py-1.5 text-sm"
          @click="openFile(m)"
        >
          ⬇ {{ t('post.download') }}
        </button>
      </div>
    </template>
  </div>
</template>

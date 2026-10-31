<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ALLOWED_FILE_TYPES } from '@cuka/shared'
import { deleteSiteImage, siteImages } from '@/api/endpoints/site'
import type { AdminSiteImageDto } from '@/api/types'
import Btn from '@/components/common/Btn.vue'
import Modal from '@/components/common/Modal.vue'
import Spinner from '@/components/common/Spinner.vue'
import { useErrorText } from '@/composables/useErrorText'
import { useUploader, validateFile } from '@/composables/useUploader'
import { useToast } from '@/stores/toast'
import { useEditor } from './model'

/**
 * The site media library: pick an image (or, with `kind="video"`, a background video) for a slot, upload new ones
 * (site media: no credit mark, a 2400px render; a video gets a poster frame) with their progress, and delete those no
 * page uses. Files being processed are polled until ready.
 */
const props = withDefaults(defineProps<{ kind?: 'image' | 'video' }>(), { kind: 'image' })
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ pick: [fileId: string] }>()
const { t } = useI18n()
const toast = useToast()
const errorText = useErrorText()
const { images, videos } = useEditor()
const up = useUploader([], { purpose: 'site' })

const list = ref<AdminSiteImageDto[]>([])
const loading = ref(false)
const confirmDelete = ref<AdminSiteImageDto | null>(null)
const deleting = ref(false)
const input = ref<HTMLInputElement | null>(null)
let poll: ReturnType<typeof setTimeout> | undefined

const accept = computed(() =>
  ALLOWED_FILE_TYPES.filter((f) => f.kind === props.kind)
    .map((f) => '.' + f.ext)
    .join(','),
)
/** Library entries of this kind (an entry without a kind is an image from before videos existed). */
const shown = computed(() => list.value.filter((i) => (i.kind ?? 'image') === props.kind))
const pending = computed(() => up.queue.value.filter((q) => q.status === 'queued' || q.status === 'uploading'))

async function load() {
  loading.value = list.value.length === 0
  try {
    list.value = await siteImages()
    for (const i of list.value) {
      if (i.image) images.value = { ...images.value, [i.id]: i.image }
      if (i.video) videos.value = { ...videos.value, [i.id]: i.video }
    }
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    loading.value = false
  }
  if (poll) clearTimeout(poll)
  if (open.value && list.value.some((i) => i.status === 'processing' || i.status === 'uploading')) poll = setTimeout(load, 2000)
}
watch(open, (o) => (o ? void load() : poll && clearTimeout(poll)), { immediate: true })
onBeforeUnmount(() => poll && clearTimeout(poll))

// Each finished upload refreshes the list (the worker makes its renders a moment later).
watch(
  () => up.queue.value.map((q) => q.status).join(),
  () => {
    for (const q of up.queue.value) {
      if (q.status === 'failed' || q.status === 'invalid') toast.push({ kind: 'error', text: t('errors.' + (q.error === 'too_large' ? 'FILE_TOO_LARGE' : q.error === 'type' ? 'FILE_TYPE_NOT_ALLOWED' : (q.error ?? 'INTERNAL'))) })
      if (q.status === 'processing' || q.status === 'ready' || q.status === 'failed' || q.status === 'invalid') up.remove(q.id)
    }
    void load()
  },
)
const uploading = computed(() => up.queue.value.some((q) => q.status === 'queued' || q.status === 'uploading'))

function onFiles(e: Event) {
  const el = e.target as HTMLInputElement
  // The picker filters by type, but a drop or "all files" could still bring the other kind.
  const files = [...(el.files ?? [])]
  el.value = ''
  const wrong = files.filter((f) => validateFile(f).ok && (validateFile(f) as { kind: string }).kind !== props.kind)
  if (wrong.length) toast.push({ kind: 'error', text: t('errors.FILE_TYPE_NOT_ALLOWED') })
  const ok = files.filter((f) => !wrong.includes(f))
  if (ok.length) up.add(ok)
}

function pick(img: AdminSiteImageDto) {
  if (img.image) images.value = { ...images.value, [img.id]: img.image }
  if (img.video) videos.value = { ...videos.value, [img.id]: img.video }
  emit('pick', img.id)
  open.value = false
}

async function remove() {
  const img = confirmDelete.value
  if (!img) return
  deleting.value = true
  try {
    await deleteSiteImage(img.id)
    list.value = list.value.filter((i) => i.id !== img.id)
    confirmDelete.value = null
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    deleting.value = false
  }
}
const dur = (sec: number | null) => (sec == null ? '' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`)
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
</script>

<template>
  <Modal v-model:open="open" :title="kind === 'video' ? t('admin.home.videoLibrary') : t('admin.home.library')" wide>
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <Btn :loading="uploading" data-test="library-upload" @click="input?.click()">{{ kind === 'video' ? t('admin.home.uploadVideo') : t('admin.home.upload') }}</Btn>
        <input ref="input" type="file" multiple :accept="accept" class="hidden" data-test="library-input" @change="onFiles" />
        <p class="text-xs text-[var(--c-muted)]">{{ kind === 'video' ? t('admin.home.uploadVideoHint') : t('admin.home.uploadHint') }}</p>
      </div>
      <ul v-if="pending.length" class="flex flex-col gap-2" data-test="library-progress">
        <li v-for="q in pending" :key="q.id" class="flex items-center gap-3 rounded-lg border border-[var(--c-border)] px-3 py-2 text-xs">
          <span class="min-w-0 flex-1 truncate">{{ q.name }}</span>
          <span class="h-1.5 w-32 overflow-hidden rounded-full bg-[var(--c-surface-2)]" role="progressbar" :aria-label="t('admin.home.uploading', { name: q.name })" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(q.progress * 100)">
            <span class="block h-full bg-[var(--c-primary)] transition-[width]" :style="{ width: `${Math.round(q.progress * 100)}%` }" />
          </span>
          <span class="w-9 text-right text-[var(--c-muted)]">{{ Math.round(q.progress * 100) }}%</span>
        </li>
      </ul>
      <div v-if="loading" class="flex justify-center py-10"><Spinner /></div>
      <p v-else-if="!shown.length" class="py-8 text-center text-sm text-[var(--c-muted)]">{{ kind === 'video' ? t('admin.home.videoLibraryEmpty') : t('admin.home.libraryEmpty') }}</p>
      <ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <li v-for="img in shown" :key="img.id" class="flex flex-col overflow-hidden rounded-lg border border-[var(--c-border)]" data-test="library-item">
          <button
            type="button"
            class="relative aspect-square bg-[var(--c-surface-2)] disabled:cursor-not-allowed"
            :disabled="img.status !== 'ready'"
            :aria-label="t('admin.home.pickImage', { name: img.originalName })"
            data-test="library-pick"
            @click="pick(img)"
          >
            <img v-if="img.image" :src="img.image.src" alt="" class="h-full w-full object-cover" loading="lazy" />
            <span v-else class="absolute inset-0 flex items-center justify-center gap-2 text-xs text-[var(--c-muted)]">
              <Spinner v-if="img.status === 'processing'" />{{ t(img.status === 'failed' ? 'admin.home.imageFailed' : 'admin.home.imageProcessing') }}
            </span>
            <span v-if="img.used" class="badge absolute top-2 left-2">{{ t('admin.home.inUse') }}</span>
            <span v-if="img.kind === 'video' && img.durationSec != null" class="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">▶ {{ dur(img.durationSec) }}</span>
          </button>
          <div class="flex items-center gap-2 p-2 text-xs">
            <span class="min-w-0 flex-1 truncate" :title="img.originalName">{{ img.originalName }}</span>
            <span class="shrink-0 text-[var(--c-muted)]">{{ kb(img.sizeBytes) }}</span>
            <button
              type="button"
              class="icon-btn size-8 shrink-0 text-[var(--c-danger)] disabled:opacity-40"
              :disabled="img.used"
              :title="img.used ? t('admin.home.inUseHint') : undefined"
              :aria-label="t('admin.home.deleteImage', { name: img.originalName })"
              data-test="library-delete"
              @click="confirmDelete = img"
            >
              <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg>
            </button>
          </div>
        </li>
      </ul>
    </div>
  </Modal>
  <Modal :open="!!confirmDelete" :title="t('admin.home.deleteImageTitle')" @update:open="(v) => !v && (confirmDelete = null)">
    <p class="text-sm">{{ t('admin.home.deleteImageConfirm', { name: confirmDelete?.originalName ?? '' }) }}</p>
    <div class="mt-5 flex justify-end gap-2">
      <Btn variant="secondary" @click="confirmDelete = null">{{ t('common.cancel') }}</Btn>
      <Btn variant="danger" :loading="deleting" data-test="library-delete-confirm" @click="remove">{{ t('admin.home.delete') }}</Btn>
    </div>
  </Modal>
</template>

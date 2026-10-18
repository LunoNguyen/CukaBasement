<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ALLOWED_FILE_TYPES } from '@cuka/shared'
import { useUploader, validateFile } from '@/composables/useUploader'
import { useToast } from '@/stores/toast'
import Spinner from '@/components/common/Spinner.vue'
import ImageCropper from '@/components/upload/ImageCropper.vue'

/**
 * One profile image (avatar or banner): a still image is cropped first (ImageCropper: 1:1 avatar, 4:1 banner);
 * a GIF or animated WebP is uploaded as-is (the worker center-crops it, keeping the animation). Once the file is
 * accepted by the server (processing/ready) its id goes to `save`. The public URL only exists after the worker has
 * published it, so the uploaded file is previewed locally.
 */
const props = defineProps<{
  label: string
  testId: string
  shape: 'avatar' | 'banner'
  /** Public URL of the image currently saved on the profile, if any. */
  currentUrl?: string | null
  save: (fileId: string) => Promise<void>
}>()
const { t } = useI18n()
const toast = useToast()
const up = useUploader()

const accept = ALLOWED_FILE_TYPES.filter((f) => f.kind === 'image')
  .map((f) => '.' + f.ext)
  .join(',')
const preview = ref<string | null>(null)
const shown = computed(() => preview.value ?? props.currentUrl ?? null)
const saving = ref(false)
const input = ref<HTMLInputElement | null>(null)

function setPreview(file: File | null) {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = file && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null
}
onBeforeUnmount(() => setPreview(null))

/** GIF, or WebP whose VP8X header has the animation flag: canvas cropping would drop the animation. */
async function isAnimated(file: File): Promise<boolean> {
  if (file.type === 'image/gif') return true
  if (file.type !== 'image/webp') return false
  try {
    const b = new Uint8Array(await file.slice(0, 21).arrayBuffer())
    const tag = (from: number, to: number) => String.fromCharCode(...b.slice(from, to))
    return b.length >= 21 && tag(0, 4) === 'RIFF' && tag(8, 16) === 'WEBPVP8X' && (b[20]! & 0x02) !== 0
  } catch {
    return false
  }
}

/** Shown after an animated pick: it is uploaded uncropped and the worker crops it around the centre. */
const animatedNote = ref(false)
const cropping = ref<File | null>(null)
const cropperOpen = ref(false)

function upload(file: File) {
  for (const q of [...up.queue.value]) up.remove(q.id)
  setPreview(file)
  up.add([file])
}

async function onChange(e: Event) {
  const el = e.target as HTMLInputElement
  const file = el.files?.[0]
  el.value = ''
  if (!file) return
  const v = validateFile(file)
  if (!v.ok || v.kind !== 'image') {
    toast.push({ kind: 'error', text: t(v.ok || v.reason === 'type' ? 'settings.imageOnly' : 'errors.FILE_TOO_LARGE') })
    return
  }
  if (await isAnimated(file)) {
    animatedNote.value = true
    upload(file)
    return
  }
  animatedNote.value = false
  cropping.value = file
  cropperOpen.value = true
}

function onCropped(file: File) {
  cropping.value = null
  upload(file)
}

async function persist(fileId: string) {
  saving.value = true
  try {
    await props.save(fileId)
  } catch {
    setPreview(null)
  } finally {
    saving.value = false
  }
}

const state = () => {
  const q = up.queue.value[0]
  return q ? `${q.status}:${q.fileId ?? ''}` : ''
}
watch(state, () => {
  const q = up.queue.value[0]
  if (!q) return
  if ((q.status === 'processing' || q.status === 'ready') && q.fileId) void persist(q.fileId)
  else if (q.status === 'failed') toast.push({ kind: 'error', text: t('errors.' + (q.error ?? 'INTERNAL')) })
})

const busy = () => saving.value || up.queue.value.some((q) => q.status === 'queued' || q.status === 'uploading')
</script>

<template>
  <div class="flex flex-col gap-2 text-sm">
    <span>{{ label }}</span>
    <div class="flex items-center gap-3">
      <div
        class="flex shrink-0 items-center justify-center overflow-hidden bg-[var(--c-border)]"
        :class="shape === 'avatar' ? 'h-20 w-20 rounded-full' : 'h-12 w-48 rounded'"
      >
        <img v-if="shown" :src="shown" alt="" :data-test="testId + '-preview'" class="h-full w-full object-cover" />
      </div>
      <button
        type="button"
        class="rounded border border-[var(--c-border)] px-3 py-1.5 font-semibold disabled:opacity-60"
        :data-test="testId + '-choose'"
        :aria-label="t('settings.chooseImage') + ': ' + label"
        :disabled="busy()"
        @click="input?.click()"
      >
        <Spinner v-if="busy()" />
        <span v-else>{{ t('settings.chooseImage') }}</span>
      </button>
      <input ref="input" :data-test="testId + '-input'" type="file" class="sr-only" tabindex="-1" aria-hidden="true" :accept="accept" @change="onChange" />
    </div>
    <p v-if="animatedNote" :data-test="testId + '-animated-note'" class="text-xs text-[var(--c-muted)]">{{ t('settings.animatedNote') }}</p>
    <ImageCropper v-model:open="cropperOpen" :file="cropping" :shape="shape" @confirm="onCropped" @cancel="cropping = null" />
  </div>
</template>

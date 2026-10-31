<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Cropper from 'cropperjs'
import type { CropRect } from '@cuka/shared'
import 'cropperjs/dist/cropper.css'
import Modal from '@/components/common/Modal.vue'
import Btn from '@/components/common/Btn.vue'

/**
 * Crop/edit dialog for a profile image: avatar 1:1 (round preview) exported at 512×512, banner 4:1 exported at
 * 1600×400. PNG, JPEG and WebP keep their type (quality 0.92); anything else is exported as PNG.
 *
 * `animated` (GIF / animated WebP): a canvas would keep one frame only, so nothing is exported; `crop` gives the chosen
 * box as fractions of the original instead, and the worker cuts every frame to it. Rotate and flip cannot be applied
 * that way, so they are off.
 */
const props = defineProps<{ file: File | null; shape: 'avatar' | 'banner'; animated?: boolean }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ confirm: [file: File]; crop: [rect: CropRect]; cancel: [] }>()
const { t } = useI18n()

const SHAPES = {
  avatar: { aspectRatio: 1, width: 512, height: 512 },
  banner: { aspectRatio: 4, width: 1600, height: 400 },
} as const
const KEEP_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const QUALITY = 0.92
const ZOOM_STEP = 0.1
const MOVE_STEP = 10

const image = ref<HTMLImageElement | null>(null)
const src = ref<string | null>(null)
const exporting = ref(false)
const failed = ref(false)
/** The browser could not decode the picked file. */
const unreadable = ref(false)
let cropper: Cropper | null = null

function destroy() {
  cropper?.destroy()
  cropper = null
}
function setSource(file: File | null) {
  if (src.value) URL.revokeObjectURL(src.value)
  src.value = file ? URL.createObjectURL(file) : null
}

watch(
  () => [open.value, props.file] as const,
  ([isOpen, file]) => {
    destroy()
    failed.value = false
    unreadable.value = false
    setSource(isOpen ? file : null)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  destroy()
  setSource(null)
})

function onImageLoad() {
  unreadable.value = false
  destroy()
  if (!image.value) return
  cropper = new Cropper(image.value, {
    aspectRatio: SHAPES[props.shape].aspectRatio,
    viewMode: 1,
    dragMode: 'move',
    autoCropArea: 1,
    background: false,
    responsive: true,
    rotatable: !props.animated,
    scalable: !props.animated,
  })
}

function onImageError() {
  destroy()
  unreadable.value = true
}

const zoom = (step: number) => cropper?.zoom(step)
const rotate = () => cropper?.rotate(90)
const flip = () => {
  if (cropper) cropper.scaleX(cropper.getData().scaleX === -1 ? 1 : -1)
}
const reset = () => cropper?.reset()

function onStageKey(e: KeyboardEvent) {
  if (!cropper) return
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-MOVE_STEP, 0],
    ArrowRight: [MOVE_STEP, 0],
    ArrowUp: [0, -MOVE_STEP],
    ArrowDown: [0, MOVE_STEP],
  }
  const m = moves[e.key]
  if (m) cropper.move(m[0], m[1])
  else if (e.key === '+' || e.key === '=') zoom(ZOOM_STEP)
  else if (e.key === '-' || e.key === '_') zoom(-ZOOM_STEP)
  else return
  e.preventDefault()
}

/** The exported file's type and name: the input's type when kept, else PNG with a .png name. */
function output(file: File): { type: string; name: string } {
  const type = KEEP_TYPES.includes(file.type) ? file.type : 'image/png'
  if (type === file.type) return { type, name: file.name }
  return { type, name: (file.name.replace(/\.[^.]*$/, '') || 'image') + '.png' }
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** The crop box as fractions of the natural image, kept inside it; null when the box is empty. */
function cropRect(c: Cropper): CropRect | null {
  const d = c.getData()
  const { naturalWidth: nw, naturalHeight: nh } = c.getImageData()
  if (!nw || !nh) return null
  const x = round6(clamp01(d.x / nw))
  const y = round6(clamp01(d.y / nh))
  const w = Math.min(round6(clamp01(d.width / nw)), round6(1 - x))
  const h = Math.min(round6(clamp01(d.height / nh)), round6(1 - y))
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

function confirmRect(c: Cropper) {
  const rect = cropRect(c)
  if (!rect) {
    failed.value = true
    return
  }
  emit('crop', rect)
  confirmed = true
  open.value = false
}

async function confirm() {
  if (!cropper || !props.file || exporting.value) return
  if (props.animated) {
    failed.value = false
    confirmRect(cropper)
    return
  }
  exporting.value = true
  failed.value = false
  try {
    const { width, height } = SHAPES[props.shape]
    const { type, name } = output(props.file)
    const canvas = cropper.getCroppedCanvas({
      width,
      height,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      // JPEG has no alpha: fill transparent areas (rotated corners) with white instead of black.
      ...(type === 'image/jpeg' ? { fillColor: '#fff' } : {}),
    })
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY))
    if (!blob) {
      failed.value = true
      return
    }
    emit('confirm', new File([blob], name, { type }))
    confirmed = true
    open.value = false
  } finally {
    exporting.value = false
  }
}

/** Closing without a confirmed crop (Cancel, Escape, ✕ or the backdrop) is a cancel. */
let confirmed = false
watch(open, (isOpen, was) => {
  if (isOpen || !was) return
  if (!confirmed) emit('cancel')
  confirmed = false
})

function cancel() {
  open.value = false
}

const title = computed(() => t(props.shape === 'avatar' ? 'cropper.titleAvatar' : 'cropper.titleBanner'))
const control = 'inline-flex min-h-9 items-center rounded border border-[var(--c-border)] px-3 text-sm hover:bg-[var(--c-surface-2)]'
</script>

<template>
  <Modal v-model:open="open" :title="title" wide>
    <div class="flex flex-col gap-3">
      <div
        data-test="cropper-stage"
        tabindex="0"
        role="group"
        :aria-label="t('cropper.stage')"
        class="h-[min(60vh,24rem)] w-full overflow-hidden rounded-lg bg-[var(--c-surface-2)] focus:outline-2 focus:outline-[var(--c-accent-strong)]"
        :class="{ 'crop-round': shape === 'avatar' }"
        @keydown="onStageKey"
      >
        <img v-if="src" ref="image" :src="src" alt="" data-test="cropper-image" class="block max-w-full" @load="onImageLoad" @error="onImageError" />
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-test="cropper-zoom-in" :class="control" :aria-label="t('cropper.zoomIn')" :title="t('cropper.zoomIn')" @click="zoom(ZOOM_STEP)">
          <span aria-hidden="true">＋</span>
        </button>
        <button type="button" data-test="cropper-zoom-out" :class="control" :aria-label="t('cropper.zoomOut')" :title="t('cropper.zoomOut')" @click="zoom(-ZOOM_STEP)">
          <span aria-hidden="true">－</span>
        </button>
        <template v-if="!animated">
          <button type="button" data-test="cropper-rotate" :class="control" :aria-label="t('cropper.rotate')" :title="t('cropper.rotate')" @click="rotate">
            <span aria-hidden="true">⟳</span>
          </button>
          <button type="button" data-test="cropper-flip" :class="control" :aria-label="t('cropper.flip')" :title="t('cropper.flip')" @click="flip">
            <span aria-hidden="true">⇋</span>
          </button>
        </template>
        <button type="button" data-test="cropper-reset" :class="control" :aria-label="t('cropper.reset')" @click="reset">
          {{ t('cropper.reset') }}
        </button>
      </div>
      <p v-if="animated" data-test="cropper-animated-note" class="text-xs text-[var(--c-muted)]">{{ t('cropper.animatedNote') }}</p>
      <p v-if="unreadable" role="alert" data-test="cropper-unreadable" class="text-sm text-[var(--c-danger)]">{{ t('cropper.unreadable') }}</p>
      <p v-else-if="failed" role="alert" class="text-sm text-[var(--c-danger)]">{{ t('cropper.failed') }}</p>
      <div class="flex justify-end gap-2">
        <Btn variant="secondary" data-test="cropper-cancel" @click="cancel">{{ t('cropper.cancel') }}</Btn>
        <Btn data-test="cropper-confirm" :loading="exporting" @click="confirm">{{ t('cropper.confirm') }}</Btn>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.crop-round :deep(.cropper-view-box),
.crop-round :deep(.cropper-face) {
  border-radius: 50%;
}
</style>

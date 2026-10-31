<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PostMediaDto } from '@/api/types'
import MediaPlaceholder from './MediaPlaceholder.vue'

/**
 * Full-screen zoomable view of a post's images. Shows the largest public variant (preview, else thumb_md), never the
 * presigned original, and never a blurred r18 file: the viewer does not open it for those, and it refuses them too.
 */
const props = defineProps<{ items: PostMediaDto[]; title: string }>()
const emit = defineEmits<{ original: [m: PostMediaDto] }>()
const open = defineModel<boolean>('open', { default: false })
const index = defineModel<number>('index', { default: 0 })
const { t } = useI18n()

const MIN = 1
const MAX = 5
const STEP = 1.5

/** The shown page, ahead of the parent's v-model round-trip so fast key repeats each count. */
const pos = ref(index.value)
watch(index, (v) => (pos.value = v))

const images = computed(() => props.items.filter((m) => m.kind === 'image' && !m.blurred))
const current = computed(() => images.value[Math.min(Math.max(pos.value, 0), images.value.length - 1)] ?? null)
const src = computed(() => current.value?.previewUrl ?? current.value?.thumbMdUrl ?? null)
const many = computed(() => images.value.length > 1)
const name = computed(() => (many.value ? t('post.pageAlt', { title: props.title, n: pos.value + 1 }) : props.title))

const dialog = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const img = ref<HTMLImageElement | null>(null)

const view = reactive({ scale: 1, x: 0, y: 0 })
const zoomed = computed(() => view.scale > 1)
const percent = computed(() => `${Math.round(view.scale * 100)}%`)

function reset() {
  view.scale = 1
  view.x = 0
  view.y = 0
}

/** Keeps the zoomed image covering the stage: it can be panned up to its own edges, no further. */
function clampPan() {
  const s = stage.value
  const i = img.value
  if (!s || !i) return
  const maxX = Math.max(0, (i.offsetWidth * view.scale - s.clientWidth) / 2)
  const maxY = Math.max(0, (i.offsetHeight * view.scale - s.clientHeight) / 2)
  view.x = Math.min(maxX, Math.max(-maxX, view.x))
  view.y = Math.min(maxY, Math.max(-maxY, view.y))
}

/** Zooms to `next`, keeping the point under (clientX, clientY) in place; the stage centre without a point. */
function zoomTo(next: number, clientX?: number, clientY?: number) {
  const scale = Math.min(MAX, Math.max(MIN, next))
  if (scale === view.scale) return
  const rect = stage.value?.getBoundingClientRect()
  const px = rect && clientX !== undefined ? clientX - (rect.left + rect.width / 2) : 0
  const py = rect && clientY !== undefined ? clientY - (rect.top + rect.height / 2) : 0
  const k = scale / view.scale
  view.x = px - (px - view.x) * k
  view.y = py - (py - view.y) * k
  view.scale = scale
  if (scale === MIN) reset()
  else clampPan()
}

const zoomIn = () => zoomTo(view.scale * STEP)
const zoomOut = () => zoomTo(view.scale / STEP < 1.05 ? MIN : view.scale / STEP)

function onWheel(e: WheelEvent) {
  e.preventDefault()
  // ctrl+wheel is also how trackpad pinches arrive: small deltas, so a steeper curve.
  zoomTo(view.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY)
}

function onDblClick(e: MouseEvent) {
  if (zoomed.value) reset()
  else zoomTo(2, e.clientX, e.clientY)
}

// ---- drag to pan, two-finger pinch ----
const pointers = new Map<number, { x: number; y: number }>()
let pinch: { dist: number; scale: number } | null = null
let moved = false
/** A finger or button is down: the transform follows it without easing. */
const gesturing = ref(false)

const distance = () => {
  const [a, b] = [...pointers.values()]
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
}

function onPointerDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  moved = false
  gesturing.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  if (pointers.size === 2) pinch = { dist: distance(), scale: view.scale }
}

function onPointerMove(e: PointerEvent) {
  const prev = pointers.get(e.pointerId)
  if (!prev) return
  const dx = e.clientX - prev.x
  const dy = e.clientY - prev.y
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (Math.abs(dx) + Math.abs(dy) > 2) moved = true
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()]
    if (pinch.dist > 0) zoomTo((pinch.scale * distance()) / pinch.dist, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2)
  } else if (zoomed.value) {
    view.x += dx
    view.y += dy
    clampPan()
  }
}

function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinch = null
  gesturing.value = pointers.size > 0
}

/** A plain click on the empty backdrop (not a drag) closes, like most lightboxes. */
function onStageClick(e: MouseEvent) {
  if (e.target === stage.value && !moved && !zoomed.value) open.value = false
}

// ---- navigation ----
function go(delta: number) {
  const n = images.value.length
  if (n < 2) return
  pos.value = (pos.value + delta + n) % n
  index.value = pos.value
}

watch(pos, reset)

// ---- keyboard, focus trap ----
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    open.value = false
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault()
    go(e.key === 'ArrowLeft' ? -1 : 1)
  } else if (e.key === '+' || e.key === '=') {
    e.preventDefault()
    zoomIn()
  } else if (e.key === '-') {
    e.preventDefault()
    zoomOut()
  } else if (e.key === '0') {
    e.preventDefault()
    reset()
  } else if (e.key === 'Tab' && dialog.value) {
    const items = Array.from(dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE))
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return e.preventDefault()
    const active = document.activeElement
    const outside = !dialog.value.contains(active) || active === dialog.value
    if (e.shiftKey && (active === first || outside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || outside)) {
      e.preventDefault()
      first.focus()
    }
  }
}

// ---- open / close: scroll lock, focus in and back ----
let previous: HTMLElement | null = null
let bodyOverflow: string | null = null

function release() {
  if (bodyOverflow !== null) document.body.style.overflow = bodyOverflow
  bodyOverflow = null
  pointers.clear()
  pinch = null
  gesturing.value = false
  previous?.focus?.()
  previous = null
}

watch(
  open,
  async (isOpen) => {
    if (isOpen) {
      reset()
      previous = document.activeElement as HTMLElement | null
      bodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      await nextTick()
      ;(closeBtn.value ?? dialog.value)?.focus()
    } else release()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (open.value) release()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && current"
      ref="dialog"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      data-test="lightbox"
      :aria-label="t('post.lightbox', { name: title })"
      class="fixed inset-0 z-50 flex flex-col bg-[#0a0a0a]/95 text-[#ededed] outline-none"
      @keydown="onKeydown"
    >
      <div class="flex shrink-0 items-center gap-1 px-2 py-2 sm:px-4">
        <p
          v-if="many"
          data-test="lightbox-indicator"
          class="min-w-0 px-2 text-sm text-[#a3a3a3] tabular-nums"
          :aria-label="t('post.pageOf', { n: pos + 1, total: images.length })"
        >
          {{ pos + 1 }} / {{ images.length }}
        </p>
        <div class="ml-auto flex items-center gap-1">
          <button type="button" data-test="zoom-out" class="icon-btn lightbox-btn" :disabled="!zoomed" :aria-label="t('post.zoomOut')" @click="zoomOut">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M20 20l-3.5-3.5" /></svg>
          </button>
          <button
            type="button"
            data-test="zoom-level"
            class="lightbox-btn inline-flex h-11 min-w-14 items-center justify-center rounded px-2 text-xs tabular-nums"
            :aria-label="t('post.zoomReset')"
            @click="reset"
          >
            {{ percent }}
          </button>
          <button type="button" data-test="zoom-in" class="icon-btn lightbox-btn" :disabled="view.scale >= MAX" :aria-label="t('post.zoomIn')" @click="zoomIn">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M11 8v6M20 20l-3.5-3.5" /></svg>
          </button>
          <button type="button" data-test="lightbox-original" class="icon-btn lightbox-btn" :aria-label="t('post.openOriginal', { name })" @click="emit('original', current)">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
          </button>
          <button ref="closeBtn" type="button" data-test="lightbox-close" class="icon-btn lightbox-btn" :aria-label="t('common.close')" @click="open = false">
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </div>

      <div
        ref="stage"
        data-test="lightbox-stage"
        class="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden select-none"
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @click="onStageClick"
      >
        <img
          v-if="src"
          ref="img"
          :key="current.fileId"
          data-test="lightbox-img"
          :src="src"
          :alt="name"
          draggable="false"
          class="max-h-full max-w-full object-contain will-change-transform"
          :class="zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'"
          :style="{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: gesturing ? 'none' : 'transform 0.12s ease-out' }"
          @dblclick="onDblClick"
          @load="clampPan"
        />
        <div v-else class="aspect-[4/3] w-full max-w-md"><MediaPlaceholder /></div>

        <template v-if="many">
          <button type="button" data-test="lightbox-prev" class="icon-btn lightbox-btn lightbox-nav left-2 sm:left-4" :aria-label="t('post.prevImage')" @click.stop="go(-1)">
            <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
          </button>
          <button type="button" data-test="lightbox-next" class="icon-btn lightbox-btn lightbox-nav right-2 sm:right-4" :aria-label="t('post.nextImage')" @click.stop="go(1)">
            <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* icon-btn's text and hover are for the page; on the cellar backdrop it is light on dark. */
.lightbox-btn {
  color: #ededed;
  transition: background-color 0.15s;
}
.lightbox-btn:hover:not(:disabled) {
  background: #2e2e2e;
}
.lightbox-btn:disabled {
  opacity: 0.4;
}
.lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: color-mix(in srgb, #1f1f1f 80%, transparent);
}
</style>

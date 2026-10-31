<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatMusicDate, formatViews, type MusicVideo } from './music'

/**
 * The music section's player: a dark dialog with the youtube-nocookie.com player (it loads when the visitor chose a
 * video — that click is the "play"), its title, date and views, and a "Watch on YouTube" link. Focus stays inside
 * while it is open; Esc, the close button or a click outside closes it and focus returns to the chosen card.
 */
const props = defineProps<{ video: MusicVideo | null; locale: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const titleId = useId()
const dialog = ref<HTMLElement | null>(null)
let previous: HTMLElement | null = null

const src = computed(() => (props.video ? `https://www.youtube-nocookie.com/embed/${props.video.id}?autoplay=1&rel=0` : ''))
const meta = computed(() => {
  const v = props.video
  if (!v) return ''
  return [formatMusicDate(v.date, props.locale), v.views !== null ? t('landing.music.views', { n: formatViews(v.views, props.locale) }) : ''].filter(Boolean).join(' · ')
})

const FOCUSABLE = 'a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const items = Array.from(dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE))
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) return
  const active = document.activeElement
  const outside = !dialog.value.contains(active)
  if (e.shiftKey && (active === first || outside)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || outside)) {
    e.preventDefault()
    first.focus()
  }
}

function release() {
  document.removeEventListener('keydown', onKeydown)
  document.documentElement.classList.remove('fp-dialog-open')
  const back = previous
  previous = null
  back?.focus?.({ preventScroll: true })
}

watch(
  () => !!props.video,
  async (open) => {
    if (open) {
      previous = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKeydown)
      document.documentElement.classList.add('fp-dialog-open')
      await nextTick()
      dialog.value?.querySelector<HTMLElement>('[data-test="music-close"]')?.focus()
    } else release()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (previous || document.documentElement.classList.contains('fp-dialog-open')) release()
})
</script>

<template>
  <Teleport to="body">
    <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity duration-300 motion-reduce:transition-none" leave-active-class="transition-opacity duration-200 motion-reduce:transition-none">
      <div v-if="video" class="fixed inset-0 z-50 flex items-center justify-center bg-[#0f0b09]/90 p-3 backdrop-blur-sm sm:p-8" data-test="music-lightbox" @click.self="emit('close')">
        <div ref="dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId" class="flex w-full max-w-[min(72rem,calc((100svh-12rem)*16/9))] flex-col gap-4 text-[#f3ebe6]">
          <div class="flex items-center justify-between gap-4">
            <p class="text-[11px] text-[#a89a90]">{{ t('landing.music.player') }}</p>
            <button type="button" class="flex size-11 items-center justify-center rounded-full border border-[#f3ebe6]/35 hover:border-[#f3ebe6]" :aria-label="t('landing.music.close')" data-test="music-close" @click="emit('close')">
              <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <div class="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl">
            <iframe
              :key="video.id"
              :src="src"
              :title="video.title"
              class="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen
              referrerpolicy="strict-origin-when-cross-origin"
              data-test="music-iframe"
            />
          </div>
          <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div class="flex min-w-0 flex-col gap-1">
              <h2 :id="titleId" class="font-display text-xl leading-tight font-semibold text-balance sm:text-2xl">{{ video.title }}</h2>
              <p v-if="meta" class="text-xs text-[#a89a90]">{{ meta }}</p>
            </div>
            <a :href="video.watchUrl" target="_blank" rel="noopener noreferrer" class="group inline-flex min-h-11 items-center gap-2 rounded-full bg-[#fbf7f4] px-5 text-sm font-semibold text-[#5b3a29] hover:bg-white" data-test="music-watch">
              {{ t('landing.music.watchOnYoutube') }}
              <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
              <span class="sr-only">{{ t('landing.fp.newTab') }}</span>
            </a>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

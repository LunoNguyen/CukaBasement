<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HeroVideoData } from '@cuka/shared'
import SiteImage from './SiteImage.vue'
import SmartLink from './SmartLink.vue'
import { useLanding } from './context'
import { useInView, useMedia, usePageVisible, useReducedMotion } from './motion'
import { pickFromSrcset } from './media'

/**
 * The page's opening panel (at most 60% of the screen): a muted, looping background video (the phone clip on small
 * screens) that plays only while in view and while the tab is visible, with a pause button (WCAG 2.2.2). Reduced
 * motion: the poster and a play button. No video: the images cross-fade, else plain text on the grey surface.
 */
const props = withDefaults(defineProps<{ data: HeroVideoData; level?: 1 | 2 }>(), { level: 1 })
const { t } = useI18n()
const { tx, images, videos, preview } = useLanding()
const nameId = useId()

const root = ref<HTMLElement | null>(null)
const video = ref<HTMLVideoElement | null>(null)
const inView = useInView(root, 0.25)
const pageVisible = usePageVisible()
const reduced = useReducedMotion()
const phone = useMedia('(max-width: 767px)')

/** The clip for this screen: the phone one on a phone when set, else the desktop one (or the phone one alone). */
const clipId = computed(() => {
  const desk = props.data.video?.fileId
  const mob = props.data.videoMobile?.fileId
  const ok = (id?: string) => (id && videos.value[id] ? id : undefined)
  return (phone.value ? ok(mob) ?? ok(desk) : ok(desk) ?? ok(mob)) ?? null
})
const clip = computed(() => (clipId.value ? videos.value[clipId.value]! : null))
const poster = computed(() => {
  const p = clipId.value ? images.value[clipId.value] : undefined
  if (!p) return undefined
  const w = typeof window === 'undefined' ? 1440 : window.innerWidth * Math.min(2, window.devicePixelRatio || 1)
  return pickFromSrcset(p.srcset, w, p.src)
})
const slides = computed(() => props.data.images.filter((img) => images.value[img.fileId]))

// --- Playback: the visitor's choice, then what the screen allows ------------------------------------------------
const wanted = ref(true)
const current = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
const animated = computed(() => (clip.value ? true : slides.value.length > 1))
const playing = computed(() => wanted.value && !preview && inView.value && pageVisible.value)

function syncVideo() {
  const v = video.value
  if (!v) return
  if (playing.value) {
    try {
      const p = v.play?.()
      if (p && typeof p.catch === 'function') p.catch(() => (wanted.value = false))
    } catch {
      wanted.value = false
    }
  } else v.pause?.()
}
function syncSlides() {
  if (timer) clearInterval(timer)
  timer = undefined
  if (!clip.value && slides.value.length > 1 && playing.value) timer = setInterval(() => (current.value = (current.value + 1) % slides.value.length), 6500)
}
function toggle() {
  wanted.value = !wanted.value
}

onMounted(async () => {
  await nextTick()
  if (reduced.value) wanted.value = false
  syncVideo()
  syncSlides()
})
watch(playing, () => {
  syncVideo()
  syncSlides()
})
watch(
  () => clip.value?.src,
  async () => {
    await nextTick()
    video.value?.load?.()
    syncVideo()
  },
)
watch(
  () => slides.value.length,
  (n) => {
    if (current.value >= n) current.value = 0
    syncSlides()
  },
)
onBeforeUnmount(() => timer && clearInterval(timer))

const media = computed(() => !!clip.value || slides.value.length > 0)
</script>

<template>
  <section
    ref="root"
    data-test="fp-hero"
    :aria-labelledby="nameId"
    class="relative isolate flex max-h-[60vh] flex-col justify-end overflow-hidden rounded-lg"
    :class="media ? 'h-[60vh] min-h-[280px] bg-[#141414] text-white sm:min-h-[360px]' : 'bg-[var(--c-surface-2)]'"
  >
    <div v-if="media" class="absolute inset-0 -z-10" aria-hidden="true">
      <video
        v-if="clip"
        ref="video"
        data-test="fp-hero-video"
        class="h-full w-full object-cover"
        :poster="poster"
        :preload="inView ? 'auto' : 'metadata'"
        muted
        loop
        playsinline
        disablepictureinpicture
        disableremoteplayback
        tabindex="-1"
      >
        <source :src="clip.src" :type="clip.mime" />
      </video>
      <template v-else>
        <div
          v-for="(img, i) in slides"
          :key="img.fileId"
          class="absolute inset-0 transition-opacity duration-[1400ms] ease-out motion-reduce:transition-none"
          :class="i === current ? 'opacity-100' : 'opacity-0'"
          data-test="fp-hero-slide"
        >
          <SiteImage :image="img" sizes="(min-width: 1280px) 1232px, 100vw" :eager="i === 0" img-class="h-full w-full object-cover" />
        </div>
      </template>
      <!-- Keeps the text legible over any frame. -->
      <div class="absolute inset-0 bg-linear-to-t from-black/75 via-black/30 to-transparent" />
    </div>

    <div class="flex flex-col gap-3 p-6 sm:p-10">
      <p v-if="tx(data.eyebrow)" class="text-xs font-semibold" :class="media ? 'text-white/80' : 'text-[var(--c-accent-strong)]'">{{ tx(data.eyebrow) }}</p>
      <component
        :is="level === 1 ? 'h1' : 'h2'"
        :id="nameId"
        data-test="fp-hero-name"
        class="font-display text-[clamp(2.25rem,6vw,4rem)] leading-[1.02] font-semibold tracking-[-0.02em] text-balance"
        >{{ tx(data.name) }}</component
      >
      <p v-if="tx(data.subtitle)" class="max-w-xl text-sm leading-relaxed sm:text-base" :class="media ? 'text-white/85' : 'text-[var(--c-muted)]'">{{ tx(data.subtitle) }}</p>
      <div class="flex flex-wrap items-center gap-2 pt-2">
        <SmartLink
          v-if="data.link"
          :href="data.link.href"
          data-test="fp-now-playing"
          class="inline-flex h-10 items-center gap-1.5 rounded bg-[var(--c-accent-strong)] px-4 text-sm font-semibold text-[var(--c-on-primary)] hover:brightness-110"
        >
          <span v-if="tx(data.link.kicker)" class="sr-only">{{ tx(data.link.kicker) }}:</span>
          {{ tx(data.link.label) }}
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
        </SmartLink>
        <button
          v-if="animated"
          type="button"
          data-test="fp-hero-toggle"
          class="inline-flex h-10 items-center gap-1.5 rounded px-3 text-sm font-semibold"
          :class="media ? 'border border-white/40 text-white hover:bg-white/10' : 'border border-[var(--c-border)]'"
          :aria-pressed="!wanted"
          @click="toggle"
        >
          <svg v-if="wanted" viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
          <svg v-else viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          <span class="sr-only sm:not-sr-only">{{ wanted ? t(clip ? 'landing.fp.pauseVideo' : 'landing.pause') : t(clip ? 'landing.fp.playVideo' : 'landing.play') }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

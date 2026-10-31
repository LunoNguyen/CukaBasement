<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HeroVideoData } from '@cuka/shared'
import BasementArt from '@/components/brand/BasementArt.vue'
import Halftone from '../Halftone.vue'
import SiteImage from '../SiteImage.vue'
import SmartLink from '../SmartLink.vue'
import { useLanding } from '../context'
import { useInView, useMedia, usePageVisible, useReducedMotion } from '../motion'
import { pickFromSrcset } from './media'

/**
 * The opening screen: a muted, looping background video (the phone clip on small screens) that plays only while the
 * screen is in view and the tab is visible, with a pause button (WCAG 2.2.2). Reduced motion: the poster and a play
 * button. No video: the images cross-fade, else the basement art. The name sits huge at the bottom left and the
 * "now playing" link bottom right, drawn in difference blend so it reads over any frame.
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

const words = computed(() => tx(props.data.name).split(/\s+/).filter(Boolean))
</script>

<template>
  <section ref="root" data-test="fp-hero" :aria-labelledby="nameId" class="fp-hero relative isolate flex flex-1 flex-col overflow-hidden bg-[#0a0a0a] text-[#f3ebe6]">
    <!-- Background -->
    <div class="absolute inset-0 -z-10" aria-hidden="true">
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
      <template v-else-if="slides.length">
        <div
          v-for="(img, i) in slides"
          :key="img.fileId"
          class="absolute inset-0 transition-opacity duration-[1400ms] ease-out motion-reduce:transition-none"
          :class="i === current ? 'opacity-100' : 'opacity-0'"
          data-test="fp-hero-slide"
        >
          <SiteImage :image="img" sizes="100vw" :eager="i === 0" img-class="h-full w-full object-cover" />
        </div>
      </template>
      <template v-else>
        <BasementArt class="absolute inset-0 h-full w-full" data-test="fp-hero-art" />
        <Halftone class="absolute inset-0 h-full w-full opacity-40" from="tr" :size="11" />
      </template>
      <!-- Flat scrims keep the type at contrast over any frame. -->
      <div class="absolute inset-0 bg-[#0f0b09]/25" />
      <div class="absolute inset-x-0 bottom-0 h-2/3 bg-linear-to-t from-[#0f0b09]/70 to-transparent" />
    </div>

    <p v-if="tx(data.eyebrow)" class="fp-fade pointer-events-none absolute top-6 left-1/2 hidden -translate-x-1/2 items-center gap-3 text-[11px] whitespace-nowrap text-[#f3ebe6]/85 sm:top-8 md:flex">
      <span class="size-1.5 rounded-full bg-[var(--c-accent)]" aria-hidden="true" />{{ tx(data.eyebrow) }}
    </p>

    <div class="relative mt-auto grid gap-8 px-5 pt-28 pb-7 sm:px-10 sm:pb-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-12">
      <div class="flex min-w-0 flex-col gap-5">
        <p v-if="tx(data.eyebrow)" class="fp-fade flex items-center gap-2 text-[11px] text-[#f3ebe6]/85 md:hidden">
          <span class="size-1.5 rounded-full bg-[var(--c-accent)]" aria-hidden="true" />{{ tx(data.eyebrow) }}
        </p>
        <component
          :is="level === 1 ? 'h1' : 'h2'"
          :id="nameId"
          data-test="fp-hero-name"
          class="font-display text-[clamp(2.6rem,11.5cqw,12.5rem)] leading-[0.84] font-semibold tracking-[-0.045em] [word-spacing:0.12em] [overflow-wrap:anywhere]"
        >
          <template v-for="(w, i) in words" :key="i"
            ><span class="fp-word inline-block overflow-hidden pb-[0.06em] align-bottom"
              ><span class="fp-rise inline-block" :style="{ animationDelay: `${180 + i * 110}ms` }">{{ w }}</span></span
            >{{ i < words.length - 1 ? ' ' : '' }}</template
          >
        </component>
        <p v-if="tx(data.subtitle)" class="fp-fade max-w-xl text-base leading-relaxed text-[#f3ebe6]/85 sm:text-lg" style="animation-delay: 520ms">{{ tx(data.subtitle) }}</p>
      </div>

      <div class="flex items-center justify-between gap-4 lg:flex-col lg:items-end lg:gap-6">
        <SmartLink
          v-if="data.link"
          :href="data.link.href"
          data-test="fp-now-playing"
          class="fp-fade group flex min-h-11 items-center gap-3 text-white mix-blend-difference"
          style="animation-delay: 700ms"
        >
          <span class="fp-eq flex h-5 items-end gap-[3px]" aria-hidden="true"><i /><i /><i /><i /></span>
          <span class="flex flex-col leading-tight">
            <span v-if="tx(data.link.kicker)" class="text-[10px] opacity-80">{{ tx(data.link.kicker) }}</span>
            <span class="font-display text-lg font-semibold whitespace-nowrap sm:text-xl">{{ tx(data.link.label) }}</span>
          </span>
          <svg viewBox="0 0 24 24" class="size-5 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
        </SmartLink>
        <button
          v-if="animated"
          type="button"
          data-test="fp-hero-toggle"
          class="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full border border-[#f3ebe6]/40 bg-[#0f0b09]/30 px-3 text-xs font-semibold whitespace-nowrap text-[#f3ebe6] backdrop-blur-sm hover:border-[#f3ebe6] sm:px-4"
          :aria-pressed="!wanted"
          @click="toggle"
        >
          <svg v-if="wanted" viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
          <svg v-else viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          <span class="sr-only sm:not-sr-only">{{ wanted ? t(clip ? 'landing.fp.pauseVideo' : 'landing.pause') : t(clip ? 'landing.fp.playVideo' : 'landing.play') }}</span>
        </button>
      </div>
    </div>

    <div class="fp-fade pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[10px] text-[#f3ebe6]/70 xl:flex" style="animation-delay: 900ms" aria-hidden="true">
      {{ t('landing.fp.scroll') }}<span class="fp-scrollline block h-10 w-px bg-[#f3ebe6]/50" />
    </div>
  </section>
</template>

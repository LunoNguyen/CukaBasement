<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HeroData } from '@cuka/shared'
import SiteImage from './SiteImage.vue'
import SmartLink from './SmartLink.vue'
import { useLanding } from './context'

/**
 * The page's opening panel (at most 60% of the screen). With pictures: a cross-fading slideshow (paused on reduced
 * motion, with a pause button and slide dots) under a dark scrim. Without: plain text on the grey surface.
 */
const props = withDefaults(defineProps<{ data: HeroData; level?: 1 | 2 }>(), { level: 1 })
const { t } = useI18n()
const { tx, images } = useLanding()
const titleId = useId()

/** Slides whose image is ready; a chosen but unprocessed picture is skipped. */
const slides = computed(() => props.data.images.filter((img) => images.value[img.fileId]))
const current = ref(0)
const playing = ref(true)
const reduced = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

function stop() {
  if (timer) clearInterval(timer)
  timer = undefined
}
function start() {
  stop()
  if (slides.value.length > 1 && playing.value && !reduced.value) timer = setInterval(() => (current.value = (current.value + 1) % slides.value.length), 6500)
}
function go(i: number) {
  current.value = i
  start()
}
function toggle() {
  playing.value = !playing.value
  start()
}

onMounted(() => {
  try {
    reduced.value = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    /* ignore */
  }
  if (reduced.value) playing.value = false
  start()
})
onBeforeUnmount(stop)
watch(
  () => slides.value.length,
  (n) => {
    if (current.value >= n) current.value = 0
    start()
  },
)
</script>

<template>
  <section
    data-test="landing-hero"
    :aria-labelledby="titleId"
    class="relative isolate flex max-h-[60vh] flex-col justify-end overflow-hidden rounded-lg"
    :class="slides.length ? 'h-[60vh] min-h-[280px] bg-[#141414] text-white sm:min-h-[360px]' : 'bg-[var(--c-surface-2)]'"
  >
    <div v-if="slides.length" class="absolute inset-0 -z-10">
      <div
        v-for="(img, i) in slides"
        :key="img.fileId"
        class="absolute inset-0 transition-opacity duration-[1400ms] ease-out motion-reduce:transition-none"
        :class="i === current ? 'opacity-100' : 'opacity-0'"
        :aria-hidden="i === current ? undefined : 'true'"
      >
        <SiteImage :image="img" sizes="(min-width: 1280px) 1232px, 100vw" :eager="i === 0" img-class="h-full w-full object-cover" />
      </div>
      <div class="absolute inset-0 bg-linear-to-t from-black/75 via-black/30 to-transparent" />
    </div>

    <div class="flex flex-col gap-3 p-6 sm:p-10">
      <p v-if="tx(data.eyebrow)" class="text-xs font-semibold" :class="slides.length ? 'text-white/80' : 'text-[var(--c-accent-strong)]'">{{ tx(data.eyebrow) }}</p>
      <component :is="level === 1 ? 'h1' : 'h2'" :id="titleId" class="font-display text-[clamp(2.25rem,6vw,4rem)] leading-[1.02] font-semibold tracking-[-0.02em] text-balance">
        {{ tx(data.title) }}
      </component>
      <p v-if="tx(data.subtitle)" class="max-w-xl text-sm leading-relaxed sm:text-base" :class="slides.length ? 'text-white/85' : 'text-[var(--c-muted)]'">{{ tx(data.subtitle) }}</p>
      <div v-if="data.ctas.length" class="flex flex-wrap gap-2 pt-2">
        <SmartLink
          v-for="(cta, i) in data.ctas"
          :key="i"
          :href="cta.href"
          data-test="hero-cta"
          class="inline-flex h-10 items-center rounded px-4 text-sm font-semibold transition"
          :class="
            i === 0
              ? 'bg-[var(--c-primary)] text-[var(--c-on-primary)] hover:brightness-110'
              : slides.length
                ? 'border border-white/40 text-white hover:bg-white/10'
                : 'border border-[var(--c-border)] bg-[var(--c-bg)] hover:bg-[var(--c-surface-2)]'
          "
        >
          {{ tx(cta.label) }}
        </SmartLink>
      </div>
    </div>

    <div v-if="slides.length > 1" class="absolute right-3 bottom-3 flex items-center sm:right-5 sm:bottom-5">
      <button
        v-for="(img, i) in slides"
        :key="img.fileId"
        type="button"
        class="flex size-8 items-center justify-center touch-pad"
        :aria-label="t('landing.slide', { n: i + 1, total: slides.length })"
        :aria-current="i === current ? 'true' : undefined"
        @click="go(i)"
      >
        <span class="block size-1.5 rounded-full" :class="i === current ? 'bg-white' : 'bg-white/45'" />
      </button>
      <button
        type="button"
        data-test="hero-pause"
        class="icon-btn text-white hover:bg-white/10"
        :aria-label="playing ? t('landing.pause') : t('landing.play')"
        @click="toggle"
      >
        <svg v-if="playing" viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
        <svg v-else viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      </button>
    </div>
  </section>
</template>

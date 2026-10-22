<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HeroData } from '@cuka/shared'
import BasementArt from '@/components/brand/BasementArt.vue'
import Halftone from './Halftone.vue'
import SiteImage from './SiteImage.vue'
import SmartLink from './SmartLink.vue'
import { useLanding } from './context'

/**
 * Full-bleed opening band. With pictures: a cross-fading slideshow (paused on reduced motion, with a pause button
 * and slide dots). Without: the basement arch and halftone dots of the brand board.
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
  <section data-test="landing-hero" :aria-labelledby="titleId" class="relative isolate overflow-hidden bg-[var(--c-cellar)] text-[var(--c-cellar-text)]">
    <!-- Background -->
    <div v-if="slides.length" class="absolute inset-0 -z-10">
      <div
        v-for="(img, i) in slides"
        :key="img.fileId"
        class="absolute inset-0 transition-opacity duration-[1400ms] ease-out motion-reduce:transition-none"
        :class="i === current ? 'opacity-100' : 'opacity-0'"
        :aria-hidden="i === current ? undefined : 'true'"
      >
        <SiteImage :image="img" sizes="100vw" :eager="i === 0" img-class="h-full w-full object-cover" />
      </div>
      <!-- A flat scrim keeps the text at contrast over any picture (the board has no gradients). -->
      <div class="absolute inset-0 bg-[#17110e]/60" />
    </div>
    <div v-else class="absolute inset-0 -z-10" aria-hidden="true">
      <Halftone class="absolute inset-y-0 right-0 h-full w-full opacity-25 md:w-2/3" from="tr" :size="10" />
      <Halftone class="absolute bottom-0 left-0 h-1/2 w-1/2 opacity-15" from="bl" :size="7" />
    </div>

    <div class="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-16 pb-24 sm:px-6 md:min-h-[min(88svh,860px)] md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:pt-24">
      <div class="flex flex-col gap-7">
        <p v-if="tx(data.eyebrow)" class="flex items-center gap-3 font-mono text-xs tracking-[0.16em] text-[var(--c-cellar-text)]/85 uppercase">
          <span class="size-2 rounded-full bg-[var(--c-cellar-accent)]" aria-hidden="true" />
          {{ tx(data.eyebrow) }}
        </p>
        <component :is="level === 1 ? 'h1' : 'h2'" :id="titleId" class="font-display text-[clamp(3.25rem,11vw,8.5rem)] leading-[0.9] font-semibold tracking-[-0.045em] text-balance">
          {{ tx(data.title) }}
        </component>
        <p v-if="tx(data.subtitle)" class="max-w-xl text-lg leading-relaxed text-[var(--c-cellar-text)]/90 sm:text-xl">{{ tx(data.subtitle) }}</p>
        <div v-if="data.ctas.length" class="flex flex-wrap gap-3 pt-1">
          <SmartLink
            v-for="(cta, i) in data.ctas"
            :key="i"
            :href="cta.href"
            data-test="hero-cta"
            class="group inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-sm font-semibold transition-colors"
            :class="
              i === 0
                ? 'bg-[#fbf7f4] text-[#5b3a29] hover:bg-white'
                : 'border border-[var(--c-cellar-text)]/35 text-[var(--c-cellar-text)] hover:border-[var(--c-cellar-text)]'
            "
          >
            {{ tx(cta.label) }}
            <svg viewBox="0 0 24 24" class="size-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </SmartLink>
        </div>
      </div>

      <!-- No picture yet: the basement arch from the brand board. -->
      <div v-if="!slides.length" class="relative mx-auto hidden w-full max-w-sm md:block" aria-hidden="true">
        <div class="relative aspect-[4/5] overflow-hidden rounded-t-full border border-[var(--c-cellar-line)] bg-[var(--c-cellar-deep)]">
          <BasementArt class="absolute inset-0 h-full w-full" />
        </div>
        <div class="absolute -bottom-5 -left-6 flex items-center gap-2 rounded-full border border-[var(--c-cellar-line)] bg-[var(--c-cellar-surface)] px-4 py-2 font-mono text-[11px] tracking-[0.14em] text-[var(--c-cellar-muted)] uppercase">
          <span class="size-1.5 rounded-full bg-[var(--c-cellar-accent)]" />
          CukaBasement
        </div>
      </div>
    </div>

    <div v-if="slides.length > 1" class="absolute right-4 bottom-6 flex items-center gap-2 sm:right-6">
      <button
        v-for="(img, i) in slides"
        :key="img.fileId"
        type="button"
        class="flex size-11 items-center justify-center"
        :aria-label="t('landing.slide', { n: i + 1, total: slides.length })"
        :aria-current="i === current ? 'true' : undefined"
        @click="go(i)"
      >
        <span class="block h-1.5 rounded-full transition-all" :class="i === current ? 'w-7 bg-[var(--c-cellar-text)]' : 'w-1.5 bg-[var(--c-cellar-text)]/50'" />
      </button>
      <button
        type="button"
        data-test="hero-pause"
        class="flex size-11 items-center justify-center rounded-full border border-[var(--c-cellar-text)]/35 text-[var(--c-cellar-text)] hover:border-[var(--c-cellar-text)]"
        :aria-label="playing ? t('landing.pause') : t('landing.play')"
        @click="toggle"
      >
        <svg v-if="playing" viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
        <svg v-else viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      </button>
    </div>
  </section>
</template>

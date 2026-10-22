<script setup lang="ts">
import { computed, useId } from 'vue'
import type { VibeData } from '@cuka/shared'
import BrandMark from '@/components/brand/BrandMark.vue'
import Halftone from '../Halftone.vue'
import SmartLink from '../SmartLink.vue'
import { useLanding } from '../context'
import { vReveal } from '../reveal'
import { panelImage } from './media'

/**
 * The brand statement: the page's own colours (cream by day, cocoa by night), a big Fraunces line and, beside it, a
 * picture in the basement arch (or the logo mark on the dark arch), with a link to the Introduction page.
 */
const props = defineProps<{ data: VibeData }>()
const { tx, images } = useLanding()
const textId = useId()
const pic = computed(() => panelImage(props.data.image, images.value, tx))
</script>

<template>
  <section data-test="fp-vibe" :aria-labelledby="textId" class="relative isolate flex flex-1 items-center overflow-hidden bg-[var(--c-bg)] text-[var(--c-text)]">
    <Halftone class="absolute top-0 right-0 -z-10 h-2/3 w-2/3 opacity-[0.18]" from="tr" :size="10" aria-hidden="true" />
    <div class="mx-auto grid w-full max-w-screen-2xl items-center gap-10 px-5 pt-24 pb-12 sm:px-10 md:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)] md:gap-16">
      <div v-reveal class="flex flex-col gap-7">
        <p v-if="tx(data.eyebrow)" class="flex items-center gap-3 font-mono text-[11px] tracking-[0.2em] text-[var(--c-muted)] uppercase">
          <span class="h-px w-8 bg-[var(--c-accent)]" aria-hidden="true" />{{ tx(data.eyebrow) }}
        </p>
        <h2 :id="textId" class="font-display text-[clamp(2.1rem,5.4vw,5.6rem)] leading-[1.02] font-medium tracking-[-0.035em] text-balance italic">{{ tx(data.text) }}</h2>
        <SmartLink
          v-if="data.cta"
          :href="data.cta.href"
          data-test="vibe-cta"
          class="group inline-flex min-h-12 w-fit items-center gap-3 rounded-full bg-[var(--c-primary)] px-6 text-sm font-semibold text-[var(--c-bg)] transition-opacity hover:opacity-90"
        >
          {{ tx(data.cta.label) }}
          <svg viewBox="0 0 24 24" class="size-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </SmartLink>
      </div>
      <div v-reveal class="relative mx-auto w-full max-w-[min(26rem,70vw)] md:max-w-md">
        <div class="relative aspect-[4/5] overflow-hidden rounded-t-full border border-[var(--c-border)] bg-[var(--c-cellar)]">
          <img v-if="pic" :src="pic.src" :srcset="pic.srcset" sizes="(min-width: 768px) 30vw, 70vw" :alt="pic.alt" loading="lazy" decoding="async" class="h-full w-full object-cover" data-test="vibe-image" />
          <div v-else class="flex h-full w-full items-center justify-center" aria-hidden="true">
            <Halftone class="absolute inset-0 h-full w-full opacity-30" from="bl" :size="8" />
            <BrandMark on-dark class="relative size-28 sm:size-36" />
          </div>
        </div>
        <span class="absolute -bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-[var(--c-border)] bg-[var(--c-surface)] px-4 py-2 font-mono text-[10px] tracking-[0.18em] whitespace-nowrap text-[var(--c-muted)] uppercase" aria-hidden="true">
          <b class="font-semibold text-[var(--c-text)]">Cuka</b>Basement
        </span>
      </div>
    </div>
  </section>
</template>

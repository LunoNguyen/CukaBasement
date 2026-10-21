<script setup lang="ts">
import { computed } from 'vue'
import type { BannerData } from '@cuka/shared'
import Halftone from './Halftone.vue'
import SiteImage from './SiteImage.vue'
import SmartLink from './SmartLink.vue'
import { useLanding } from './context'
import { vReveal } from './reveal'

/** A dark quote band; #hashtags in the text are picked out in the accent colour. */
const props = defineProps<{ data: BannerData }>()
const { tx } = useLanding()
const parts = computed(() => tx(props.data.text).split(/(#[\p{L}\p{N}_]+)/u).filter(Boolean))
const hasImage = computed(() => !!props.data.image)
</script>

<template>
  <section data-test="landing-banner" class="relative isolate overflow-hidden bg-[var(--c-cellar)] text-[var(--c-cellar-text)]">
    <Halftone class="absolute top-0 right-0 -z-10 h-full w-2/3 opacity-25" from="tr" :size="10" aria-hidden="true" />
    <div class="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 md:py-28" :class="hasImage ? 'md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]' : ''">
      <figure v-reveal class="flex flex-col gap-8">
        <p v-if="tx(data.eyebrow)" class="flex items-center gap-3 font-mono text-xs tracking-[0.16em] text-[var(--c-cellar-muted)] uppercase">
          <span class="size-2 rounded-full bg-[var(--c-cellar-accent)]" aria-hidden="true" />{{ tx(data.eyebrow) }}
        </p>
        <blockquote class="max-w-4xl font-display text-[clamp(1.85rem,4.4vw,3.5rem)] leading-[1.12] font-semibold tracking-[-0.025em] text-balance">
          <template v-for="(p, i) in parts" :key="i"
            ><span v-if="p.startsWith('#')" class="text-[var(--c-cellar-accent)]">{{ p }}</span><template v-else>{{ p }}</template></template
          >
        </blockquote>
        <figcaption v-if="tx(data.attribution) || data.cta" class="flex flex-wrap items-center gap-x-8 gap-y-4">
          <SmartLink
            v-if="data.cta"
            :href="data.cta.href"
            data-test="banner-cta"
            class="group inline-flex min-h-12 items-center gap-2 rounded-full bg-[#fbf7f4] px-6 text-sm font-semibold text-[#5b3a29] hover:bg-white"
          >
            {{ tx(data.cta.label) }}
            <svg viewBox="0 0 24 24" class="size-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </SmartLink>
          <span v-if="tx(data.attribution)" class="font-mono text-xs tracking-[0.08em] text-[var(--c-cellar-muted)]">{{ tx(data.attribution) }}</span>
        </figcaption>
      </figure>
      <div v-if="hasImage" v-reveal class="overflow-hidden rounded-[2rem] border border-[var(--c-cellar-line)]">
        <SiteImage :image="data.image" sizes="(min-width: 768px) 26rem, 90vw" img-class="aspect-[4/5] h-full w-full object-cover">
          <template #fallback><div class="aspect-[4/5] w-full" /></template>
        </SiteImage>
      </div>
    </div>
  </section>
</template>

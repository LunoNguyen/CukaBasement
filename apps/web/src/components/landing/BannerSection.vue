<script setup lang="ts">
import { computed } from 'vue'
import type { BannerData } from '@cuka/shared'
import SiteImage from './SiteImage.vue'
import SmartLink from './SmartLink.vue'
import { useLanding } from './context'

/** A dark quote band; #hashtags in the text are picked out in the accent colour. */
const props = defineProps<{ data: BannerData }>()
const { tx } = useLanding()
const parts = computed(() => tx(props.data.text).split(/(#[\p{L}\p{N}_]+)/u).filter(Boolean))
const hasImage = computed(() => !!props.data.image)
</script>

<template>
  <section data-test="landing-banner" class="border-t border-[var(--c-border)] py-10 sm:py-12">
    <div class="grid items-center gap-6 rounded-lg bg-[var(--c-surface-2)] p-6 sm:p-8" :class="hasImage ? 'md:grid-cols-[minmax(0,1fr)_14rem]' : ''">
      <figure class="flex flex-col gap-4">
        <p v-if="tx(data.eyebrow)" class="text-[13px] text-[var(--c-muted)]">{{ tx(data.eyebrow) }}</p>
        <blockquote class="max-w-3xl text-lg leading-relaxed font-bold text-balance sm:text-xl">
          <template v-for="(p, i) in parts" :key="i"
            ><span v-if="p.startsWith('#')" class="text-[var(--c-accent-strong)]">{{ p }}</span><template v-else>{{ p }}</template></template
          >
        </blockquote>
        <figcaption v-if="tx(data.attribution) || data.cta" class="flex flex-wrap items-center gap-x-6 gap-y-3">
          <SmartLink
            v-if="data.cta"
            :href="data.cta.href"
            data-test="banner-cta"
            class="inline-flex h-10 items-center rounded bg-[var(--c-primary)] px-4 text-sm font-semibold text-[var(--c-on-primary)] hover:brightness-110"
          >
            {{ tx(data.cta.label) }}
          </SmartLink>
          <span v-if="tx(data.attribution)" class="text-xs text-[var(--c-muted)]">{{ tx(data.attribution) }}</span>
        </figcaption>
      </figure>
      <div v-if="hasImage" class="overflow-hidden rounded-lg">
        <SiteImage :image="data.image" sizes="14rem" img-class="aspect-[4/5] h-full w-full object-cover">
          <template #fallback><div class="aspect-[4/5] w-full" /></template>
        </SiteImage>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { AboutData } from '@cuka/shared'
import ArchArt from './ArchArt.vue'
import LandingSection from './LandingSection.vue'
import RichText from './RichText.vue'
import SiteImage from './SiteImage.vue'
import { useLanding } from './context'
import { vReveal } from './reveal'

defineProps<{ data: AboutData; index: number; tone: 'cream' | 'soft' }>()
const { tx } = useLanding()
</script>

<template>
  <LandingSection data-test="landing-about" :tone="tone" :index="index" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)">
    <div class="grid items-center gap-12 md:grid-cols-2 md:gap-16">
      <div v-reveal class="max-w-prose text-lg leading-[1.75] text-[var(--c-text)]/85" :class="data.imageSide === 'left' ? 'md:order-2' : ''">
        <RichText :source="tx(data.body)" />
      </div>
      <figure v-reveal class="relative mx-auto w-full max-w-md" :class="data.imageSide === 'left' ? 'md:order-1' : ''">
        <div class="aspect-[4/5] overflow-hidden rounded-t-full rounded-b-[2rem] border border-[var(--c-border)] bg-[#141414]">
          <SiteImage :image="data.image" sizes="(min-width: 768px) 28rem, 90vw" img-class="h-full w-full object-cover">
            <template #fallback><ArchArt /></template>
          </SiteImage>
        </div>
        <span aria-hidden="true" class="absolute -top-3 -right-3 size-6 rounded-full bg-[var(--c-accent)]" />
      </figure>
    </div>
  </LandingSection>
</template>

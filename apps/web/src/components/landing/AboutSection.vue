<script setup lang="ts">
import type { AboutData } from '@cuka/shared'
import LandingSection from './LandingSection.vue'
import RichText from './RichText.vue'
import SiteImage from './SiteImage.vue'
import { useLanding } from './context'

defineProps<{ data: AboutData }>()
const { tx } = useLanding()
</script>

<template>
  <LandingSection data-test="landing-about" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)">
    <div class="grid items-start gap-8" :class="data.image ? 'md:grid-cols-[minmax(0,1fr)_20rem] md:gap-12' : ''">
      <div class="max-w-prose text-[15px] leading-[1.8]" :class="data.imageSide === 'left' ? 'md:order-2' : ''">
        <RichText :source="tx(data.body)" />
      </div>
      <figure v-if="data.image" class="w-full max-w-xs overflow-hidden rounded-lg bg-[var(--c-surface-2)]" :class="data.imageSide === 'left' ? 'md:order-1' : ''">
        <SiteImage :image="data.image" sizes="20rem" img-class="aspect-[4/5] h-full w-full object-cover" />
      </figure>
    </div>
  </LandingSection>
</template>

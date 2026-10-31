<script setup lang="ts">
import { computed } from 'vue'
import type { ProfileData } from '@cuka/shared'
import ArchArt from './ArchArt.vue'
import LandingSection from './LandingSection.vue'
import SiteImage from './SiteImage.vue'
import { useLanding } from './context'
import { vReveal } from './reveal'

const props = defineProps<{ data: ProfileData; index: number; tone: 'cream' | 'soft' }>()
const { tx } = useLanding()
/** Monogram of the portrait stand-in: the heading's first letter. */
const letter = computed(() => tx(props.data.heading).trim().charAt(0).toUpperCase())
</script>

<template>
  <LandingSection data-test="landing-profile" :tone="tone" :index="index" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)">
    <div class="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
      <figure v-reveal class="mx-auto w-full max-w-sm lg:mx-0 lg:max-w-none">
        <div class="aspect-[3/4] overflow-hidden rounded-[2rem] border border-[var(--c-border)] bg-[#141414] lg:sticky lg:top-24">
          <SiteImage :image="data.image" sizes="(min-width: 1024px) 26rem, 90vw" img-class="h-full w-full object-cover">
            <template #fallback><ArchArt :letter="letter" /></template>
          </SiteImage>
        </div>
      </figure>
      <dl class="grid content-start gap-x-10 sm:grid-cols-2">
        <div v-for="(f, i) in data.facts" :key="i" v-reveal data-test="profile-fact" class="flex flex-col gap-2 border-t border-[var(--c-border)] py-5" :class="tx(f.value).length > 70 ? 'sm:col-span-2' : ''">
          <dt class="text-[11px] text-[var(--c-muted)]">{{ tx(f.label) }}</dt>
          <dd class="text-lg leading-snug font-medium text-pretty">{{ tx(f.value) }}</dd>
        </div>
      </dl>
    </div>
  </LandingSection>
</template>

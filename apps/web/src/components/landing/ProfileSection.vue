<script setup lang="ts">
import { computed } from 'vue'
import type { ProfileData } from '@cuka/shared'
import LandingSection from './LandingSection.vue'
import SiteImage from './SiteImage.vue'
import { useLanding } from './context'

const props = defineProps<{ data: ProfileData }>()
const { tx } = useLanding()
/** Monogram of the portrait stand-in: the heading's first letter. */
const letter = computed(() => tx(props.data.heading).trim().charAt(0).toUpperCase())
</script>

<template>
  <LandingSection data-test="landing-profile" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)">
    <div class="grid items-start gap-8" :class="data.image ? 'md:grid-cols-[16rem_minmax(0,1fr)] md:gap-12' : ''">
      <figure v-if="data.image" class="w-full max-w-64 overflow-hidden rounded-lg bg-[var(--c-surface-2)]">
        <SiteImage :image="data.image" sizes="16rem" img-class="aspect-[3/4] h-full w-full object-cover" />
      </figure>
      <dl class="grid content-start border-t border-[var(--c-border)] sm:grid-cols-[10rem_minmax(0,1fr)]">
        <template v-for="(f, i) in data.facts" :key="i">
          <div data-test="profile-fact" class="contents">
            <dt class="pt-3 text-[13px] text-[var(--c-muted)] sm:border-b sm:border-[var(--c-border)] sm:py-3">{{ tx(f.label) }}</dt>
            <dd class="border-b border-[var(--c-border)] pb-3 text-sm text-pretty sm:py-3">{{ tx(f.value) }}</dd>
          </div>
        </template>
      </dl>
    </div>
  </LandingSection>
</template>

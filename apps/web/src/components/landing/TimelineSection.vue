<script setup lang="ts">
import type { TimelineData } from '@cuka/shared'
import LandingSection from './LandingSection.vue'
import SiteImage from './SiteImage.vue'
import { useLanding } from './context'

defineProps<{ data: TimelineData }>()
const { tx } = useLanding()
</script>

<template>
  <LandingSection data-test="landing-timeline" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)">
    <ol class="flex flex-col">
      <li v-for="(item, i) in data.items" :key="i" data-test="timeline-item" class="grid gap-1 border-b border-[var(--c-border)] py-3 first:border-t sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6">
        <p class="text-[13px] text-[var(--c-accent-strong)] tabular-nums">{{ item.date }}</p>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <h3 class="text-sm font-bold">{{ tx(item.title) }}</h3>
            <p v-if="tx(item.text)" class="mt-1 max-w-prose text-[13px] leading-relaxed text-[var(--c-muted)]">{{ tx(item.text) }}</p>
          </div>
          <SiteImage v-if="item.image" :image="item.image" sizes="10rem" img-class="aspect-[4/3] w-40 shrink-0 rounded object-cover" />
        </div>
      </li>
    </ol>
  </LandingSection>
</template>

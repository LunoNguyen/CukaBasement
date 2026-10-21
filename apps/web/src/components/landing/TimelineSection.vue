<script setup lang="ts">
import type { TimelineData } from '@cuka/shared'
import LandingSection from './LandingSection.vue'
import SiteImage from './SiteImage.vue'
import { useLanding } from './context'
import { vReveal } from './reveal'

defineProps<{ data: TimelineData; index: number; tone: 'cream' | 'soft' }>()
const { tx } = useLanding()
</script>

<template>
  <LandingSection data-test="landing-timeline" :tone="tone" :index="index" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)">
    <ol class="relative ml-1.5 border-l border-[var(--c-border)] md:ml-[11.5rem]">
      <li v-for="(item, i) in data.items" :key="i" v-reveal data-test="timeline-item" class="relative pb-12 pl-8 last:pb-0 md:pl-12">
        <span aria-hidden="true" class="absolute top-2.5 -left-[6.5px] size-3 rounded-full bg-[var(--c-accent)]" />
        <p class="mb-2 font-mono text-sm tracking-[0.06em] text-[var(--c-accent-text)] md:absolute md:top-1 md:-left-[11.5rem] md:mb-0 md:w-36 md:text-right">{{ item.date }}</p>
        <div class="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div class="flex-1">
            <h3 class="font-display text-2xl leading-tight font-semibold tracking-[-0.02em] sm:text-3xl">{{ tx(item.title) }}</h3>
            <p v-if="tx(item.text)" class="mt-2 max-w-prose leading-relaxed text-[var(--c-muted)]">{{ tx(item.text) }}</p>
          </div>
          <SiteImage v-if="item.image" :image="item.image" sizes="(min-width: 640px) 14rem, 90vw" img-class="aspect-[4/3] w-full rounded-2xl object-cover sm:w-56" />
        </div>
      </li>
    </ol>
  </LandingSection>
</template>

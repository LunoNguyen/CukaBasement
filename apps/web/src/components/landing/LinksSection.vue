<script setup lang="ts">
import { SOCIAL_PLATFORM_LABELS, type LinksData } from '@cuka/shared'
import LandingSection from './LandingSection.vue'
import { useLanding } from './context'
import { vReveal } from './reveal'

defineProps<{ data: LinksData; index: number; tone: 'cream' | 'soft' }>()
const { tx } = useLanding()

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
const platformName = (p: keyof typeof SOCIAL_PLATFORM_LABELS, url: string) => SOCIAL_PLATFORM_LABELS[p] || host(url)
</script>

<template>
  <LandingSection data-test="landing-links" :tone="tone" :index="index" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)">
    <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <li v-for="(l, i) in data.items" :key="i" v-reveal>
        <a
          :href="l.url"
          target="_blank"
          rel="noopener noreferrer"
          data-test="landing-link"
          class="group relative flex h-full min-h-40 flex-col justify-between gap-6 rounded-[1.75rem] border border-[var(--c-border)] bg-[var(--c-surface)] p-6 transition-[border-color,transform] duration-300 hover:-translate-y-1 hover:border-[var(--c-primary)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          <div class="flex items-center justify-between gap-4">
            <span class="flex size-11 items-center justify-center rounded-full bg-[var(--c-primary)] font-display text-lg font-semibold text-[var(--c-bg)]" aria-hidden="true">{{
              platformName(l.platform, l.url).charAt(0)
            }}</span>
            <svg viewBox="0 0 24 24" class="size-5 text-[var(--c-muted)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--c-text)]" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
          </div>
          <div class="flex flex-col gap-1">
            <span class="font-mono text-[11px] tracking-[0.14em] text-[var(--c-muted)] uppercase">{{ platformName(l.platform, l.url) }}</span>
            <span class="font-display text-2xl leading-tight font-semibold tracking-[-0.02em] break-words">{{ tx(l.label) || host(l.url) }}</span>
          </div>
        </a>
      </li>
    </ul>
  </LandingSection>
</template>

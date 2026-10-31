<script setup lang="ts">
import { SOCIAL_PLATFORM_LABELS, type LinksData } from '@cuka/shared'
import LandingSection from './LandingSection.vue'
import { useLanding } from './context'

defineProps<{ data: LinksData }>()
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
  <LandingSection data-test="landing-links" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)">
    <ul class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <li v-for="(l, i) in data.items" :key="i">
        <a
          :href="l.url"
          target="_blank"
          rel="noopener noreferrer"
          data-test="landing-link"
          class="group flex min-h-14 items-center gap-3 rounded-lg border border-[var(--c-border)] px-4 py-2.5 transition-colors hover:bg-[var(--c-surface-2)]"
        >
          <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--c-surface-2)] text-xs font-bold" aria-hidden="true">{{ platformName(l.platform, l.url).charAt(0) }}</span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-sm font-bold">{{ tx(l.label) || host(l.url) }}</span>
            <span class="text-xs text-[var(--c-muted)]">{{ platformName(l.platform, l.url) }}</span>
          </span>
          <svg viewBox="0 0 24 24" class="size-4 shrink-0 text-[var(--c-muted)] group-hover:text-[var(--c-text)]" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg>
        </a>
      </li>
    </ul>
  </LandingSection>
</template>

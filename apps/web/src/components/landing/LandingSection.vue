<script setup lang="ts">
import { computed, useId } from 'vue'
import { vReveal } from './reveal'

/**
 * Frame of one landing section: full-bleed band in its tone, a centred column, and the heading row
 * ("02 — HỒ SƠ" in mono over a Fraunces title). `cellar` bands stay dark in both themes.
 */
const props = withDefaults(
  defineProps<{ tone?: 'cream' | 'soft' | 'cellar'; index?: number; eyebrow?: string; heading?: string; anchor?: string; wide?: boolean }>(),
  { tone: 'cream', index: 0, eyebrow: '', heading: '', anchor: undefined, wide: false },
)
const headingId = useId()
const num = computed(() => (props.index > 0 ? String(props.index).padStart(2, '0') : ''))
</script>

<template>
  <section
    :id="anchor"
    :aria-labelledby="heading ? headingId : undefined"
    class="relative isolate overflow-hidden"
    :class="{
      'bg-[var(--c-bg)] text-[var(--c-text)]': tone === 'cream',
      'bg-[var(--c-soft)] text-[var(--c-text)]': tone === 'soft',
      'bg-[var(--c-cellar)] text-[var(--c-cellar-text)]': tone === 'cellar',
    }"
  >
    <slot name="decor" />
    <div class="relative mx-auto w-full px-4 py-20 sm:px-6 md:py-28" :class="wide ? 'max-w-screen-2xl' : 'max-w-6xl'">
      <header v-if="heading || $slots.aside" v-reveal class="mb-10 flex flex-wrap items-end justify-between gap-6 md:mb-14">
        <div class="flex max-w-3xl flex-col gap-4">
          <p
            v-if="eyebrow || num"
            class="flex items-center gap-3 font-mono text-xs tracking-[0.14em] uppercase"
            :class="tone === 'cellar' ? 'text-[var(--c-cellar-muted)]' : 'text-[var(--c-muted)]'"
          >
            <span v-if="num" :class="tone === 'cellar' ? 'text-[var(--c-cellar-accent)]' : 'text-[var(--c-accent-text)]'">{{ num }}</span>
            <span v-if="num && eyebrow" aria-hidden="true" class="h-px w-8" :class="tone === 'cellar' ? 'bg-[var(--c-cellar-line)]' : 'bg-[var(--c-border)]'" />
            <span v-if="eyebrow">{{ eyebrow }}</span>
          </p>
          <h2 :id="headingId" class="font-display text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.02] font-semibold tracking-[-0.03em] text-balance">{{ heading }}</h2>
        </div>
        <slot name="aside" />
      </header>
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { useId } from 'vue'

/** One block of the Introduction page: a hairline on top, an optional small label over the H2, then the content. */
withDefaults(defineProps<{ eyebrow?: string; heading?: string; anchor?: string }>(), { eyebrow: '', heading: '', anchor: undefined })
const headingId = useId()
</script>

<template>
  <section :id="anchor" :aria-labelledby="heading ? headingId : undefined" class="border-t border-[var(--c-border)] py-10 sm:py-12">
    <header v-if="heading || $slots.aside" class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div class="flex min-w-0 flex-col gap-1">
        <h2 :id="headingId" class="text-xl font-bold text-balance sm:text-2xl">{{ heading }}</h2>
        <p v-if="eyebrow" data-test="section-subtitle" class="text-[13px] text-[var(--c-muted)]">{{ eyebrow }}</p>
      </div>
      <slot name="aside" />
    </header>
    <slot />
  </section>
</template>

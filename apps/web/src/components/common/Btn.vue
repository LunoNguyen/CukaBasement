<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import Spinner from './Spinner.vue'

/**
 * The site's button. `primary` is the one pink action of a view, `secondary` an outlined action, `ghost` a quiet
 * text action, `danger` a destructive one. With `to` it renders a RouterLink styled the same way.
 */
const props = withDefaults(
  defineProps<{ variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'md' | 'sm'; loading?: boolean; to?: RouteLocationRaw }>(),
  { variant: 'primary', size: 'md', loading: false, to: undefined },
)

const classes = computed(() => [
  props.size === 'sm' ? 'touch-pad h-8 px-3 text-[13px]' : 'h-11 px-4 text-sm sm:h-10',
  {
    'bg-[var(--c-accent-strong)] text-[var(--c-on-primary)] hover:brightness-110': props.variant === 'primary',
    'border border-[var(--c-border)] bg-[var(--c-bg)] text-[var(--c-text)] hover:bg-[var(--c-surface-2)]': props.variant === 'secondary',
    'text-[var(--c-text)] hover:bg-[var(--c-surface-2)]': props.variant === 'ghost',
    'bg-[var(--c-danger)] text-[var(--c-on-primary)] hover:brightness-110': props.variant === 'danger',
  },
])
</script>

<template>
  <RouterLink
    v-if="to"
    :to="to"
    class="inline-flex shrink-0 items-center justify-center gap-1.5 rounded font-semibold whitespace-nowrap transition"
    :class="classes"
  >
    <slot />
  </RouterLink>
  <button
    v-else
    type="button"
    class="inline-flex shrink-0 items-center justify-center gap-1.5 rounded font-semibold whitespace-nowrap transition disabled:opacity-50"
    :class="classes"
    :disabled="loading"
    :aria-busy="loading ? true : undefined"
  >
    <Spinner v-if="loading" />
    <slot />
  </button>
</template>

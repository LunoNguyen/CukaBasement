<script setup lang="ts">
import Spinner from './Spinner.vue'

withDefaults(defineProps<{ variant?: 'primary' | 'ghost' | 'danger'; size?: 'md' | 'sm'; loading?: boolean }>(), {
  variant: 'primary',
  size: 'md',
  loading: false,
})
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-colors disabled:opacity-60"
    :class="[
      size === 'sm' ? 'min-h-8 px-3 text-xs' : 'min-h-11 px-4 text-sm',
      {
        'bg-[var(--c-primary)] text-[var(--c-bg)] hover:opacity-90': variant === 'primary',
        'border border-[var(--c-border)] bg-[var(--c-bg)] text-[var(--c-text)] hover:border-[var(--c-latte)]': variant === 'ghost',
        'bg-[var(--c-danger)] text-[var(--c-bg)] hover:opacity-90': variant === 'danger',
      },
    ]"
    :disabled="loading"
    :aria-busy="loading ? true : undefined"
  >
    <Spinner v-if="loading" />
    <slot />
  </button>
</template>

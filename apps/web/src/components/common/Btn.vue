<script setup lang="ts">
import Spinner from './Spinner.vue'

withDefaults(defineProps<{ variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean }>(), {
  variant: 'primary',
  loading: false,
})
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center justify-center gap-2 rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-60"
    :class="{
      'bg-[var(--c-primary)] text-[var(--c-bg)]': variant === 'primary',
      'border border-[var(--c-border)] text-[var(--c-text)]': variant === 'ghost',
      'bg-red-600 text-white': variant === 'danger',
    }"
    :disabled="loading"
  >
    <Spinner v-if="loading" />
    <slot />
  </button>
</template>

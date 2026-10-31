<script setup lang="ts">
import { useToast } from '@/stores/toast'

const toast = useToast()
const color = { error: 'var(--c-danger)', success: '#2f9e6b', info: 'var(--c-muted)' }
</script>

<template>
  <div class="fixed right-3 bottom-3 z-50 flex w-72 max-w-[calc(100vw-1.5rem)] flex-col gap-2" aria-live="polite">
    <div
      v-for="t in toast.toasts"
      :key="t.id"
      role="status"
      class="cursor-pointer rounded-lg border border-l-[3px] border-[var(--c-border)] bg-[var(--c-bg)] px-4 py-3 text-sm shadow-[var(--shadow-pop)]"
      :style="{ borderLeftColor: color[t.kind] }"
      @click="toast.dismiss(t.id)"
    >
      {{ t.text }}
    </div>
  </div>
</template>

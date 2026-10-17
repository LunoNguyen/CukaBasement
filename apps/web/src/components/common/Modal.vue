<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ title?: string }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-3"
      @click.self="open = false"
      @keydown.esc="open = false"
    >
      <div
        role="dialog"
        aria-modal="true"
        class="w-full max-w-md rounded bg-[var(--c-surface)] p-4 text-[var(--c-text)] shadow-lg"
      >
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-lg font-semibold">{{ title }}</h2>
          <button type="button" :aria-label="t('common.close')" @click="open = false">✕</button>
        </div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>

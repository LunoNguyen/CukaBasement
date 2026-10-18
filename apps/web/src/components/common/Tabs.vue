<script setup lang="ts">
defineProps<{ tabs: { key: string; label: string }[] }>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <div role="tablist" class="flex gap-5 overflow-x-auto border-b border-[var(--c-border)]">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      role="tab"
      :aria-selected="model === tab.key"
      class="-mb-px border-b-2 py-2.5 text-sm whitespace-nowrap transition-colors"
      :class="model === tab.key ? 'border-[var(--c-accent)] font-semibold text-[var(--c-text)]' : 'border-transparent text-[var(--c-muted)] hover:text-[var(--c-text)]'"
      @click="model = tab.key"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

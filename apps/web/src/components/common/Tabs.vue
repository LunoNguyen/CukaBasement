<script setup lang="ts">
defineProps<{ tabs: { key: string; label: string }[] }>()
const model = defineModel<string>({ required: true })
</script>

<template>
  <div role="tablist" class="flex gap-1 overflow-x-auto border-b border-[var(--c-border)]">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      role="tab"
      :aria-selected="model === tab.key"
      class="border-b-2 px-3 py-2 text-sm whitespace-nowrap"
      :class="model === tab.key ? 'border-[var(--c-accent)] font-semibold' : 'border-transparent text-[var(--c-muted)]'"
      @click="model = tab.key"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

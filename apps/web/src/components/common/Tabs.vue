<script setup lang="ts">
defineProps<{ tabs: { key: string; label: string }[] }>()
const model = defineModel<string>({ required: true })
</script>

<!--
  The baseline is an inset shadow, not a border with -mb-px tabs: those overflow the row by 1px, which makes an
  overflow-x-auto row grow a vertical scrollbar. The tabs' own bottom border paints over the shadow. The row still
  scrolls sideways on narrow screens (touch, trackpad, shift+wheel) with its scrollbar hidden.
-->
<template>
  <div
    role="tablist"
    class="flex gap-5 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--c-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
  >
    <button
      v-for="tab in tabs"
      :key="tab.key"
      type="button"
      role="tab"
      :aria-selected="model === tab.key"
      class="border-b-2 py-2.5 text-sm whitespace-nowrap transition-colors"
      :class="model === tab.key ? 'border-[var(--c-accent)] font-semibold text-[var(--c-text)]' : 'border-transparent text-[var(--c-muted)] hover:text-[var(--c-text)]'"
      @click="model = tab.key"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

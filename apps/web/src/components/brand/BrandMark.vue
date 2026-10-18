<script setup lang="ts">
// On the dark "Hầm" panels the mark is drawn in its on-dark colours whatever the theme.
defineProps<{ onDark?: boolean }>()
</script>

<template>
  <!-- Basement-door "C" with three steps and the credit dot; colours follow the theme tokens. -->
  <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <rect width="100" height="100" rx="24" :fill="onDark ? '#5b3a29' : 'var(--c-primary)'" />
    <path d="M69.9 33.3A26 26 0 1 0 69.9 66.7" fill="none" :stroke="onDark ? '#fbf7f4' : 'var(--c-bg)'" stroke-width="12" />
    <path d="M36 52H44V58H52V64H60V70H36Z" :fill="onDark ? '#fbf7f4' : 'var(--c-bg)'" />
    <circle cx="72" cy="50" r="6.5" :fill="onDark ? 'var(--c-cellar-accent)' : 'var(--c-accent)'" />
  </svg>
</template>

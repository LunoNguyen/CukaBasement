<script setup lang="ts">
// `onDark`: drawn for a dark backdrop whatever the theme (white mark).
defineProps<{ onDark?: boolean }>()
</script>

<template>
  <!-- Basement-door "C" with three steps and the pink credit dot: black in light mode, white in dark mode. -->
  <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <rect width="100" height="100" rx="24" :fill="onDark ? '#ededed' : 'var(--c-text)'" />
    <path d="M69.9 33.3A26 26 0 1 0 69.9 66.7" fill="none" :stroke="onDark ? '#141414' : 'var(--c-bg)'" stroke-width="12" />
    <path d="M36 52H44V58H52V64H60V70H36Z" :fill="onDark ? '#141414' : 'var(--c-bg)'" />
    <circle cx="72" cy="50" r="6.5" fill="var(--c-accent)" />
  </svg>
</template>

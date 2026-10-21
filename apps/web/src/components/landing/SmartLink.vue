<script setup lang="ts">
import { isExternalHref } from '@cuka/shared'

/** A site path as a RouterLink; an http(s) URL opens in a new tab without leaking the opener. */
defineProps<{ href: string }>()
</script>

<template>
  <a v-if="isExternalHref(href)" :href="href" target="_blank" rel="noopener noreferrer"><slot /></a>
  <RouterLink v-else :to="href"><slot /></RouterLink>
</template>

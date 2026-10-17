<script setup lang="ts">
import AppHeader from '@/components/layout/AppHeader.vue'
import ToastHost from '@/components/layout/ToastHost.vue'
</script>

<template>
  <AppHeader />
  <main class="mx-auto max-w-screen-2xl px-3 py-4">
    <RouterView />
  </main>
  <ToastHost />
</template>

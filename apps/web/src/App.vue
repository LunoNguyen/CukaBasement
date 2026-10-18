<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import AppHeader from '@/components/layout/AppHeader.vue'
import VerifyBanner from '@/components/layout/VerifyBanner.vue'
import ToastHost from '@/components/layout/ToastHost.vue'

const auth = useAuth()
const route = useRoute()
const router = useRouter()

// The session ended mid-use (refresh rejected, password changed elsewhere): leave auth-only pages.
// `sync` so a navigation started right after (e.g. logout → home) supersedes this one.
watch(
  () => auth.isLoggedIn,
  (loggedIn) => {
    if (loggedIn || !(route.meta.auth || route.meta.roles)) return
    void router.replace({ path: '/login', query: { next: route.fullPath } })
  },
  { flush: 'sync' },
)
</script>

<template>
  <AppHeader />
  <VerifyBanner />
  <main class="mx-auto max-w-screen-2xl px-3 py-4">
    <RouterView />
  </main>
  <ToastHost />
</template>

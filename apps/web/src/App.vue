<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import AppHeader from '@/components/layout/AppHeader.vue'
import VerifyBanner from '@/components/layout/VerifyBanner.vue'
import ToastHost from '@/components/layout/ToastHost.vue'
import AppFooter from '@/components/layout/AppFooter.vue'

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
  <div class="flex min-h-[calc(100dvh-4rem)] flex-col">
    <main class="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-5">
      <RouterView />
    </main>
    <AppFooter />
  </div>
  <ToastHost />
</template>

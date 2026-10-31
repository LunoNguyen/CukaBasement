<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { useMaintenance } from '@/stores/maintenance'
import AppHeader from '@/components/layout/AppHeader.vue'
import VerifyBanner from '@/components/layout/VerifyBanner.vue'
import ToastHost from '@/components/layout/ToastHost.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import MaintenanceNotice from '@/components/layout/MaintenanceNotice.vue'
import { useTheme } from '@/composables/useTheme'

// The theme is applied at start-up, before any menu holding the toggle is opened.
useTheme()
const auth = useAuth()
const route = useRoute()
const router = useRouter()
const maintenance = useMaintenance()
// Admins keep using the site during a restore (the API lets them through); everyone else waits.
const showMaintenance = computed(() => maintenance.active && !auth.isAdmin)

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
  <div class="flex min-h-[calc(100dvh-6.25rem)] flex-col">
    <main :class="route.meta.fullBleed && !showMaintenance ? 'w-full flex-1' : 'mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6'">
      <MaintenanceNotice v-if="showMaintenance" />
      <RouterView v-else />
    </main>
    <AppFooter />
  </div>
  <ToastHost />
</template>

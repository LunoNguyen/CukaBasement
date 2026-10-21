<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import Tabs from '@/components/common/Tabs.vue'
import AdminUsers from './AdminUsers.vue'
import AdminSettings from './AdminSettings.vue'
import AdminLogs from './AdminLogs.vue'
import AdminBackups from './AdminBackups.vue'

// The homepage editor (and its preview components) loads only when its tab is opened.
const AdminHome = defineAsyncComponent(() => import('./AdminHome.vue'))

const KEYS = ['users', 'home', 'settings', 'logs', 'backups'] as const
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const tab = computed({
  get: () => (KEYS.find((k) => k === route.query.tab) ?? 'users') as string,
  set: (v) => void router.replace({ query: { ...route.query, tab: v } }),
})
const tabs = computed(() => KEYS.map((key) => ({ key, label: t(`admin.tabs.${key}`) })))
</script>

<template>
  <section class="mx-auto px-3 py-4" :class="tab === 'home' ? 'max-w-screen-2xl' : 'max-w-5xl'">
    <h1 class="mb-4 font-display text-3xl font-semibold tracking-tight">{{ t('admin.title') }}</h1>
    <Tabs v-model="tab" :tabs="tabs" />
    <div class="pt-4">
      <AdminUsers v-if="tab === 'users'" />
      <AdminHome v-else-if="tab === 'home'" />
      <AdminSettings v-else-if="tab === 'settings'" />
      <AdminLogs v-else-if="tab === 'logs'" />
      <AdminBackups v-else />
    </div>
  </section>
</template>

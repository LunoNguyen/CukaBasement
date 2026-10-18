<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import Tabs from '@/components/common/Tabs.vue'
import AdminUsers from './AdminUsers.vue'
import AdminSettings from './AdminSettings.vue'
import AdminLogs from './AdminLogs.vue'
import AdminBackups from './AdminBackups.vue'

const KEYS = ['users', 'settings', 'logs', 'backups'] as const
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
  <section class="mx-auto max-w-5xl px-3 py-4">
    <h1 class="mb-4 font-display text-3xl font-semibold tracking-tight">{{ t('admin.title') }}</h1>
    <Tabs v-model="tab" :tabs="tabs" />
    <div class="pt-4">
      <AdminUsers v-if="tab === 'users'" />
      <AdminSettings v-else-if="tab === 'settings'" />
      <AdminLogs v-else-if="tab === 'logs'" />
      <AdminBackups v-else />
    </div>
  </section>
</template>

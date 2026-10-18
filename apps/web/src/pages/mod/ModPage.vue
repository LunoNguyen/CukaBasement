<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import Tabs from '@/components/common/Tabs.vue'
import ModQueue from './ModQueue.vue'
import ModReports from './ModReports.vue'
import ModComments from './ModComments.vue'

const KEYS = ['queue', 'reports', 'comments'] as const
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// The tab lives in the URL so a reload keeps it.
const tab = computed({
  get: () => (KEYS.find((k) => k === route.query.tab) ?? 'queue') as string,
  set: (v) => void router.replace({ query: { ...route.query, tab: v } }),
})
const tabs = computed(() => KEYS.map((key) => ({ key, label: t(`mod.tabs.${key}`) })))
</script>

<template>
  <section class="mx-auto max-w-3xl px-3 py-4">
    <h1 class="mb-4 font-display text-3xl font-semibold tracking-tight">{{ t('mod.title') }}</h1>
    <Tabs v-model="tab" :tabs="tabs" />
    <div class="pt-4">
      <ModQueue v-if="tab === 'queue'" />
      <ModReports v-else-if="tab === 'reports'" />
      <ModComments v-else />
    </div>
  </section>
</template>

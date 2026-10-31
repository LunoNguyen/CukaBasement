<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNotifications } from '@/stores/notifications'

const { t } = useI18n()
const store = useNotifications()
const label = computed(() => (store.count > 99 ? '99+' : String(store.count)))

onMounted(() => store.start())
onBeforeUnmount(() => store.stop())
</script>

<template>
  <RouterLink to="/notifications" data-test="bell" class="icon-btn relative" :aria-label="t('notifications.bell', { n: store.count })">
    <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0" />
    </svg>
    <span
      v-if="store.count > 0"
      data-test="bell-badge"
      class="absolute top-1 right-1 min-w-4 rounded-full bg-[var(--c-primary)] px-1 text-center text-[10px] font-bold leading-4 text-[var(--c-on-primary)] ring-2 ring-[var(--c-bg)]"
      aria-hidden="true"
    >{{ label }}</span>
  </RouterLink>
</template>

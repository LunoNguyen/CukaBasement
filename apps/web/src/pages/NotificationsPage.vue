<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as api from '@/api/endpoints/notifications'
import type { NotificationDto } from '@/api/types'
import { useCursorList } from '@/composables/useCursorList'
import { useInfiniteTrigger } from '@/composables/useInfiniteTrigger'
import { useNotifications } from '@/stores/notifications'
import Btn from '@/components/common/Btn.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import Spinner from '@/components/common/Spinner.vue'

const { t, te, locale } = useI18n()
const store = useNotifications()
const list = useCursorList<NotificationDto>(api.list)
const sentinel = ref<HTMLElement | null>(null)
useInfiniteTrigger(sentinel, () => void list.loadMore())
onMounted(() => void list.loadMore())

// Rows stay highlighted for this visit; the server (and the badge) already count them as read.
const requested = new Set<string>()
watch(list.items, (items) => {
  const ids = items.filter((n) => !n.readAt && !requested.has(n.id)).map((n) => n.id)
  ids.forEach((id) => requested.add(id))
  void store.markRead(ids)
})

async function markAll() {
  if (!(await store.markAllRead())) return
  const now = new Date().toISOString()
  list.items.value = list.items.value.map((n) => (n.readAt ? n : { ...n, readAt: now }))
}

function text(n: NotificationDto): string {
  if (!te('notifications.type.' + n.type)) return t('notifications.unknown')
  return t('notifications.type.' + n.type, {
    title: n.post?.title ?? t('notifications.deletedPost'),
    actor: n.actor?.displayName ?? t('notifications.someone'),
    reason: n.reason ?? '',
  })
}

function link(n: NotificationDto): string | null {
  if (n.type === 'follow') return n.actor ? '/u/' + encodeURIComponent(n.actor.username) : null
  return n.post ? '/posts/' + encodeURIComponent(n.post.id) : null
}
</script>

<template>
  <section class="mx-auto max-w-2xl px-3 py-4">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h1 class="text-xl font-bold">{{ t('notifications.title') }}</h1>
      <Btn variant="ghost" data-test="mark-all" @click="markAll">{{ t('notifications.markAll') }}</Btn>
    </div>
    <ul class="divide-y divide-[var(--c-border)] rounded border border-[var(--c-border)] bg-[var(--c-surface)]">
      <li
        v-for="n in list.items.value"
        :key="n.id"
        data-test="notification"
        class="px-3 py-2 text-sm"
        :class="{ 'is-unread bg-[var(--c-border)] font-semibold': !n.readAt }"
      >
        <component :is="link(n) ? 'RouterLink' : 'div'" :to="link(n) ?? undefined" class="block">
          <span>{{ text(n) }}</span>
          <time :datetime="n.createdAt" class="ml-2 text-xs font-normal text-[var(--c-muted)]">{{ new Date(n.createdAt).toLocaleString(locale) }}</time>
        </component>
      </li>
    </ul>
    <div v-if="list.error.value" class="py-6 text-center">
      <p class="mb-2 text-[var(--c-muted)]">{{ t('errors.' + list.error.value.code) }}</p>
      <Btn variant="ghost" @click="list.loadMore()">{{ t('common.retry') }}</Btn>
    </div>
    <div v-else-if="list.loading.value" class="flex justify-center py-6"><Spinner /></div>
    <EmptyState v-else-if="list.done.value && list.items.value.length === 0">{{ t('notifications.empty') }}</EmptyState>
    <div v-else-if="!list.done.value" :key="list.items.value.length" ref="sentinel" class="flex justify-center py-6">
      <Btn variant="ghost" @click="list.loadMore()">{{ t('common.loadMore') }}</Btn>
    </div>
  </section>
</template>

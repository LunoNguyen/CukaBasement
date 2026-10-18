<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MOD_ACTIONS, type ModAction } from '@cuka/shared'
import * as api from '@/api/endpoints/admin'
import type { AdminLogDto } from '@/api/types'
import { useCursorList } from '@/composables/useCursorList'
import { useErrorText } from '@/pages/auth/errorText'
import Btn from '@/components/common/Btn.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import Spinner from '@/components/common/Spinner.vue'

const { t, locale } = useI18n()
const errorText = useErrorText()
const action = ref<ModAction | ''>('')
const list = useCursorList<AdminLogDto>((cursor) => api.logs(action.value || undefined, cursor))
onMounted(() => void list.loadMore())
watch(action, () => {
  list.reset()
  void list.loadMore()
})
</script>

<template>
  <div>
    <label class="mb-3 flex items-center gap-2 text-sm">
      {{ t('admin.logs.action') }}
      <select v-model="action" data-test="log-action" class="rounded border border-[var(--c-border)] bg-[var(--c-bg)] p-1.5">
        <option value="">{{ t('admin.logs.allActions') }}</option>
        <option v-for="a in MOD_ACTIONS" :key="a" :value="a">{{ t(`admin.actions.${a}`) }}</option>
      </select>
    </label>
    <ul class="flex flex-col gap-2">
      <li v-for="l in list.items.value" :key="l.id" data-test="log-row" class="rounded border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-sm">
        <p class="break-words">
          <span class="font-semibold">{{ l.actor === 'system' ? t('admin.logs.system') : '@' + l.actor.username }}</span>
          · {{ t(`admin.actions.${l.action}`) }} ·
          <RouterLink v-if="l.targetType === 'post'" :to="`/posts/${l.targetId}`" class="underline">{{ l.targetType }}:{{ l.targetId }}</RouterLink>
          <span v-else>{{ l.targetType }}:{{ l.targetId }}</span>
        </p>
        <p v-if="l.note" class="break-words text-xs text-[var(--c-muted)]">{{ l.note }}</p>
        <time :datetime="l.createdAt" class="text-xs text-[var(--c-muted)]">{{ new Date(l.createdAt).toLocaleString(locale) }}</time>
      </li>
    </ul>
    <div v-if="list.error.value" class="py-6 text-center">
      <p class="mb-2 text-[var(--c-muted)]">{{ errorText(list.error.value) }}</p>
      <Btn variant="ghost" @click="list.loadMore()">{{ t('common.retry') }}</Btn>
    </div>
    <div v-else-if="list.loading.value" class="flex justify-center py-6"><Spinner /></div>
    <EmptyState v-else-if="list.done.value && list.items.value.length === 0">{{ t('admin.logs.empty') }}</EmptyState>
    <div v-else-if="!list.done.value" class="flex justify-center py-6">
      <Btn variant="ghost" @click="list.loadMore()">{{ t('common.loadMore') }}</Btn>
    </div>
  </div>
</template>

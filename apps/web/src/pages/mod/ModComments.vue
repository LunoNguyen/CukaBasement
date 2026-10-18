<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as api from '@/api/endpoints/mod'
import type { HiddenCommentDto } from '@/api/types'
import { useCursorList } from '@/composables/useCursorList'
import { useToast } from '@/stores/toast'
import { useErrorText } from '@/pages/auth/errorText'
import Btn from '@/components/common/Btn.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import Spinner from '@/components/common/Spinner.vue'

const { t, locale } = useI18n()
const toast = useToast()
const errorText = useErrorText()
const list = useCursorList<HiddenCommentDto>(api.hiddenComments)
const restoring = ref<string | null>(null)
onMounted(() => void list.loadMore())

async function restore(c: HiddenCommentDto) {
  if (restoring.value) return
  restoring.value = c.id
  try {
    await api.restoreComment(c.id)
    list.items.value = list.items.value.filter((x) => x.id !== c.id)
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    restoring.value = null
  }
}
</script>

<template>
  <div>
    <ul class="flex flex-col gap-3">
      <li v-for="c in list.items.value" :key="c.id" data-test="hidden-comment" class="rounded border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-sm">
        <p class="whitespace-pre-wrap break-words">{{ c.body }}</p>
        <p class="mt-1 text-xs text-[var(--c-muted)]">
          {{ c.author.displayName || c.author.username }} ·
          <RouterLink :to="`/posts/${c.post.id}`" class="underline">{{ c.post.title }}</RouterLink> ·
          <time :datetime="c.createdAt">{{ new Date(c.createdAt).toLocaleString(locale) }}</time>
        </p>
        <div class="mt-2"><Btn variant="ghost" :loading="restoring === c.id" @click="restore(c)">{{ t('mod.restore') }}</Btn></div>
      </li>
    </ul>
    <div v-if="list.error.value" class="py-6 text-center">
      <p class="mb-2 text-[var(--c-muted)]">{{ errorText(list.error.value) }}</p>
      <Btn variant="ghost" @click="list.loadMore()">{{ t('common.retry') }}</Btn>
    </div>
    <div v-else-if="list.loading.value" class="flex justify-center py-6"><Spinner /></div>
    <EmptyState v-else-if="list.done.value && list.items.value.length === 0">{{ t('mod.commentsEmpty') }}</EmptyState>
    <div v-else-if="!list.done.value" class="flex justify-center py-6">
      <Btn variant="ghost" @click="list.loadMore()">{{ t('common.loadMore') }}</Btn>
    </div>
  </div>
</template>

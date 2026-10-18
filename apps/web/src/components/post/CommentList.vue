<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { LIMITS } from '@cuka/shared'
import * as commentsApi from '@/api/endpoints/comments'
import { ApiError } from '@/api/client'
import type { CommentDto } from '@/api/types'
import { useCursorList } from '@/composables/useCursorList'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import Btn from '@/components/common/Btn.vue'
import Spinner from '@/components/common/Spinner.vue'
import CommentItem from './CommentItem.vue'

/** Comments of one post; the parent remounts it (`:key`) when the post changes. */
const props = defineProps<{ postId: string }>()
const { t } = useI18n()
const auth = useAuth()
const toast = useToast()
const route = useRoute()

const list = useCursorList((cursor) => commentsApi.listComments(props.postId, cursor))
onMounted(() => void list.loadMore())
onBeforeUnmount(() => list.reset())

const canWrite = computed(() => auth.isLoggedIn && !!auth.user?.emailVerified)
const body = ref('')
const replyTo = ref<string | null>(null)
const replyBody = ref('')
const busy = ref(false)

function fail(e: unknown) {
  toast.push({ kind: 'error', text: t('errors.' + (e instanceof ApiError ? e.code : 'INTERNAL')) })
}

async function send(text: string, parentId?: string): Promise<boolean> {
  const trimmed = text.trim()
  if (!trimmed || busy.value) return false
  busy.value = true
  try {
    const created = await commentsApi.createComment(props.postId, trimmed, parentId)
    if (parentId) {
      list.items.value = list.items.value.map((c) => (c.id === parentId ? { ...c, replies: [...(c.replies ?? []), created] } : c))
    } else {
      list.items.value = [...list.items.value, { ...created, replies: [] }]
    }
    return true
  } catch (e) {
    fail(e)
    return false
  } finally {
    busy.value = false
  }
}

async function submitTop() {
  if (await send(body.value)) body.value = ''
}

async function submitReply() {
  if (replyTo.value && (await send(replyBody.value, replyTo.value))) {
    replyBody.value = ''
    replyTo.value = null
  }
}

function startReply(c: CommentDto) {
  replyTo.value = replyTo.value === c.id ? null : c.id
  replyBody.value = ''
}

async function remove(c: CommentDto) {
  try {
    await commentsApi.deleteComment(c.id)
    list.items.value = c.parentId
      ? list.items.value.map((p) => (p.id === c.parentId ? { ...p, replies: (p.replies ?? []).filter((r) => r.id !== c.id) } : p))
      : list.items.value.filter((p) => p.id !== c.id)
  } catch (e) {
    fail(e)
  }
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="text-lg font-semibold">{{ t('comments.title') }}</h2>

    <form v-if="canWrite" data-test="comment-form" class="flex flex-col gap-2" @submit.prevent="submitTop">
      <textarea
        v-model="body"
        :maxlength="LIMITS.commentMax"
        rows="3"
        :placeholder="t('comments.placeholder')"
        :aria-label="t('comments.placeholder')"
        class="rounded border border-[var(--c-border)] bg-[var(--c-bg)] p-2 text-sm"
      />
      <div class="flex justify-end"><Btn type="submit" :loading="busy" :disabled="busy || !body.trim()">{{ t('comments.submit') }}</Btn></div>
    </form>
    <p v-else-if="auth.isLoggedIn" data-test="verify-hint" class="text-sm text-[var(--c-muted)]">{{ t('comments.verifyHint', { resend: t('auth.resend') }) }}</p>
    <RouterLink v-else :to="{ path: '/login', query: { next: route.fullPath } }" class="text-sm font-semibold text-[var(--c-accent)]">{{ t('comments.loginHint') }}</RouterLink>

    <div class="flex flex-col gap-4">
      <div v-for="c in list.items.value" :key="c.id" class="flex flex-col gap-2">
        <CommentItem :comment="c" :can-reply="canWrite" @reply="startReply(c)" @delete="remove(c)" />
        <CommentItem v-for="r in c.replies ?? []" :key="r.id" :comment="r" is-reply @delete="remove(r)" />
        <form v-if="replyTo === c.id" data-test="reply-form" class="ml-8 flex flex-col gap-2" @submit.prevent="submitReply">
          <textarea
            v-model="replyBody"
            :maxlength="LIMITS.commentMax"
            rows="2"
            :placeholder="t('comments.placeholder')"
            :aria-label="t('comments.placeholder')"
            class="rounded border border-[var(--c-border)] bg-[var(--c-bg)] p-2 text-sm"
          />
          <div class="flex justify-end gap-2">
            <Btn variant="ghost" @click="replyTo = null">{{ t('common.cancel') }}</Btn>
            <Btn type="submit" :loading="busy" :disabled="busy || !replyBody.trim()">{{ t('comments.reply') }}</Btn>
          </div>
        </form>
      </div>
    </div>

    <div v-if="list.error.value" class="text-center">
      <p class="mb-2 text-sm text-[var(--c-muted)]">{{ t('errors.' + list.error.value.code) }}</p>
      <Btn variant="ghost" @click="list.loadMore()">{{ t('common.retry') }}</Btn>
    </div>
    <div v-else-if="list.loading.value" class="flex justify-center"><Spinner /></div>
    <p v-else-if="list.done.value && list.items.value.length === 0" class="text-sm text-[var(--c-muted)]">{{ t('comments.empty') }}</p>
    <div v-else-if="!list.done.value" class="flex justify-center"><Btn variant="ghost" @click="list.loadMore()">{{ t('common.loadMore') }}</Btn></div>
  </section>
</template>

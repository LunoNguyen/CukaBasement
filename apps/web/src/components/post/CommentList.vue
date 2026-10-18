<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { LIMITS } from '@cuka/shared'
import * as commentsApi from '@/api/endpoints/comments'
import * as modApi from '@/api/endpoints/mod'
import { useErrorText } from '@/composables/useErrorText'
import type { CommentDto } from '@/api/types'
import { useCursorList } from '@/composables/useCursorList'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import Btn from '@/components/common/Btn.vue'
import Modal from '@/components/common/Modal.vue'
import Spinner from '@/components/common/Spinner.vue'
import CommentItem from './CommentItem.vue'

/** Comments of one post; the parent remounts it (`:key`) when the post changes. */
const props = defineProps<{ postId: string }>()
const { t } = useI18n()
const auth = useAuth()
const toast = useToast()
const errorText = useErrorText()
const route = useRoute()

const list = useCursorList((cursor) => commentsApi.listComments(props.postId, cursor))
onMounted(() => void list.loadMore())

const canWrite = computed(() => auth.isLoggedIn && !!auth.user?.emailVerified)
const body = ref('')
const replyTo = ref<string | null>(null)
const replyBody = ref('')
const busy = ref(false)

function fail(e: unknown) {
  toast.push({ kind: 'error', text: errorText(e) })
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

/** Applies `fn` to the comment (top-level or reply) with `c.id`; `null` removes it. */
function replace(c: CommentDto, fn: (x: CommentDto) => CommentDto | null) {
  const map = (xs: CommentDto[]) => xs.flatMap((x) => (x.id === c.id ? (fn(x) ?? []) : [x]))
  list.items.value = c.parentId
    ? list.items.value.map((p) => (p.id === c.parentId ? { ...p, replies: map(p.replies ?? []) } : p))
    : map(list.items.value)
}

// Delete and staff hide both ask first.
const pending = ref<{ kind: 'delete' | 'hide'; comment: CommentDto } | null>(null)
const confirmOpen = computed({
  get: () => pending.value !== null,
  set: (v) => {
    if (!v) pending.value = null
  },
})
const acting = ref(false)

async function confirmPending() {
  const p = pending.value
  if (!p || acting.value) return
  acting.value = true
  try {
    if (p.kind === 'delete') {
      await commentsApi.deleteComment(p.comment.id)
      replace(p.comment, () => null)
    } else {
      await modApi.hideComment(p.comment.id)
      replace(p.comment, (x) => ({ ...x, status: 'hidden' }))
    }
    pending.value = null
  } catch (e) {
    pending.value = null
    fail(e)
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="font-display text-xl font-semibold">{{ t('comments.title') }}</h2>

    <form v-if="canWrite" data-test="comment-form" class="flex flex-col gap-2" @submit.prevent="submitTop">
      <textarea
        v-model="body"
        :maxlength="LIMITS.commentMax"
        rows="3"
        :placeholder="t('comments.placeholder')"
        :aria-label="t('comments.placeholder')"
        class="field text-sm"
      />
      <div class="flex justify-end"><Btn type="submit" :loading="busy" :disabled="busy || !body.trim()">{{ t('comments.submit') }}</Btn></div>
    </form>
    <p v-else-if="auth.isLoggedIn" data-test="verify-hint" class="text-sm text-[var(--c-muted)]">{{ t('comments.verifyHint', { resend: t('auth.resend') }) }}</p>
    <RouterLink v-else :to="{ path: '/login', query: { next: route.fullPath } }" class="link text-sm">{{ t('comments.loginHint') }}</RouterLink>

    <div class="flex flex-col gap-4">
      <div v-for="c in list.items.value" :key="c.id" class="flex flex-col gap-2">
        <CommentItem
          :comment="c"
          :can-reply="canWrite"
          @reply="startReply(c)"
          @delete="pending = { kind: 'delete', comment: c }"
          @hide="pending = { kind: 'hide', comment: c }"
        />
        <CommentItem
          v-for="r in c.replies ?? []"
          :key="r.id"
          :comment="r"
          is-reply
          @delete="pending = { kind: 'delete', comment: r }"
          @hide="pending = { kind: 'hide', comment: r }"
        />
        <form v-if="replyTo === c.id" data-test="reply-form" class="ml-8 flex flex-col gap-2" @submit.prevent="submitReply">
          <textarea
            v-model="replyBody"
            :maxlength="LIMITS.commentMax"
            rows="2"
            :placeholder="t('comments.placeholder')"
            :aria-label="t('comments.placeholder')"
            class="field text-sm"
          />
          <div class="flex justify-end gap-2">
            <Btn variant="ghost" @click="replyTo = null">{{ t('common.cancel') }}</Btn>
            <Btn type="submit" :loading="busy" :disabled="busy || !replyBody.trim()">{{ t('comments.reply') }}</Btn>
          </div>
        </form>
      </div>
    </div>

    <div v-if="list.error.value" class="text-center">
      <p class="mb-2 text-sm text-[var(--c-muted)]">{{ errorText(list.error.value) }}</p>
      <Btn variant="ghost" @click="list.loadMore()">{{ t('common.retry') }}</Btn>
    </div>
    <div v-else-if="list.loading.value" class="flex justify-center"><Spinner /></div>
    <p v-else-if="list.done.value && list.items.value.length === 0" class="text-sm text-[var(--c-muted)]">{{ t('comments.empty') }}</p>
    <div v-else-if="!list.done.value" class="flex justify-center"><Btn variant="ghost" @click="list.loadMore()">{{ t('common.loadMore') }}</Btn></div>

    <Modal v-model:open="confirmOpen" :title="pending?.kind === 'hide' ? t('comments.hideTitle') : t('comments.deleteTitle')">
      <p class="mb-4 text-sm">{{ pending?.kind === 'hide' ? t('comments.hideConfirm') : t('comments.deleteConfirm') }}</p>
      <div class="flex justify-end gap-2">
        <Btn variant="ghost" @click="pending = null">{{ t('common.cancel') }}</Btn>
        <Btn data-test="confirm-comment" variant="danger" :loading="acting" @click="confirmPending">
          {{ pending?.kind === 'hide' ? t('mod.hide') : t('comments.delete') }}
        </Btn>
      </div>
    </Modal>
  </section>
</template>

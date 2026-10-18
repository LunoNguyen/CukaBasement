<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommentDto } from '@/api/types'
import { useAuth } from '@/stores/auth'

const props = defineProps<{ comment: CommentDto; isReply?: boolean; canReply?: boolean }>()
defineEmits<{ reply: []; delete: []; hide: [] }>()
const { t, locale } = useI18n()
const auth = useAuth()

const canDelete = computed(() => !!auth.user && (auth.user.id === props.comment.author.id || auth.isStaff))
const canHide = computed(() => auth.isStaff && props.comment.status !== 'hidden')
</script>

<template>
  <div data-test="comment" class="flex flex-col gap-1 text-sm" :class="{ 'ml-8 border-l-2 border-[var(--c-border)] pl-3': isReply }">
    <div class="flex flex-wrap items-baseline gap-2">
      <RouterLink :to="`/u/${comment.author.username}`" class="font-semibold">{{ comment.author.displayName || comment.author.username }}</RouterLink>
      <time :datetime="comment.createdAt" class="text-xs text-[var(--c-muted)]">{{ new Date(comment.createdAt).toLocaleDateString(locale) }}</time>
    </div>
    <template v-if="comment.status === 'hidden'">
      <p class="text-[var(--c-muted)] italic">{{ t('comments.hidden') }}</p>
      <p v-if="comment.body" class="whitespace-pre-line text-[var(--c-muted)]">{{ comment.body }}</p>
    </template>
    <p v-else class="whitespace-pre-line break-words">{{ comment.body }}</p>
    <div class="flex gap-3 text-xs">
      <button v-if="!isReply && canReply" type="button" data-test="reply" class="font-semibold text-[var(--c-muted)]" @click="$emit('reply')">
        {{ t('comments.reply') }}
      </button>
      <button v-if="canDelete" type="button" data-test="delete-comment" class="font-semibold text-[var(--c-muted)]" @click="$emit('delete')">
        {{ t('comments.delete') }}
      </button>
      <button v-if="canHide" type="button" data-test="hide-comment" class="font-semibold text-[var(--c-muted)]" @click="$emit('hide')">
        {{ t('mod.hide') }}
      </button>
    </div>
  </div>
</template>

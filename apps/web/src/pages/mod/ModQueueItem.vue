<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LIMITS, type Credit } from '@cuka/shared'
import * as api from '@/api/endpoints/mod'
import type { PostCardDto } from '@/api/types'
import { useToast } from '@/stores/toast'
import { useErrorText } from '@/composables/useErrorText'
import { creditValid, toCredit, type CreditForm } from '@/components/upload/postForm'
import CreditFields from '@/components/upload/CreditFields.vue'
import CreditLine from '@/components/post/CreditLine.vue'
import MediaPlaceholder from '@/components/post/MediaPlaceholder.vue'
import Btn from '@/components/common/Btn.vue'
import Modal from '@/components/common/Modal.vue'

/** `rejectSchema.reason` max in @cuka/shared. */

const props = defineProps<{ post: PostCardDto }>()
const emit = defineEmits<{ removed: []; updated: [post: PostCardDto] }>()
const { t } = useI18n()
const toast = useToast()
const errorText = useErrorText()

const busy = ref(false)
const rejectOpen = ref(false)
const reason = ref('')
const creditOpen = ref(false)
const creditForm = ref<CreditForm>({ ...props.post.credit })

// Staff get the full media from the API; fall back through the sizes.
const src = computed(() => props.post.cover?.previewUrl ?? props.post.cover?.thumbMdUrl ?? props.post.cover?.thumbSmUrl ?? null)

async function run(fn: () => Promise<unknown>, done: () => void): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await fn()
    done()
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    busy.value = false
  }
}

const approve = () => run(() => api.approve(props.post.id), () => emit('removed'))
const hide = () => run(() => api.hide(props.post.id), () => emit('removed'))

function openReject() {
  reason.value = ''
  rejectOpen.value = true
}
async function submitReject() {
  const text = reason.value.trim()
  if (!text) return
  await run(() => api.reject(props.post.id, text), () => {
    rejectOpen.value = false
    emit('removed')
  })
}

function openCredit() {
  creditForm.value = { ...props.post.credit }
  creditOpen.value = true
}
async function submitCredit() {
  if (!creditValid(creditForm.value)) return
  const credit: Credit = toCredit(creditForm.value)
  await run(() => api.updateCredit(props.post.id, credit), () => {
    creditOpen.value = false
    emit('updated', { ...props.post, credit })
  })
}
</script>

<template>
  <li data-test="queue-item" class="flex flex-col gap-3 card p-3 sm:flex-row">
    <RouterLink :to="`/posts/${post.id}`" class="relative block aspect-[4/5] w-full shrink-0 overflow-hidden rounded sm:w-40">
      <img v-if="src" :src="src" :alt="post.title" loading="lazy" class="h-full w-full object-cover" />
      <MediaPlaceholder v-else />
      <span v-if="post.rating === 'r18'" data-test="r18" class="absolute top-1 left-1 badge badge-accent">R18</span>
    </RouterLink>
    <div class="flex min-w-0 flex-1 flex-col gap-1 text-sm">
      <RouterLink :to="`/posts/${post.id}`" class="truncate font-semibold">{{ post.title }}</RouterLink>
      <span class="text-xs text-[var(--c-muted)]">{{ post.author.displayName || post.author.username }} · @{{ post.author.username }}</span>
      <span class="text-xs text-[var(--c-muted)]"><CreditLine :credit="post.credit" :author="post.author" /></span>
      <div class="mt-auto flex flex-wrap gap-2 pt-2">
        <Btn :loading="busy" @click="approve">{{ t('mod.approve') }}</Btn>
        <Btn variant="danger" :disabled="busy" @click="openReject">{{ t('mod.reject') }}</Btn>
        <Btn variant="ghost" :disabled="busy" @click="hide">{{ t('mod.hide') }}</Btn>
        <Btn variant="ghost" :disabled="busy" @click="openCredit">{{ t('mod.editCredit') }}</Btn>
      </div>
    </div>

    <Modal v-model:open="rejectOpen" :title="t('mod.rejectTitle')">
      <form class="flex flex-col gap-3" @submit.prevent="submitReject">
        <label class="flex flex-col gap-1 text-sm">
          {{ t('mod.rejectReason') }} *
          <textarea v-model="reason" :maxlength="LIMITS.rejectReasonMax" rows="3" class="field" />
        </label>
        <div class="flex justify-end gap-2">
          <Btn variant="ghost" @click="rejectOpen = false">{{ t('common.cancel') }}</Btn>
          <Btn type="submit" variant="danger" :loading="busy" :disabled="!reason.trim()">{{ t('mod.reject') }}</Btn>
        </div>
      </form>
    </Modal>

    <Modal v-model:open="creditOpen" :title="t('mod.editCredit')">
      <form class="flex flex-col gap-3" @submit.prevent="submitCredit">
        <CreditFields v-model="creditForm" />
        <div class="flex justify-end gap-2">
          <Btn variant="ghost" @click="creditOpen = false">{{ t('common.cancel') }}</Btn>
          <Btn type="submit" :loading="busy" :disabled="!creditValid(creditForm)">{{ t('mod.saveCredit') }}</Btn>
        </div>
      </form>
    </Modal>
  </li>
</template>

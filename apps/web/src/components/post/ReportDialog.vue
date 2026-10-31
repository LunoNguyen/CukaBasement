<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LIMITS, REPORT_REASONS, type ReportReason } from '@cuka/shared'
import * as reportsApi from '@/api/endpoints/reports'
import { ApiError } from '@/api/client'
import { useToast } from '@/stores/toast'
import Modal from '@/components/common/Modal.vue'
import Btn from '@/components/common/Btn.vue'


const props = defineProps<{ postId: string }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const toast = useToast()

const reason = ref<ReportReason | null>(null)
const detail = ref('')
const busy = ref(false)

watch(open, (v) => {
  if (!v) return
  reason.value = null
  detail.value = ''
})

async function submit() {
  if (!reason.value || busy.value) return
  busy.value = true
  try {
    await reportsApi.reportPost(props.postId, reason.value, detail.value.trim())
    toast.push({ kind: 'success', text: t('post.reported') })
    open.value = false
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'INTERNAL'
    if (code === 'REPORT_ALREADY_EXISTS') {
      toast.push({ kind: 'info', text: t('post.alreadyReported') })
      open.value = false
    } else toast.push({ kind: 'error', text: t('errors.' + code) })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal v-model:open="open" :title="t('post.reportTitle')">
    <form data-test="report-form" class="flex flex-col gap-3" @submit.prevent="submit">
      <fieldset class="flex flex-col gap-1">
        <legend class="mb-1 text-sm font-semibold">{{ t('post.reportReason') }}</legend>
        <label v-for="r in REPORT_REASONS" :key="r" class="flex items-center gap-2 text-sm">
          <input v-model="reason" type="radio" name="reason" :value="r" />
          {{ t(`post.reasons.${r}`) }}
        </label>
      </fieldset>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('post.reportDetail') }}
        <textarea v-model="detail" :maxlength="LIMITS.reportDetailMax" rows="3" class="field" />
      </label>
      <div class="flex justify-end gap-2">
        <Btn variant="secondary" @click="open = false">{{ t('common.cancel') }}</Btn>
        <Btn type="submit" :loading="busy" :disabled="!reason || busy">{{ t('post.reportSubmit') }}</Btn>
      </div>
    </form>
  </Modal>
</template>

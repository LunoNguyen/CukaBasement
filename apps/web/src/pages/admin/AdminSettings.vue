<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_SETTINGS, type GlobalSettings } from '@cuka/shared'
import * as api from '@/api/endpoints/admin'
import { useToast } from '@/stores/toast'
import { useErrorText } from '@/pages/auth/errorText'
import Btn from '@/components/common/Btn.vue'
import Spinner from '@/components/common/Spinner.vue'

const MB = 1024 * 1024
const GB = 1024 * MB
const MAX_FILE_MB = DEFAULT_SETTINGS.maxFileBytes / MB

type Key = keyof GlobalSettings
/** Bytes per displayed unit: 1 for plain counts. */
const UNIT: Record<Key, number> = { reportHideThreshold: 1, reportAiHideThreshold: 1, maxFileBytes: MB, maxFilesPerPost: 1, dailyUploadQuotaBytes: GB }
const KEYS = Object.keys(UNIT) as Key[]

const { t } = useI18n()
const toast = useToast()
const errorText = useErrorText()

const loaded = ref<GlobalSettings | null>(null)
const form = reactive<Record<Key, string>>({ reportHideThreshold: '', reportAiHideThreshold: '', maxFileBytes: '', maxFilesPerPost: '', dailyUploadQuotaBytes: '' })
const errors = reactive<Partial<Record<Key, string>>>({})
const loadError = ref<unknown>(null)
const saving = ref(false)

function fill(s: GlobalSettings) {
  loaded.value = s
  for (const k of KEYS) form[k] = String(s[k] / UNIT[k])
}

onMounted(async () => {
  try {
    fill(await api.settings())
  } catch (e) {
    loadError.value = e
  }
})

async function save() {
  if (saving.value || !loaded.value) return
  const patch: Partial<GlobalSettings> = {}
  for (const k of KEYS) delete errors[k]
  for (const k of KEYS) {
    const n = Number(form[k])
    const bytes = Math.round(n * UNIT[k])
    if (String(form[k]).trim() === '' || !Number.isFinite(n) || bytes < 1 || (UNIT[k] === 1 && !Number.isInteger(n))) errors[k] = t('admin.settings.invalid')
    else if (k === 'maxFileBytes' && bytes > DEFAULT_SETTINGS.maxFileBytes) errors[k] = t('admin.settings.maxFileTooBig', { max: MAX_FILE_MB })
    else if (bytes !== loaded.value[k]) patch[k] = bytes
  }
  if (KEYS.some((k) => errors[k]) || Object.keys(patch).length === 0) return
  saving.value = true
  try {
    fill(await api.updateSettings(patch))
    toast.push({ kind: 'success', text: t('admin.settings.saved') })
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <p v-if="loadError" class="py-6 text-center text-[var(--c-muted)]">{{ errorText(loadError) }}</p>
  <div v-else-if="!loaded" class="flex justify-center py-6"><Spinner /></div>
  <form v-else class="flex max-w-md flex-col gap-3" @submit.prevent="save">
    <label v-for="k in KEYS" :key="k" class="flex flex-col gap-1 text-sm">
      {{ t(`admin.settings.${k}`) }}
      <input
        v-model="form[k]"
        :data-test="`set-${k}`"
        type="number"
        min="1"
        :max="k === 'maxFileBytes' ? MAX_FILE_MB : undefined"
        step="any"
        class="rounded border border-[var(--c-border)] bg-[var(--c-bg)] p-2"
      />
      <span v-if="errors[k]" role="alert" class="text-xs text-red-600">{{ errors[k] }}</span>
    </label>
    <div><Btn type="submit" :loading="saving">{{ t('admin.settings.save') }}</Btn></div>
  </form>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LocalizedText } from '@cuka/shared'
import { useEditor } from './model'

/**
 * One bilingual text field showing the language being edited. English left empty falls back to Vietnamese, which
 * is shown as its placeholder.
 */
const props = withDefaults(defineProps<{ label: string; max: number; multiline?: boolean; rows?: number; required?: boolean; hint?: string; testId?: string }>(), {
  multiline: false,
  rows: 3,
  required: false,
  hint: '',
  testId: undefined,
})
const model = defineModel<LocalizedText>({ required: true })
const { t } = useI18n()
const { lang } = useEditor()
const id = useId()

const value = computed({
  get: () => model.value[lang.value] ?? '',
  set: (v: string) => (model.value = { ...model.value, [lang.value]: v }),
})
const placeholder = computed(() => (lang.value === 'en' ? model.value.vi : ''))
const missing = computed(() => props.required && lang.value === 'vi' && !model.value.vi.trim())
</script>

<template>
  <div class="flex flex-col gap-1.5 text-sm">
    <label :for="id" class="flex items-center gap-2 font-medium">
      {{ label }}<span v-if="required" class="text-[var(--c-accent-strong)]" aria-hidden="true">*</span>
      <span class="ml-auto text-[10px] text-[var(--c-muted)]">{{ lang }}</span>
    </label>
    <textarea v-if="multiline" :id="id" v-model="value" :rows="rows" :maxlength="max" :placeholder="placeholder" class="field resize-y" :aria-invalid="missing || undefined" :data-test="testId" />
    <input v-else :id="id" v-model="value" type="text" :maxlength="max" :placeholder="placeholder" class="field" :aria-invalid="missing || undefined" :data-test="testId" />
    <p v-if="missing" class="text-xs text-[var(--c-danger)]">{{ t('admin.home.required') }}</p>
    <p v-else-if="lang === 'en'" class="text-xs text-[var(--c-muted)]">{{ t('admin.home.enFallback') }}</p>
    <p v-if="hint" class="text-xs text-[var(--c-muted)]">{{ hint }}</p>
  </div>
</template>

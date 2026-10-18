<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ALLOWED_FILE_TYPES, DEFAULT_SETTINGS } from '@cuka/shared'

const emit = defineEmits<{ files: [File[]] }>()
const { t } = useI18n()

const accept = ALLOWED_FILE_TYPES.map((f) => '.' + f.ext).join(',')
const types = ALLOWED_FILE_TYPES.map((f) => f.ext).join(', ')
const mb = Math.round(DEFAULT_SETTINGS.maxFileBytes / 1048576)
const over = ref(false)
const input = ref<HTMLInputElement | null>(null)

function onChange(e: Event) {
  const el = e.target as HTMLInputElement
  const files = [...(el.files ?? [])]
  if (files.length) emit('files', files)
  el.value = ''
}

function onDrop(e: DragEvent) {
  over.value = false
  const files = [...(e.dataTransfer?.files ?? [])]
  if (files.length) emit('files', files)
}
</script>

<template>
  <div
    class="flex flex-col items-center gap-2 rounded border-2 border-dashed p-6 text-center text-sm"
    :class="over ? 'border-[var(--c-accent)]' : 'border-[var(--c-border)]'"
    @dragover.prevent="over = true"
    @dragleave="over = false"
    @drop.prevent="onDrop"
  >
    <p>{{ t('upload.drop') }}</p>
    <button type="button" class="font-semibold text-[var(--c-accent)]" @click="input?.click()">{{ t('upload.choose') }}</button>
    <input ref="input" data-test="file-input" type="file" multiple class="sr-only" :accept="accept" @change="onChange" />
    <p class="text-xs text-[var(--c-muted)]">{{ t('upload.allowed', { types, mb }) }}</p>
  </div>
</template>

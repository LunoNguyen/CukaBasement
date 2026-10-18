<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DEFAULT_SETTINGS } from '@cuka/shared'
import type { QueueItem } from '@/composables/useUploader'
import MediaPlaceholder from '@/components/post/MediaPlaceholder.vue'

const props = defineProps<{ item: QueueItem; cover: boolean; first: boolean; last: boolean }>()
defineEmits<{ remove: []; up: []; down: []; cover: [] }>()
const { t } = useI18n()

const canBeCover = computed(() => ['image', 'video', 'audio'].includes(props.item.kind) && props.item.status !== 'invalid' && props.item.status !== 'failed')

const statusText = computed(() => {
  const { status, error, progress } = props.item
  if (error === 'too_large') return t('upload.tooLarge', { mb: Math.round(DEFAULT_SETTINGS.maxFileBytes / 1048576) })
  if (error === 'type') return t('upload.badType')
  if (error === 'too_many') return t('upload.tooMany', { n: DEFAULT_SETTINGS.maxFilesPerPost })
  if (status === 'failed' && props.item.existing) return t('upload.failedExisting')
  if (status === 'failed') return error ? t('errors.' + error) : t('upload.status.failed')
  if (status === 'uploading') return t('upload.status.uploading', { n: Math.round(progress * 100) })
  return t('upload.status.' + status)
})
const bad = computed(() => props.item.status === 'invalid' || props.item.status === 'failed')
</script>

<template>
  <li data-test="queue-item" class="flex items-center gap-3 rounded-xl border border-[var(--c-border)] bg-[var(--c-surface)] p-2 text-sm">
    <div class="h-12 w-12 shrink-0 overflow-hidden rounded">
      <img v-if="item.thumbUrl" :src="item.thumbUrl" alt="" class="h-full w-full object-cover" />
      <MediaPlaceholder v-else />
    </div>
    <div class="min-w-0 flex-1">
      <p class="truncate font-medium">{{ item.name || t('upload.existingFile') }}</p>
      <p data-test="queue-status" class="text-xs" :class="bad ? 'text-[var(--c-danger)]' : 'text-[var(--c-muted)]'">{{ statusText }}</p>
      <div v-if="item.status === 'uploading'" class="mt-1 h-1 rounded-full bg-[var(--c-border)]">
        <div class="h-1 rounded-full bg-[var(--c-accent)]" :style="{ width: Math.round(item.progress * 100) + '%' }" />
      </div>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <span v-if="cover" class="badge badge-accent">{{ t('upload.cover') }}</span>
      <button v-else-if="canBeCover" data-test="set-cover" type="button" class="text-xs underline" @click="$emit('cover')">{{ t('upload.setCover') }}</button>
      <button data-test="move-up" type="button" class="px-1" :disabled="first" :aria-label="t('upload.moveUp')" @click="$emit('up')">↑</button>
      <button data-test="move-down" type="button" class="px-1" :disabled="last" :aria-label="t('upload.moveDown')" @click="$emit('down')">↓</button>
      <button data-test="remove-file" type="button" class="px-1 text-[var(--c-danger)]" :aria-label="t('upload.remove')" @click="$emit('remove')">✕</button>
    </div>
  </li>
</template>

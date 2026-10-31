<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { HOME_LIMITS, type HomeImage } from '@cuka/shared'
import ImageLibrary from './ImageLibrary.vue'
import LocalizedInput from './LocalizedInput.vue'
import { newImage, useEditor } from './model'

/** One image slot: preview, choose from / upload to the library, remove (when optional), alt text or decorative. */
withDefaults(defineProps<{ label: string; optional?: boolean }>(), { optional: true })
const model = defineModel<HomeImage | null>({ required: true })
const { t } = useI18n()
const { images } = useEditor()
const libraryOpen = ref(false)
const resolved = computed(() => (model.value?.fileId ? images.value[model.value.fileId] : undefined))
const chosen = computed(() => !!model.value?.fileId)

function pick(fileId: string) {
  model.value = model.value ? { ...model.value, fileId } : newImage(fileId)
}
</script>

<template>
  <div class="flex flex-col gap-3 text-sm" data-test="image-field">
    <span class="font-medium">{{ label }}</span>
    <div class="flex items-center gap-3">
      <div class="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--c-border)] bg-[var(--c-surface-2)]">
        <img v-if="resolved" :src="resolved.src" alt="" class="h-full w-full object-cover" data-test="image-field-preview" />
        <span v-else-if="chosen" class="px-1 text-center text-[10px] text-[var(--c-muted)]">{{ t('admin.home.imageProcessing') }}</span>
        <svg v-else viewBox="0 0 24 24" class="size-6 text-[var(--c-muted)]" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 17-5-5-9 8" /></svg>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="chip" data-test="image-choose" @click="libraryOpen = true">{{ chosen ? t('admin.home.changeImage') : t('admin.home.chooseImage') }}</button>
        <button v-if="model && optional" type="button" class="chip text-[var(--c-danger)]" data-test="image-clear" @click="model = null">{{ t('admin.home.removeImage') }}</button>
      </div>
    </div>
    <template v-if="model">
      <label class="flex items-center gap-2">
        <input v-model="model.decorative" type="checkbox" data-test="image-decorative" />
        {{ t('admin.home.decorative') }}
      </label>
      <LocalizedInput v-if="!model.decorative" v-model="model.alt" :label="t('admin.home.alt')" :max="HOME_LIMITS.altMax" required :hint="t('admin.home.altHint')" test-id="image-alt" />
    </template>
    <ImageLibrary v-model:open="libraryOpen" @pick="pick" />
  </div>
</template>

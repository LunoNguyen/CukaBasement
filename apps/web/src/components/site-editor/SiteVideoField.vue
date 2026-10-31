<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HomeVideo } from '@cuka/shared'
import ImageLibrary from './ImageLibrary.vue'
import { useEditor } from './model'

/** One background-video slot: poster preview (plays muted on demand), choose from / upload to the library, remove. */
withDefaults(defineProps<{ label: string; hint?: string }>(), { hint: '' })
const model = defineModel<HomeVideo | null>({ required: true })
const { t } = useI18n()
const { images, videos } = useEditor()
const libraryOpen = ref(false)
const previewing = ref(false)
const poster = computed(() => (model.value ? images.value[model.value.fileId] : undefined))
const clip = computed(() => (model.value ? videos.value[model.value.fileId] : undefined))

function pick(fileId: string) {
  model.value = { fileId }
  previewing.value = false
}
</script>

<template>
  <div class="flex flex-col gap-3 text-sm" data-test="video-field">
    <span class="font-medium">{{ label }}</span>
    <div class="flex items-center gap-3">
      <div class="relative flex aspect-video w-36 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--c-border)] bg-[#141414]">
        <video v-if="previewing && clip" :src="clip.src" :poster="poster?.src" class="h-full w-full object-cover" muted autoplay loop playsinline data-test="video-field-player" />
        <template v-else-if="poster">
          <img :src="poster.src" alt="" class="h-full w-full object-cover" data-test="video-field-poster" />
          <button v-if="clip" type="button" class="absolute inset-0 flex items-center justify-center bg-black/25 text-white hover:bg-black/40" :aria-label="t('admin.home.previewVideo')" data-test="video-field-play" @click="previewing = true">
            <svg viewBox="0 0 24 24" class="size-7" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          </button>
        </template>
        <span v-else-if="model" class="px-1 text-center text-[10px] text-[#a3a3a3]">{{ t('admin.home.imageProcessing') }}</span>
        <svg v-else viewBox="0 0 24 24" class="size-6 text-[#a3a3a3]" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></svg>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="chip" data-test="video-choose" @click="libraryOpen = true">{{ model ? t('admin.home.changeVideo') : t('admin.home.chooseVideo') }}</button>
        <button v-if="model" type="button" class="chip text-[var(--c-danger)]" data-test="video-clear" @click="model = null">{{ t('admin.home.removeVideo') }}</button>
      </div>
    </div>
    <p v-if="hint" class="text-xs text-[var(--c-muted)]">{{ hint }}</p>
    <ImageLibrary v-model:open="libraryOpen" kind="video" @pick="pick" />
  </div>
</template>

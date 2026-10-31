<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { PostType } from '@cuka/shared'

/** Chips "All / Illustration / Manga / Video / Audio"; '' is all. The parent keeps the value in `?type=`. */
defineProps<{ type: PostType | '' }>()
const emit = defineEmits<{ 'update:type': [PostType | ''] }>()
const { t } = useI18n()
const TYPES: PostType[] = ['illustration', 'manga', 'video', 'audio']
</script>

<template>
  <div role="group" :aria-label="t('home.typeFilter')" class="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <button type="button" data-test="type-filter-all" class="chip touch-pad" :aria-pressed="type === ''" @click="emit('update:type', '')">{{ t('home.all') }}</button>
    <button
      v-for="ty in TYPES"
      :key="ty"
      type="button"
      :data-test="`type-filter-${ty}`"
      class="chip touch-pad"
      :aria-pressed="type === ty"
      @click="emit('update:type', ty)"
    >
      {{ t(`post.type.${ty}`) }}
    </button>
  </div>
</template>

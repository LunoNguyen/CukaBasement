<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { featuredTags, type TagDto } from '@/api/endpoints/tags'

/** One scrolling row of the featured tags; nothing at all when there are none (or they fail to load). */
const { t } = useI18n()
const tags = ref<TagDto[]>([])
onMounted(async () => {
  try {
    tags.value = await featuredTags()
  } catch {
    /* the row is optional */
  }
})
</script>

<template>
  <nav v-if="tags.length" :aria-label="t('home.featuredTags')" class="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    <RouterLink
      v-for="tag in tags"
      :key="tag.name"
      :to="`/tags/${encodeURIComponent(tag.name)}`"
      data-test="featured-tag"
      class="chip touch-pad shrink-0"
      >#{{ tag.display }}</RouterLink
    >
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { search } from '@/api/endpoints/feed'
import PostFeed from '@/components/post/PostFeed.vue'

const { t } = useI18n()
const route = useRoute()
const tag = computed(() => String(route.params.tag ?? ''))
</script>

<template>
  <div class="flex flex-col gap-3">
    <h1 class="font-display text-4xl font-semibold tracking-tight">#{{ tag }}</h1>
    <PostFeed :key="tag" :fetch-page="(c) => search({ tag }, c)" :empty-text="t('tag.empty')" />
  </div>
</template>

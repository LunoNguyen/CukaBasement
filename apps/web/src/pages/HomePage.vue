<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { featuredTags, type TagDto } from '@/api/endpoints/tags'
import { followingFeed, homeFeed } from '@/api/endpoints/feed'
import Tabs from '@/components/common/Tabs.vue'
import PostFeed from '@/components/post/PostFeed.vue'
import { useAuth } from '@/stores/auth'

const { t } = useI18n()
const auth = useAuth()
const tab = ref('latest')
const tags = ref<TagDto[]>([])

const tabs = computed(() => [
  { key: 'latest', label: t('home.latest') },
  ...(auth.isLoggedIn ? [{ key: 'following', label: t('home.following') }] : []),
])
// A logout while on the Following tab falls back to the public feed.
const active = computed(() => (tab.value === 'following' && auth.isLoggedIn ? 'following' : 'latest'))

onMounted(async () => {
  try {
    tags.value = await featuredTags()
  } catch {
    /* chips are optional */
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="tags.length" class="flex flex-wrap gap-2">
      <RouterLink
        v-for="tag in tags"
        :key="tag.name"
        :to="`/tags/${encodeURIComponent(tag.name)}`"
        data-test="featured-tag"
        class="chip"
        >{{ tag.display }}</RouterLink
      >
    </div>
    <Tabs v-model="tab" :tabs="tabs" />
    <PostFeed
      :key="active"
      :fetch-page="active === 'following' ? followingFeed : homeFeed"
      :empty-text="active === 'following' ? t('home.emptyFollowing') : t('home.empty')"
    />
  </div>
</template>

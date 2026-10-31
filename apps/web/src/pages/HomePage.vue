<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { POST_TYPES, type PostType } from '@cuka/shared'
import { followingFeed, homeFeed } from '@/api/endpoints/feed'
import { homeBanner } from '@/api/endpoints/site'
import type { HomeBannerDto } from '@/api/types'
import Tabs from '@/components/common/Tabs.vue'
import PostFeed from '@/components/post/PostFeed.vue'
import FeaturedTags from '@/components/home/FeaturedTags.vue'
import HomeBanner from '@/components/home/HomeBanner.vue'
import RankingRow from '@/components/home/RankingRow.vue'
import TypeFilter from '@/components/home/TypeFilter.vue'
import { useAuth } from '@/stores/auth'

/**
 * "/": the fanart gallery. A small banner about Du Ca, featured tags and the type filter, the ranking, then the
 * latest (or followed) works as an endless grid. The type filter lives in `?type=` and applies to both lists.
 */
const { t } = useI18n()
const auth = useAuth()
const route = useRoute()
const router = useRouter()

const type = computed<PostType | ''>(() => {
  const q = route.query.type
  return typeof q === 'string' && (POST_TYPES as readonly string[]).includes(q) ? (q as PostType) : ''
})
function setType(v: PostType | '') {
  const { type: _drop, ...rest } = route.query
  void router.replace({ query: v ? { ...rest, type: v } : rest })
}

const banner = ref<HomeBannerDto | null>(null)
onMounted(async () => {
  try {
    banner.value = (await homeBanner()).banner
  } catch {
    /* the gallery works without its banner */
  }
})

const tab = ref('latest')
const tabs = computed(() => [
  { key: 'latest', label: t('home.latest') },
  ...(auth.isLoggedIn ? [{ key: 'following', label: t('home.following') }] : []),
])
// A logout while on the Following tab falls back to the public feed.
const active = computed(() => (tab.value === 'following' && auth.isLoggedIn ? 'following' : 'latest'))
const fetchPage = computed(() => {
  const ty = type.value || undefined
  return active.value === 'following' ? (c: string | null) => followingFeed(c, ty) : (c: string | null) => homeFeed(c, ty)
})
</script>

<template>
  <div class="flex flex-col gap-6 sm:gap-8">
    <HomeBanner v-if="banner" :banner="banner" />
    <h1 v-else class="sr-only">{{ t('common.siteName') }}</h1>
    <div class="flex flex-col gap-3">
      <FeaturedTags />
      <TypeFilter :type="type" @update:type="setType" />
    </div>
    <RankingRow :type="type" />
    <section class="flex flex-col gap-4">
      <Tabs v-model="tab" data-test="feed-tabs" :tabs="tabs" />
      <PostFeed
        :key="`${active}:${type}`"
        :fetch-page="fetchPage"
        :empty-text="active === 'following' ? t('home.emptyFollowing') : t('home.empty')"
      />
    </section>
  </div>
</template>

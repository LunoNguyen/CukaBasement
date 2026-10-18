<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ApiError } from '@/api/client'
import { getUser, getUserBookmarks, getUserPosts } from '@/api/endpoints/users'
import type { PublicUserDto } from '@/api/types'
import { useAuth } from '@/stores/auth'
import Btn from '@/components/common/Btn.vue'
import Spinner from '@/components/common/Spinner.vue'
import Tabs from '@/components/common/Tabs.vue'
import PostFeed from '@/components/post/PostFeed.vue'
import FollowButton from '@/components/user/FollowButton.vue'
import NotFoundPage from './NotFoundPage.vue'

const { t } = useI18n()
const route = useRoute()
const auth = useAuth()

const username = computed(() => String(route.params.username ?? ''))
const user = ref<PublicUserDto | null>(null)
const loading = ref(true)
const failure = ref<ApiError | null>(null)
const tab = ref('posts')
let seq = 0

async function load() {
  const my = ++seq
  loading.value = true
  failure.value = null
  user.value = null
  tab.value = 'posts'
  try {
    const u = await getUser(username.value)
    if (my === seq) user.value = u
  } catch (e) {
    if (my === seq) failure.value = e instanceof ApiError ? e : new ApiError('INTERNAL', 0)
  } finally {
    if (my === seq) loading.value = false
  }
}
watch(username, load, { immediate: true })

const isSelf = computed(() => !!user.value && auth.user?.id === user.value.id)
const tabs = computed(() => [
  { key: 'posts', label: t('profile.posts') },
  { key: 'bookmarks', label: t('profile.bookmarks') },
])

const SOCIAL = [
  { key: 'x', label: 'X' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'pixiv', label: 'pixiv' },
] as const
const socials = computed(() =>
  SOCIAL.map((s) => ({ ...s, url: user.value?.socialLinks[s.key] ?? '' })).filter((s) => /^https?:\/\//i.test(s.url)),
)

function onFollow(s: { following: boolean; followerCount: number }) {
  if (!user.value) return
  user.value = { ...user.value, isFollowing: s.following, stats: { ...user.value.stats, followerCount: s.followerCount } }
}
</script>

<template>
  <div v-if="loading" class="flex justify-center py-10"><Spinner /></div>
  <NotFoundPage v-else-if="failure?.code === 'NOT_FOUND'" />
  <div v-else-if="failure" class="py-10 text-center">
    <p class="mb-2 text-[var(--c-muted)]">{{ t('errors.' + failure.code) }}</p>
    <Btn variant="ghost" @click="load()">{{ t('common.retry') }}</Btn>
  </div>
  <div v-else-if="user" class="flex flex-col gap-4">
    <div class="h-32 w-full overflow-hidden rounded bg-[var(--c-border)] sm:h-48">
      <img v-if="user.bannerUrl" :src="user.bannerUrl" alt="" class="h-full w-full object-cover" data-test="banner" />
    </div>
    <div class="-mt-12 flex flex-wrap items-end gap-3 px-2 sm:-mt-16">
      <img
        v-if="user.avatarUrl"
        :src="user.avatarUrl"
        alt=""
        data-test="avatar-img"
        class="h-20 w-20 shrink-0 rounded-full border-4 border-[var(--c-bg)] object-cover sm:h-28 sm:w-28"
      />
      <span
        v-else
        data-test="avatar"
        class="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-[var(--c-bg)] bg-[var(--c-border)] text-3xl font-bold sm:h-28 sm:w-28"
        aria-hidden="true"
        >{{ (user.displayName || user.username).charAt(0).toUpperCase() }}</span
      >
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-xl font-bold">{{ user.displayName || user.username }}</h1>
        <p class="truncate text-sm text-[var(--c-muted)]">@{{ user.username }}</p>
      </div>
      <FollowButton v-if="!isSelf" :username="user.username" :following="user.isFollowing" @change="onFollow" />
      <RouterLink v-else to="/settings" class="text-sm font-semibold text-[var(--c-accent)]">{{ t('profile.edit') }}</RouterLink>
    </div>
    <p v-if="user.bio" class="px-2 whitespace-pre-line">{{ user.bio }}</p>
    <ul v-if="socials.length" class="flex flex-wrap gap-3 px-2 text-sm">
      <li v-for="s in socials" :key="s.key">
        <a :href="s.url" data-test="social-link" target="_blank" rel="noopener noreferrer nofollow" class="text-[var(--c-accent)]">{{ s.label }}</a>
      </li>
    </ul>
    <dl class="flex gap-6 px-2 text-sm">
      <div data-test="stat-followers"><dt class="inline text-[var(--c-muted)]">{{ t('profile.followers') }}</dt> <dd class="inline font-semibold">{{ user.stats.followerCount }}</dd></div>
      <div data-test="stat-following"><dt class="inline text-[var(--c-muted)]">{{ t('profile.following') }}</dt> <dd class="inline font-semibold">{{ user.stats.followingCount }}</dd></div>
      <div data-test="stat-posts"><dt class="inline text-[var(--c-muted)]">{{ t('profile.postCount') }}</dt> <dd class="inline font-semibold">{{ user.stats.postCount }}</dd></div>
    </dl>
    <Tabs v-model="tab" :tabs="tabs" />
    <PostFeed
      :key="user.username + tab"
      :fetch-page="(c) => (tab === 'posts' ? getUserPosts(user!.username, c) : getUserBookmarks(user!.username, c))"
      :empty-text="tab === 'posts' ? t('profile.emptyPosts') : t('profile.emptyBookmarks')"
    />
  </div>
</template>

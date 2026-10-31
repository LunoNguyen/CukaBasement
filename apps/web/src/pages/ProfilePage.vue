<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { SOCIAL_PLATFORM_LABELS } from '@cuka/shared'
import { ApiError } from '@/api/client'
import { useErrorText } from '@/composables/useErrorText'
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
const errorText = useErrorText()

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
// Own profile shows private bookmarks and pending posts: reload when the viewer logs in or out.
watch(
  () => auth.user?.id,
  () => {
    if (auth.ready) void load()
  },
)

const isSelf = computed(() => !!user.value && auth.user?.id === user.value.id)
const tabs = computed(() => [
  { key: 'posts', label: t('profile.posts') },
  { key: 'bookmarks', label: t('profile.bookmarks') },
])

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
/** In the saved order; `other` (or a platform this build does not know) shows its label with a generic link icon. */
const socials = computed(() =>
  (user.value?.links ?? [])
    .filter((l) => /^https?:\/\//i.test(l.url))
    .map((l, i) => {
      const name = (SOCIAL_PLATFORM_LABELS as Record<string, string | undefined>)[l.platform]
      return { key: i, url: l.url, label: name || l.label || hostOf(l.url), generic: !name }
    }),
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
    <p class="mb-2 text-[var(--c-muted)]">{{ errorText(failure) }}</p>
    <Btn variant="secondary" @click="load()">{{ t('common.retry') }}</Btn>
  </div>
  <div v-else-if="user" class="flex flex-col gap-5">
    <!-- 4:1 like the worker's banner render (1600×400), so the whole crop shows at every width. -->
    <div data-test="banner-box" class="aspect-[4/1] w-full overflow-hidden rounded-lg bg-[var(--c-surface-2)]">
      <img v-if="user.bannerUrl" :src="user.bannerUrl" alt="" class="h-full w-full object-cover" data-test="banner" />
    </div>
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
      <img
        v-if="user.avatarUrl"
        :src="user.avatarUrl"
        alt=""
        data-test="avatar-img"
        class="-mt-14 h-24 w-24 shrink-0 rounded-full border-4 border-[var(--c-bg)] bg-[var(--c-surface-2)] object-cover sm:-mt-12"
      />
      <span
        v-else
        data-test="avatar"
        class="-mt-14 flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4 border-[var(--c-bg)] bg-[var(--c-surface-2)] text-3xl font-bold sm:-mt-12"
        aria-hidden="true"
        >{{ (user.displayName || user.username).charAt(0).toUpperCase() }}</span
      >
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div class="min-w-0">
            <h1 class="truncate text-xl font-bold">{{ user.displayName || user.username }}</h1>
            <p class="truncate text-[13px] text-[var(--c-muted)]">@{{ user.username }}</p>
          </div>
          <div class="sm:ml-auto">
            <FollowButton v-if="!isSelf" :username="user.username" :following="user.isFollowing" @change="onFollow" />
            <Btn v-else to="/settings" variant="secondary">{{ t('profile.edit') }}</Btn>
          </div>
        </div>
        <dl class="flex gap-5 text-[13px]">
          <div data-test="stat-followers"><dd class="inline font-bold">{{ user.stats.followerCount }}</dd> <dt class="inline text-[var(--c-muted)]">{{ t('profile.followers') }}</dt></div>
          <div data-test="stat-following"><dd class="inline font-bold">{{ user.stats.followingCount }}</dd> <dt class="inline text-[var(--c-muted)]">{{ t('profile.following') }}</dt></div>
          <div data-test="stat-posts"><dd class="inline font-bold">{{ user.stats.postCount }}</dd> <dt class="inline text-[var(--c-muted)]">{{ t('profile.postCount') }}</dt></div>
        </dl>
        <p v-if="user.bio" class="max-w-2xl text-sm whitespace-pre-line">{{ user.bio }}</p>
        <ul v-if="socials.length" class="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          <li v-for="s in socials" :key="s.key">
            <a :href="s.url" data-test="social-link" target="_blank" rel="noopener noreferrer nofollow" class="inline-flex min-h-8 items-center gap-1 text-[var(--c-muted)] hover:text-[var(--c-text)] hover:underline">
              <svg v-if="s.generic" data-test="link-icon" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
              </svg>
              {{ s.label }}
            </a>
          </li>
        </ul>
      </div>
    </div>
    <Tabs v-model="tab" :tabs="tabs" />
    <PostFeed
      :key="user.username + tab"
      :fetch-page="(c) => (tab === 'posts' ? getUserPosts(user!.username, c) : getUserBookmarks(user!.username, c))"
      :empty-text="tab === 'posts' ? t('profile.emptyPosts') : t('profile.emptyBookmarks')"
    />
  </div>
</template>

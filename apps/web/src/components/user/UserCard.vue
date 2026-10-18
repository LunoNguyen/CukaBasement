<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PublicUserDto } from '@/api/types'
import { useAuth } from '@/stores/auth'
import FollowButton from './FollowButton.vue'

const props = defineProps<{ user: PublicUserDto }>()
const emit = defineEmits<{ change: [user: PublicUserDto] }>()
const { t } = useI18n()
const auth = useAuth()

const isSelf = computed(() => auth.user?.id === props.user.id)

function onFollow(s: { following: boolean; followerCount: number }) {
  emit('change', { ...props.user, isFollowing: s.following, stats: { ...props.user.stats, followerCount: s.followerCount } })
}
</script>

<template>
  <div data-test="user-card" class="flex items-center gap-3 card p-3">
    <RouterLink :to="`/u/${user.username}`" class="flex min-w-0 flex-1 items-center gap-3">
      <img v-if="user.avatarUrl" :src="user.avatarUrl" alt="" class="h-12 w-12 shrink-0 rounded-full object-cover" />
      <span v-else class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--c-border)] font-bold" aria-hidden="true">{{
        (user.displayName || user.username).charAt(0).toUpperCase()
      }}</span>
      <span class="min-w-0">
        <span class="block truncate font-semibold">{{ user.displayName || user.username }}</span>
        <span class="block truncate text-sm text-[var(--c-muted)]">@{{ user.username }} · {{ t('user.followers', { n: user.stats.followerCount }) }}</span>
      </span>
    </RouterLink>
    <FollowButton v-if="!isSelf" :username="user.username" :following="user.isFollowing" @change="onFollow" />
  </div>
</template>

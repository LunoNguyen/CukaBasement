<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { useDropdown } from '@/composables/useDropdown'
import LangSwitch from './LangSwitch.vue'
import ThemeToggle from './ThemeToggle.vue'

const { t } = useI18n()
const router = useRouter()
const auth = useAuth()

const root = ref<HTMLElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)
const open = useDropdown(root, button)
/** The avatar URL whose image failed to load: show the initial instead until the URL changes. */
const brokenAvatar = ref<string | null>(null)
watch(
  () => auth.user?.avatarUrl,
  () => (brokenAvatar.value = null),
)

async function logout() {
  open.value = false
  await auth.logout()
  await router.push('/')
}

const item = 'menu-item'
</script>

<template>
  <div v-if="auth.user" ref="root" class="relative">
    <button
      type="button"
      ref="button"
      data-test="account-menu-button"
      class="flex h-11 w-11 items-center justify-center rounded sm:h-10 sm:w-10 hover:bg-[var(--c-surface-2)]"
      :aria-expanded="open"
      :aria-label="t('account.menu')"
      @click="open = !open"
    >
      <img
        v-if="auth.user.avatarUrl && auth.user.avatarUrl !== brokenAvatar"
        :src="auth.user.avatarUrl"
        alt=""
        data-test="account-avatar"
        class="h-8 w-8 shrink-0 rounded-full bg-[var(--c-surface-2)] object-cover"
        @error="brokenAvatar = auth.user.avatarUrl"
      />
      <span
        v-else
        data-test="account-initial"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--c-surface-2)] text-xs font-bold text-[var(--c-text)]"
        aria-hidden="true"
      >
        {{ auth.user.profile.displayName.charAt(0).toUpperCase() }}
      </span>
    </button>
    <div v-if="open" data-test="account-menu" class="menu absolute right-0 z-40 mt-1 w-64">
      <RouterLink :to="'/u/' + auth.user.profile.username" class="flex items-center gap-3 rounded px-3 py-2.5 hover:bg-[var(--c-surface-2)]" @click="open = false">
        <span class="min-w-0">
          <span data-test="account-name" class="block truncate text-sm font-bold">{{ auth.user.profile.displayName }}</span>
          <span class="block truncate text-xs text-[var(--c-muted)]">@{{ auth.user.profile.username }}</span>
        </span>
      </RouterLink>
      <div class="menu-sep" />
      <ul>
        <li><RouterLink :to="'/u/' + auth.user.profile.username" :class="item" @click="open = false">{{ t('account.profile') }}</RouterLink></li>
        <li><RouterLink to="/settings" :class="item" @click="open = false">{{ t('account.settings') }}</RouterLink></li>
        <li v-if="auth.isStaff"><RouterLink to="/mod" :class="item" @click="open = false">{{ t('account.mod') }}</RouterLink></li>
        <li v-if="auth.isAdmin"><RouterLink to="/admin" :class="item" @click="open = false">{{ t('account.admin') }}</RouterLink></li>
      </ul>
      <div class="menu-sep" />
      <div class="px-3 py-2"><LangSwitch /></div>
      <ThemeToggle />
      <div class="menu-sep" />
      <button type="button" data-test="menu-logout" :class="item" @click="logout">{{ t('account.logout') }}</button>
    </div>
  </div>
</template>

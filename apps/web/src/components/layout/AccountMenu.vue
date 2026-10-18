<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'

const { t } = useI18n()
const router = useRouter()
const auth = useAuth()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const button = ref<HTMLButtonElement | null>(null)
/** The avatar URL whose image failed to load: show the initial instead until the URL changes. */
const brokenAvatar = ref<string | null>(null)
watch(
  () => auth.user?.avatarUrl,
  () => (brokenAvatar.value = null),
)

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return
  open.value = false
  button.value?.focus()
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

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
      class="flex min-h-9 items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm font-semibold hover:bg-[var(--c-soft)]"
      :aria-expanded="open"
      :aria-label="t('account.menu')"
      @click="open = !open"
    >
      <img
        v-if="auth.user.avatarUrl && auth.user.avatarUrl !== brokenAvatar"
        :src="auth.user.avatarUrl"
        alt=""
        data-test="account-avatar"
        class="h-7 w-7 shrink-0 rounded-full bg-[var(--c-border)] object-cover"
        @error="brokenAvatar = auth.user.avatarUrl"
      />
      <span
        v-else
        data-test="account-initial"
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--c-primary)] text-xs text-[var(--c-bg)]"
        aria-hidden="true"
      >
        {{ auth.user.profile.displayName.charAt(0).toUpperCase() }}
      </span>
      <span data-test="account-name" class="hidden max-w-[8rem] truncate sm:inline">{{ auth.user.profile.displayName }}</span>
    </button>
    <ul
      v-if="open"
      data-test="account-menu"
      class="menu absolute right-0 z-40 mt-2 min-w-48"
    >
      <li><RouterLink :to="'/u/' + auth.user.profile.username" :class="item" @click="open = false">{{ t('account.profile') }}</RouterLink></li>
      <li><RouterLink to="/settings" :class="item" @click="open = false">{{ t('account.settings') }}</RouterLink></li>
      <li v-if="auth.isStaff"><RouterLink to="/mod" :class="item" @click="open = false">{{ t('account.mod') }}</RouterLink></li>
      <li v-if="auth.isAdmin"><RouterLink to="/admin" :class="item" @click="open = false">{{ t('account.admin') }}</RouterLink></li>
      <li><button type="button" data-test="menu-logout" :class="item" @click="logout">{{ t('account.logout') }}</button></li>
    </ul>
  </div>
</template>

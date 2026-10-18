<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'

const { t } = useI18n()
const router = useRouter()
const auth = useAuth()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
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

const item = 'block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--c-border)]'
</script>

<template>
  <div v-if="auth.user" ref="root" class="relative">
    <button
      type="button"
      data-test="account-menu-button"
      class="flex items-center gap-2 rounded px-2 py-1 text-sm font-semibold"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="t('account.menu')"
      @click="open = !open"
    >
      <span class="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--c-primary)] text-xs text-[var(--c-bg)]" aria-hidden="true">
        {{ auth.user.profile.displayName.charAt(0).toUpperCase() }}
      </span>
      <span data-test="account-name" class="hidden max-w-[8rem] truncate sm:inline">{{ auth.user.profile.displayName }}</span>
    </button>
    <div
      v-if="open"
      role="menu"
      class="absolute right-0 z-40 mt-1 min-w-40 rounded border border-[var(--c-border)] bg-[var(--c-surface)] py-1 shadow"
    >
      <RouterLink role="menuitem" :to="'/u/' + auth.user.profile.username" :class="item" @click="open = false">{{ t('account.profile') }}</RouterLink>
      <RouterLink role="menuitem" to="/settings" :class="item" @click="open = false">{{ t('account.settings') }}</RouterLink>
      <RouterLink v-if="auth.isStaff" role="menuitem" to="/mod" :class="item" @click="open = false">{{ t('account.mod') }}</RouterLink>
      <RouterLink v-if="auth.isAdmin" role="menuitem" to="/admin" :class="item" @click="open = false">{{ t('account.admin') }}</RouterLink>
      <button type="button" role="menuitem" data-test="menu-logout" :class="item" @click="logout">{{ t('account.logout') }}</button>
    </div>
  </div>
</template>

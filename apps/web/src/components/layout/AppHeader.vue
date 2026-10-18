<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import LangSwitch from './LangSwitch.vue'
import ThemeToggle from './ThemeToggle.vue'
import NotificationBell from './NotificationBell.vue'
import AccountMenu from './AccountMenu.vue'
import { useAuth } from '@/stores/auth'

const { t } = useI18n()
const auth = useAuth()
</script>

<template>
  <header class="border-b border-[var(--c-border)] bg-[var(--c-surface)]">
    <div class="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
      <RouterLink to="/" class="text-lg font-bold text-[var(--c-primary)]">
        {{ t('common.siteName') }}
      </RouterLink>
      <nav class="flex gap-3 text-sm">
        <RouterLink to="/">{{ t('nav.home') }}</RouterLink>
        <RouterLink to="/search">{{ t('nav.search') }}</RouterLink>
      </nav>
      <div data-test="header-actions" class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        <LangSwitch />
        <ThemeToggle />
        <slot name="right" />
        <template v-if="auth.isLoggedIn">
          <RouterLink to="/upload" class="rounded bg-[var(--c-primary)] px-3 py-1 text-sm font-semibold text-[var(--c-bg)]">
            <span aria-hidden="true" class="sm:hidden">+</span>
            <span data-test="upload-label" class="sr-only sm:not-sr-only">{{ t('nav.upload') }}</span>
          </RouterLink>
          <NotificationBell />
          <AccountMenu />
        </template>
        <template v-else-if="auth.ready">
          <RouterLink to="/login" class="text-sm font-semibold">{{ t('auth.login') }}</RouterLink>
          <RouterLink to="/register" class="rounded bg-[var(--c-primary)] px-3 py-1 text-sm font-semibold text-[var(--c-bg)]">{{ t('auth.register') }}</RouterLink>
        </template>
      </div>
    </div>
  </header>
</template>

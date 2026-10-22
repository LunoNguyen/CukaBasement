<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import LangSwitch from './LangSwitch.vue'
import ThemeToggle from './ThemeToggle.vue'
import NotificationBell from './NotificationBell.vue'
import AccountMenu from './AccountMenu.vue'
import BrandMark from '@/components/brand/BrandMark.vue'
import { useAuth } from '@/stores/auth'

const { t } = useI18n()
const auth = useAuth()
const router = useRouter()
const query = ref('')

function search() {
  const q = query.value.trim()
  void router.push(q ? { path: '/search', query: { q } } : '/search')
  query.value = ''
}
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-[var(--c-border)] bg-[var(--c-bg)]/95 backdrop-blur">
    <div class="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
      <RouterLink to="/" data-test="brand" class="flex min-h-11 items-center gap-2" :aria-label="t('common.siteName')">
        <BrandMark class="size-8 shrink-0" />
        <span class="wordmark text-xl" aria-hidden="true"><b>Cuka</b>Basement</span>
      </RouterLink>
      <nav class="flex gap-1 text-sm font-medium text-[var(--c-muted)]">
        <RouterLink to="/" data-test="nav-home" class="inline-flex min-h-11 items-center px-2 hover:text-[var(--c-text)]" exact-active-class="text-[var(--c-text)]">{{ t('nav.home') }}</RouterLink>
        <RouterLink to="/gioi-thieu" data-test="nav-intro" class="inline-flex min-h-11 items-center px-2 hover:text-[var(--c-text)]" active-class="text-[var(--c-text)]">{{ t('nav.intro') }}</RouterLink>
        <RouterLink to="/posts" data-test="nav-posts" class="inline-flex min-h-11 items-center px-2 hover:text-[var(--c-text)]" exact-active-class="text-[var(--c-text)]">{{ t('nav.posts') }}</RouterLink>
        <RouterLink to="/search" class="inline-flex min-h-11 items-center px-2 hover:text-[var(--c-text)] md:hidden" active-class="text-[var(--c-text)]">{{ t('nav.search') }}</RouterLink>
      </nav>
      <!-- Not a <form>: pages own the forms, and this one would be the first on every page. -->
      <div role="search" class="relative hidden w-64 md:block lg:w-80">
        <svg viewBox="0 0 24 24" class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--c-muted)]" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input v-model="query" data-test="header-search" type="text" enterkeyhint="search" maxlength="100" :placeholder="t('search.placeholder')" :aria-label="t('nav.search')" class="field min-h-11 w-full rounded-full pl-9" @keydown.enter.prevent="search" />
      </div>
      <div data-test="header-actions" class="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        <LangSwitch />
        <ThemeToggle />
        <slot name="right" />
        <template v-if="auth.isLoggedIn">
          <RouterLink to="/upload" class="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-[var(--c-primary)] px-3 text-sm font-semibold text-[var(--c-bg)] hover:opacity-90 sm:px-4">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            <span data-test="upload-label" class="sr-only sm:not-sr-only">{{ t('nav.upload') }}</span>
          </RouterLink>
          <NotificationBell />
          <AccountMenu />
        </template>
        <template v-else-if="auth.ready">
          <RouterLink to="/login" class="inline-flex min-h-11 items-center px-2 text-sm font-semibold hover:text-[var(--c-primary)]">{{ t('auth.login') }}</RouterLink>
          <RouterLink to="/register" class="inline-flex min-h-11 items-center rounded-full bg-[var(--c-primary)] px-4 text-sm font-semibold text-[var(--c-bg)] hover:opacity-90">{{ t('auth.register') }}</RouterLink>
        </template>
      </div>
    </div>
  </header>
</template>

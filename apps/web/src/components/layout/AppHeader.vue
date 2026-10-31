<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import LangSwitch from './LangSwitch.vue'
import ThemeToggle from './ThemeToggle.vue'
import NotificationBell from './NotificationBell.vue'
import AccountMenu from './AccountMenu.vue'
import BrandMark from '@/components/brand/BrandMark.vue'
import Btn from '@/components/common/Btn.vue'
import { useAuth } from '@/stores/auth'
import { useDropdown } from '@/composables/useDropdown'

const { t } = useI18n()
const auth = useAuth()
const router = useRouter()
const query = ref('')

const moreRoot = ref<HTMLElement | null>(null)
const moreButton = ref<HTMLButtonElement | null>(null)
const moreOpen = useDropdown(moreRoot, moreButton)

function search() {
  const q = query.value.trim()
  void router.push(q ? { path: '/search', query: { q } } : '/search')
  query.value = ''
}

const navLink = 'inline-flex min-h-11 items-center border-b-2 border-transparent text-sm font-semibold text-[var(--c-muted)] transition-colors hover:text-[var(--c-text)]'
const navActive = '!border-[var(--c-accent)] !text-[var(--c-text)]'
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-[var(--c-border)] bg-[var(--c-bg)]">
    <div class="mx-auto flex h-14 max-w-[1280px] items-center gap-3 px-4 sm:gap-4 sm:px-6">
      <RouterLink to="/" data-test="brand" class="flex min-h-11 shrink-0 items-center gap-2" :aria-label="t('common.siteName')">
        <BrandMark class="size-7 shrink-0" />
        <span class="hidden text-base font-bold tracking-tight sm:inline" aria-hidden="true">CukaBasement</span>
      </RouterLink>
      <!-- Not a <form>: pages own the forms, and this one would be the first on every page. -->
      <div role="search" class="relative hidden max-w-[480px] flex-1 md:block">
        <svg viewBox="0 0 24 24" class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--c-muted)]" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input v-model="query" data-test="header-search" type="text" enterkeyhint="search" maxlength="100" :placeholder="t('search.placeholder')" :aria-label="t('nav.search')" class="field w-full border-transparent pl-9" @keydown.enter.prevent="search" />
      </div>
      <div data-test="header-actions" class="ml-auto flex min-w-0 items-center justify-end gap-1 sm:gap-2">
        <RouterLink to="/search" data-test="header-search-link" class="icon-btn md:hidden" :aria-label="t('nav.search')">
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </RouterLink>
        <slot name="right" />
        <template v-if="auth.isLoggedIn">
          <Btn to="/upload" data-test="header-upload" class="max-sm:w-11 max-sm:px-0" :aria-label="t('nav.upload')">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            <span data-test="upload-label" class="max-sm:sr-only">{{ t('nav.upload') }}</span>
          </Btn>
          <NotificationBell />
          <AccountMenu />
        </template>
        <template v-else>
          <div ref="moreRoot" class="relative">
            <button ref="moreButton" type="button" data-test="header-more" class="icon-btn" :aria-label="t('nav.more')" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">
              <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <div v-if="moreOpen" data-test="header-more-menu" class="menu absolute right-0 z-40 mt-1 w-60">
              <div class="px-3 py-2"><LangSwitch /></div>
              <ThemeToggle />
            </div>
          </div>
          <template v-if="auth.ready">
            <Btn to="/login" variant="ghost" data-test="header-login" class="max-sm:px-2.5">{{ t('auth.login') }}</Btn>
            <Btn to="/register" data-test="header-register" class="max-sm:px-3">{{ t('auth.register') }}</Btn>
          </template>
        </template>
      </div>
    </div>
    <nav data-test="main-nav" :aria-label="t('nav.main')" class="mx-auto flex max-w-[1280px] gap-6 px-4 sm:px-6">
      <RouterLink to="/" data-test="nav-home" :class="navLink" :exact-active-class="navActive">{{ t('nav.home') }}</RouterLink>
      <RouterLink to="/gioi-thieu" data-test="nav-intro" :class="navLink" :active-class="navActive">{{ t('nav.intro') }}</RouterLink>
    </nav>
  </header>
</template>

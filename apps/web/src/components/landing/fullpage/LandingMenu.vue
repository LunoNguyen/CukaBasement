<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import LangSwitch from '@/components/layout/LangSwitch.vue'
import ThemeToggle from '@/components/layout/ThemeToggle.vue'
import { useAuth } from '@/stores/auth'
import { useNotifications } from '@/stores/notifications'

/**
 * The landing page's full-screen menu (it has no header): site links, search, language, theme and the account
 * links. A modal dialog: focus moves in and stays in (Tab wraps), Esc or the close button closes it and focus
 * returns to the menu button, the page behind does not scroll. Always drawn in the dark palette.
 */
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ closed: [] }>()
const { t } = useI18n()
const auth = useAuth()
const notifications = useNotifications()
const router = useRouter()
const route = useRoute()
const panel = ref<HTMLElement | null>(null)
const closeBtn = ref<HTMLButtonElement | null>(null)
const query = ref('')

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function close() {
  if (!open.value) return
  open.value = false
}

watch(
  open,
  async (o) => {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('fp-menu-open', o)
    if (o) {
      // The unread count is polled only while the menu is open (the landing page has no bell).
      if (auth.isLoggedIn) notifications.start()
      await nextTick()
      closeBtn.value?.focus()
    } else {
      notifications.stop()
      emit('closed')
    }
  },
)
// A link inside was followed (or the page changed some other way): the menu goes away.
watch(
  () => route.fullPath,
  () => close(),
)
onBeforeUnmount(() => {
  if (open.value) notifications.stop()
  document.documentElement.classList.remove('fp-menu-open')
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
    return
  }
  if (e.key !== 'Tab' || !panel.value) return
  const items = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]'))
  if (!items.length) return
  const first = items[0]!
  const last = items[items.length - 1]!
  const at = document.activeElement
  if (e.shiftKey && (at === first || !panel.value.contains(at))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (at === last || !panel.value.contains(at))) {
    e.preventDefault()
    first.focus()
  }
}

function search() {
  const q = query.value.trim()
  query.value = ''
  void router.push(q ? { path: '/search', query: { q } } : '/search')
}

async function logout() {
  close()
  await auth.logout()
  await router.push('/')
}

const nav = [
  { to: '/', key: 'nav.home', n: '01' },
  { to: '/gioi-thieu', key: 'nav.intro', n: '02' },
  { to: '/posts', key: 'nav.posts', n: '03' },
  { to: '/upload', key: 'nav.upload', n: '04' },
] as const
const badge = () => (notifications.count > 99 ? '99+' : String(notifications.count))
</script>

<template>
  <Transition name="fp-menu">
    <div
      v-if="open"
      id="landing-menu"
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-label="t('landing.menu.title')"
      data-theme="dark"
      data-test="landing-menu"
      class="fp-menu fixed inset-0 z-50 overflow-y-auto bg-[#0f0b09] text-[#f3ebe6]"
      @keydown="onKeydown"
    >
      <div class="mx-auto flex min-h-full w-full max-w-screen-2xl flex-col px-5 pt-5 pb-8 sm:px-10 sm:pt-6">
        <div class="flex items-center justify-between gap-4">
          <span class="font-mono text-[11px] tracking-[0.2em] text-[#a89a90] uppercase">{{ t('landing.menu.title') }}</span>
          <button ref="closeBtn" type="button" class="fp-close flex size-12 items-center justify-center rounded-full border border-[#f3ebe6]/30 hover:border-[#f3ebe6]" :aria-label="t('landing.menu.close')" data-test="menu-close" @click="close">
            <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div class="grid flex-1 gap-12 py-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-center lg:py-16">
          <nav :aria-label="t('landing.menu.site')">
            <ul class="flex flex-col">
              <li v-for="(l, i) in nav" :key="l.to" class="fp-menu-item" :style="{ transitionDelay: `${80 + i * 60}ms` }">
                <RouterLink
                  :to="l.to"
                  class="group flex min-h-11 items-baseline gap-5 border-b border-[#3a2d26] py-3 sm:py-4"
                  :aria-current="route.path === l.to ? 'page' : undefined"
                  data-test="menu-link"
                  @click="close"
                >
                  <span class="w-8 font-mono text-xs tracking-[0.14em] text-[#a89a90] group-hover:text-[var(--c-cellar-accent)]" aria-hidden="true">{{ l.n }}</span>
                  <span class="font-display text-[clamp(2.25rem,6vw,5rem)] leading-none font-semibold tracking-[-0.035em] transition-transform duration-300 group-hover:translate-x-2 motion-reduce:transition-none" :class="route.path === l.to ? 'text-[var(--c-cellar-accent)]' : ''">{{ t(l.key) }}</span>
                </RouterLink>
              </li>
            </ul>
          </nav>

          <div class="flex flex-col gap-8">
            <div role="search" class="flex flex-col gap-2">
              <label for="menu-search" class="font-mono text-[11px] tracking-[0.2em] text-[#a89a90] uppercase">{{ t('nav.search') }}</label>
              <div class="relative">
                <input id="menu-search" v-model="query" type="text" enterkeyhint="search" maxlength="100" :placeholder="t('search.placeholder')" class="h-12 w-full rounded-full border border-[#3a2d26] bg-[#17110e] pr-14 pl-5 text-base text-[#f3ebe6] placeholder:text-[#a89a90] focus:border-[#f3ebe6] focus:outline-none" data-test="menu-search" @keydown.enter.prevent="search" />
                <button type="button" class="absolute top-0.5 right-0.5 flex size-11 items-center justify-center rounded-full hover:bg-[#231a15]" :aria-label="t('nav.search')" @click="search">
                  <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                </button>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-3">
              <LangSwitch />
              <ThemeToggle />
            </div>

            <div class="flex flex-col gap-1 border-t border-[#3a2d26] pt-6" data-test="menu-account">
              <template v-if="auth.user">
                <p class="mb-2 text-sm text-[#a89a90]">{{ t('landing.menu.signedInAs', { name: auth.user.profile.displayName }) }}</p>
                <RouterLink :to="'/u/' + auth.user.profile.username" class="inline-flex min-h-11 w-fit items-center text-lg font-semibold hover:text-[var(--c-cellar-accent)]" @click="close">{{ t('account.profile') }}</RouterLink>
                <RouterLink to="/notifications" class="inline-flex min-h-11 w-fit items-center gap-2 text-lg font-semibold hover:text-[var(--c-cellar-accent)]" data-test="menu-notifications" @click="close">
                  {{ t('landing.menu.notifications') }}
                  <span v-if="notifications.count > 0" class="rounded-full bg-[var(--c-cellar-accent)] px-2 text-xs leading-5 font-bold text-[#0f0b09]">{{ badge() }}</span>
                </RouterLink>
                <RouterLink to="/settings" class="inline-flex min-h-11 w-fit items-center text-lg font-semibold hover:text-[var(--c-cellar-accent)]" @click="close">{{ t('account.settings') }}</RouterLink>
                <RouterLink v-if="auth.isStaff" to="/mod" class="inline-flex min-h-11 w-fit items-center text-lg font-semibold hover:text-[var(--c-cellar-accent)]" @click="close">{{ t('account.mod') }}</RouterLink>
                <RouterLink v-if="auth.isAdmin" to="/admin" class="inline-flex min-h-11 w-fit items-center text-lg font-semibold hover:text-[var(--c-cellar-accent)]" data-test="menu-admin" @click="close">{{ t('account.admin') }}</RouterLink>
                <button type="button" class="inline-flex min-h-11 w-fit items-center text-lg font-semibold text-[#a89a90] hover:text-[#f3ebe6]" data-test="menu-logout" @click="logout">{{ t('account.logout') }}</button>
              </template>
              <div v-else-if="auth.ready" class="flex flex-wrap gap-3">
                <RouterLink to="/login" class="inline-flex min-h-12 items-center rounded-full border border-[#f3ebe6]/40 px-6 text-sm font-semibold hover:border-[#f3ebe6]" data-test="menu-login" @click="close">{{ t('auth.login') }}</RouterLink>
                <RouterLink to="/register" class="inline-flex min-h-12 items-center rounded-full bg-[#fbf7f4] px-6 text-sm font-semibold text-[#5b3a29] hover:bg-white" data-test="menu-register" @click="close">{{ t('auth.register') }}</RouterLink>
              </div>
            </div>
          </div>
        </div>

        <p class="font-mono text-[10px] tracking-[0.18em] text-[#a89a90] uppercase">{{ t('brand.footerNote') }}</p>
      </div>
    </div>
  </Transition>
</template>

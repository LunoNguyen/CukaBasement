<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BrandMark from '@/components/brand/BrandMark.vue'
import LandingMenu from './LandingMenu.vue'

/**
 * The landing page's only chrome, floating over the screens: the logo top left and the menu button top right.
 * Their colour follows the screen behind them (`tone`).
 */
withDefaults(defineProps<{ tone?: 'dark' | 'page' }>(), { tone: 'dark' })
const { t } = useI18n()
const open = ref(false)
const button = ref<HTMLButtonElement | null>(null)

async function restoreFocus() {
  await nextTick()
  button.value?.focus()
}
</script>

<template>
  <header data-test="landing-chrome" class="pointer-events-none fixed inset-x-0 top-0 z-40 transition-colors duration-500" :class="tone === 'dark' ? 'text-[#f3ebe6]' : 'text-[var(--c-text)]'">
    <div class="flex items-center justify-between gap-4 px-4 pt-4 sm:px-8 sm:pt-6">
      <RouterLink to="/" class="fp-logo pointer-events-auto flex min-h-11 items-center gap-2.5" :aria-label="t('common.siteName')" data-test="landing-logo">
        <BrandMark :on-dark="tone === 'dark'" class="size-9 shrink-0 sm:size-10" />
        <span class="font-display text-xl tracking-[-0.02em] sm:text-2xl" aria-hidden="true"><b class="font-bold">Cuka</b>Basement</span>
      </RouterLink>
      <button
        ref="button"
        type="button"
        class="fp-burger pointer-events-auto flex min-h-12 items-center gap-3 rounded-full py-1 pr-1 pl-4 transition-colors"
        :class="tone === 'dark' ? 'bg-[#0f0b09]/25 backdrop-blur-sm hover:bg-[#0f0b09]/45' : 'bg-[var(--c-surface)]/70 backdrop-blur-sm hover:bg-[var(--c-surface)]'"
        :aria-expanded="open"
        aria-controls="landing-menu"
        :aria-label="t('landing.menu.open')"
        data-test="menu-button"
        @click="open = true"
      >
        <span class="hidden font-mono text-[11px] tracking-[0.2em] uppercase sm:inline" aria-hidden="true">{{ t('landing.menu.label') }}</span>
        <span class="flex size-10 flex-col items-center justify-center gap-[5px] rounded-full border border-current/40" aria-hidden="true">
          <i class="block h-[1.5px] w-4 bg-current" /><i class="block h-[1.5px] w-4 bg-current" /><i class="block h-[1.5px] w-2.5 translate-x-[-3px] bg-current" />
        </span>
      </button>
    </div>
    <LandingMenu v-model:open="open" class="pointer-events-auto" @closed="restoreFocus" />
  </header>
</template>

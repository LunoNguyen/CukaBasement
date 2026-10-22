<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { type FooterData, SOCIAL_PLATFORM_LABELS } from '@cuka/shared'
import BrandMark from '@/components/brand/BrandMark.vue'
import { useLanding } from '../context'

/** The landing page's closing screen, always dark: logo, note, site links, e-mail, social links and copyright. */
defineProps<{ data: FooterData }>()
const emit = defineEmits<{ top: [] }>()
const { t } = useI18n()
const { tx } = useLanding()

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
const platformName = (p: keyof typeof SOCIAL_PLATFORM_LABELS, url: string) => SOCIAL_PLATFORM_LABELS[p] || host(url)
</script>

<template>
  <footer data-test="fp-footer" class="relative flex flex-1 flex-col justify-end bg-[#0b0806] text-[#f3ebe6]">
    <div class="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col justify-end gap-12 px-5 pt-24 pb-8 sm:px-10 sm:pb-10 md:pr-20 lg:pr-24">
      <p class="hidden font-display text-[clamp(3.2rem,13cqw,14rem)] sm:block leading-[0.82] font-semibold tracking-[-0.05em] text-[#f3ebe6]/[0.08] select-none" aria-hidden="true"><b class="font-bold">Cuka</b>Basement</p>
      <div class="grid gap-10 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div class="flex flex-col gap-5">
          <RouterLink to="/" class="flex w-fit items-center gap-3" :aria-label="t('common.siteName')">
            <BrandMark on-dark class="size-12 shrink-0" />
            <span class="font-display text-[clamp(1.75rem,3cqw,2.5rem)] tracking-[-0.02em]" aria-hidden="true"><b class="font-bold">Cuka</b>Basement</span>
          </RouterLink>
          <p v-if="tx(data.note)" class="max-w-md text-sm leading-relaxed text-[#a89a90]">{{ tx(data.note) }}</p>
        </div>
        <nav :aria-label="t('landing.fp.siteLinks')" class="flex flex-col gap-1">
          <p class="mb-2 font-mono text-[10px] tracking-[0.2em] text-[#a89a90] uppercase">{{ t('landing.fp.explore') }}</p>
          <RouterLink to="/gioi-thieu" class="inline-flex min-h-11 w-fit items-center font-display text-xl hover:text-[var(--c-cellar-accent)]" data-test="footer-intro">{{ t('nav.intro') }}</RouterLink>
          <RouterLink to="/posts" class="inline-flex min-h-11 w-fit items-center font-display text-xl hover:text-[var(--c-cellar-accent)]">{{ t('nav.posts') }}</RouterLink>
          <a v-if="data.email" :href="`mailto:${data.email}`" class="inline-flex min-h-11 w-fit items-center font-display text-xl hover:text-[var(--c-cellar-accent)]" data-test="footer-email">{{ t('landing.fp.contact') }}</a>
        </nav>
        <div v-if="data.links.length" class="flex flex-col gap-3">
          <p class="mb-1 font-mono text-[10px] tracking-[0.2em] text-[#a89a90] uppercase">{{ t('landing.fp.follow') }}</p>
          <ul class="flex flex-wrap gap-2">
            <li v-for="(l, i) in data.links" :key="i">
              <a :href="l.url" target="_blank" rel="noopener noreferrer" class="group inline-flex min-h-11 items-center gap-2 rounded-full border border-[#3a2d26] py-1 pr-4 pl-1 text-sm hover:border-[#f3ebe6]" data-test="footer-social">
                <span class="flex size-9 items-center justify-center rounded-full bg-[#231a15] font-display text-base font-semibold text-[var(--c-cellar-accent)] group-hover:bg-[var(--c-cellar-accent)] group-hover:text-[#0b0806]" aria-hidden="true">{{ platformName(l.platform, l.url).charAt(0) }}</span>
                <span><span class="sr-only">{{ platformName(l.platform, l.url) }}: </span>{{ tx(l.label) || platformName(l.platform, l.url) }}</span>
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-4 border-t border-[#3a2d26] pt-6 font-mono text-[11px] tracking-[0.1em] text-[#a89a90]">
        <p>{{ tx(data.copyright) || `© ${t('common.siteName')}` }}</p>
        <button type="button" class="inline-flex min-h-11 items-center gap-2 uppercase hover:text-[#f3ebe6]" data-test="footer-top" @click="emit('top')">
          {{ t('landing.fp.backToTop') }}
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" /></svg>
        </button>
      </div>
    </div>
  </footer>
</template>

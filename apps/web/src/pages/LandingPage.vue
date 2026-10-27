<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { pickText } from '@cuka/shared'
import { publicPage } from '@/api/endpoints/site'
import type { PublicHomeDto } from '@/api/types'
import BasementArt from '@/components/brand/BasementArt.vue'
import FullPage from '@/components/landing/fullpage/FullPage.vue'
import type { PanelTone } from '@/components/landing/fullpage/media'
import LandingChrome from '@/components/landing/fullpage/LandingChrome.vue'

/**
 * "/": the landing page admins build in Quản trị → Trang chủ, as full screens that snap one at a time. It has no
 * site header or footer: a floating logo and a menu button instead (see App.vue, route meta `immersive`).
 */
const { t, locale } = useI18n()
const home = ref<PublicHomeDto | null>(null)
const failed = ref(false)
const tone = ref<PanelTone>('dark')

onMounted(async () => {
  document.documentElement.classList.add('fp-snap')
  try {
    home.value = await publicPage('home')
  } catch {
    failed.value = true
  }
})
onBeforeUnmount(() => document.documentElement.classList.remove('fp-snap'))

// Title and description for the tab and for link previews that run scripts; restored when leaving.
const intro = computed(() => {
  for (const s of home.value?.sections ?? []) {
    if (s.type === 'heroVideo') return { title: s.data.name, text: s.data.subtitle }
    if (s.type === 'hero') return { title: s.data.title, text: s.data.subtitle }
  }
  return null
})
const previousTitle = typeof document !== 'undefined' ? document.title : ''
let descriptionTag: HTMLMetaElement | null = null
watch(
  [intro, locale],
  () => {
    if (!intro.value || typeof document === 'undefined') return
    const title = pickText(intro.value.title, locale.value)
    document.title = title ? `${title} · ${t('common.siteName')}` : t('common.siteName')
    descriptionTag ??= document.head.querySelector('meta[name="description"]') ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'description' }))
    descriptionTag.content = pickText(intro.value.text, locale.value)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.title = previousTitle
})
</script>

<template>
  <div data-test="landing">
    <LandingChrome :tone="tone" />
    <!-- Loading: the dark first screen, so nothing jumps when the content arrives. -->
    <div v-if="!home && !failed" class="h-[100svh] bg-[var(--c-cellar-deep)]" aria-busy="true">
      <span class="sr-only">{{ t('common.loading') }}</span>
    </div>
    <section v-else-if="failed" class="relative isolate flex min-h-[100svh] items-end overflow-hidden bg-[var(--c-cellar)] text-[var(--c-cellar-text)]">
      <BasementArt class="absolute inset-0 -z-10 h-full w-full opacity-60" />
      <div class="flex w-full flex-col gap-6 px-5 pt-28 pb-16 sm:px-10">
        <h1 class="font-display text-[clamp(3rem,9vw,7rem)] leading-[0.9] font-semibold tracking-[-0.04em]">{{ t('common.siteName') }}</h1>
        <p class="max-w-xl text-lg text-[var(--c-cellar-text)]/90">{{ t('brand.heroBody') }}</p>
        <RouterLink to="/posts" class="inline-flex min-h-12 w-fit items-center rounded-full bg-[#fbf7f4] px-6 text-sm font-semibold text-[#5b3a29] hover:bg-white">{{ t('landing.browsePosts') }}</RouterLink>
      </div>
    </section>
    <FullPage v-else-if="home" :sections="home.sections" :images="home.images" :videos="home.videos" :youtube="home.youtube" @active="(_, tn) => (tone = tn)" />
  </div>
</template>

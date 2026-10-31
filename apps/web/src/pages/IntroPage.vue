<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { type HeroData, pickText } from '@cuka/shared'
import { publicPage } from '@/api/endpoints/site'
import type { PublicHomeDto } from '@/api/types'
import HomeHero from '@/components/brand/HomeHero.vue'
import BasementArt from '@/components/brand/BasementArt.vue'
import LandingSections from '@/components/landing/LandingSections.vue'
import { useAuth } from '@/stores/auth'

/** "/gioi-thieu": the Introduction page admins build in Quản trị → Trang chủ, then the sign-up invitation for visitors. */
const { t, locale } = useI18n()
const auth = useAuth()
const page = ref<PublicHomeDto | null>(null)
const failed = ref(false)

onMounted(async () => {
  try {
    page.value = await publicPage('intro')
  } catch {
    failed.value = true
  }
})

// Title and description for the tab and for link previews that run scripts; restored when leaving.
const hero = computed(() => page.value?.sections.find((s) => s.type === 'hero')?.data as HeroData | undefined)
const previousTitle = typeof document !== 'undefined' ? document.title : ''
let descriptionTag: HTMLMetaElement | null = null
watch(
  [hero, locale],
  () => {
    if (typeof document === 'undefined') return
    const title = hero.value ? pickText(hero.value.title, locale.value) : ''
    document.title = `${t('nav.intro')}${title ? ` · ${title}` : ''} · ${t('common.siteName')}`
    if (!hero.value) return
    descriptionTag ??= document.head.querySelector('meta[name="description"]') ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'description' }))
    descriptionTag.content = pickText(hero.value.subtitle, locale.value)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.title = previousTitle
})
</script>

<template>
  <div data-test="intro">
    <!-- Loading: the dark hero band, so the page does not jump when the content arrives. -->
    <div v-if="!page && !failed" class="min-h-[28rem] bg-[#141414] md:min-h-[min(88svh,860px)]" aria-busy="true">
      <span class="sr-only">{{ t('common.loading') }}</span>
    </div>
    <section v-else-if="failed" class="relative isolate overflow-hidden bg-[#141414] text-[#ededed]">
      <BasementArt class="absolute inset-0 -z-10 h-full w-full opacity-60" />
      <div class="mx-auto flex min-h-[60svh] max-w-6xl flex-col justify-center gap-6 px-4 py-20 sm:px-6">
        <h1 class="font-display text-[clamp(3rem,9vw,6rem)] leading-[0.95] font-semibold tracking-[-0.04em]">{{ t('common.siteName') }}</h1>
        <p class="max-w-xl text-lg text-[#ededed]/90">{{ t('brand.heroBody') }}</p>
        <RouterLink to="/posts" class="inline-flex min-h-12 w-fit items-center rounded-full bg-[#fbf7f4] px-6 text-sm font-semibold text-[#5b3a29] hover:bg-white">{{ t('landing.browsePosts') }}</RouterLink>
      </div>
    </section>
    <LandingSections v-else-if="page" :sections="page.sections" :images="page.images" />

    <div v-if="auth.ready && !auth.isLoggedIn" class="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
      <HomeHero level="h2" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { type HeroData, type HeroVideoData, pickText } from '@cuka/shared'
import { publicPage } from '@/api/endpoints/site'
import type { PublicHomeDto } from '@/api/types'
import Btn from '@/components/common/Btn.vue'
import Spinner from '@/components/common/Spinner.vue'
import LandingSections from '@/components/landing/LandingSections.vue'
import { useAuth } from '@/stores/auth'

/** "/gioi-thieu": the Introduction page admins build in Quản trị → Trang chủ, one normal-scrolling page. */
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

/** The opening block's name and line, for the tab title and the description of link previews that run scripts. */
const opening = computed(() => {
  const s = page.value?.sections.find((x) => x.type === 'heroVideo' || x.type === 'hero')
  if (!s) return null
  if (s.type === 'heroVideo') return { title: (s.data as HeroVideoData).name, text: (s.data as HeroVideoData).subtitle }
  return { title: (s.data as HeroData).title, text: (s.data as HeroData).subtitle }
})
const previousTitle = typeof document !== 'undefined' ? document.title : ''
let descriptionTag: HTMLMetaElement | null = null
watch(
  [opening, locale],
  () => {
    if (typeof document === 'undefined') return
    const title = opening.value ? pickText(opening.value.title, locale.value) : ''
    document.title = `${t('nav.intro')}${title ? ` · ${title}` : ''} · ${t('common.siteName')}`
    if (!opening.value) return
    descriptionTag ??= document.head.querySelector('meta[name="description"]') ?? document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'description' }))
    descriptionTag.content = pickText(opening.value.text, locale.value)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.title = previousTitle
})
</script>

<template>
  <div data-test="intro">
    <div v-if="!page && !failed" class="flex min-h-[40vh] items-center justify-center" aria-busy="true"><Spinner /></div>
    <section v-else-if="failed" class="flex flex-col items-start gap-3 rounded-lg bg-[var(--c-surface-2)] p-6 sm:p-10">
      <h1 class="text-2xl font-bold">{{ t('common.siteName') }}</h1>
      <p class="max-w-xl text-sm text-[var(--c-muted)]">{{ t('brand.heroBody') }}</p>
      <Btn to="/">{{ t('landing.browsePosts') }}</Btn>
    </section>
    <LandingSections v-else-if="page" :sections="page.sections" :images="page.images" :videos="page.videos" :youtube="page.youtube" />

    <section v-if="auth.ready && !auth.isLoggedIn" data-test="intro-join" class="flex flex-col gap-3 border-t border-[var(--c-border)] pt-10 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-col gap-1">
        <h2 class="text-lg font-bold">{{ t('brand.heroTitle') }}</h2>
        <p class="max-w-xl text-[13px] text-[var(--c-muted)]">{{ t('brand.heroBody') }}</p>
      </div>
      <div class="flex shrink-0 gap-2">
        <Btn to="/login" variant="secondary">{{ t('auth.login') }}</Btn>
        <Btn to="/register">{{ t('auth.register') }}</Btn>
      </div>
    </section>
  </div>
</template>

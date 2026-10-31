<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FanartData } from '@cuka/shared'
import { fanartShowcase } from '@/api/endpoints/site'
import type { PostCardDto } from '@/api/types'
import PostCard from '@/components/post/PostCard.vue'
import Spinner from '@/components/common/Spinner.vue'
import LandingSection from './LandingSection.vue'
import { useLanding } from './context'
import { vReveal } from './reveal'

/** The newest approved all-ages posts (never R18 here, whoever is looking), with a link to the full list. */
const props = defineProps<{ data: FanartData; index: number; tone: 'cream' | 'soft' }>()
const { t } = useI18n()
const { tx } = useLanding()
const items = ref<PostCardDto[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')

async function load() {
  state.value = 'loading'
  try {
    items.value = (await fanartShowcase(props.data.count)).items
    state.value = 'ready'
  } catch {
    state.value = 'error'
  }
}
onMounted(load)
watch(() => props.data.count, load)
</script>

<template>
  <LandingSection data-test="landing-fanart" :tone="tone" :index="index" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)">
    <template #aside>
      <RouterLink to="/posts" data-test="fanart-all" class="group inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--c-accent-strong)] px-5 text-sm font-semibold text-[var(--c-accent-strong)] hover:bg-[var(--c-accent-strong)] hover:text-[var(--c-bg)]">
        {{ t('landing.seeAll') }}
        <svg viewBox="0 0 24 24" class="size-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </RouterLink>
    </template>
    <div v-if="state === 'loading'" class="flex justify-center py-16 text-[var(--c-muted)]"><Spinner /></div>
    <div v-else-if="!items.length" v-reveal class="flex flex-col items-start gap-4 rounded-[1.75rem] border border-dashed border-[var(--c-border)] p-8 sm:p-10">
      <p class="font-display text-2xl font-semibold">{{ t(state === 'error' ? 'landing.fanartError' : 'landing.fanartEmpty') }}</p>
      <RouterLink to="/upload" class="link">{{ t('landing.fanartShare') }}</RouterLink>
    </div>
    <div v-else class="columns-2 gap-4 md:columns-3 lg:columns-4"><PostCard v-for="p in items" :key="p.id" :post="p" /></div>
  </LandingSection>
</template>

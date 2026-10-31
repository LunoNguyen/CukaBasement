<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FanartData } from '@cuka/shared'
import { fanartShowcase } from '@/api/endpoints/site'
import type { PostCardDto } from '@/api/types'
import PostGrid from '@/components/post/PostGrid.vue'
import Spinner from '@/components/common/Spinner.vue'
import LandingSection from './LandingSection.vue'
import { useLanding } from './context'

/** The newest approved all-ages posts (never R18 here, whoever is looking), with a link to the full list. */
const props = defineProps<{ data: FanartData }>()
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
  <LandingSection data-test="landing-fanart" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)">
    <template #aside>
      <RouterLink to="/" data-test="fanart-all" class="inline-flex min-h-9 items-center gap-0.5 text-sm text-[var(--c-muted)] hover:text-[var(--c-text)]">
        {{ t('landing.seeAll') }}
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
      </RouterLink>
    </template>
    <div v-if="state === 'loading'" class="flex justify-center py-12 text-[var(--c-muted)]"><Spinner /></div>
    <div v-else-if="!items.length" class="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--c-muted)]">
      <p>{{ t(state === 'error' ? 'landing.fanartError' : 'landing.fanartEmpty') }}</p>
      <RouterLink to="/upload" class="link">{{ t('landing.fanartShare') }}</RouterLink>
    </div>
    <PostGrid v-else :items="items" />
  </LandingSection>
</template>

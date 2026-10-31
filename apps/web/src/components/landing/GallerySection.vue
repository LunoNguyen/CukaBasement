<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GalleryData } from '@cuka/shared'
import LandingSection from './LandingSection.vue'
import SiteImage from './SiteImage.vue'
import SmartLink from './SmartLink.vue'
import { useLanding } from './context'
import { vReveal } from './reveal'

defineProps<{ data: GalleryData; index: number; tone: 'cream' | 'soft' }>()
const { t } = useI18n()
const { tx } = useLanding()
const track = ref<HTMLElement | null>(null)

function scroll(dir: -1 | 1) {
  const el = track.value
  if (!el) return
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' })
}
</script>

<template>
  <LandingSection data-test="landing-gallery" :tone="tone" :index="index" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)" :wide="data.layout !== 'grid'">
    <template v-if="data.layout === 'carousel' && data.items.length > 1" #aside>
      <div class="flex gap-2">
        <button type="button" class="icon-btn border border-[var(--c-border)]" :aria-label="t('landing.prev')" @click="scroll(-1)">
          <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <button type="button" class="icon-btn border border-[var(--c-border)]" :aria-label="t('landing.next')" @click="scroll(1)">
          <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
    </template>

    <p v-if="!data.items.length" class="text-[var(--c-muted)]">{{ t('landing.galleryEmpty') }}</p>
    <div
      v-else
      ref="track"
      :data-layout="data.layout"
      :class="{
        'grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3': data.layout === 'grid',
        'columns-2 gap-3 sm:gap-4 md:columns-3 xl:columns-4': data.layout === 'masonry',
        '-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-4 [scrollbar-width:thin] sm:-mx-6 sm:scroll-px-6 sm:px-6': data.layout === 'carousel',
      }"
    >
      <figure
        v-for="(item, i) in data.items"
        :key="i"
        v-reveal
        data-test="gallery-item"
        class="group"
        :class="{
          'mb-3 break-inside-avoid sm:mb-4': data.layout === 'masonry',
          'w-[78%] shrink-0 snap-start sm:w-[46%] lg:w-[31%]': data.layout === 'carousel',
        }"
      >
        <component :is="item.href ? SmartLink : 'div'" v-bind="item.href ? { href: item.href } : {}" class="block overflow-hidden rounded-2xl bg-[var(--c-surface-2)]">
          <SiteImage
            :image="item.image"
            :sizes="data.layout === 'carousel' ? '(min-width: 1024px) 31vw, (min-width: 640px) 46vw, 78vw' : '(min-width: 768px) 33vw, 50vw'"
            :img-class="[
              'w-full transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none',
              data.layout === 'masonry' ? 'h-auto' : 'aspect-[4/5] object-cover',
            ].join(' ')"
          >
            <template #fallback><div class="aspect-[4/5] w-full bg-[var(--c-surface-2)]" aria-hidden="true" /></template>
          </SiteImage>
        </component>
        <figcaption v-if="tx(item.caption)" class="mt-2 text-sm text-[var(--c-muted)]">{{ tx(item.caption) }}</figcaption>
      </figure>
    </div>
  </LandingSection>
</template>

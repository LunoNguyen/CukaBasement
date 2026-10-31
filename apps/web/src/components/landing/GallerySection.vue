<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GalleryData } from '@cuka/shared'
import LandingSection from './LandingSection.vue'
import SiteImage from './SiteImage.vue'
import SmartLink from './SmartLink.vue'
import { useLanding } from './context'

defineProps<{ data: GalleryData }>()
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
  <LandingSection data-test="landing-gallery" :eyebrow="tx(data.eyebrow)" :heading="tx(data.heading)">
    <template v-if="data.layout === 'carousel' && data.items.length > 1" #aside>
      <div class="flex gap-2">
        <button type="button" class="icon-btn border border-[var(--c-border)]" :aria-label="t('landing.prev')" @click="scroll(-1)">
          <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <button type="button" class="icon-btn border border-[var(--c-border)]" :aria-label="t('landing.next')" @click="scroll(1)">
          <svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </div>
    </template>

    <p v-if="!data.items.length" class="text-sm text-[var(--c-muted)]">{{ t('landing.galleryEmpty') }}</p>
    <div
      v-else
      ref="track"
      :data-layout="data.layout"
      :class="{
        'grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4': data.layout === 'grid',
        'columns-2 gap-2 sm:columns-3 sm:gap-4 lg:columns-4': data.layout === 'masonry',
        'flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]': data.layout === 'carousel',
      }"
    >
      <figure
        v-for="(item, i) in data.items"
        :key="i"
        data-test="gallery-item"
        class="group"
        :class="{
          'mb-2 break-inside-avoid sm:mb-4': data.layout === 'masonry',
          'w-[70%] shrink-0 snap-start sm:w-[40%] lg:w-[24%]': data.layout === 'carousel',
        }"
      >
        <component :is="item.href ? SmartLink : 'div'" v-bind="item.href ? { href: item.href } : {}" class="block overflow-hidden rounded-lg bg-[var(--c-surface-2)]">
          <SiteImage
            :image="item.image"
            :sizes="data.layout === 'carousel' ? '(min-width: 1024px) 31vw, (min-width: 640px) 46vw, 78vw' : '(min-width: 768px) 33vw, 50vw'"
            :img-class="[
              'w-full transition-opacity group-hover:opacity-90',
              data.layout === 'masonry' ? 'h-auto' : 'aspect-square object-cover',
            ].join(' ')"
          >
            <template #fallback><div class="aspect-square w-full bg-[var(--c-surface-2)]" aria-hidden="true" /></template>
          </SiteImage>
        </component>
        <figcaption v-if="tx(item.caption)" class="mt-1.5 text-xs text-[var(--c-muted)]">{{ tx(item.caption) }}</figcaption>
      </figure>
    </div>
  </LandingSection>
</template>

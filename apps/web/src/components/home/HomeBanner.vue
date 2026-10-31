<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { isExternalHref, pickText } from '@cuka/shared'
import type { HomeBannerDto } from '@/api/types'

/**
 * The small band about Du Ca atop the gallery: cover picture (if any) with the name, one line and a link. Without a
 * picture it is plain text on the grey surface.
 */
const props = defineProps<{ banner: HomeBannerDto }>()
const { t, locale } = useI18n()
const tx = (v: { vi: string; en: string }) => pickText(v, locale.value)
const external = computed(() => isExternalHref(props.banner.link.href))
const img = computed(() => props.banner.image)
</script>

<template>
  <section
    data-test="home-banner"
    class="relative flex h-[120px] items-center overflow-hidden rounded-lg sm:h-40"
    :class="img ? 'bg-[#1f1f1f] text-white' : 'bg-[var(--c-surface-2)]'"
  >
    <template v-if="img">
      <img
        :src="img.src"
        :srcset="img.srcset"
        sizes="(min-width: 1280px) 1232px, 100vw"
        :alt="img.decorative ? '' : tx(img.alt)"
        class="absolute inset-0 h-full w-full object-cover"
      />
      <!-- Keeps the text legible on any picture. -->
      <div class="absolute inset-0 bg-linear-to-r from-black/70 via-black/40 to-transparent" aria-hidden="true" />
    </template>
    <div class="relative flex max-w-xl min-w-0 flex-col gap-1 px-5 sm:px-8">
      <h1 class="truncate text-xl font-bold sm:text-2xl">{{ tx(banner.title) }}</h1>
      <p v-if="tx(banner.text)" class="line-clamp-2 text-[13px] sm:line-clamp-1 sm:text-sm" :class="img ? 'text-white/85' : 'text-[var(--c-muted)]'">{{ tx(banner.text) }}</p>
      <component
        :is="external ? 'a' : 'RouterLink'"
        v-bind="external ? { href: banner.link.href, target: '_blank', rel: 'noopener noreferrer' } : { to: banner.link.href }"
        class="mt-1 inline-flex min-h-8 w-fit items-center gap-1 text-sm font-semibold hover:underline"
        :class="img ? 'text-white' : 'text-[var(--c-accent-strong)]'"
      >
        {{ tx(banner.link.label) }}
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        <span v-if="external" class="sr-only">{{ t('landing.fp.newTab') }}</span>
      </component>
    </div>
  </section>
</template>

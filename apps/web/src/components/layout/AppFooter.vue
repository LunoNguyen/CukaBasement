<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BrandMark from '@/components/brand/BrandMark.vue'
import Tagline from '@/components/brand/Tagline.vue'

const { t } = useI18n()
</script>

<template>
  <footer data-test="footer" class="mt-12 bg-[var(--c-cellar)] text-[var(--c-cellar-text)]">
    <div class="mx-auto flex max-w-screen-2xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-end sm:justify-between">
      <Tagline size="sm" />
      <div class="flex flex-col gap-2 sm:items-end">
        <RouterLink to="/" class="flex items-center gap-2" :aria-label="t('common.siteName')">
          <BrandMark class="size-7 shrink-0" on-dark />
          <span class="wordmark text-lg text-[var(--c-cellar-text)]" aria-hidden="true"><b>Cuka</b>Basement</span>
        </RouterLink>
        <p class="font-mono text-[11px] tracking-[0.08em] text-[var(--c-cellar-muted)] uppercase">{{ t('brand.footerNote') }}</p>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BasementArt from './BasementArt.vue'
import Tagline from './Tagline.vue'

const { t } = useI18n()
</script>

<!-- Logged-out welcome on the home page: the tagline (board 04) next to the basement art (board 08). -->
<template>
  <section data-test="home-hero" class="grid overflow-hidden rounded-2xl bg-[var(--c-cellar)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div class="order-2 flex flex-col gap-5 p-6 sm:p-8 md:order-1 md:py-10">
      <p class="font-mono text-xs tracking-[0.08em] text-[var(--c-cellar-muted)] uppercase">{{ t('common.siteName') }}</p>
      <Tagline tag="h1" />
      <p class="max-w-md text-sm leading-relaxed text-[var(--c-cellar-text)]/85">{{ t('brand.heroBody') }}</p>
      <div class="flex flex-wrap gap-3">
        <RouterLink to="/register" data-test="hero-register" class="inline-flex min-h-11 items-center rounded-full bg-[#fbf7f4] px-5 text-sm font-semibold text-[#5b3a29] hover:bg-white">{{
          t('auth.register')
        }}</RouterLink>
        <RouterLink to="/login" class="inline-flex min-h-11 items-center rounded-full border border-[var(--c-cellar-line)] px-5 text-sm font-semibold text-[var(--c-cellar-text)] hover:border-[var(--c-cellar-muted)]">{{
          t('auth.login')
        }}</RouterLink>
      </div>
    </div>
    <BasementArt class="order-1 h-44 w-full sm:h-56 md:order-2 md:h-full md:min-h-80" />
  </section>
</template>

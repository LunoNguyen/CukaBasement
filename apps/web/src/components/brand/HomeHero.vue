<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BasementArt from './BasementArt.vue'

/** `h2` where the page already has its own h1 (the landing page). */
withDefaults(defineProps<{ level?: 'h1' | 'h2' }>(), { level: 'h1' })
const { t } = useI18n()
</script>

<!-- Logged-out welcome on the home page, next to the basement art (board 08). -->
<template>
  <section data-test="home-hero" class="grid overflow-hidden rounded-2xl bg-[#141414] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div class="order-2 flex flex-col gap-5 p-6 sm:p-8 md:order-1 md:py-10">
      <p class="text-xs text-[#a3a3a3]">{{ t('common.siteName') }}</p>
      <component :is="level" class="font-display text-4xl leading-[1.05] font-semibold tracking-[-0.025em] text-[#ededed] sm:text-5xl">{{ t('brand.heroTitle') }}</component>
      <p class="max-w-md text-sm leading-relaxed text-[#ededed]/85">{{ t('brand.heroBody') }}</p>
      <div class="flex flex-wrap gap-3">
        <RouterLink to="/register" data-test="hero-register" class="inline-flex min-h-11 items-center rounded-full bg-[#fbf7f4] px-5 text-sm font-semibold text-[#5b3a29] hover:bg-white">{{
          t('auth.register')
        }}</RouterLink>
        <RouterLink to="/login" class="inline-flex min-h-11 items-center rounded-full border border-[#2e2e2e] px-5 text-sm font-semibold text-[#ededed] hover:border-[#a3a3a3]">{{
          t('auth.login')
        }}</RouterLink>
      </div>
    </div>
    <BasementArt class="order-1 h-44 w-full sm:h-56 md:order-2 md:h-full md:min-h-80" />
  </section>
</template>

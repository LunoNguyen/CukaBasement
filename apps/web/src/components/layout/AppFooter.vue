<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <footer data-test="footer" class="mt-16 border-t border-[var(--c-border)]">
    <p class="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-2 gap-y-1 px-4 py-6 text-xs text-[var(--c-muted)] sm:px-6">
      <span>© CukaBasement</span>
      <span aria-hidden="true">·</span>
      <span>{{ t('brand.footerNote') }}</span>
      <span aria-hidden="true">·</span>
      <RouterLink to="/gioi-thieu" class="hover:text-[var(--c-text)] hover:underline">{{ t('nav.intro') }}</RouterLink>
    </p>
  </footer>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="py-12 text-center text-sm text-[var(--c-muted)]">
    <slot>{{ t('common.empty') }}</slot>
  </div>
</template>

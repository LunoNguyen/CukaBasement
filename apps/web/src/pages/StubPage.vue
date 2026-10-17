<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import EmptyState from '@/components/common/EmptyState.vue'

const { t } = useI18n()
</script>

<template>
  <EmptyState>{{ t('common.underConstruction') }}</EmptyState>
</template>

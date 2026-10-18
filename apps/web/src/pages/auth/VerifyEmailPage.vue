<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import * as authApi from '@/api/endpoints/auth'
import { useAuth } from '@/stores/auth'
import Spinner from '@/components/common/Spinner.vue'
import AuthCard from './AuthCard.vue'
import { useErrorText } from '@/composables/useErrorText'

const { t } = useI18n()
const route = useRoute()
const auth = useAuth()
const errorText = useErrorText()

const state = ref<'loading' | 'ok' | 'error'>('loading')
const error = ref('')

onMounted(async () => {
  const token = route.query.token
  if (typeof token !== 'string' || !token) {
    error.value = t('errors.TOKEN_INVALID')
    state.value = 'error'
    return
  }
  try {
    await authApi.verifyEmail(token)
    // On a cold start the session may still be loading; mark it verified once it is.
    await auth.whenReady()
    if (auth.user) auth.setUser({ ...auth.user, emailVerified: true })
    state.value = 'ok'
  } catch (e) {
    error.value = errorText(e)
    state.value = 'error'
  }
})
</script>

<template>
  <AuthCard :title="t('auth.verifyTitle')">
    <p v-if="state === 'loading'" class="flex items-center gap-2 text-sm"><Spinner /> {{ t('auth.verifying') }}</p>
    <p v-else-if="state === 'ok'" data-test="verify-success" class="text-sm">{{ t('auth.verifySuccess') }}</p>
    <p v-else role="alert" class="text-sm text-[var(--c-danger)]">{{ error }}</p>
    <RouterLink v-if="state !== 'loading'" to="/" class="link mt-3 inline-block text-sm">{{ t('notFound.back') }}</RouterLink>
  </AuthCard>
</template>

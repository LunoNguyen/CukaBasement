<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as authApi from '@/api/endpoints/auth'
import { ApiError } from '@/api/client'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'

const { t } = useI18n()
const auth = useAuth()
const toast = useToast()
const busy = ref(false)

async function resend() {
  if (busy.value) return
  busy.value = true
  try {
    await authApi.resendVerification()
    toast.push({ kind: 'success', text: t('auth.resent') })
  } catch (e) {
    toast.push({ kind: 'error', text: t('errors.' + (e instanceof ApiError ? e.code : 'INTERNAL')) })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="auth.isLoggedIn && !auth.user!.emailVerified" role="status" class="border-b border-[var(--c-border)] bg-[var(--c-surface)] px-3 py-2 text-sm">
    <div class="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-2">
      <span>{{ t('auth.unverifiedBanner') }}</span>
      <button type="button" data-test="resend-verification" class="font-semibold text-[var(--c-accent)] disabled:opacity-60" :disabled="busy" @click="resend">
        {{ t('auth.resend') }}
      </button>
    </div>
  </div>
</template>

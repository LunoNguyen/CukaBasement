<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as authApi from '@/api/endpoints/auth'
import Btn from '@/components/common/Btn.vue'
import AuthCard from './AuthCard.vue'

const { t } = useI18n()
const email = ref('')
const busy = ref(false)
const sent = ref(false)

async function submit() {
  if (busy.value) return
  busy.value = true
  try {
    await authApi.forgotPassword(email.value.trim())
  } catch {
    /* the answer is the same either way, so the form cannot reveal which emails exist */
  } finally {
    busy.value = false
    sent.value = true
  }
}
</script>

<template>
  <AuthCard :title="t('auth.forgotTitle')">
    <p v-if="sent" data-test="forgot-success" class="text-sm">{{ t('auth.forgotSuccess') }}</p>
    <form v-else class="flex flex-col gap-3" @submit.prevent="submit">
      <label class="flex flex-col gap-1 text-sm">
        {{ t('auth.email') }}
        <input v-model="email" type="email" required autocomplete="email" class="rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1.5" />
      </label>
      <Btn type="submit" :loading="busy">{{ t('auth.forgotSend') }}</Btn>
    </form>
  </AuthCard>
</template>

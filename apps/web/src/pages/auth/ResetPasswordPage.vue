<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { LIMITS } from '@cuka/shared'
import * as authApi from '@/api/endpoints/auth'
import Btn from '@/components/common/Btn.vue'
import AuthCard from './AuthCard.vue'
import { useErrorText } from './errorText'

const { t } = useI18n()
const route = useRoute()
const errorText = useErrorText()

const form = reactive({ password: '', confirm: '' })
const errors = reactive({ password: '', confirm: '', server: '' })
const busy = ref(false)
const done = ref(false)
const token = typeof route.query.token === 'string' ? route.query.token : ''

async function submit() {
  if (busy.value) return
  errors.server = ''
  errors.password = form.password.length >= LIMITS.passwordMin ? '' : t('auth.passwordTooShort', { min: LIMITS.passwordMin })
  errors.confirm = form.confirm === form.password ? '' : t('auth.passwordMismatch')
  if (errors.password || errors.confirm) return
  busy.value = true
  try {
    await authApi.resetPassword(token, form.password)
    done.value = true
  } catch (e) {
    errors.server = errorText(e)
  } finally {
    busy.value = false
  }
}

const input = 'rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1.5'
</script>

<template>
  <AuthCard :title="t('auth.resetTitle')">
    <p v-if="!token" role="alert" class="text-sm text-red-600">{{ t('errors.TOKEN_INVALID') }}</p>
    <div v-else-if="done" data-test="reset-success" class="text-sm">
      <p>{{ t('auth.resetSuccess') }}</p>
      <RouterLink to="/login" class="mt-3 inline-block text-[var(--c-accent)]">{{ t('auth.login') }}</RouterLink>
    </div>
    <form v-else class="flex flex-col gap-3" novalidate @submit.prevent="submit">
      <label class="flex flex-col gap-1 text-sm">
        {{ t('auth.newPassword') }}
        <input v-model="form.password" data-test="password" type="password" autocomplete="new-password" :class="input" />
        <span v-if="errors.password" class="text-red-600">{{ errors.password }}</span>
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('auth.confirmPassword') }}
        <input v-model="form.confirm" data-test="confirm" type="password" autocomplete="new-password" :class="input" />
        <span v-if="errors.confirm" class="text-red-600">{{ errors.confirm }}</span>
      </label>
      <p v-if="errors.server" role="alert" class="text-sm text-red-600">{{ errors.server }}</p>
      <Btn type="submit" :loading="busy">{{ t('auth.resetSubmit') }}</Btn>
    </form>
  </AuthCard>
</template>

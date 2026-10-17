<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LIMITS } from '@cuka/shared'
import { ApiError } from '@/api/client'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import Btn from '@/components/common/Btn.vue'
import AuthCard from './AuthCard.vue'

const { t } = useI18n()
const auth = useAuth()
const toast = useToast()

// Same pattern as `registerSchema` in @cuka/shared.
const USERNAME_RE = /^[a-z0-9_]{3,24}$/

const form = reactive({ email: '', username: '', displayName: '', password: '', confirm: '' })
const errors = reactive({ email: '', username: '', displayName: '', password: '', confirm: '' })
const busy = ref(false)
const done = ref(false)
const usernameValid = computed(() => USERNAME_RE.test(form.username))

function validate(): boolean {
  errors.email = form.email.trim() ? '' : t('auth.required')
  errors.username = usernameValid.value ? '' : t('auth.usernameInvalid')
  errors.displayName = form.displayName.trim() ? '' : t('auth.required')
  errors.password = form.password.length >= LIMITS.passwordMin ? '' : t('auth.passwordTooShort', { min: LIMITS.passwordMin })
  errors.confirm = form.confirm === form.password ? '' : t('auth.passwordMismatch')
  return !Object.values(errors).some(Boolean)
}

async function submit() {
  if (busy.value || !validate()) return
  busy.value = true
  try {
    await auth.register({
      email: form.email.trim(),
      username: form.username,
      displayName: form.displayName.trim(),
      password: form.password,
    })
    done.value = true
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'INTERNAL'
    if (code === 'EMAIL_TAKEN') errors.email = t('errors.EMAIL_TAKEN')
    else if (code === 'USERNAME_TAKEN') errors.username = t('errors.USERNAME_TAKEN')
    else toast.push({ kind: 'error', text: t('errors.' + code) })
  } finally {
    busy.value = false
  }
}

const input = 'rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1.5'
</script>

<template>
  <AuthCard v-if="done" :title="t('auth.checkEmailTitle')">
    <p class="text-sm">{{ t('auth.checkEmailBody') }}</p>
    <p class="mt-2 text-xs text-[var(--c-muted)]">{{ t('auth.devNote') }}</p>
  </AuthCard>
  <AuthCard v-else :title="t('auth.register')">
    <form class="flex flex-col gap-3" novalidate @submit.prevent="submit">
      <label class="flex flex-col gap-1 text-sm">
        {{ t('auth.email') }}
        <input v-model="form.email" data-test="email" type="email" autocomplete="email" :class="input" />
        <span v-if="errors.email" data-test="email-error" class="text-red-600">{{ errors.email }}</span>
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('auth.username') }}
        <input v-model="form.username" data-test="username" autocomplete="username" :class="input" />
        <span
          data-test="username-hint"
          :data-valid="usernameValid"
          class="text-xs"
          :class="!form.username || usernameValid ? 'text-[var(--c-muted)]' : 'text-red-600'"
        >
          {{ t('auth.usernameHint') }}
        </span>
        <span v-if="errors.username" data-test="username-error" class="text-red-600">{{ errors.username }}</span>
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('auth.displayName') }}
        <input v-model="form.displayName" data-test="displayName" :class="input" />
        <span v-if="errors.displayName" class="text-red-600">{{ errors.displayName }}</span>
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('auth.password') }}
        <input v-model="form.password" data-test="password" type="password" autocomplete="new-password" :class="input" />
        <span v-if="errors.password" class="text-red-600">{{ errors.password }}</span>
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('auth.confirmPassword') }}
        <input v-model="form.confirm" data-test="confirm" type="password" autocomplete="new-password" :class="input" />
        <span v-if="errors.confirm" class="text-red-600">{{ errors.confirm }}</span>
      </label>
      <Btn type="submit" :loading="busy">{{ t('auth.register') }}</Btn>
      <p class="text-sm text-[var(--c-muted)]">
        {{ t('auth.haveAccount') }} <RouterLink to="/login" class="text-[var(--c-accent)]">{{ t('auth.login') }}</RouterLink>
      </p>
    </form>
  </AuthCard>
</template>

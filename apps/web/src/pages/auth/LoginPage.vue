<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import { i18n, setLocale } from '@/i18n'
import Btn from '@/components/common/Btn.vue'
import AuthCard from './AuthCard.vue'
import { useErrorText } from '@/composables/useErrorText'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuth()
const errorText = useErrorText()

const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

/** Only same-site paths; `//host`, absolute URLs and any backslash (`/\\host`) would be open redirects. */
function nextPath(): string {
  const n = route.query.next
  return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') ? n : '/'
}

async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await auth.login(email.value, password.value)
    const locale = auth.user!.locale
    if (locale !== i18n.global.locale.value) setLocale(locale)
    await router.push(nextPath())
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthCard :title="t('auth.login')">
    <form class="flex flex-col gap-3" @submit.prevent="submit">
      <label class="flex flex-col gap-1 text-sm">
        {{ t('auth.email') }}
        <input v-model="email" type="email" required autocomplete="email" class="field" />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('auth.password') }}
        <input v-model="password" type="password" required autocomplete="current-password" class="field" />
      </label>
      <p v-if="error" role="alert" class="text-sm text-[var(--c-danger)]">{{ error }}</p>
      <Btn type="submit" :loading="busy">{{ t('auth.login') }}</Btn>
      <RouterLink to="/forgot-password" class="text-sm text-[var(--c-muted)]">{{ t('auth.forgotLink') }}</RouterLink>
      <p class="text-sm text-[var(--c-muted)]">
        {{ t('auth.noAccount') }} <RouterLink to="/register" class="text-[var(--c-accent)]">{{ t('auth.register') }}</RouterLink>
      </p>
    </form>
  </AuthCard>
</template>

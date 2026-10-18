<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { LIMITS } from '@cuka/shared'
import { ApiError } from '@/api/client'
import { changePassword, getMe, updateProfile, updateSettings, type UpdateProfileInput, type UpdateSettingsInput } from '@/api/endpoints/me'
import type { SocialLinks } from '@/api/types'
import type { Locale } from '@/i18n'
import { useChangeLocale } from '@/composables/useChangeLocale'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import Btn from '@/components/common/Btn.vue'
import ImageField from '@/components/user/ImageField.vue'
import { useErrorText } from '@/composables/useErrorText'

const { t, locale } = useI18n()
const auth = useAuth()
const toast = useToast()
const router = useRouter()
const errorText = useErrorText()

const me = auth.user!

const LINKS = [
  { key: 'x', label: 'X' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'pixiv', label: 'pixiv' },
] as const

/** Signals `run` that the failure was already reported. */
class Relogin extends Error {}

type Section = 'profile' | 'password' | 'locale' | 'r18'
const busy = ref<Record<Section, boolean>>({ profile: false, password: false, locale: false, r18: false })

/** Runs one section's save: busy flag, success/failure toast, and `overrides` for codes with a specific message. */
async function run(section: Section, fn: () => Promise<void>, overrides: Partial<Record<string, string>> = {}) {
  if (busy.value[section]) return
  busy.value[section] = true
  try {
    await fn()
    toast.push({ kind: 'success', text: t('settings.saved') })
  } catch (e) {
    if (e instanceof Relogin) return
    const key = e instanceof ApiError ? overrides[e.code] : undefined
    toast.push({ kind: 'error', text: key ? t(key) : errorText(e) })
  } finally {
    busy.value[section] = false
  }
}

// --- profile
const displayName = ref(me.profile.displayName)
const bio = ref(me.profile.bio)
const links = ref<SocialLinks>({ ...me.profile.socialLinks })

function validLink(v: string): boolean {
  if (v === '') return true
  try {
    return ['http:', 'https:'].includes(new URL(v).protocol)
  } catch {
    return false
  }
}
const linkErrors = computed(() => Object.fromEntries(LINKS.map((l) => [l.key, !validLink(links.value[l.key].trim())])))
const profileValid = computed(
  () => displayName.value.trim().length > 0 && bio.value.length <= LIMITS.bioMax && !Object.values(linkErrors.value).some(Boolean),
)

function saveProfile() {
  if (!profileValid.value) return
  const body: UpdateProfileInput = {
    displayName: displayName.value.trim(),
    bio: bio.value,
    socialLinks: Object.fromEntries(LINKS.map((l) => [l.key, links.value[l.key].trim()])),
  }
  return run('profile', async () => auth.setUser(await updateProfile(body)))
}

// --- avatar/banner: the public URL appears only once the worker has published the new image, so /me is polled
const POLL_MS = 3000
const POLL_TRIES = 10
const pollTimers: Partial<Record<'avatarUrl' | 'bannerUrl', ReturnType<typeof setTimeout>>> = {}
let unmounted = false
onBeforeUnmount(() => {
  unmounted = true
  for (const id of Object.values(pollTimers)) clearTimeout(id)
})

/** Re-reads /me every POLL_MS (at most POLL_TRIES times) until `key` holds a URL; the header follows the store. */
function pollUntilPublished(key: 'avatarUrl' | 'bannerUrl', tries = POLL_TRIES) {
  clearTimeout(pollTimers[key])
  delete pollTimers[key]
  if (unmounted || tries <= 0 || auth.user?.[key]) return
  pollTimers[key] = setTimeout(async () => {
    delete pollTimers[key]
    try {
      const u = await getMe()
      if (unmounted || !auth.user) return
      auth.setUser(u)
      if (u[key]) return
    } catch {
      /* try again on the next tick */
    }
    pollUntilPublished(key, tries - 1)
  }, POLL_MS)
}

/** Avatar/banner: failures are toasted here and rethrown so the image field drops its preview. */
async function saveImage(body: UpdateProfileInput) {
  try {
    auth.setUser(await updateProfile(body))
    pollUntilPublished(body.avatarFileId ? 'avatarUrl' : 'bannerUrl')
    toast.push({ kind: 'success', text: t('settings.saved') })
  } catch (e) {
    toast.push({ kind: 'error', text: e instanceof ApiError && e.code === 'FILE_NOT_READY' ? t('settings.imageInUse') : errorText(e) })
    throw e
  }
}

// --- password
const currentPassword = ref('')
const newPassword = ref('')
const passwordValid = computed(() => currentPassword.value.length > 0 && newPassword.value.length >= LIMITS.passwordMin)

function savePassword() {
  if (!passwordValid.value) return
  return run('password', async () => {
    const next = newPassword.value
    await changePassword({ currentPassword: currentPassword.value, newPassword: next })
    currentPassword.value = ''
    newPassword.value = ''
    // The change revokes every refresh token, this browser's included: sign in again for a fresh session.
    try {
      await auth.login(me.email, next)
    } catch {
      auth.clear()
      toast.push({ kind: 'error', text: t('settings.reloginNeeded') })
      void router.replace({ path: '/login', query: { next: '/settings' } })
      throw new Relogin()
    }
  })
}

// --- locale: the radios follow the live UI locale and move only after a successful save
const changeLocale = useChangeLocale()
/** Bumped on a failed save so the radios re-render from the live locale. */
const localeRev = ref(0)

async function pickLocale(l: Locale) {
  busy.value.locale = true
  try {
    if (!(await changeLocale(l))) localeRev.value++
  } finally {
    busy.value.locale = false
  }
}

// --- R18
const birthDate = ref(me.birthDate ?? '')
const showR18 = ref(me.showR18)

function saveR18() {
  const body: UpdateSettingsInput = { showR18: showR18.value }
  if (birthDate.value) body.birthDate = birthDate.value
  return run(
    'r18',
    async () => {
      const u = await updateSettings(body)
      auth.setUser(u)
      showR18.value = u.showR18
      birthDate.value = u.birthDate ?? ''
    },
    { AGE_REQUIRED: 'settings.ageRequired' },
  )
}

// --- current images (from the session): the initial preview of the image fields
const avatarUrl = computed(() => auth.user?.avatarUrl ?? null)
const bannerUrl = computed(() => auth.user?.bannerUrl ?? null)

const field = 'rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1.5'
const section = 'flex flex-col gap-3 rounded border border-[var(--c-border)] bg-[var(--c-surface)] p-4'
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4">
    <h1 class="text-xl font-bold">{{ t('settings.title') }}</h1>

    <form :class="section" data-test="profile-form" @submit.prevent="saveProfile">
      <h2 class="font-semibold">{{ t('settings.profile') }}</h2>
      <ImageField :label="t('settings.avatar')" test-id="avatar" shape="avatar" :current-url="avatarUrl" :save="(id) => saveImage({ avatarFileId: id })" />
      <ImageField :label="t('settings.banner')" test-id="banner" shape="banner" :current-url="bannerUrl" :save="(id) => saveImage({ bannerFileId: id })" />
      <label class="flex flex-col gap-1 text-sm">
        {{ t('settings.displayName') }}
        <input v-model="displayName" data-test="display-name" required :maxlength="LIMITS.displayNameMax" :class="field" />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('settings.bio') }}
        <textarea v-model="bio" data-test="bio" rows="4" :maxlength="LIMITS.bioMax" :class="field" />
        <span data-test="bio-count" class="self-end text-xs text-[var(--c-muted)]">{{ bio.length }}/{{ LIMITS.bioMax }}</span>
      </label>
      <label v-for="l in LINKS" :key="l.key" class="flex flex-col gap-1 text-sm">
        {{ l.label }}
        <input v-model="links[l.key]" :data-test="'link-' + l.key" type="text" inputmode="url" placeholder="https://" :class="field" :aria-invalid="linkErrors[l.key]" />
        <span v-if="linkErrors[l.key]" role="alert" class="text-xs text-red-600">{{ t('settings.linkInvalid') }}</span>
      </label>
      <Btn type="submit" data-test="save-profile" :loading="busy.profile" :disabled="!profileValid">{{ t('settings.save') }}</Btn>
    </form>

    <form :class="section" @submit.prevent="savePassword">
      <h2 class="font-semibold">{{ t('settings.password') }}</h2>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('settings.currentPassword') }}
        <input v-model="currentPassword" data-test="current-password" type="password" autocomplete="current-password" :class="field" />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('settings.newPassword') }}
        <input v-model="newPassword" data-test="new-password" type="password" autocomplete="new-password" :minlength="LIMITS.passwordMin" :class="field" />
        <span class="text-xs text-[var(--c-muted)]">{{ t('settings.passwordHint', { n: LIMITS.passwordMin }) }}</span>
      </label>
      <Btn type="submit" data-test="save-password" :loading="busy.password" :disabled="!passwordValid">{{ t('settings.changePassword') }}</Btn>
    </form>

    <fieldset :key="localeRev" :class="section" :disabled="busy.locale">
      <legend class="sr-only">{{ t('settings.language') }}</legend>
      <h2 class="font-semibold">{{ t('settings.language') }}</h2>
      <div class="flex gap-4 text-sm">
        <label class="flex items-center gap-2">
          <input type="radio" name="locale" data-test="locale-vi" :checked="locale === 'vi'" @change="pickLocale('vi')" /> Tiếng Việt
        </label>
        <label class="flex items-center gap-2">
          <input type="radio" name="locale" data-test="locale-en" :checked="locale === 'en'" @change="pickLocale('en')" /> English
        </label>
      </div>
    </fieldset>

    <form :class="section" @submit.prevent="saveR18">
      <h2 class="font-semibold">{{ t('settings.r18') }}</h2>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('settings.birthDate') }}
        <input v-model="birthDate" data-test="birthdate" type="date" :class="field" />
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input v-model="showR18" data-test="show-r18" type="checkbox" /> {{ t('settings.showR18') }}
      </label>
      <Btn type="submit" data-test="save-r18" :loading="busy.r18">{{ t('settings.save') }}</Btn>
    </form>
  </div>
</template>

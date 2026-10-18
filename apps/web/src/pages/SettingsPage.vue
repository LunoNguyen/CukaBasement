<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { LIMITS } from '@cuka/shared'
import { ApiError } from '@/api/client'
import { changePassword, updateProfile, updateSettings, type UpdateProfileInput, type UpdateSettingsInput } from '@/api/endpoints/me'
import type { Locale } from '@/i18n'
import { useChangeLocale } from '@/composables/useChangeLocale'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import Btn from '@/components/common/Btn.vue'
import ImageField from '@/components/user/ImageField.vue'
import SocialLinksField from '@/components/user/SocialLinksField.vue'
import { rowErrors, toLinks, toRows } from '@/components/user/socialLinks'
import { useErrorText } from '@/composables/useErrorText'

const { t, locale } = useI18n()
const auth = useAuth()
const toast = useToast()
const router = useRouter()
const errorText = useErrorText()

const me = auth.user!

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
const links = ref(toRows(me.profile.links))
const profileValid = computed(
  () =>
    displayName.value.trim().length > 0 &&
    bio.value.length <= LIMITS.bioMax &&
    links.value.every((r) => Object.keys(rowErrors(r)).length === 0),
)

function saveProfile() {
  if (!profileValid.value) return
  const body: UpdateProfileInput = {
    displayName: displayName.value.trim(),
    bio: bio.value,
    links: toLinks(links.value),
  }
  return run('profile', async () => {
    const u = await updateProfile(body)
    auth.setUser(u)
    // Blank rows are gone and values trimmed: show the list as saved.
    links.value = toRows(u.profile.links)
  })
}

// --- avatar/banner: the public URL appears only once the worker has published the new image, so the auth store
// polls /me (the header follows the store, also after leaving this page)

/** Avatar/banner: failures are toasted here and rethrown so the image field drops its preview. */
async function saveImage(body: UpdateProfileInput) {
  try {
    auth.setUser(await updateProfile(body))
    auth.pollUntilPublished()
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

const field = 'field'
const section = 'flex flex-col gap-3 card p-4'
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-4">
    <h1 class="font-display text-3xl font-semibold tracking-tight">{{ t('settings.title') }}</h1>

    <form :class="section" data-test="profile-form" @submit.prevent="saveProfile">
      <h2 class="font-display text-lg font-semibold">{{ t('settings.profile') }}</h2>
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
      <SocialLinksField v-model="links" />
      <Btn type="submit" data-test="save-profile" class="self-start" :loading="busy.profile" :disabled="!profileValid">{{ t('settings.save') }}</Btn>
    </form>

    <form :class="section" @submit.prevent="savePassword">
      <h2 class="font-display text-lg font-semibold">{{ t('settings.password') }}</h2>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('settings.currentPassword') }}
        <input v-model="currentPassword" data-test="current-password" type="password" autocomplete="current-password" :class="field" />
      </label>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('settings.newPassword') }}
        <input v-model="newPassword" data-test="new-password" type="password" autocomplete="new-password" :minlength="LIMITS.passwordMin" :class="field" />
        <span class="text-xs text-[var(--c-muted)]">{{ t('settings.passwordHint', { n: LIMITS.passwordMin }) }}</span>
      </label>
      <Btn type="submit" data-test="save-password" class="self-start" :loading="busy.password" :disabled="!passwordValid">{{ t('settings.changePassword') }}</Btn>
    </form>

    <fieldset :key="localeRev" :class="section" :disabled="busy.locale">
      <legend class="sr-only">{{ t('settings.language') }}</legend>
      <h2 class="font-display text-lg font-semibold">{{ t('settings.language') }}</h2>
      <div class="flex flex-wrap gap-2">
        <label class="chip">
          <input type="radio" class="sr-only" name="locale" data-test="locale-vi" :checked="locale === 'vi'" @change="pickLocale('vi')" /> Tiếng Việt
        </label>
        <label class="chip">
          <input type="radio" class="sr-only" name="locale" data-test="locale-en" :checked="locale === 'en'" @change="pickLocale('en')" /> English
        </label>
      </div>
    </fieldset>

    <form :class="section" @submit.prevent="saveR18">
      <h2 class="font-display text-lg font-semibold">{{ t('settings.r18') }}</h2>
      <label class="flex flex-col gap-1 text-sm">
        {{ t('settings.birthDate') }}
        <input v-model="birthDate" data-test="birthdate" type="date" :class="field" />
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input v-model="showR18" data-test="show-r18" type="checkbox" /> {{ t('settings.showR18') }}
      </label>
      <Btn type="submit" data-test="save-r18" class="self-start" :loading="busy.r18">{{ t('settings.save') }}</Btn>
    </form>
  </div>
</template>

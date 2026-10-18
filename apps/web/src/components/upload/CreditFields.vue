<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CREDIT_PLATFORMS, LIMITS, PLATFORM_LABELS } from '@cuka/shared'
import { isHttpUrl, type CreditForm } from './postForm'

const model = defineModel<CreditForm>({ required: true })
const { t } = useI18n()

function set<K extends keyof CreditForm>(k: K, v: CreditForm[K]) {
  model.value = { ...model.value, [k]: v }
}

function setOwnWork(own: boolean) {
  // A repost must pick its platform; own work does not have one.
  model.value = { ...model.value, isOwnWork: own, platform: own ? 'other' : '' }
}

const urlInvalid = computed(() => !!model.value.sourceUrl.trim() && !isHttpUrl(model.value.sourceUrl))
const input = 'w-full field'
</script>

<template>
  <fieldset class="flex flex-col gap-3 text-sm">
    <div class="flex flex-wrap gap-2">
      <label class="chip">
        <input data-test="credit-own" type="radio" class="sr-only" name="credit-kind" :checked="model.isOwnWork" @change="setOwnWork(true)" />
        <svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
        {{ t('upload.credit.ownWork') }}
      </label>
      <label class="chip">
        <input data-test="credit-repost" type="radio" class="sr-only" name="credit-kind" :checked="!model.isOwnWork" @change="setOwnWork(false)" />
        <svg viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </svg>
        {{ t('upload.credit.repost') }}
      </label>
    </div>
    <template v-if="!model.isOwnWork">
      <label class="flex flex-col gap-1">
        {{ t('upload.credit.artistName') }} *
        <input data-test="artist-name" :class="input" :maxlength="LIMITS.creditArtistNameMax" :value="model.artistName" @input="set('artistName', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="flex flex-col gap-1">
        {{ t('upload.credit.artistHandle') }}
        <input data-test="artist-handle" :class="input" :maxlength="LIMITS.creditArtistHandleMax" :value="model.artistHandle" @input="set('artistHandle', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="flex flex-col gap-1">
        {{ t('upload.credit.platform') }} *
        <select data-test="platform" :class="input" :value="model.platform" @change="set('platform', ($event.target as HTMLSelectElement).value as CreditForm['platform'])">
          <option value="" disabled>{{ t('upload.credit.choosePlatform') }}</option>
          <option v-for="p in CREDIT_PLATFORMS" :key="p" :value="p">{{ PLATFORM_LABELS[p] || t('upload.credit.platformOther') }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1">
        {{ t('upload.credit.sourceUrl') }} *
        <input data-test="source-url" type="url" :class="input" :maxlength="LIMITS.creditSourceUrlMax" :value="model.sourceUrl" @input="set('sourceUrl', ($event.target as HTMLInputElement).value)" />
        <span v-if="urlInvalid" class="text-[var(--c-danger)]">{{ t('upload.credit.sourceUrlInvalid') }}</span>
      </label>
      <label class="flex flex-col gap-1">
        {{ t('upload.credit.permissionNote') }}
        <textarea data-test="permission-note" :class="input" rows="2" :maxlength="LIMITS.creditPermissionNoteMax" :value="model.permissionNote" @input="set('permissionNote', ($event.target as HTMLTextAreaElement).value)" />
        <span class="text-xs text-[var(--c-muted)]">{{ t('upload.credit.permissionHint') }}</span>
      </label>
    </template>
  </fieldset>
</template>

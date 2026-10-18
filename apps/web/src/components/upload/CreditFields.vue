<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CREDIT_PLATFORMS, PLATFORM_LABELS } from '@cuka/shared'
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
const input = 'w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1.5'
</script>

<template>
  <fieldset class="flex flex-col gap-3 text-sm">
    <div class="flex flex-wrap gap-4">
      <label class="flex items-center gap-2">
        <input data-test="credit-own" type="radio" name="credit-kind" :checked="model.isOwnWork" @change="setOwnWork(true)" />
        {{ t('upload.credit.ownWork') }}
      </label>
      <label class="flex items-center gap-2">
        <input data-test="credit-repost" type="radio" name="credit-kind" :checked="!model.isOwnWork" @change="setOwnWork(false)" />
        {{ t('upload.credit.repost') }}
      </label>
    </div>
    <template v-if="!model.isOwnWork">
      <label class="flex flex-col gap-1">
        {{ t('upload.credit.artistName') }} *
        <input data-test="artist-name" :class="input" maxlength="100" :value="model.artistName" @input="set('artistName', ($event.target as HTMLInputElement).value)" />
      </label>
      <label class="flex flex-col gap-1">
        {{ t('upload.credit.artistHandle') }}
        <input data-test="artist-handle" :class="input" maxlength="100" :value="model.artistHandle" @input="set('artistHandle', ($event.target as HTMLInputElement).value)" />
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
        <input data-test="source-url" type="url" :class="input" maxlength="500" :value="model.sourceUrl" @input="set('sourceUrl', ($event.target as HTMLInputElement).value)" />
        <span v-if="urlInvalid" class="text-red-600">{{ t('upload.credit.sourceUrlInvalid') }}</span>
      </label>
      <label class="flex flex-col gap-1">
        {{ t('upload.credit.permissionNote') }}
        <textarea data-test="permission-note" :class="input" rows="2" maxlength="300" :value="model.permissionNote" @input="set('permissionNote', ($event.target as HTMLTextAreaElement).value)" />
        <span class="text-xs text-[var(--c-muted)]">{{ t('upload.credit.permissionHint') }}</span>
      </label>
    </template>
  </fieldset>
</template>

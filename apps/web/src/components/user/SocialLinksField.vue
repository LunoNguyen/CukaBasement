<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { LIMITS, SOCIAL_PLATFORM_LABELS, SOCIAL_PLATFORMS } from '@cuka/shared'
import { type LinkRow, newRow, rowErrors } from './socialLinks'

/** The profile's ordered links: one row per link (platform, label for `other`, URL), reorder, remove, add up to the limit. */
const rows = defineModel<LinkRow[]>({ required: true })
const { t } = useI18n()

const errors = computed(() => rows.value.map(rowErrors))
const full = computed(() => rows.value.length >= LIMITS.socialLinksMax)

function add() {
  if (!full.value) rows.value = [...rows.value, newRow()]
}
function remove(i: number) {
  rows.value = rows.value.filter((_, j) => j !== i)
}
function move(i: number, by: -1 | 1) {
  const next = [...rows.value]
  const j = i + by
  if (j < 0 || j >= next.length) return
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  rows.value = next
}

const field = 'field'
const iconBtn = 'inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--c-border)] disabled:opacity-40'
</script>

<template>
  <fieldset class="flex flex-col gap-2 text-sm">
    <legend class="mb-1">{{ t('settings.links') }}</legend>
    <p v-if="!rows.length" class="text-xs text-[var(--c-muted)]">{{ t('settings.noLinks') }}</p>
    <div v-for="(row, i) in rows" :key="row.id" data-test="link-row" class="flex flex-col gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <select v-model="row.platform" data-test="link-platform" :aria-label="t('settings.linkPlatform')" :class="field">
          <option v-for="p in SOCIAL_PLATFORMS" :key="p" :value="p">{{ SOCIAL_PLATFORM_LABELS[p] || t('settings.platformOther') }}</option>
        </select>
        <input
          v-if="row.platform === 'other'"
          v-model="row.label"
          data-test="link-label"
          type="text"
          :maxlength="LIMITS.socialLinkLabelMax"
          :placeholder="t('settings.linkLabel')"
          :aria-label="t('settings.linkLabel')"
          :aria-invalid="!!errors[i]?.label"
          :class="[field, 'w-32']"
        />
        <input
          v-model="row.url"
          data-test="link-url"
          type="text"
          inputmode="url"
          placeholder="https://"
          :aria-label="t('settings.linkUrl')"
          :aria-invalid="!!errors[i]?.url"
          :class="[field, 'min-w-0 flex-1 basis-40']"
        />
        <div class="flex gap-1">
          <button type="button" data-test="link-up" :class="iconBtn" :disabled="i === 0" :aria-label="t('settings.moveUp')" @click="move(i, -1)">↑</button>
          <button type="button" data-test="link-down" :class="iconBtn" :disabled="i === rows.length - 1" :aria-label="t('settings.moveDown')" @click="move(i, 1)">↓</button>
          <button type="button" data-test="link-remove" :class="iconBtn" :aria-label="t('settings.removeLink')" @click="remove(i)">✕</button>
        </div>
      </div>
      <span v-if="errors[i]?.label" role="alert" class="text-xs text-[var(--c-danger)]">{{ t(errors[i]!.label!, { n: LIMITS.socialLinkLabelMax }) }}</span>
      <span v-if="errors[i]?.url" role="alert" class="text-xs text-[var(--c-danger)]">{{ t(errors[i]!.url!, { n: LIMITS.socialLinkUrlMax }) }}</span>
    </div>
    <div class="flex items-center gap-3">
      <button
        type="button"
        data-test="add-link"
        class="self-start inline-flex min-h-11 items-center rounded-full border border-[var(--c-border)] bg-[var(--c-bg)] px-4 font-semibold hover:border-[var(--c-latte)] disabled:opacity-60"
        :disabled="full"
        @click="add"
      >
        {{ t('settings.addLink') }}
      </button>
      <span v-if="full" data-test="links-max" class="text-xs text-[var(--c-muted)]">{{ t('settings.linksMax', { n: LIMITS.socialLinksMax }) }}</span>
    </div>
  </fieldset>
</template>

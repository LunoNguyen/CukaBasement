<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { HOME_LIMITS as L, isYouTubeChannelId, type MusicData, type MusicGroup, MUSIC_GROUPS, musicFeedKey, parseYouTubeId } from '@cuka/shared'
import * as api from '@/api/endpoints/site'
import type { MusicStatusDto } from '@/api/types'
import Btn from '@/components/common/Btn.vue'
import { useErrorText } from '@/composables/useErrorText'
import { useToast } from '@/stores/toast'
import ItemList from './ItemList.vue'
import LocalizedInput from './LocalizedInput.vue'
import { lt } from './model'

/**
 * The music section's own fields: the channel, then one panel per tab (its name, the automatic option and the
 * hand-picked videos with optional title/date/views), with the server's sync status and a "Làm mới ngay" button.
 * Automatic "MV mới" / "MV phổ biến" need a YouTube API key on the server; without one they are disabled.
 */
const props = defineProps<{ data: MusicData }>()
const { t, locale } = useI18n()
const toast = useToast()
const errorText = useErrorText()

const status = ref<MusicStatusDto | null>(null)
const statusFailed = ref(false)
const refreshing = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function loadStatus() {
  try {
    status.value = await api.musicStatus()
    statusFailed.value = false
  } catch {
    statusFailed.value = true
  }
}
onMounted(loadStatus)
onBeforeUnmount(() => clearTimeout(timer))

async function refresh() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await api.refreshMusic()
    toast.push({ kind: 'success', text: t('admin.home.music.refreshed') })
    clearTimeout(timer)
    timer = setTimeout(loadStatus, 5000)
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    refreshing.value = false
  }
}

const apiKey = computed(() => !!status.value?.apiKey)
/** Whether the automatic option of `g` can be used (the channel feed needs no key). */
const canAuto = (g: MusicGroup) => g === 'channel' || apiKey.value
const feedOf = (g: MusicGroup) => status.value?.feeds.find((f) => f.key === musicFeedKey(g, props.data.channelId, props.data.newest.keyword)) ?? null
const fmt = (iso: string) => new Date(iso).toLocaleString(locale.value === 'en' ? 'en-GB' : 'vi-VN', { dateStyle: 'medium', timeStyle: 'short' })
const channelOk = computed(() => isYouTubeChannelId(props.data.channelId.trim()))
const viewsOk = (v: unknown) => v === null || v === '' || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= L.musicViewsMax)

/** `<input type="number">` gives '' when cleared: store null (no override). */
function setViews(item: { views: number | null }, raw: string) {
  const n = raw.trim() === '' ? null : Number(raw)
  item.views = n === null || Number.isNaN(n) ? null : n
}
function setAuto(g: MusicGroup, on: boolean) {
  props.data[g].auto = on
}
</script>

<template>
  <div class="flex flex-col gap-5" data-test="music-form">
    <label class="flex flex-col gap-1.5 text-sm font-medium">
      {{ t('admin.home.music.channelId') }}
      <input v-model.trim="data.channelId" class="field" type="text" maxlength="24" placeholder="UC…" :aria-invalid="!channelOk || undefined" data-test="f-channel-id" />
      <span v-if="!channelOk" class="text-xs font-normal text-[var(--c-danger)]">{{ t('admin.home.music.channelIdInvalid') }}</span>
      <span class="text-xs font-normal text-[var(--c-muted)]">{{ t('admin.home.music.channelIdHint') }}</span>
    </label>

    <section class="flex flex-col gap-2 rounded-xl border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm" data-test="music-sync">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="mr-auto font-semibold">{{ t('admin.home.music.syncTitle') }}</h3>
        <Btn size="sm" variant="secondary" :loading="refreshing" data-test="music-refresh" @click="refresh">{{ t('admin.home.music.refresh') }}</Btn>
      </div>
      <p class="text-xs text-[var(--c-muted)]">{{ t('admin.home.music.syncHint') }}</p>
      <p v-if="statusFailed" class="text-xs text-[var(--c-danger)]">{{ t('admin.home.music.statusError') }}</p>
      <p v-else-if="status" class="text-xs" :class="apiKey ? 'text-[var(--c-text)]' : 'text-[var(--c-muted)]'" data-test="music-api-key">{{ apiKey ? t('admin.home.music.apiKeyOn') : t('admin.home.music.apiKeyOff') }}</p>
    </section>

    <fieldset v-for="g in MUSIC_GROUPS" :key="g" class="flex flex-col gap-4 rounded-xl border border-[var(--c-border)] p-3" :data-test="`music-group-${g}`">
      <legend class="px-1 text-sm font-semibold">{{ t(`admin.home.music.group.${g}`) }}</legend>
      <LocalizedInput v-model="data[g].label" :label="t('admin.home.music.tabLabel')" :max="L.labelMax" :test-id="`f-music-label-${g}`" />

      <div class="flex flex-col gap-1.5">
        <label class="flex items-center gap-2 text-sm font-medium" :class="canAuto(g) ? '' : 'text-[var(--c-muted)]'">
          <input type="checkbox" :checked="data[g].auto && canAuto(g)" :disabled="!canAuto(g)" :data-test="`f-music-auto-${g}`" @change="setAuto(g, ($event.target as HTMLInputElement).checked)" />
          {{ t(`admin.home.music.auto.${g}`) }}
        </label>
        <p v-if="!canAuto(g)" class="text-xs text-[var(--c-muted)]" :data-test="`music-needs-key-${g}`">{{ t('admin.home.music.needsKey') }}</p>
        <template v-else-if="data[g].auto">
          <p class="text-xs text-[var(--c-muted)]">{{ t('admin.home.music.autoHint', { max: L.musicItemsMax }) }}</p>
          <p v-if="feedOf(g)?.fetchedAt" class="text-xs text-[var(--c-text)]" :data-test="`music-status-${g}`">{{ t('admin.home.music.status', { at: fmt(feedOf(g)!.fetchedAt!), n: feedOf(g)!.count }) }}</p>
          <p v-else-if="status" class="text-xs text-[var(--c-muted)]" :data-test="`music-status-${g}`">{{ t('admin.home.music.never') }}</p>
          <p v-if="feedOf(g)?.error" class="text-xs text-[var(--c-danger)]" :data-test="`music-error-${g}`">{{ t('admin.home.music.error', { at: fmt(feedOf(g)!.errorAt ?? feedOf(g)!.attemptAt), error: feedOf(g)!.error }) }}</p>
        </template>
      </div>
      <label v-if="g === 'newest' && data.newest.auto && canAuto(g)" class="flex flex-col gap-1.5 text-sm font-medium">
        {{ t('admin.home.music.keyword') }}
        <input v-model="data.newest.keyword" class="field w-48" type="text" :maxlength="L.musicKeywordMax" placeholder="MV" data-test="f-music-keyword" />
        <span class="text-xs font-normal text-[var(--c-muted)]">{{ t('admin.home.music.keywordHint') }}</span>
      </label>

      <ItemList v-model="data[g].items" :label="t('admin.home.music.items')" :max="L.musicItemsMax" :add-label="t('admin.home.music.addItem')" :create="() => ({ url: '', title: lt(), date: '', views: null })" :test-id="`music-items-${g}`">
        <template #default="{ item }">
          <label class="flex flex-col gap-1.5 text-sm font-medium">
            {{ t('admin.home.music.url') }}
            <input v-model.trim="item.url" class="field" type="url" :maxlength="L.urlMax" placeholder="https://www.youtube.com/watch?v=…" :aria-invalid="!parseYouTubeId(item.url) || undefined" data-test="f-music-url" />
            <span v-if="item.url && !parseYouTubeId(item.url)" class="text-xs font-normal text-[var(--c-danger)]">{{ t('admin.home.notYoutube') }}</span>
          </label>
          <LocalizedInput v-model="item.title" :label="t('admin.home.music.titleOverride')" :max="L.headingMax" test-id="f-music-title" />
          <div class="grid grid-cols-2 gap-3">
            <label class="flex flex-col gap-1.5 text-sm font-medium">
              {{ t('admin.home.music.date') }}
              <input v-model="item.date" class="field" type="date" data-test="f-music-date" />
            </label>
            <label class="flex flex-col gap-1.5 text-sm font-medium">
              {{ t('admin.home.music.views') }}
              <input :value="item.views ?? ''" class="field" type="number" min="0" step="1" inputmode="numeric" :aria-invalid="!viewsOk(item.views) || undefined" data-test="f-music-views" @input="setViews(item, ($event.target as HTMLInputElement).value)" />
              <span v-if="!viewsOk(item.views)" class="text-xs font-normal text-[var(--c-danger)]">{{ t('admin.home.music.viewsInvalid') }}</span>
            </label>
          </div>
          <p class="-mt-1 text-xs text-[var(--c-muted)]">{{ t('admin.home.music.overrideHint') }}</p>
        </template>
      </ItemList>
    </fieldset>
  </div>
</template>

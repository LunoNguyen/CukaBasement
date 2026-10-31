<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { BACKUP_FREQUENCIES, BACKUP_KEEP_MAX, BACKUP_RESTORE_CONFIRM, type BackupSchedule, backupScheduleSchema } from '@cuka/shared'
import * as api from '@/api/endpoints/backups'
import type { BackupOverviewDto, BackupRunDto } from '@/api/types'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import { useErrorText } from '@/composables/useErrorText'
import Btn from '@/components/common/Btn.vue'
import Modal from '@/components/common/Modal.vue'
import Spinner from '@/components/common/Spinner.vue'

const POLL_MS = 2000

const { t, locale } = useI18n()
const toast = useToast()
const errorText = useErrorText()
const auth = useAuth()
const router = useRouter()

const data = ref<BackupOverviewDto | null>(null)
const loadError = ref<unknown>(null)
const creating = ref(false)
const uploading = ref(false)
const uploadProgress = ref(0)
const restoreTarget = ref<string | null>(null)
const confirmText = ref('')
const restoring = ref(false)
const deleteTarget = ref<string | null>(null)
const deleting = ref(false)
const restoreDone = ref(false)
const savingSchedule = ref(false)
const scheduleError = ref(false)
const form = reactive<BackupSchedule>({ enabled: false, frequency: 'daily', weekday: 0, time: '03:00', keep: 7 })

let timer: ReturnType<typeof setTimeout> | null = null
let disposed = false
/** The run being watched, to announce how it ended. */
let watched: { id: string; status: string } | null = null

const running = computed(() => data.value?.run?.status === 'running' || data.value?.busy === true)
const restoreOpen = computed({ get: () => restoreTarget.value !== null, set: (v) => void (v || (restoreTarget.value = null)) })
const deleteOpen = computed({ get: () => deleteTarget.value !== null, set: (v) => void (v || (deleteTarget.value = null)) })
const canRestore = computed(() => confirmText.value.trim() === BACKUP_RESTORE_CONFIRM && !restoring.value)
const weekdays = computed(() => {
  const fmt = new Intl.DateTimeFormat(locale.value, { weekday: 'long', timeZone: 'UTC' })
  // 2023-01-01 was a Sunday (weekday 0).
  return Array.from({ length: 7 }, (_, d) => ({ value: d, label: fmt.format(new Date(Date.UTC(2023, 0, 1 + d))) }))
})

function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v.toLocaleString(locale.value, { maximumFractionDigits: 1 })} ${units[i]}`
}
const when = (iso: string, timeZone?: string) => new Date(iso).toLocaleString(locale.value, timeZone ? { timeZone } : undefined)

function percent(r: BackupRunDto): number | null {
  const p = r.progress
  if (!p || p.total <= 0) return null
  return Math.min(100, Math.floor((p.done / p.total) * 100))
}

function announce(run: BackupRunDto | null) {
  if (!run) return
  if (watched && watched.id === run.id && watched.status === 'running' && run.status !== 'running') {
    if (run.status === 'succeeded') {
      toast.push({ kind: 'success', text: t(run.kind === 'restore' ? 'admin.backups.restoreSucceeded' : 'admin.backups.backupSucceeded') })
      if (run.kind === 'restore') restoreDone.value = true
    } else {
      toast.push({ kind: 'error', text: t(run.kind === 'restore' ? 'admin.backups.restoreFailed' : 'admin.backups.backupFailed') })
    }
  }
  watched = { id: run.id, status: run.status }
}

function fillSchedule(s: BackupSchedule) {
  Object.assign(form, s)
}

async function load(first = false) {
  timer = null
  try {
    const next = await api.overview()
    if (disposed) return
    announce(next.run)
    data.value = next
    loadError.value = null
    if (first) fillSchedule(next.schedule.schedule)
  } catch (e) {
    if (disposed) return
    if (first) loadError.value = e
  }
  if (running.value) poll()
}

function poll() {
  if (!timer && !disposed) timer = setTimeout(() => void load(), POLL_MS)
}

onMounted(() => void load(true))
onBeforeUnmount(() => {
  disposed = true
  if (timer) clearTimeout(timer)
})

function started(run: BackupRunDto) {
  watched = { id: run.id, status: 'running' }
  if (data.value) data.value = { ...data.value, run, busy: true }
  poll()
}

async function createBackup() {
  if (creating.value) return
  creating.value = true
  try {
    started(await api.create())
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    creating.value = false
  }
}

function askRestore(name: string) {
  confirmText.value = ''
  restoreTarget.value = name
}

async function confirmRestore() {
  const name = restoreTarget.value
  if (!name || !canRestore.value) return
  restoring.value = true
  try {
    started(await api.restore(name))
    restoreTarget.value = null
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    restoring.value = false
  }
}

async function confirmDelete() {
  const name = deleteTarget.value
  if (!name || deleting.value) return
  deleting.value = true
  try {
    await api.remove(name)
    if (data.value) data.value = { ...data.value, items: data.value.items.filter((b) => b.name !== name) }
    deleteTarget.value = null
    toast.push({ kind: 'success', text: t('admin.backups.deleted') })
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    deleting.value = false
  }
}

async function download(name: string) {
  try {
    await api.download(name)
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  }
}

async function onUpload(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || uploading.value || !data.value) return
  if (!/\.(tar\.gz|tgz)$/i.test(file.name)) {
    toast.push({ kind: 'error', text: t('admin.backups.uploadType') })
    return
  }
  if (file.size > data.value.maxUploadBytes) {
    toast.push({ kind: 'error', text: t('admin.backups.uploadTooLarge', { max: formatBytes(data.value.maxUploadBytes) }) })
    return
  }
  uploading.value = true
  uploadProgress.value = 0
  try {
    const saved = await api.upload(file, (f) => (uploadProgress.value = f))
    if (data.value) data.value = { ...data.value, items: [saved, ...data.value.items] }
    toast.push({ kind: 'success', text: t('admin.backups.uploaded') })
    // Uploading is almost always followed by restoring it.
    askRestore(saved.name)
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    uploading.value = false
  }
}

async function saveSchedule() {
  if (savingSchedule.value) return
  const parsed = backupScheduleSchema.safeParse({ ...form, weekday: Number(form.weekday), keep: Number(form.keep) })
  scheduleError.value = !parsed.success
  if (!parsed.success) return
  savingSchedule.value = true
  try {
    const next = await api.updateSchedule(parsed.data)
    if (data.value) data.value = { ...data.value, schedule: next }
    fillSchedule(next.schedule)
    toast.push({ kind: 'success', text: t('admin.backups.schedule.saved') })
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    savingSchedule.value = false
  }
}

async function loginAgain() {
  auth.clear()
  await router.push({ path: '/login', query: { next: '/admin?tab=backups' } })
}
</script>

<template>
  <p v-if="loadError" class="py-6 text-center text-[var(--c-muted)]">{{ errorText(loadError) }}</p>
  <div v-else-if="!data" class="flex justify-center py-6"><Spinner /></div>
  <div v-else class="flex flex-col gap-6">
    <div v-if="restoreDone" data-test="restore-done" role="status" class="panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
      <p>{{ t('admin.backups.restoreDoneBody') }}</p>
      <Btn size="sm" @click="loginAgain">{{ t('admin.backups.loginAgain') }}</Btn>
    </div>

    <section class="flex flex-col gap-3">
      <p class="text-sm text-[var(--c-muted)]">{{ t('admin.backups.intro') }}</p>
      <div class="flex flex-wrap items-center gap-3">
        <Btn data-test="backup-create" :loading="creating" :disabled="running" @click="createBackup">{{ t('admin.backups.create') }}</Btn>
        <label class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded border border-[var(--c-border)] px-4 text-sm font-semibold" :class="{ 'pointer-events-none opacity-60': uploading || running }">
          <input data-test="backup-upload" type="file" accept=".gz,.tgz,application/gzip" class="sr-only" :disabled="uploading || running" @change="onUpload" />
          {{ uploading ? t('admin.backups.uploading', { n: Math.round(uploadProgress * 100) }) : t('admin.backups.upload') }}
        </label>
      </div>

      <div v-if="data.run" data-test="backup-run" class="panel p-3 text-sm" :role="data.run.status === 'running' ? 'status' : undefined">
        <p class="font-semibold">
          {{ t(`admin.backups.kind.${data.run.kind}`) }} · {{ t(`admin.backups.status.${data.run.status}`) }}
          <span v-if="data.run.status === 'running' && data.run.progress">
            · {{ t(`admin.backups.phase.${data.run.progress.phase}`) }}<template v-if="percent(data.run) !== null"> {{ percent(data.run) }}%</template>
          </span>
        </p>
        <p class="break-all text-xs text-[var(--c-muted)]">{{ data.run.file }} · {{ when(data.run.startedAt) }}</p>
        <p v-if="data.run.error" data-test="backup-run-error" class="mt-1 break-words text-xs text-[var(--c-danger)]">{{ data.run.error }}</p>
        <p v-if="data.run.status === 'running' && data.run.kind === 'restore'" class="mt-1 text-xs">{{ t('admin.backups.maintenanceHint') }}</p>
      </div>

      <p v-if="data.items.length === 0" class="py-4 text-center text-sm text-[var(--c-muted)]">{{ t('admin.backups.empty') }}</p>
      <ul v-else class="flex flex-col gap-2">
        <li v-for="b in data.items" :key="b.name" data-test="backup-row" class="panel flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
          <div class="min-w-0">
            <p class="break-all font-semibold">
              {{ b.name }}
              <span v-if="b.scheduled" class="ml-1 rounded border border-[var(--c-border)] px-1.5 text-xs font-normal">{{ t('admin.backups.scheduledBadge') }}</span>
            </p>
            <p class="text-xs text-[var(--c-muted)]">{{ when(b.createdAt) }} · {{ formatBytes(b.sizeBytes) }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <Btn size="sm" variant="secondary" data-test="backup-download" @click="download(b.name)">{{ t('admin.backups.download') }}</Btn>
            <Btn size="sm" variant="secondary" data-test="backup-restore" :disabled="running" @click="askRestore(b.name)">{{ t('admin.backups.restore') }}</Btn>
            <Btn size="sm" variant="danger" data-test="backup-delete" :disabled="running" @click="deleteTarget = b.name">{{ t('admin.backups.delete') }}</Btn>
          </div>
        </li>
      </ul>
    </section>

    <section class="flex flex-col gap-3" data-test="backup-schedule">
      <h2 class="text-base font-bold">{{ t('admin.backups.schedule.title') }}</h2>
      <form novalidate class="flex max-w-md flex-col gap-3" @submit.prevent="saveSchedule">
        <label class="flex items-center gap-2 text-sm">
          <input v-model="form.enabled" data-test="sched-enabled" type="checkbox" />
          {{ t('admin.backups.schedule.enabled') }}
        </label>
        <label class="flex flex-col gap-1 text-sm">
          {{ t('admin.backups.schedule.frequency') }}
          <select v-model="form.frequency" data-test="sched-frequency" class="field">
            <option v-for="f in BACKUP_FREQUENCIES" :key="f" :value="f">{{ t(`admin.backups.schedule.${f}`) }}</option>
          </select>
        </label>
        <label v-if="form.frequency === 'weekly'" class="flex flex-col gap-1 text-sm">
          {{ t('admin.backups.schedule.weekday') }}
          <select v-model.number="form.weekday" data-test="sched-weekday" class="field">
            <option v-for="d in weekdays" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-sm">
          {{ t('admin.backups.schedule.time', { tz: data.schedule.timeZone }) }}
          <input v-model="form.time" data-test="sched-time" type="time" class="field" />
        </label>
        <label class="flex flex-col gap-1 text-sm">
          {{ t('admin.backups.schedule.keep') }}
          <input v-model.number="form.keep" data-test="sched-keep" type="number" min="1" :max="BACKUP_KEEP_MAX" class="field" />
          <span class="text-xs text-[var(--c-muted)]">{{ t('admin.backups.schedule.keepHint') }}</span>
        </label>
        <span v-if="scheduleError" role="alert" class="text-xs text-[var(--c-danger)]">{{ t('admin.backups.schedule.invalid', { max: BACKUP_KEEP_MAX }) }}</span>
        <div><Btn type="submit" data-test="sched-save" :loading="savingSchedule">{{ t('admin.backups.schedule.save') }}</Btn></div>
      </form>
      <p class="text-sm" data-test="sched-next">
        {{ t('admin.backups.schedule.next') }}:
        {{ data.schedule.nextRunAt ? `${when(data.schedule.nextRunAt, data.schedule.timeZone)} (${data.schedule.timeZone})` : t('admin.backups.schedule.off') }}
      </p>
      <p class="text-sm" data-test="sched-last">
        {{ t('admin.backups.schedule.last') }}:
        <template v-if="data.schedule.lastRun">
          {{ t(`admin.backups.schedule.outcome.${data.schedule.lastRun.outcome}`) }} · {{ when(data.schedule.lastRun.at) }}
          <span v-if="data.schedule.lastRun.error" class="block break-words text-xs text-[var(--c-danger)]">{{ data.schedule.lastRun.error }}</span>
        </template>
        <template v-else>{{ t('admin.backups.schedule.never') }}</template>
      </p>
    </section>

    <Modal v-model:open="restoreOpen" :title="t('admin.backups.restoreTitle')">
      <form class="flex flex-col gap-3 text-sm" @submit.prevent="confirmRestore">
        <p class="break-all font-semibold">{{ restoreTarget }}</p>
        <p>{{ t('admin.backups.restoreWarning') }}</p>
        <label class="flex flex-col gap-1">
          {{ t('admin.backups.restoreType', { word: BACKUP_RESTORE_CONFIRM }) }}
          <input v-model="confirmText" data-test="restore-confirm" class="field" autocomplete="off" spellcheck="false" />
        </label>
        <div class="flex justify-end gap-2">
          <Btn variant="secondary" @click="restoreTarget = null">{{ t('common.cancel') }}</Btn>
          <Btn type="submit" variant="danger" data-test="restore-submit" :loading="restoring" :disabled="!canRestore">{{ t('admin.backups.restoreSubmit') }}</Btn>
        </div>
      </form>
    </Modal>

    <Modal v-model:open="deleteOpen" :title="t('admin.backups.deleteTitle')">
      <form class="flex flex-col gap-3 text-sm" @submit.prevent="confirmDelete">
        <p>{{ t('admin.backups.deleteConfirm', { name: deleteTarget }) }}</p>
        <div class="flex justify-end gap-2">
          <Btn variant="secondary" @click="deleteTarget = null">{{ t('common.cancel') }}</Btn>
          <Btn type="submit" variant="danger" data-test="delete-submit" :loading="deleting">{{ t('admin.backups.delete') }}</Btn>
        </div>
      </form>
    </Modal>
  </div>
</template>

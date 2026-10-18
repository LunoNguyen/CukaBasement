<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LIMITS, ROLES, USER_STATUSES, type Role, type UserStatus } from '@cuka/shared'
import * as api from '@/api/endpoints/admin'
import type { AdminUserDto } from '@/api/types'
import { useCursorList } from '@/composables/useCursorList'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import { useErrorText } from '@/composables/useErrorText'
import Btn from '@/components/common/Btn.vue'
import Modal from '@/components/common/Modal.vue'
import ListFooter from '@/components/common/ListFooter.vue'

/** `adminStatusSchema.note` max in @cuka/shared. */
const DEBOUNCE_MS = 300

type Pending = { user: AdminUserDto; kind: 'status'; value: UserStatus } | { user: AdminUserDto; kind: 'role'; value: Role }

const { t, locale } = useI18n()
const auth = useAuth()
const toast = useToast()
const errorText = useErrorText()

const q = ref('')
const role = ref<Role | ''>('')
const status = ref<UserStatus | ''>('')
// Filters live in refs the fetcher reads, so a reset + reload always uses the latest ones.
let appliedQ = ''
const list = useCursorList<AdminUserDto>((cursor) => api.users({ q: appliedQ, role: role.value || undefined, status: status.value || undefined }, cursor))

function reload() {
  list.reset()
  void list.loadMore()
}
let timer: ReturnType<typeof setTimeout> | undefined
watch(q, (v) => {
  clearTimeout(timer)
  timer = setTimeout(() => {
    appliedQ = v.trim()
    reload()
  }, DEBOUNCE_MS)
})
watch([role, status], reload)
onMounted(() => void list.loadMore())
onBeforeUnmount(() => clearTimeout(timer))

const isSelf = (u: AdminUserDto) => u.id === auth.user?.id

const pending = ref<Pending | null>(null)
const note = ref('')
const busy = ref(false)
const open = computed({
  get: () => pending.value !== null,
  set: (v) => {
    if (!v) pending.value = null
  },
})

function ask(u: AdminUserDto, kind: 'status' | 'role', e: Event) {
  const el = e.target as HTMLSelectElement
  const value = el.value
  // The select only shows the saved value; a change takes effect after confirmation.
  el.value = u[kind]
  if (value === u[kind]) return
  note.value = ''
  pending.value = { user: u, kind, value } as Pending
}

async function confirm() {
  const p = pending.value
  if (!p || busy.value) return
  busy.value = true
  try {
    const updated = p.kind === 'status' ? await api.setStatus(p.user.id, p.value, note.value.trim() || undefined) : await api.setRole(p.user.id, p.value)
    list.items.value = list.items.value.map((x) => (x.id === updated.id ? updated : x))
    pending.value = null
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-3 flex flex-wrap gap-2 text-sm">
      <input v-model="q" data-test="user-q" type="search" :placeholder="t('admin.users.search')" :aria-label="t('admin.users.search')" class="min-w-0 flex-1 field" />
      <select v-model="role" data-test="filter-role" :aria-label="t('admin.users.role')" class="field">
        <option value="">{{ t('admin.users.allRoles') }}</option>
        <option v-for="r in ROLES" :key="r" :value="r">{{ t(`admin.roles.${r}`) }}</option>
      </select>
      <select v-model="status" data-test="filter-status" :aria-label="t('admin.users.status')" class="field">
        <option value="">{{ t('admin.users.allStatuses') }}</option>
        <option v-for="s in USER_STATUSES" :key="s" :value="s">{{ t(`admin.statuses.${s}`) }}</option>
      </select>
    </div>

    <ul class="flex flex-col gap-2">
      <li v-for="u in list.items.value" :key="u.id" data-test="user-row" class="flex flex-col gap-2 card p-3 text-sm sm:flex-row sm:items-center">
        <div class="min-w-0 flex-1">
          <p class="truncate font-semibold">@{{ u.username }} <span v-if="u.emailVerified" class="text-xs font-normal text-[var(--c-muted)]">· {{ t('admin.users.verified') }}</span></p>
          <p class="truncate text-xs text-[var(--c-muted)]">{{ u.email }} · {{ new Date(u.createdAt).toLocaleDateString(locale) }}</p>
          <p class="text-xs text-[var(--c-muted)]">{{ t(`admin.roles.${u.role}`) }} · {{ t(`admin.statuses.${u.status}`) }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <select data-test="role-select" :value="u.role" :disabled="isSelf(u)" :aria-label="t('admin.users.roleOf', { name: '@' + u.username })" class="field disabled:opacity-60" @change="ask(u, 'role', $event)">
            <option v-for="r in ROLES" :key="r" :value="r">{{ t(`admin.roles.${r}`) }}</option>
          </select>
          <select data-test="status-select" :value="u.status" :disabled="isSelf(u)" :aria-label="t('admin.users.statusOf', { name: '@' + u.username })" class="field disabled:opacity-60" @change="ask(u, 'status', $event)">
            <option v-for="s in USER_STATUSES" :key="s" :value="s">{{ t(`admin.statuses.${s}`) }}</option>
          </select>
        </div>
      </li>
    </ul>

    <ListFooter :list="list" :empty-text="t('admin.users.empty')" />

    <Modal v-model:open="open" :title="pending?.kind === 'role' ? t('admin.users.roleTitle') : t('admin.users.statusTitle')">
      <form v-if="pending" class="flex flex-col gap-3" @submit.prevent="confirm">
        <p class="text-sm">
          {{
            pending.kind === 'status'
              ? t('admin.users.statusConfirm', { name: '@' + pending.user.username, status: t(`admin.statuses.${pending.value}`) })
              : t('admin.users.roleConfirm', { name: '@' + pending.user.username, role: t(`admin.roles.${pending.value}`) })
          }}
        </p>
        <label v-if="pending.kind === 'status'" class="flex flex-col gap-1 text-sm">
          {{ t('admin.users.note') }}
          <textarea v-model="note" :maxlength="LIMITS.adminNoteMax" rows="3" class="field" />
        </label>
        <div class="flex justify-end gap-2">
          <Btn variant="ghost" @click="open = false">{{ t('common.cancel') }}</Btn>
          <Btn type="submit" :variant="pending.kind === 'status' && pending.value !== 'active' ? 'danger' : 'primary'" :loading="busy">{{ t('admin.users.confirm') }}</Btn>
        </div>
      </form>
    </Modal>
  </div>
</template>

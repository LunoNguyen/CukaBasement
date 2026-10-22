<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { HOME_LIMITS, HOME_SECTION_TYPES, type HomeSection, type HomeSectionType, homeSectionsSchema, pickText, SITE_PAGE_TYPES, SITE_PAGES, type SitePage } from '@cuka/shared'
import { ApiError } from '@/api/client'
import * as api from '@/api/endpoints/site'
import type { HomeDraftDto, SiteImageDto, SiteVideoDto } from '@/api/types'
import Btn from '@/components/common/Btn.vue'
import Modal from '@/components/common/Modal.vue'
import Spinner from '@/components/common/Spinner.vue'
import LandingSections from '@/components/landing/LandingSections.vue'
import FullPage from '@/components/landing/fullpage/FullPage.vue'
import SectionForm from '@/components/site-editor/SectionForm.vue'
import { freshId, newSection, provideEditor, sectionTitle } from '@/components/site-editor/model'
import { useErrorText } from '@/composables/useErrorText'
import { useToast } from '@/stores/toast'

/**
 * Quản trị → Trang chủ: edit a site page — the landing page ("/") or the Introduction page ("/gioi-thieu") — as a
 * list of sections (add, reorder, duplicate, hide, delete, edit fields), with a live preview drawn by the same
 * components as the public page. Each page has its own draft (saves are guarded by its revision); "Xuất bản" makes
 * the draft public.
 */
const { t, locale } = useI18n()
const toast = useToast()
const errorText = useErrorText()

const draft = ref<HomeDraftDto | null>(null)
const sections = ref<HomeSection[]>([])
const saved = ref('[]')
const images = ref<Record<string, SiteImageDto>>({})
const videos = ref<Record<string, SiteVideoDto>>({})
const page = ref<SitePage>('home')
const LANGS = ['vi', 'en'] as const
const lang = ref<'vi' | 'en'>(locale.value === 'en' ? 'en' : 'vi')
const setLang = (l: 'vi' | 'en') => (lang.value = l)
provideEditor({ lang, images, videos })

const selectedId = ref<string | null>(null)
const selected = computed(() => sections.value.find((s) => s.id === selectedId.value) ?? null)
const loadError = ref<unknown>(null)
const busy = ref<'' | 'save' | 'publish' | 'discard'>('')
const conflict = ref(false)
const problem = ref<string | null>(null)
const view = ref<'edit' | 'preview'>('edit')
const confirm = ref<'' | 'publish' | 'discard' | 'delete'>('')
const addType = ref<HomeSectionType>(SITE_PAGE_TYPES.home[0]!)
/** The page's own section types first, then the others. */
const addGroups = computed(() => {
  const own = SITE_PAGE_TYPES[page.value]
  return [
    { key: page.value, types: own },
    { key: page.value === 'home' ? 'intro' : 'home', types: HOME_SECTION_TYPES.filter((ty) => !own.includes(ty)) },
  ]
})

const dirty = computed(() => JSON.stringify(sections.value) !== saved.value)

function apply(d: HomeDraftDto) {
  draft.value = d
  sections.value = JSON.parse(JSON.stringify(d.sections)) as HomeSection[]
  saved.value = JSON.stringify(d.sections)
  images.value = { ...images.value, ...d.images }
  videos.value = { ...videos.value, ...(d.videos ?? {}) }
  conflict.value = false
  problem.value = null
  if (!sections.value.some((s) => s.id === selectedId.value)) selectedId.value = sections.value[0]?.id ?? null
}

async function load() {
  loadError.value = null
  try {
    apply(await api.pageDraft(page.value))
  } catch (e) {
    loadError.value = e
  }
}
onMounted(load)

/** Switches the page being edited (asks first when there are unsaved changes). */
async function switchPage(p: SitePage) {
  if (p === page.value || busy.value) return
  if (dirty.value && !window.confirm(t('admin.home.leaveConfirm'))) return
  page.value = p
  draft.value = null
  selectedId.value = null
  addType.value = SITE_PAGE_TYPES[p][0]!
  view.value = 'edit'
  await load()
}

// --- Section list ----------------------------------------------------------------------------------------------
const label = (s: HomeSection) => pickText(sectionTitle(s), lang.value) || t(`admin.home.types.${s.type}`)

function move(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= sections.value.length) return
  const next = [...sections.value]
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  sections.value = next
}
function add() {
  if (sections.value.length >= HOME_LIMITS.sectionsMax) return
  const s = newSection(addType.value, freshId(addType.value, new Set(sections.value.map((x) => x.id))))
  const at = selected.value ? sections.value.indexOf(selected.value) + 1 : sections.value.length
  sections.value = [...sections.value.slice(0, at), s, ...sections.value.slice(at)]
  selectedId.value = s.id
  view.value = 'edit'
}
function duplicate(s: HomeSection) {
  if (sections.value.length >= HOME_LIMITS.sectionsMax) return
  const copy = { ...(JSON.parse(JSON.stringify(s)) as HomeSection), id: freshId(s.type, new Set(sections.value.map((x) => x.id))) } as HomeSection
  const at = sections.value.indexOf(s) + 1
  sections.value = [...sections.value.slice(0, at), copy, ...sections.value.slice(at)]
  selectedId.value = copy.id
}
function removeSelected() {
  const s = selected.value
  confirm.value = ''
  if (!s) return
  const i = sections.value.indexOf(s)
  sections.value = sections.value.filter((x) => x !== s)
  selectedId.value = sections.value[Math.min(i, sections.value.length - 1)]?.id ?? null
}

// --- Save / publish / discard ----------------------------------------------------------------------------------
/** Checks the draft with the shared schema; on a problem selects its section and explains which field. */
function validate(): HomeSection[] | null {
  const r = homeSectionsSchema.safeParse(sections.value)
  if (r.success) {
    problem.value = null
    return r.data
  }
  const issue = r.error.issues[0]!
  const index = typeof issue.path[0] === 'number' ? issue.path[0] : -1
  const s = sections.value[index]
  if (s) selectedId.value = s.id
  const field = issue.path.slice(2).filter((p) => typeof p === 'string').join(' › ')
  problem.value = t('admin.home.invalid', { section: s ? label(s) : '—', field: field || '—' })
  view.value = 'edit'
  return null
}

function onError(e: unknown) {
  if (e instanceof ApiError && e.code === 'REVISION_CONFLICT') conflict.value = true
  toast.push({ kind: 'error', text: errorText(e) })
}

async function save(): Promise<boolean> {
  if (!draft.value || busy.value) return false
  const valid = validate()
  if (!valid) return false
  busy.value = 'save'
  try {
    apply(await api.savePageDraft(page.value, draft.value.revision, valid))
    toast.push({ kind: 'success', text: t('admin.home.saved') })
    return true
  } catch (e) {
    onError(e)
    return false
  } finally {
    busy.value = ''
  }
}

async function publish() {
  confirm.value = ''
  if (!draft.value) return
  if (dirty.value && !(await save())) return
  busy.value = 'publish'
  try {
    apply(await api.publishPage(page.value, draft.value.revision))
    toast.push({ kind: 'success', text: t('admin.home.publishedPage', { page: t(`admin.home.pages.${page.value}`) }) })
  } catch (e) {
    onError(e)
  } finally {
    busy.value = ''
  }
}

async function discard() {
  confirm.value = ''
  if (!draft.value) return
  busy.value = 'discard'
  try {
    apply(await api.discardPageDraft(page.value, draft.value.revision))
    toast.push({ kind: 'success', text: t('admin.home.discarded') })
  } catch (e) {
    onError(e)
  } finally {
    busy.value = ''
  }
}

// --- Unsaved changes guard -------------------------------------------------------------------------------------
const leaveOk = () => !dirty.value || window.confirm(t('admin.home.leaveConfirm'))
onBeforeRouteLeave(leaveOk)
// Switching admin tabs is a query change on the same route.
onBeforeRouteUpdate((to, from) => (to.query.tab === from.query.tab ? true : leaveOk()))
function beforeUnload(e: BeforeUnloadEvent) {
  if (!dirty.value) return
  e.preventDefault()
  e.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))

// --- Preview scaling: the page is drawn at desktop width and scaled into its pane --------------------------------
const PREVIEW_WIDTH = 1280
const pane = ref<HTMLElement | null>(null)
const inner = ref<HTMLElement | null>(null)
const scale = ref(1)
const innerHeight = ref(0)
let ro: ResizeObserver | undefined
function measure() {
  if (!pane.value || !inner.value) return
  scale.value = Math.min(1, pane.value.clientWidth / PREVIEW_WIDTH) || 1
  innerHeight.value = inner.value.offsetHeight
}
watch([pane, inner], async () => {
  ro?.disconnect()
  if (typeof ResizeObserver === 'undefined' || !pane.value || !inner.value) return
  ro = new ResizeObserver(measure)
  ro.observe(pane.value)
  ro.observe(inner.value)
  await nextTick()
  measure()
})
onBeforeUnmount(() => ro?.disconnect())

const fmt = (iso: string) => new Date(iso).toLocaleString(locale.value === 'en' ? 'en-GB' : 'vi-VN', { dateStyle: 'medium', timeStyle: 'short' })
</script>

<template>
  <div data-test="admin-home">
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="flex rounded-full border border-[var(--c-border)] p-1" role="group" :aria-label="t('admin.home.pageSwitch')" data-test="page-switch">
        <button
          v-for="p in SITE_PAGES"
          :key="p"
          type="button"
          class="min-h-11 rounded-full px-5 text-sm font-semibold transition-colors"
          :class="page === p ? 'bg-[var(--c-primary)] text-[var(--c-bg)]' : 'text-[var(--c-muted)] hover:text-[var(--c-text)]'"
          :aria-pressed="page === p"
          :data-test="`page-${p}`"
          @click="switchPage(p)"
        >
          {{ t(`admin.home.pages.${p}`) }}
        </button>
      </div>
      <RouterLink :to="page === 'home' ? '/' : '/gioi-thieu'" target="_blank" class="link text-sm" data-test="page-open">{{ t('admin.home.openPage') }} ↗</RouterLink>
    </div>
    <p v-if="loadError" class="text-sm text-[var(--c-danger)]">
      {{ errorText(loadError) }} <button type="button" class="link" @click="load">{{ t('common.retry') }}</button>
    </p>
    <div v-else-if="!draft" class="flex justify-center py-12"><Spinner /></div>
    <template v-else>
      <!-- Toolbar -->
      <div class="z-20 -mx-3 lg:sticky lg:top-[4.25rem] mb-4 flex flex-wrap items-center gap-3 border-b border-[var(--c-border)] bg-[var(--c-bg)]/95 px-3 py-3 backdrop-blur">
        <div class="mr-auto flex min-w-0 flex-col text-xs text-[var(--c-muted)]">
          <span class="flex items-center gap-2 text-sm font-semibold text-[var(--c-text)]" data-test="home-status">
            <span class="size-2 rounded-full" :class="dirty ? 'bg-[var(--c-accent)]' : draft.unpublished ? 'bg-[var(--c-latte)]' : 'bg-emerald-600'" aria-hidden="true" />
            {{ dirty ? t('admin.home.unsaved') : draft.unpublished ? t('admin.home.draftAhead') : t('admin.home.upToDate') }}
          </span>
          <span>{{ t('admin.home.publishedAt', { at: fmt(draft.publishedAt), by: draft.publishedBy?.username ?? t('admin.logs.system') }) }}</span>
        </div>
        <div class="flex rounded-full border border-[var(--c-border)] p-0.5 text-xs font-semibold" role="group" :aria-label="t('admin.home.editLang')">
          <button v-for="l in LANGS" :key="l" type="button" class="min-h-9 rounded-full px-3 uppercase" :class="lang === l ? 'bg-[var(--c-primary)] text-[var(--c-bg)]' : ''" :aria-pressed="lang === l" :data-test="`edit-lang-${l}`" @click="setLang(l)">
            {{ l }}
          </button>
        </div>
        <button type="button" class="chip lg:hidden" data-test="toggle-preview" :aria-pressed="view === 'preview'" @click="view = view === 'edit' ? 'preview' : 'edit'">
          {{ view === 'edit' ? t('admin.home.showPreview') : t('admin.home.showEditor') }}
        </button>
        <Btn variant="ghost" :disabled="!draft.unpublished && !dirty" :loading="busy === 'discard'" data-test="home-discard" @click="confirm = 'discard'">{{ t('admin.home.discard') }}</Btn>
        <Btn variant="ghost" :disabled="!dirty" :loading="busy === 'save'" data-test="home-save" @click="save">{{ t('admin.home.save') }}</Btn>
        <Btn :disabled="!dirty && !draft.unpublished" :loading="busy === 'publish'" data-test="home-publish" @click="confirm = 'publish'">{{ t('admin.home.publish') }}</Btn>
      </div>

      <div v-if="conflict" role="alert" class="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--c-danger)] p-3 text-sm">
        {{ t('admin.home.conflict') }}
        <Btn size="sm" variant="ghost" data-test="home-reload" @click="load">{{ t('admin.home.reload') }}</Btn>
      </div>
      <p v-if="problem" role="alert" data-test="home-problem" class="mb-4 rounded-xl bg-[var(--c-accent-soft)] p-3 text-sm text-[var(--c-accent-text)]">{{ problem }}</p>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <!-- Editor -->
        <div class="flex min-w-0 flex-col gap-5" :class="view === 'preview' ? 'max-lg:hidden' : ''">
          <section class="card p-3">
            <h2 class="mb-2 px-1 text-sm font-semibold">{{ t('admin.home.sections') }}</h2>
            <ol class="flex flex-col gap-1" data-test="section-list">
              <li
                v-for="(s, i) in sections"
                :key="s.id"
                class="flex items-center gap-1 rounded-lg pl-1"
                :class="s.id === selectedId ? 'bg-[var(--c-soft)]' : ''"
                data-test="section-row"
              >
                <button type="button" class="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center px-2 text-left" :aria-current="s.id === selectedId ? 'true' : undefined" data-test="section-select" @click="selectedId = s.id">
                  <span class="font-mono text-[10px] tracking-[0.1em] text-[var(--c-muted)] uppercase">{{ t(`admin.home.types.${s.type}`) }}</span>
                  <span class="w-full truncate text-sm font-medium" :class="s.visible ? '' : 'text-[var(--c-muted)] line-through'">{{ label(s) }}</span>
                </button>
                <button type="button" class="icon-btn size-9" :aria-label="s.visible ? t('admin.home.hide', { name: label(s) }) : t('admin.home.show', { name: label(s) })" :aria-pressed="!s.visible" data-test="section-visible" @click="s.visible = !s.visible">
                  <svg v-if="s.visible" viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
                  <svg v-else viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3" /></svg>
                </button>
                <button type="button" class="icon-btn size-9" :disabled="i === 0" :aria-label="t('admin.home.moveUpNamed', { name: label(s) })" data-test="section-up" @click="move(i, -1)">
                  <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
                </button>
                <button type="button" class="icon-btn size-9" :disabled="i === sections.length - 1" :aria-label="t('admin.home.moveDownNamed', { name: label(s) })" data-test="section-down" @click="move(i, 1)">
                  <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
              </li>
            </ol>
            <div class="mt-3 flex gap-2 border-t border-[var(--c-border)] pt-3">
              <label class="sr-only" for="add-type">{{ t('admin.home.addType') }}</label>
              <select id="add-type" v-model="addType" class="field min-h-11 flex-1" data-test="add-type">
                <optgroup v-for="g in addGroups" :key="g.key" :label="t(`admin.home.typeGroups.${g.key}`)">
                  <option v-for="ty in g.types" :key="ty" :value="ty">{{ t(`admin.home.types.${ty}`) }}</option>
                </optgroup>
              </select>
              <Btn variant="ghost" :disabled="sections.length >= HOME_LIMITS.sectionsMax" data-test="add-section" @click="add">{{ t('admin.home.add') }}</Btn>
            </div>
          </section>

          <section v-if="selected" :key="selected.id" class="card flex flex-col gap-4 p-4" data-test="section-editor">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="mr-auto font-display text-xl font-semibold">{{ t(`admin.home.types.${selected.type}`) }}</h2>
              <Btn size="sm" variant="ghost" data-test="section-duplicate" @click="duplicate(selected)">{{ t('admin.home.duplicate') }}</Btn>
              <Btn size="sm" variant="ghost" class="text-[var(--c-danger)]" data-test="section-delete" @click="confirm = 'delete'">{{ t('admin.home.delete') }}</Btn>
            </div>
            <label class="flex items-center gap-2 text-sm">
              <input v-model="selected.visible" type="checkbox" data-test="section-visible-check" />
              {{ t('admin.home.visible') }}
            </label>
            <SectionForm :section="selected" />
          </section>
          <p v-else class="card p-6 text-center text-sm text-[var(--c-muted)]">{{ t('admin.home.noSections') }}</p>
        </div>

        <!-- Preview -->
        <div class="min-w-0" :class="view === 'edit' ? 'max-lg:hidden' : ''">
          <div class="lg:sticky lg:top-[9.5rem]">
            <p class="eyebrow mb-2">{{ t('admin.home.preview') }} · {{ lang.toUpperCase() }}</p>
            <div ref="pane" class="overflow-hidden rounded-xl border border-[var(--c-border)] lg:max-h-[calc(100dvh-12rem)] lg:overflow-y-auto" data-test="home-preview">
              <div :style="scale < 1 ? { height: `${innerHeight * scale}px` } : undefined">
                <div ref="inner" :style="scale < 1 ? { width: `${PREVIEW_WIDTH}px`, transform: `scale(${scale})`, transformOrigin: '0 0' } : undefined">
                  <FullPage v-if="page === 'home'" :key="`fp-${lang}`" :sections="sections" :images="images" :videos="videos" :locale="lang" preview />
                  <LandingSections v-else :sections="sections" :images="images" :locale="lang" preview />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <Modal :open="confirm === 'publish'" :title="t('admin.home.publishPageTitle', { page: t(`admin.home.pages.${page}`) })" @update:open="(v) => !v && (confirm = '')">
      <p class="text-sm">{{ t('admin.home.publishConfirm') }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" @click="confirm = ''">{{ t('common.cancel') }}</Btn>
        <Btn data-test="publish-confirm" @click="publish">{{ t('admin.home.publish') }}</Btn>
      </div>
    </Modal>
    <Modal :open="confirm === 'discard'" :title="t('admin.home.discardTitle')" @update:open="(v) => !v && (confirm = '')">
      <p class="text-sm">{{ t('admin.home.discardConfirm') }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" @click="confirm = ''">{{ t('common.cancel') }}</Btn>
        <Btn variant="danger" data-test="discard-confirm" @click="discard">{{ t('admin.home.discard') }}</Btn>
      </div>
    </Modal>
    <Modal :open="confirm === 'delete'" :title="t('admin.home.deleteTitle')" @update:open="(v) => !v && (confirm = '')">
      <p class="text-sm">{{ t('admin.home.deleteConfirm', { name: selected ? label(selected) : '' }) }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <Btn variant="ghost" @click="confirm = ''">{{ t('common.cancel') }}</Btn>
        <Btn variant="danger" data-test="delete-confirm" @click="removeSelected">{{ t('admin.home.delete') }}</Btn>
      </div>
    </Modal>
  </div>
</template>

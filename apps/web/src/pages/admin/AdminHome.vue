<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { ADDABLE_SECTION_TYPES, type HomeBanner, homeBannerSchema, HOME_LIMITS, type HomeSection, type HomeSectionType, homeSectionsSchema, isSafeHref, pickText } from '@cuka/shared'
import { ApiError } from '@/api/client'
import * as api from '@/api/endpoints/site'
import type { HomeDraftDto, PageYouTubeDto, SiteImageDto, SiteVideoDto } from '@/api/types'
import Btn from '@/components/common/Btn.vue'
import Modal from '@/components/common/Modal.vue'
import Spinner from '@/components/common/Spinner.vue'
import LandingSections from '@/components/landing/LandingSections.vue'
import SectionForm from '@/components/site-editor/SectionForm.vue'
import LocalizedInput from '@/components/site-editor/LocalizedInput.vue'
import SiteImageField from '@/components/site-editor/SiteImageField.vue'
import { freshId, newSection, provideEditor, sectionTitle } from '@/components/site-editor/model'
import { useErrorText } from '@/composables/useErrorText'
import { useToast } from '@/stores/toast'

/**
 * Quản trị → Trang chủ: edit the Introduction page ("/gioi-thieu") as a list of sections (add, reorder, duplicate,
 * hide, delete, edit fields), with a live preview drawn by the same components as the public page, and the small
 * banner atop the fanart gallery ("/"), which is saved and published with it. Saves are guarded by the draft's
 * revision; "Xuất bản" makes the draft public.
 */
const { t, locale } = useI18n()
const toast = useToast()
const errorText = useErrorText()

const draft = ref<HomeDraftDto | null>(null)
const sections = ref<HomeSection[]>([])
const saved = ref('[]')
const images = ref<Record<string, SiteImageDto>>({})
const videos = ref<Record<string, SiteVideoDto>>({})
const youtube = ref<PageYouTubeDto>({ feeds: {}, videos: {} })
const page = 'intro' as const
const banner = ref<HomeBanner | null>(null)
const savedBanner = ref('null')
const bannerOpen = ref(false)
const bannerProblem = ref<string | null>(null)
const LANGS = ['vi', 'en'] as const
const lang = ref<'vi' | 'en'>(locale.value === 'en' ? 'en' : 'vi')
const setLang = (l: 'vi' | 'en') => (lang.value = l)
provideEditor({ lang, images, videos, youtube })

const selectedId = ref<string | null>(null)
const selected = computed(() => sections.value.find((s) => s.id === selectedId.value) ?? null)
const loadError = ref<unknown>(null)
const busy = ref<'' | 'save' | 'publish' | 'discard'>('')
const conflict = ref(false)
const problem = ref<string | null>(null)
const view = ref<'edit' | 'preview'>('edit')
const confirm = ref<'' | 'publish' | 'discard' | 'delete'>('')
/** What "Thêm mục" offers: the former landing blocks first, then the long-form sections (no vibe or footer). */
const addTypes = ADDABLE_SECTION_TYPES.intro
const addType = ref<HomeSectionType>(addTypes[0]!)

const dirty = computed(() => JSON.stringify(sections.value) !== saved.value || JSON.stringify(banner.value) !== savedBanner.value)

function apply(d: HomeDraftDto) {
  draft.value = d
  sections.value = JSON.parse(JSON.stringify(d.sections)) as HomeSection[]
  saved.value = JSON.stringify(d.sections)
  banner.value = d.banner ? (JSON.parse(JSON.stringify(d.banner)) as HomeBanner) : null
  savedBanner.value = JSON.stringify(d.banner ?? null)
  bannerProblem.value = null
  images.value = { ...images.value, ...d.images }
  videos.value = { ...videos.value, ...(d.videos ?? {}) }
  youtube.value = d.youtube ?? { feeds: {}, videos: {} }
  conflict.value = false
  problem.value = null
  if (!sections.value.some((s) => s.id === selectedId.value)) selectedId.value = sections.value[0]?.id ?? null
}

async function load() {
  loadError.value = null
  try {
    apply(await api.pageDraft(page))
  } catch (e) {
    loadError.value = e
  }
}
onMounted(load)

// --- Home banner ------------------------------------------------------------------------------------------------
function toggleBanner(on: boolean) {
  banner.value = on
    ? { title: { vi: 'Hibiki Du Ca', en: '' }, text: { vi: '', en: '' }, image: null, link: { label: { vi: 'Giới thiệu', en: 'About' }, href: '/gioi-thieu' } }
    : null
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
  if (banner.value) {
    const b = homeBannerSchema.safeParse(banner.value)
    if (!b.success) {
      bannerOpen.value = true
      bannerProblem.value = t('admin.home.banner.invalid', { field: b.error.issues[0]!.path.filter((p) => typeof p === 'string').join(' › ') || '—' })
      return null
    }
  }
  bannerProblem.value = null
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
    apply(await api.savePageDraft(page, draft.value.revision, valid, banner.value))
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
    apply(await api.publishPage(page, draft.value.revision))
    toast.push({ kind: 'success', text: t('admin.home.publishedPage', { page: t('admin.home.pages.intro') }) })
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
    apply(await api.discardPageDraft(page, draft.value.revision))
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
      <h2 class="text-base font-bold">{{ t('admin.home.pages.intro') }}</h2>
      <RouterLink to="/gioi-thieu" target="_blank" class="link text-sm" data-test="page-open">{{ t('admin.home.openPage') }} ↗</RouterLink>
    </div>
    <p v-if="loadError" class="text-sm text-[var(--c-danger)]">
      {{ errorText(loadError) }} <button type="button" class="link" @click="load">{{ t('common.retry') }}</button>
    </p>
    <div v-else-if="!draft" class="flex justify-center py-12"><Spinner /></div>
    <template v-else>
      <!-- Toolbar -->
      <div class="z-20 -mx-3 mb-4 flex flex-wrap items-center gap-3 border-b border-[var(--c-border)] bg-[var(--c-bg)] px-3 py-3 lg:sticky lg:top-[6.25rem]">
        <div class="mr-auto flex min-w-0 flex-col text-xs text-[var(--c-muted)]">
          <span class="flex items-center gap-2 text-sm font-semibold text-[var(--c-text)]" data-test="home-status">
            <span class="size-2 rounded-full" :class="dirty ? 'bg-[var(--c-accent)]' : draft.unpublished ? 'bg-[var(--c-muted)]' : 'bg-emerald-600'" aria-hidden="true" />
            {{ dirty ? t('admin.home.unsaved') : draft.unpublished ? t('admin.home.draftAhead') : t('admin.home.upToDate') }}
          </span>
          <span>{{ t('admin.home.publishedAt', { at: fmt(draft.publishedAt), by: draft.publishedBy?.username ?? t('admin.logs.system') }) }}</span>
        </div>
        <div class="flex rounded border border-[var(--c-border)] p-0.5 text-xs font-semibold" role="group" :aria-label="t('admin.home.editLang')">
          <button v-for="l in LANGS" :key="l" type="button" class="min-h-9 rounded-sm px-3" :class="lang === l ? 'bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'text-[var(--c-muted)]'" :aria-pressed="lang === l" :data-test="`edit-lang-${l}`" @click="setLang(l)">
            {{ l === 'vi' ? 'Tiếng Việt' : 'English' }}
          </button>
        </div>
        <button type="button" class="chip lg:hidden" data-test="toggle-preview" :aria-pressed="view === 'preview'" @click="view = view === 'edit' ? 'preview' : 'edit'">
          {{ view === 'edit' ? t('admin.home.showPreview') : t('admin.home.showEditor') }}
        </button>
        <Btn variant="secondary" :disabled="!draft.unpublished && !dirty" :loading="busy === 'discard'" data-test="home-discard" @click="confirm = 'discard'">{{ t('admin.home.discard') }}</Btn>
        <Btn variant="secondary" :disabled="!dirty" :loading="busy === 'save'" data-test="home-save" @click="save">{{ t('admin.home.save') }}</Btn>
        <Btn :disabled="!dirty && !draft.unpublished" :loading="busy === 'publish'" data-test="home-publish" @click="confirm = 'publish'">{{ t('admin.home.publish') }}</Btn>
      </div>

      <div v-if="conflict" role="alert" class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--c-danger)] p-3 text-sm">
        {{ t('admin.home.conflict') }}
        <Btn size="sm" variant="secondary" data-test="home-reload" @click="load">{{ t('admin.home.reload') }}</Btn>
      </div>
      <p v-if="problem" role="alert" data-test="home-problem" class="mb-4 rounded-lg bg-[var(--c-accent-soft)] p-3 text-sm text-[var(--c-accent-strong)]">{{ problem }}</p>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <!-- Editor -->
        <div class="flex min-w-0 flex-col gap-5" :class="view === 'preview' ? 'max-lg:hidden' : ''">
          <!-- The gallery's home banner, saved and published with this page. -->
          <section class="panel p-3" data-test="banner-panel">
            <div class="flex items-center gap-2 px-1">
              <div class="mr-auto min-w-0">
                <h2 class="text-sm font-bold">{{ t('admin.home.banner.title') }}</h2>
                <p class="truncate text-xs text-[var(--c-muted)]">{{ banner ? pickText(banner.title, lang) : t('admin.home.banner.off') }}</p>
              </div>
              <Btn size="sm" variant="secondary" data-test="banner-edit" :aria-expanded="bannerOpen" @click="bannerOpen = !bannerOpen">{{ bannerOpen ? t('admin.home.banner.done') : t('admin.home.banner.edit') }}</Btn>
            </div>
            <div v-if="bannerOpen" class="mt-3 flex flex-col gap-4 border-t border-[var(--c-border)] px-1 pt-3" data-test="banner-form">
              <p class="text-xs text-[var(--c-muted)]">{{ t('admin.home.banner.hint') }}</p>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" :checked="!!banner" data-test="banner-on" @change="toggleBanner(($event.target as HTMLInputElement).checked)" />
                {{ t('admin.home.banner.show') }}
              </label>
              <template v-if="banner">
                <div data-test="banner-title"><LocalizedInput v-model="banner.title" :label="t('admin.home.banner.fTitle')" :max="HOME_LIMITS.headingMax" required /></div>
                <LocalizedInput v-model="banner.text" :label="t('admin.home.banner.fText')" :max="HOME_LIMITS.subtitleMax" multiline :rows="2" />
                <LocalizedInput v-model="banner.link.label" :label="t('admin.home.banner.fLinkLabel')" :max="HOME_LIMITS.labelMax" required />
                <label class="flex flex-col gap-1.5 text-sm font-medium">
                  {{ t('admin.home.banner.fHref') }}
                  <input v-model="banner.link.href" class="field" type="text" :maxlength="HOME_LIMITS.urlMax" :aria-invalid="!isSafeHref(banner.link.href) || undefined" data-test="banner-href" />
                  <span class="text-xs font-normal" :class="isSafeHref(banner.link.href) ? 'text-[var(--c-muted)]' : 'text-[var(--c-danger)]'">{{ t('admin.home.hrefHint') }}</span>
                </label>
                <SiteImageField v-model="banner.image" :label="t('admin.home.banner.image')" />
              </template>
              <p v-if="bannerProblem" role="alert" class="text-xs text-[var(--c-danger)]">{{ bannerProblem }}</p>
            </div>
          </section>

          <section class="panel p-3">
            <h2 class="mb-2 px-1 text-sm font-bold">{{ t('admin.home.sections') }}</h2>
            <ol class="flex flex-col gap-1" data-test="section-list">
              <li
                v-for="(s, i) in sections"
                :key="s.id"
                class="flex items-center gap-1 rounded pl-1"
                :class="s.id === selectedId ? 'bg-[var(--c-surface-2)]' : ''"
                data-test="section-row"
              >
                <button type="button" class="flex min-h-11 min-w-0 flex-1 flex-col items-start justify-center px-2 text-left" :aria-current="s.id === selectedId ? 'true' : undefined" data-test="section-select" @click="selectedId = s.id">
                  <span class="text-[10px] text-[var(--c-muted)]">{{ t(`admin.home.types.${s.type}`) }}</span>
                  <span class="w-full truncate text-sm font-medium" :class="s.visible ? '' : 'text-[var(--c-muted)] line-through'">{{ label(s) }}</span>
                </button>
                <button type="button" class="icon-btn size-9" :aria-label="s.visible ? t('admin.home.hide', { name: label(s) }) : t('admin.home.show', { name: label(s) })" :aria-pressed="!s.visible" data-test="section-visible" @click="s.visible = !s.visible">
                  <svg v-if="s.visible" viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
                  <svg v-else viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3" /></svg>
                </button>
                <button type="button" class="icon-btn size-9" :disabled="i === 0" :aria-label="t('admin.home.moveUpNamed', { name: label(s) })" data-test="section-up" @click="move(i, -1)">
                  <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
                </button>
                <button type="button" class="icon-btn size-9" :disabled="i === sections.length - 1" :aria-label="t('admin.home.moveDownNamed', { name: label(s) })" data-test="section-down" @click="move(i, 1)">
                  <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
              </li>
            </ol>
            <div class="mt-3 flex gap-2 border-t border-[var(--c-border)] pt-3">
              <label class="sr-only" for="add-type">{{ t('admin.home.addType') }}</label>
              <select id="add-type" v-model="addType" class="field min-h-11 flex-1" data-test="add-type">
                <option v-for="ty in addTypes" :key="ty" :value="ty">{{ t(`admin.home.types.${ty}`) }}</option>
              </select>
              <Btn variant="secondary" :disabled="sections.length >= HOME_LIMITS.sectionsMax" data-test="add-section" @click="add">{{ t('admin.home.add') }}</Btn>
            </div>
          </section>

          <section v-if="selected" :key="selected.id" class="panel flex flex-col gap-4 p-4" data-test="section-editor">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="mr-auto text-base font-bold">{{ t(`admin.home.types.${selected.type}`) }}</h2>
              <Btn size="sm" variant="secondary" data-test="section-duplicate" @click="duplicate(selected)">{{ t('admin.home.duplicate') }}</Btn>
              <Btn size="sm" variant="secondary" class="text-[var(--c-danger)]" data-test="section-delete" @click="confirm = 'delete'">{{ t('admin.home.delete') }}</Btn>
            </div>
            <label class="flex items-center gap-2 text-sm">
              <input v-model="selected.visible" type="checkbox" data-test="section-visible-check" />
              {{ t('admin.home.visible') }}
            </label>
            <SectionForm :section="selected" />
          </section>
          <p v-else class="panel p-6 text-center text-sm text-[var(--c-muted)]">{{ t('admin.home.noSections') }}</p>
        </div>

        <!-- Preview -->
        <div class="min-w-0" :class="view === 'edit' ? 'max-lg:hidden' : ''">
          <div class="lg:sticky lg:top-[11rem]">
            <p class="mb-2 text-xs font-semibold text-[var(--c-muted)]">{{ t('admin.home.preview') }} · {{ lang === 'vi' ? 'Tiếng Việt' : 'English' }}</p>
            <div ref="pane" class="overflow-hidden rounded-lg border border-[var(--c-border)] lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto" data-test="home-preview">
              <div :style="scale < 1 ? { height: `${innerHeight * scale}px` } : undefined">
                <div ref="inner" :style="scale < 1 ? { width: `${PREVIEW_WIDTH}px`, transform: `scale(${scale})`, transformOrigin: '0 0' } : undefined">
                  <div class="p-6"><LandingSections :sections="sections" :images="images" :videos="videos" :youtube="youtube" :locale="lang" preview /></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <Modal :open="confirm === 'publish'" :title="t('admin.home.publishPageTitle', { page: t('admin.home.pages.intro') })" @update:open="(v) => !v && (confirm = '')">
      <p class="text-sm">{{ t('admin.home.publishConfirm') }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <Btn variant="secondary" @click="confirm = ''">{{ t('common.cancel') }}</Btn>
        <Btn data-test="publish-confirm" @click="publish">{{ t('admin.home.publish') }}</Btn>
      </div>
    </Modal>
    <Modal :open="confirm === 'discard'" :title="t('admin.home.discardTitle')" @update:open="(v) => !v && (confirm = '')">
      <p class="text-sm">{{ t('admin.home.discardConfirm') }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <Btn variant="secondary" @click="confirm = ''">{{ t('common.cancel') }}</Btn>
        <Btn variant="danger" data-test="discard-confirm" @click="discard">{{ t('admin.home.discard') }}</Btn>
      </div>
    </Modal>
    <Modal :open="confirm === 'delete'" :title="t('admin.home.deleteTitle')" @update:open="(v) => !v && (confirm = '')">
      <p class="text-sm">{{ t('admin.home.deleteConfirm', { name: selected ? label(selected) : '' }) }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <Btn variant="secondary" @click="confirm = ''">{{ t('common.cancel') }}</Btn>
        <Btn variant="danger" data-test="delete-confirm" @click="removeSelected">{{ t('admin.home.delete') }}</Btn>
      </div>
    </Modal>
  </div>
</template>

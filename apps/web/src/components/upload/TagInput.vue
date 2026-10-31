<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LIMITS, normalizeTag } from '@cuka/shared'
import { suggestTags, type TagDto } from '@/api/endpoints/tags'

const DEBOUNCE_MS = 250

const model = defineModel<string[]>({ required: true })
const { t } = useI18n()

const text = ref('')
const suggestions = ref<TagDto[]>([])
const full = computed(() => model.value.length >= LIMITS.tagsPerPost)

let timer: ReturnType<typeof setTimeout> | null = null
/** Bumped on every keystroke and add: an older suggestion response is ignored. */
let gen = 0

function cancelSuggest() {
  if (timer !== null) clearTimeout(timer)
  timer = null
  gen++
  suggestions.value = []
}

watch(text, (q) => {
  cancelSuggest()
  if (!normalizeTag(q)) return
  const g = gen
  timer = setTimeout(async () => {
    timer = null
    try {
      const res = await suggestTags(q)
      if (g === gen) suggestions.value = res.filter((s) => !model.value.includes(s.name))
    } catch {
      /* suggestions are optional */
    }
  }, DEBOUNCE_MS)
})

onBeforeUnmount(cancelSuggest)

function add(raw: string) {
  const tag = normalizeTag(raw)
  if (tag && !full.value && !model.value.includes(tag)) model.value = [...model.value, tag]
  text.value = ''
  cancelSuggest()
}

function remove(tag: string) {
  model.value = model.value.filter((x) => x !== tag)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault()
    if (text.value.trim()) add(text.value)
  }
}
</script>

<template>
  <div class="flex flex-col gap-2 text-sm">
    <ul v-if="model.length" class="flex flex-wrap gap-1">
      <li v-for="tag in model" :key="tag" data-test="tag-chip" class="flex items-center gap-1 rounded-full bg-[var(--c-surface-2)] py-1 pr-2 pl-3 text-[var(--c-accent-strong)]">
        #{{ tag }}
        <button type="button" :aria-label="t('upload.removeTag', { tag })" @click="remove(tag)">✕</button>
      </li>
    </ul>
    <div class="relative">
      <input
        v-model="text"
        data-test="tag-input"
        class="w-full field"
        :placeholder="t('upload.tagsPlaceholder')"
        :disabled="full"
        :maxlength="LIMITS.tagMax + 1"
        @keydown="onKeydown"
      />
      <ul v-if="suggestions.length" class="menu absolute z-10 mt-1 w-full">
        <li v-for="s in suggestions" :key="s.name">
          <button data-test="tag-suggestion" type="button" class="w-full px-2 py-1 text-left hover:bg-[var(--c-border)]" @click="add(s.name)">
            #{{ s.display }} <span class="text-xs text-[var(--c-muted)]">{{ s.postCount }}</span>
          </button>
        </li>
      </ul>
    </div>
    <p class="text-xs text-[var(--c-muted)]">{{ t('upload.tagsMax', { n: LIMITS.tagsPerPost }) }}</p>
  </div>
</template>

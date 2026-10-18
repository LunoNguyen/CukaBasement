<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { POST_TYPES, type PostType } from '@cuka/shared'
import { search } from '@/api/endpoints/feed'
import Btn from '@/components/common/Btn.vue'
import PostFeed from '@/components/post/PostFeed.vue'

const FILTER_TYPES = POST_TYPES.filter((x) => x !== 'other')
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v)
const q = computed(() => String(first(route.query.q) ?? '').trim())
const type = computed<PostType | undefined>(() => {
  const v = first(route.query.type)
  return FILTER_TYPES.find((x) => x === v)
})
const input = ref(q.value)
watch(q, (v) => (input.value = v))

function go(next: { q?: string; type?: PostType }) {
  const query: Record<string, string> = {}
  if (next.q) query.q = next.q
  if (next.type) query.type = next.type
  void router.replace({ path: '/search', query })
}
const submit = () => go({ q: input.value.trim(), type: type.value })
const toggleType = (x: PostType) => go({ q: q.value, type: type.value === x ? undefined : x })
</script>

<template>
  <div class="flex flex-col gap-3">
    <form class="flex gap-2" @submit.prevent="submit">
      <input
        v-model="input"
        type="search"
        :placeholder="t('search.placeholder')"
        :aria-label="t('nav.search')"
        maxlength="100"
        class="min-w-0 flex-1 rounded border border-[var(--c-border)] bg-[var(--c-surface)] px-3 py-1.5"
      />
      <Btn type="submit">{{ t('nav.search') }}</Btn>
    </form>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="x in FILTER_TYPES"
        :key="x"
        type="button"
        :data-test="`type-${x}`"
        :aria-pressed="type === x"
        class="rounded-full border px-3 py-1 text-sm"
        :class="type === x ? 'border-[var(--c-accent)] font-semibold' : 'border-[var(--c-border)]'"
        @click="toggleType(x)"
      >
        {{ t(`post.type.${x}`) }}
      </button>
    </div>
    <PostFeed
      v-if="q || type"
      :key="`${q}|${type ?? ''}`"
      :fetch-page="(c) => search({ q: q || undefined, type }, c)"
      :empty-text="t('search.empty')"
    />
  </div>
</template>

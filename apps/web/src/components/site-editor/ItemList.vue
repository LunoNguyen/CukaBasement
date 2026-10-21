<script setup lang="ts" generic="T">
import { useI18n } from 'vue-i18n'

/** An ordered list of rows (gallery images, facts, milestones…) with move up/down, remove and add. */
const props = defineProps<{ label: string; max: number; addLabel: string; create: () => T; testId?: string }>()
const items = defineModel<T[]>({ required: true })
const { t } = useI18n()

function move(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= items.value.length) return
  const next = [...items.value]
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  items.value = next
}
const remove = (i: number) => (items.value = items.value.filter((_, k) => k !== i))
const add = () => (items.value = [...items.value, props.create()])
const update = (i: number, v: T) => (items.value = items.value.map((x, k) => (k === i ? v : x)))
</script>

<template>
  <fieldset class="flex flex-col gap-3" :data-test="testId">
    <legend class="mb-2 flex w-full items-center justify-between text-sm font-semibold">
      {{ label }}<span class="font-mono text-xs font-normal text-[var(--c-muted)]">{{ items.length }}/{{ max }}</span>
    </legend>
    <div v-for="(item, i) in items" :key="i" class="flex flex-col gap-3 rounded-xl border border-[var(--c-border)] bg-[var(--c-bg)] p-3" data-test="item-row">
      <div class="flex items-center gap-1">
        <span class="mr-auto font-mono text-xs text-[var(--c-muted)]">#{{ i + 1 }}</span>
        <button type="button" class="icon-btn size-9" :disabled="i === 0" :aria-label="t('admin.home.moveUp')" data-test="item-up" @click="move(i, -1)">
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
        </button>
        <button type="button" class="icon-btn size-9" :disabled="i === items.length - 1" :aria-label="t('admin.home.moveDown')" data-test="item-down" @click="move(i, 1)">
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <button type="button" class="icon-btn size-9 text-[var(--c-danger)]" :aria-label="t('admin.home.removeItem', { n: i + 1 })" data-test="item-remove" @click="remove(i)">
          <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg>
        </button>
      </div>
      <slot :item="item" :index="i" :update="(v: T) => update(i, v)" />
    </div>
    <button
      v-if="items.length < max"
      type="button"
      class="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--c-border)] text-sm font-semibold text-[var(--c-muted)] hover:border-[var(--c-latte)] hover:text-[var(--c-text)]"
      data-test="item-add"
      @click="add"
    >
      <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      {{ addLabel }}
    </button>
  </fieldset>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

defineProps<{ title?: string; wide?: boolean }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const titleId = useId()
const dialog = ref<HTMLElement | null>(null)
let previous: HTMLElement | null = null

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    open.value = false
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const items = Array.from(dialog.value.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (!items.length) {
    e.preventDefault()
    dialog.value.focus()
    return
  }
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  const outside = !dialog.value.contains(active) || active === dialog.value
  if (e.shiftKey && (active === first || outside)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || outside)) {
    e.preventDefault()
    first.focus()
  }
}

function release() {
  document.removeEventListener('keydown', onKeydown)
  previous?.focus?.()
  previous = null
}

watch(
  open,
  async (isOpen) => {
    if (isOpen) {
      previous = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      const first = dialog.value?.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? dialog.value)?.focus()
    } else {
      release()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex items-center justify-center bg-[#17110e]/60 p-3 backdrop-blur-sm"
      @click.self="open = false"
    >
      <div
        ref="dialog"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        :aria-labelledby="titleId"
        class="max-h-[calc(100vh-1.5rem)] w-full overflow-y-auto rounded-2xl border border-[var(--c-border)] bg-[var(--c-surface)] p-5 text-[var(--c-text)] shadow-2xl"
        :class="wide ? 'max-w-2xl' : 'max-w-md'"
      >
        <div class="mb-4 flex items-center justify-between gap-3">
          <h2 :id="titleId" class="font-display text-xl font-semibold">{{ title }}</h2>
          <button type="button" class="icon-btn -mr-2" :aria-label="t('common.close')" @click="open = false"><svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        </div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>

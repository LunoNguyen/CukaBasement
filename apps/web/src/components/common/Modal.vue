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
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-3"
      @click.self="open = false"
    >
      <div
        ref="dialog"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        :aria-labelledby="titleId"
        class="w-full rounded bg-[var(--c-surface)] p-4 text-[var(--c-text)] shadow-lg"
        :class="wide ? 'max-w-2xl' : 'max-w-md'"
      >
        <div class="mb-3 flex items-center justify-between">
          <h2 :id="titleId" class="text-lg font-semibold">{{ title }}</h2>
          <button type="button" :aria-label="t('common.close')" @click="open = false">✕</button>
        </div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>

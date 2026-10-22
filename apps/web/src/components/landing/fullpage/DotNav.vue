<script setup lang="ts">
import { useI18n } from 'vue-i18n'

/**
 * The right-edge screen dots of the landing page: one button per screen, named after it (the name also shows on
 * hover and focus), the current one marked with aria-current. Colours follow the current screen's tone.
 */
const props = defineProps<{ items: Array<{ name: string; tone: 'dark' | 'page' }>; active: number }>()
const emit = defineEmits<{ go: [index: number] }>()
const { t } = useI18n()
const dark = () => props.items[props.active]?.tone !== 'page'
</script>

<template>
  <nav
    data-test="dot-nav"
    :aria-label="t('landing.fp.sections')"
    class="fixed top-1/2 right-2 z-30 hidden -translate-y-1/2 transition-colors duration-500 md:block lg:right-4"
    :class="dark() ? 'text-[#f3ebe6]' : 'text-[var(--c-text)]'"
  >
    <ol class="flex flex-col">
      <li v-for="(it, i) in items" :key="i">
        <button
          type="button"
          class="group relative flex size-11 items-center justify-center"
          :aria-label="it.name"
          :aria-current="i === active ? 'true' : undefined"
          data-test="dot"
          @click="emit('go', i)"
        >
          <span
            class="pointer-events-none absolute right-11 rounded-full px-3 py-1 font-mono text-[10px] tracking-[0.14em] whitespace-nowrap uppercase opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            :class="dark() ? 'bg-[#0f0b09]/70 text-[#f3ebe6]' : 'bg-[var(--c-surface)] text-[var(--c-text)] shadow'"
            aria-hidden="true"
          >{{ it.name }}</span>
          <span
            class="block rounded-full border border-current transition-all duration-300"
            :class="i === active ? 'h-6 w-2 bg-current' : 'size-2 bg-transparent opacity-70 group-hover:opacity-100'"
            aria-hidden="true"
          />
        </button>
      </li>
    </ol>
  </nav>
</template>

<script setup lang="ts">
import { computed, h, type VNode } from 'vue'
import { RouterLink } from 'vue-router'
import { isExternalHref, type MdInline, parseMarkdown } from '@cuka/shared'

/**
 * The limited Markdown of the homepage (paragraphs, **bold**, *italic*, links) built as elements, never as HTML:
 * markup typed by an admin shows up as text.
 */
const props = defineProps<{ source: string }>()

function inline(nodes: MdInline[]): Array<VNode | string> {
  return nodes.map((n) => {
    switch (n.t) {
      case 'text':
        return n.v
      case 'br':
        return h('br')
      case 'strong':
        return h('strong', { class: 'font-semibold text-[var(--c-text)]' }, inline(n.c))
      case 'em':
        return h('em', inline(n.c))
      case 'link':
        return isExternalHref(n.href)
          ? h('a', { href: n.href, target: '_blank', rel: 'noopener noreferrer', class: 'link underline' }, inline(n.c))
          : h(RouterLink, { to: n.href, class: 'link underline' }, () => inline(n.c))
    }
  })
}

const blocks = computed(() => parseMarkdown(props.source))
const Render = () => blocks.value.map((b) => h('p', inline(b.c)))
</script>

<template>
  <div class="flex flex-col gap-5"><Render /></div>
</template>

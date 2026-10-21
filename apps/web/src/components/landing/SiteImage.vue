<script setup lang="ts">
import { computed } from 'vue'
import type { HomeImage } from '@cuka/shared'
import { useLanding } from './context'

/**
 * A homepage image with its responsive renders. Below the fold it loads lazily; without a ready image (none chosen,
 * or still processing) the `fallback` slot (decorative brand art) is shown instead.
 */
const props = withDefaults(defineProps<{ image: HomeImage | null | undefined; sizes?: string; eager?: boolean; imgClass?: string }>(), {
  sizes: '100vw',
  eager: false,
  imgClass: '',
})
const { images, tx } = useLanding()
const resolved = computed(() => (props.image ? images.value[props.image.fileId] : undefined))
const alt = computed(() => (props.image && !props.image.decorative ? tx(props.image.alt) : ''))
</script>

<template>
  <img
    v-if="resolved"
    :src="resolved.src"
    :srcset="resolved.srcset"
    :sizes="sizes"
    :alt="alt"
    :width="resolved.width ?? undefined"
    :height="resolved.height ?? undefined"
    :loading="eager ? 'eager' : 'lazy'"
    :fetchpriority="eager ? 'high' : undefined"
    decoding="async"
    :class="imgClass"
    data-test="site-image"
  />
  <slot v-else name="fallback" />
</template>

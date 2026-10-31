<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { PLATFORM_LABELS, artistTag } from '@cuka/shared'
import type { AuthorDto, PostCardDto } from '@/api/types'
import BrandMark from '@/components/brand/BrandMark.vue'

// Board panel 07, the credit "tag": ART BY, the artist in Fraunces, @handle · platform, then the credit chips.
const props = defineProps<{ credit: PostCardDto['credit']; author: Pick<AuthorDto, 'username' | 'displayName'> }>()
const { t } = useI18n()
const headingId = useId()

const platform = computed(() => PLATFORM_LABELS[props.credit.platform])
const name = computed(() => {
  const c = props.credit
  if (c.isOwnWork) return props.author.displayName || props.author.username
  return c.artistName.trim() || artistTag(c)
})
/** Only a real handle goes on the second line: a name-only credit already shows the name above. */
const handle = computed(() => {
  const h = props.credit.artistHandle.trim().replace(/^@+/, '')
  return h ? `@${h}` : ''
})
const repostLine = computed(() => [handle.value, platform.value].filter(Boolean).join(' · '))
</script>

<template>
  <section data-test="credit" :aria-labelledby="headingId" class="relative flex flex-col gap-1 rounded-xl border border-[var(--c-border)] bg-[var(--c-surface-2)] px-5 pt-7 pb-4 shadow-[0_10px_24px_rgb(23_17_14/0.10)]">
    <!-- The hang-tag hole. -->
    <span class="absolute top-3 left-4 size-2.5 rounded-full bg-[var(--c-muted)]" aria-hidden="true" />
    <div class="flex items-center justify-between gap-3">
      <span class="flex items-center gap-2">
        <BrandMark class="size-[22px] shrink-0" />
        <span class="text-[11px] text-[var(--c-accent-strong)]">{{ t('post.artBy') }}</span>
      </span>
      <h2 :id="headingId" class="eyebrow text-right">{{ t('post.creditLabel') }}</h2>
    </div>
    <p data-test="credit-name" class="mt-2 font-display text-[1.75rem] leading-[1.1] font-semibold tracking-[-0.02em] break-words">{{ name }}</p>
    <p data-test="credit-handle" class="text-xs text-[var(--c-muted)]">
      <template v-if="credit.isOwnWork"
        >© <RouterLink :to="`/u/${author.username}`" class="hover:text-[var(--c-text)] hover:underline">@{{ author.username }}</RouterLink> · {{ t('common.siteName') }}</template
      >
      <template v-else>{{ repostLine }}</template>
    </p>
    <p v-if="!credit.isOwnWork && credit.permissionNote" class="mt-1 text-sm break-words text-[var(--c-muted)]">{{ t('post.permissionNote', { note: credit.permissionNote }) }}</p>
    <div class="mt-3 flex flex-wrap items-center gap-1.5 border-t border-dashed border-[var(--c-muted)] pt-3">
      <span data-test="credit-kind" class="tag-pill tag-pill-filled">
        <svg v-if="credit.isOwnWork" viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
        <svg v-else viewBox="0 0 24 24" class="size-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
          <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        </svg>
        {{ credit.isOwnWork ? t('post.originalWork') : t('post.creditedRepost') }}
      </span>
      <!-- Every post is published with the no-AI declaration (aiDeclaration: true is required by the API). -->
      <span data-test="no-ai" class="tag-pill">{{ t('post.noAi') }}</span>
      <a
        v-if="!credit.isOwnWork && credit.sourceUrl"
        data-test="source-link"
        :href="credit.sourceUrl"
        target="_blank"
        rel="noopener noreferrer nofollow"
        class="link ml-auto inline-flex min-h-6 items-center gap-1 text-xs"
        >{{ t('post.viewSource')
        }}<svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg
      ></a>
    </div>
  </section>
</template>

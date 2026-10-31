<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { PLATFORM_LABELS, artistTag } from '@cuka/shared'
import type { AuthorDto, PostCardDto } from '@/api/types'

/** "Nguồn tác phẩm": one line "Art by Name · @handle · Platform", the credit chips and the source link. */
const props = defineProps<{ credit: PostCardDto['credit']; author: Pick<AuthorDto, 'username' | 'displayName'> }>()
const { t } = useI18n()
const headingId = useId()

const platform = computed(() => PLATFORM_LABELS[props.credit.platform])
const name = computed(() => {
  const c = props.credit
  if (c.isOwnWork) return props.author.displayName || props.author.username
  return c.artistName.trim() || artistTag(c)
})
/** Only a real handle follows the name: a name-only credit already shows the name. */
const handle = computed(() => {
  const h = props.credit.artistHandle.trim().replace(/^@+/, '')
  return h ? `@${h}` : ''
})
const repostLine = computed(() => [handle.value, platform.value].filter(Boolean).join(' · '))
</script>

<template>
  <section data-test="credit" :aria-labelledby="headingId" class="flex flex-col gap-2 rounded-lg bg-[var(--c-surface-2)] p-4">
    <h2 :id="headingId" class="text-xs font-bold text-[var(--c-muted)]">{{ t('post.creditLabel') }}</h2>
    <p data-test="credit-line" class="text-sm break-words">
      {{ t('post.artBy') }} <strong data-test="credit-name" class="font-bold">{{ name }}</strong>
      <template v-if="credit.isOwnWork || repostLine">
        ·
        <span data-test="credit-handle" class="text-[var(--c-muted)]"
          ><template v-if="credit.isOwnWork"
            >© <RouterLink :to="`/u/${author.username}`" class="hover:text-[var(--c-text)] hover:underline">@{{ author.username }}</RouterLink></template
          ><template v-else>{{ repostLine }}</template></span
        >
      </template>
    </p>
    <p v-if="!credit.isOwnWork && credit.permissionNote" class="text-[13px] break-words text-[var(--c-muted)]">{{ t('post.permissionNote', { note: credit.permissionNote }) }}</p>
    <div class="flex flex-wrap items-center gap-1.5">
      <span data-test="credit-kind" class="tag-pill tag-pill-filled">{{ credit.isOwnWork ? t('post.originalWork') : t('post.creditedRepost') }}</span>
      <!-- Every post is published with the no-AI declaration (aiDeclaration: true is required by the API). -->
      <span data-test="no-ai" class="tag-pill">{{ t('post.noAi') }}</span>
      <a
        v-if="!credit.isOwnWork && credit.sourceUrl"
        data-test="source-link"
        :href="credit.sourceUrl"
        target="_blank"
        rel="noopener noreferrer nofollow"
        class="link ml-auto inline-flex min-h-8 items-center gap-1 text-[13px]"
        >{{ t('post.viewSource')
        }}<svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9" /></svg
      ></a>
    </div>
  </section>
</template>

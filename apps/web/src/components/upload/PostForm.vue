<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LIMITS, POST_TYPES, R18_REQUIRED_TAGS, type PostType, type Rating } from '@cuka/shared'
import type { CreatePostBody } from '@/api/endpoints/posts'
import type { PostDto } from '@/api/types'
import { useUploader } from '@/composables/useUploader'
import Btn from '@/components/common/Btn.vue'
import CreditFields from './CreditFields.vue'
import FileDropzone from './FileDropzone.vue'
import FileQueueItem from './FileQueueItem.vue'
import TagInput from './TagInput.vue'
import { buildPatch, coverId, creditValid, fileSetChanged, filesOf, hasFailedExisting, hasMedia, OWN_WORK, queueOf, toCredit, type CreditForm } from './postForm'

/** `original` makes this the edit form: it starts from that post and only enables submit once something changed. */
const props = defineProps<{ original?: PostDto | null; busy: boolean; submitLabel: string }>()
const emit = defineEmits<{ submit: [CreatePostBody] }>()
const { t } = useI18n()

const o = props.original ?? null
const uploader = useUploader(o ? queueOf(o) : [])
const { queue } = uploader

const form = reactive({
  type: (o?.type ?? 'illustration') as PostType,
  title: o?.title ?? '',
  description: o?.description ?? '',
  rating: (o?.rating ?? 'all') as Rating,
  tags: [...(o?.tags ?? [])],
  ai: false,
})
const credit = ref<CreditForm>({ ...(o?.credit ?? OWN_WORK) })
const titleTouched = ref(false)

const titleMissing = computed(() => !form.title.trim())
const r18TagError = computed(() => form.rating === 'all' && form.tags.some((tag) => R18_REQUIRED_TAGS.includes(tag)))
const cover = computed(() => coverId(queue.value))

const payload = computed(
  (): CreatePostBody => ({
    type: form.type,
    title: form.title.trim(),
    description: form.description,
    rating: form.rating,
    tags: [...form.tags],
    credit: toCredit(credit.value),
    aiDeclaration: true,
    files: filesOf(queue.value),
  }),
)
const filesChanged = computed(() => !!o && fileSetChanged(o, payload.value.files))
const dirty = computed(() => !o || Object.keys(buildPatch(o, payload.value)).length > 0)

const canSubmit = computed(
  () =>
    !props.busy &&
    dirty.value &&
    form.ai &&
    !titleMissing.value &&
    !r18TagError.value &&
    creditValid(credit.value) &&
    hasMedia(queue.value) &&
    !hasFailedExisting(queue.value) &&
    // Files still uploading would be left out of the post.
    uploader.allDone.value,
)

function submit() {
  if (canSubmit.value) emit('submit', payload.value)
}

const input = 'w-full field'
</script>

<template>
  <form class="flex flex-col gap-8" novalidate @submit.prevent="submit">
    <section class="flex flex-col gap-2 border-t border-[var(--c-border)] pt-5">
      <h2 class="text-base font-bold">{{ t('upload.sections.files') }}</h2>
      <FileDropzone @files="uploader.add" />
      <ul v-if="queue.length" class="flex flex-col gap-2">
        <FileQueueItem
          v-for="(item, i) in queue"
          :key="item.id"
          :item="item"
          :cover="item.id === cover"
          :first="i === 0"
          :last="i === queue.length - 1"
          @remove="uploader.remove(item.id)"
          @up="uploader.move(item.id, -1)"
          @down="uploader.move(item.id, 1)"
          @cover="uploader.setCover(item.id)"
        />
      </ul>
      <p v-if="filesChanged" data-test="files-changed" class="badge badge-accent self-start">{{ t('upload.filesChanged') }}</p>
    </section>

    <section class="flex flex-col gap-5 border-t border-[var(--c-border)] pt-5">
      <h2 class="text-base font-bold">{{ t('upload.sections.details') }}</h2>
      <!-- Type chips: the chosen one tinted pink. -->
      <fieldset data-test="type" class="flex flex-col gap-1 text-sm">
        <legend class="mb-1">{{ t('upload.type') }}</legend>
        <div class="flex flex-wrap gap-2">
          <label v-for="p in POST_TYPES" :key="p" class="chip">
            <input v-model="form.type" :data-test="'type-' + p" type="radio" name="post-type" :value="p" class="sr-only" />{{ t('post.type.' + p) }}
          </label>
        </div>
      </fieldset>

      <label class="flex flex-col gap-1 text-sm">
        {{ t('upload.postTitle') }} *
        <input v-model="form.title" data-test="title" :class="input" :maxlength="LIMITS.titleMax" @blur="titleTouched = true" />
        <span v-if="titleTouched && titleMissing" class="text-[var(--c-danger)]">{{ t('upload.titleRequired') }}</span>
      </label>

      <label class="flex flex-col gap-1 text-sm">
        {{ t('upload.description') }}
        <textarea v-model="form.description" data-test="description" :class="input" rows="4" :maxlength="LIMITS.descriptionMax" />
        <span class="self-end text-xs text-[var(--c-muted)]">{{ form.description.length }}/{{ LIMITS.descriptionMax }}</span>
      </label>

      <div class="flex flex-col gap-1 text-sm">
        {{ t('upload.tags') }}
        <TagInput v-model="form.tags" />
      </div>

      <fieldset class="flex flex-col gap-1 text-sm">
        <legend class="mb-1">{{ t('upload.rating') }}</legend>
        <div class="flex flex-wrap gap-2">
          <label class="chip"><input v-model="form.rating" data-test="rating-all" type="radio" name="rating" value="all" class="sr-only" />{{ t('upload.ratingAll') }}</label>
          <label class="chip"><input v-model="form.rating" data-test="rating-r18" type="radio" name="rating" value="r18" class="sr-only" />{{ t('upload.ratingR18') }}</label>
        </div>
        <span v-if="r18TagError" data-test="r18-tag-error" class="text-[var(--c-danger)]">{{ t('upload.r18TagRequired') }}</span>
      </fieldset>
    </section>

    <section class="flex flex-col gap-4 border-t border-[var(--c-border)] pt-5">
      <h2 class="text-base font-bold">{{ t('upload.sections.credit') }}</h2>
      <CreditFields v-model="credit" />
      <label class="flex items-start gap-2 border-t border-dashed border-[var(--c-muted)] pt-4 text-sm">
        <input v-model="form.ai" data-test="ai-declaration" type="checkbox" class="mt-1" />
        {{ t('upload.aiDeclaration') }}
      </label>
    </section>

    <p v-if="!hasMedia(queue)" class="text-xs text-[var(--c-muted)]">{{ t('upload.needMedia') }}</p>
    <Btn data-test="submit" type="submit" class="self-start" :loading="busy" :disabled="!canSubmit">{{ submitLabel }}</Btn>
  </form>
</template>

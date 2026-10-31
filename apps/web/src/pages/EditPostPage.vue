<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getPost, updatePost, type CreatePostBody } from '@/api/endpoints/posts'
import type { PostDto } from '@/api/types'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import EmptyState from '@/components/common/EmptyState.vue'
import Spinner from '@/components/common/Spinner.vue'
import PostForm from '@/components/upload/PostForm.vue'
import { buildPatch } from '@/components/upload/postForm'
import { useErrorText } from '@/composables/useErrorText'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuth()
const toast = useToast()
const errorText = useErrorText()

const post = ref<PostDto | null>(null)
const loadError = ref('')
const busy = ref(false)
const isOwner = computed(() => !!post.value && auth.user?.id === post.value.author.id)

let gen = 0
async function load(id: string) {
  const g = ++gen
  post.value = null
  loadError.value = ''
  try {
    const p = await getPost(id)
    if (g === gen) post.value = p
  } catch (e) {
    if (g === gen) loadError.value = errorText(e)
  }
}

watch(
  () => route.params.id,
  (id) => {
    if (typeof id === 'string') void load(id)
  },
  { immediate: true },
)

async function submit(body: CreatePostBody) {
  const p = post.value
  if (!p) return
  busy.value = true
  try {
    await updatePost(p.id, buildPatch(p, body))
    toast.push({ kind: 'success', text: t('upload.saved') })
    await router.push(`/posts/${p.id}`)
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-[760px]">
    <h1 class="mb-6 text-2xl font-bold">{{ t('upload.editTitle') }}</h1>
    <EmptyState v-if="loadError">{{ loadError }}</EmptyState>
    <div v-else-if="!post" class="flex justify-center py-10"><Spinner /></div>
    <EmptyState v-else-if="!isOwner">{{ t('forbidden.body') }}</EmptyState>
    <PostForm v-else :key="post.id" :original="post" :busy="busy" :submit-label="t('upload.save')" @submit="submit" />
  </div>
</template>

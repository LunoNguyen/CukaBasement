<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { createPost, type CreatePostBody } from '@/api/endpoints/posts'
import { useToast } from '@/stores/toast'
import PostForm from '@/components/upload/PostForm.vue'
import { useErrorText } from '@/composables/useErrorText'

const { t } = useI18n()
const router = useRouter()
const toast = useToast()
const errorText = useErrorText()
const busy = ref(false)

async function submit(body: CreatePostBody) {
  busy.value = true
  try {
    const post = await createPost(body)
    toast.push({ kind: 'success', text: t('upload.posted') })
    await router.push(`/posts/${post.id}`)
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-[760px]">
    <h1 class="mb-6 text-2xl font-bold">{{ t('upload.title') }}</h1>
    <PostForm :busy="busy" :submit-label="t('upload.submit')" @submit="submit" />
  </div>
</template>

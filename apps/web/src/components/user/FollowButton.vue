<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import * as interactionsApi from '@/api/endpoints/interactions'
import { useErrorText } from '@/composables/useErrorText'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import Btn from '@/components/common/Btn.vue'

const props = defineProps<{ username: string; following: boolean }>()
const emit = defineEmits<{ change: [state: { following: boolean; followerCount: number }] }>()
const { t } = useI18n()
const errorText = useErrorText()
const auth = useAuth()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const busy = ref(false)

async function toggle() {
  if (!auth.isLoggedIn) {
    void router.push({ path: '/login', query: { next: route.fullPath } })
    return
  }
  if (busy.value) return
  busy.value = true
  try {
    emit('change', await (props.following ? interactionsApi.unfollow(props.username) : interactionsApi.follow(props.username)))
  } catch (e) {
    toast.push({ kind: 'error', text: errorText(e) })
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Btn data-test="follow" :variant="following ? 'ghost' : 'primary'" :loading="busy" :aria-pressed="following" @click="toggle">{{
    following ? t('user.following') : t('user.follow')
  }}</Btn>
</template>

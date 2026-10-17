import { ref } from 'vue'
import { defineStore } from 'pinia'

export interface Toast {
  id: number
  kind: 'error' | 'success' | 'info'
  text: string
}

const MAX = 3
const TTL_MS = 4000

export const useToast = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])
  let seq = 0

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function push(t: Omit<Toast, 'id'>) {
    const id = ++seq
    toasts.value = [...toasts.value, { ...t, id }].slice(-MAX)
    setTimeout(() => dismiss(id), TTL_MS)
  }

  return { toasts, push, dismiss }
})

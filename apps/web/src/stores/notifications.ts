import { ref } from 'vue'
import { defineStore } from 'pinia'
import * as api from '@/api/endpoints/notifications'

export const POLL_MS = 60_000

const isVisible = () => document.visibilityState === 'visible'

export const useNotifications = defineStore('notifications', () => {
  const count = ref(0)
  let timer: ReturnType<typeof setInterval> | null = null
  let running = false

  async function refresh() {
    try {
      count.value = (await api.unreadCount()).count
    } catch {
      /* keep the last known count; the next poll retries */
    }
  }

  function clearTimer() {
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  function sync() {
    clearTimer()
    if (!running || !isVisible()) return
    void refresh()
    timer = setInterval(() => void refresh(), POLL_MS)
  }

  /** Polls while the tab is visible; idempotent. */
  function start() {
    if (running) return
    running = true
    document.addEventListener('visibilitychange', sync)
    sync()
  }

  function stop() {
    running = false
    document.removeEventListener('visibilitychange', sync)
    clearTimer()
    count.value = 0
  }

  async function markRead(ids: string[]) {
    if (!ids.length) return
    try {
      await api.markRead({ ids })
      count.value = Math.max(0, count.value - ids.length)
    } catch {
      /* stays unread; the next visit retries */
    }
  }

  async function markAllRead(): Promise<boolean> {
    try {
      await api.markRead({ all: true })
      count.value = 0
      return true
    } catch {
      return false
    }
  }

  return { count, refresh, start, stop, markRead, markAllRead }
})

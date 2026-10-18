import { ref } from 'vue'
import { defineStore } from 'pinia'

export const MAINTENANCE_POLL_MS = 10_000

/**
 * The API answered 503 MAINTENANCE: a restore from a backup is running. App.vue shows a notice instead of the
 * page (admins keep working) and /api/health is polled until it reports the site back, then the page remounts.
 */
export const useMaintenance = defineStore('maintenance', () => {
  const active = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function check() {
    timer = null
    try {
      const res = await fetch('/api/health', { headers: { accept: 'application/json' } })
      const body = (await res.json().catch(() => null)) as { maintenance?: boolean } | null
      if (res.ok && body && body.maintenance === false) {
        active.value = false
        return
      }
    } catch {
      // Unreachable while restarting: keep waiting.
    }
    schedule()
  }

  function schedule() {
    if (!timer) timer = setTimeout(() => void check(), MAINTENANCE_POLL_MS)
  }

  function enter() {
    if (active.value) return
    active.value = true
    schedule()
  }

  return { active, enter, check }
})

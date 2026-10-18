import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { refreshOnce } from '@/api/client'
import * as authApi from '@/api/endpoints/auth'
import { getMe } from '@/api/endpoints/me'
import type { RegisterInput } from '@/api/endpoints/auth'
import type { MeDto, SessionDto } from '@/api/types'
import { i18n, setLocale } from '@/i18n'

/** At least 18 full years since `YYYY-MM-DD`, on the local calendar date. */
function isAdult(birthDate: string | null, now = new Date()): boolean {
  const m = birthDate && /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  let years = now.getFullYear() - y
  const monthDiff = now.getMonth() + 1 - mo
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d)) years--
  return years >= 18
}

/**
 * Waits between re-reads of /me while a new avatar or banner is not published yet: every 3 s for 30 s, then every
 * 10 s, about 3 minutes in all (a large animated banner, or a busy or restarting worker, can take well over 30 s).
 */
export const PUBLISH_POLL_DELAYS_MS: readonly number[] = [...Array<number>(10).fill(3000), ...Array<number>(15).fill(10_000)]

/** The image URLs a save replaced; a re-render of the same file keeps the URL apart from its `?v=`. */
export type StaleImageUrls = Partial<Record<'avatarUrl' | 'bannerUrl', string | null>>

const IMAGES = [
  ['avatarFileId', 'avatarUrl'],
  ['bannerFileId', 'bannerUrl'],
] as const

/**
 * A profile image is set but not published yet: no public URL, or still the URL it had before the save (`stale`,
 * a non-null entry), e.g. while a new crop of the same file is re-rendered.
 */
function unpublished(u: MeDto | null, stale: StaleImageUrls): Array<'avatarUrl' | 'bannerUrl'> {
  if (!u) return []
  return IMAGES.filter(([id, url]) => !!u.profile[id] && (!u[url] || (stale[url] != null && u[url] === stale[url]))).map(([, url]) => url)
}

/** The session lives in memory only; it is never written to web storage. */
export const useAuth = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const user = ref<MeDto | null>(null)
  const ready = ref(false)

  const isLoggedIn = computed(() => !!token.value && !!user.value)
  const isStaff = computed(() => user.value?.role === 'moderator' || user.value?.role === 'admin')
  const isAdmin = computed(() => user.value?.role === 'admin')
  const canSeeR18 = computed(() => !!user.value && user.value.showR18 && isAdult(user.value.birthDate))

  function setSession(s: SessionDto) {
    token.value = s.accessToken
    user.value = s.user
  }

  function clear() {
    stopPublishPoll()
    stale = {}
    token.value = null
    user.value = null
  }

  // --- avatar/banner publish poll: lives here, not in the settings page, so the header still updates after the
  // user leaves the page; one poller covers both images, so a stale reply cannot undo the other one's URL.
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  /** Bumped on every (re)start and stop: a reply of an older run is dropped. */
  let pollRun = 0
  /** URLs still being replaced (see StaleImageUrls); kept across restarts so a second save does not drop the first. */
  let stale: StaleImageUrls = {}

  function stopPublishPoll() {
    clearTimeout(pollTimer)
    pollTimer = undefined
    pollRun++
  }

  /**
   * Re-reads /me (see PUBLISH_POLL_DELAYS_MS) while an avatar or banner is set without its public URL, or still has
   * the URL in `replaced` (the one shown before the save: a new crop of the same file only changes its `?v=`).
   */
  function pollUntilPublished(replaced: StaleImageUrls = {}) {
    stopPublishPoll()
    stale = { ...stale, ...replaced }
    const run = pollRun
    const step = (i: number) => {
      if (run !== pollRun) return
      const waiting = unpublished(user.value, stale)
      // Published images are done: a later save of the other one must not wait for them again.
      stale = Object.fromEntries(Object.entries(stale).filter(([k]) => waiting.includes(k as 'avatarUrl' | 'bannerUrl')))
      if (i >= PUBLISH_POLL_DELAYS_MS.length || !waiting.length) {
        stale = {}
        return
      }
      pollTimer = setTimeout(async () => {
        pollTimer = undefined
        const id = user.value?.id
        try {
          const u = await getMe()
          if (run !== pollRun || !id || user.value?.id !== id) return
          user.value = u
        } catch {
          if (run !== pollRun) return
          /* try again on the next step */
        }
        step(i + 1)
      }, PUBLISH_POLL_DELAYS_MS[i])
    }
    step(0)
  }

  function setUser(u: MeDto | null) {
    user.value = u
  }

  async function init() {
    try {
      await refreshOnce()
      // The account's saved language wins over this browser's stored one.
      const l = user.value?.locale
      if (l && l !== i18n.global.locale.value) setLocale(l)
    } finally {
      ready.value = true
    }
  }

  /** Resolves once the start-up refresh has settled (immediately if it already has). */
  function whenReady(): Promise<void> {
    if (ready.value) return Promise.resolve()
    return new Promise((resolve) => {
      const stop = watch(ready, (v) => {
        if (!v) return
        stop()
        resolve()
      })
    })
  }

  async function login(email: string, password: string) {
    setSession(await authApi.login(email, password))
  }

  function register(input: RegisterInput) {
    return authApi.register(input)
  }

  async function logout() {
    try {
      await authApi.logout()
    } catch {
      /* the local session ends regardless */
    } finally {
      clear()
    }
  }

  return { token, user, ready, isLoggedIn, isStaff, isAdmin, canSeeR18, setSession, clear, setUser, pollUntilPublished, init, whenReady, login, register, logout }
})

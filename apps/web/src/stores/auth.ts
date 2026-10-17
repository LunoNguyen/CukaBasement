import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { refreshOnce } from '@/api/client'
import * as authApi from '@/api/endpoints/auth'
import type { RegisterInput } from '@/api/endpoints/auth'
import type { MeDto, SessionDto } from '@/api/types'

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
    token.value = null
    user.value = null
  }

  function setUser(u: MeDto | null) {
    user.value = u
  }

  async function init() {
    try {
      await refreshOnce()
    } finally {
      ready.value = true
    }
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

  return { token, user, ready, isLoggedIn, isStaff, isAdmin, canSeeR18, setSession, clear, setUser, init, login, register, logout }
})

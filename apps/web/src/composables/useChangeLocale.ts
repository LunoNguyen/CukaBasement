import { useI18n } from 'vue-i18n'
import { updateSettings } from '@/api/endpoints/me'
import { setLocale, type Locale } from '@/i18n'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/stores/toast'
import { useErrorText } from '@/composables/useErrorText'

/**
 * Switches the UI language. Logged in: saved on the account first and applied only on success
 * (failure toasts and keeps the old locale). Guests: applied and kept in localStorage.
 * Resolves to whether the locale changed.
 */
export function useChangeLocale() {
  const auth = useAuth()
  const toast = useToast()
  const errorText = useErrorText()
  const { locale } = useI18n()

  return async (l: Locale): Promise<boolean> => {
    if (l === locale.value) return true
    if (auth.isLoggedIn) {
      try {
        auth.setUser(await updateSettings({ locale: l }))
      } catch (e) {
        toast.push({ kind: 'error', text: errorText(e) })
        return false
      }
    }
    setLocale(l)
    return true
  }
}

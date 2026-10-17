import { useI18n } from 'vue-i18n'
import { ApiError } from '@/api/client'

/** Localized message for any thrown error; never the raw server text. */
export function useErrorText() {
  const { t } = useI18n()
  return (e: unknown): string => t('errors.' + (e instanceof ApiError ? e.code : 'INTERNAL'))
}

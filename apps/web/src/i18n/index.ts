import { createI18n } from 'vue-i18n'
import vi from './vi'
import en from './en'

export type Locale = 'vi' | 'en'
const KEY = 'cuka.locale'

function readStored(): Locale {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'vi' || v === 'en') return v
  } catch {
    /* storage unavailable */
  }
  return 'vi'
}

const initial = readStored()

export const i18n = createI18n({
  legacy: false,
  locale: initial,
  fallbackLocale: 'vi',
  messages: { vi, en },
})

if (typeof document !== 'undefined') document.documentElement.lang = initial

export function setLocale(l: Locale): void {
  i18n.global.locale.value = l
  document.documentElement.lang = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* storage unavailable */
  }
}

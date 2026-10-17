import { ref } from 'vue'

type Theme = 'light' | 'dark'
const KEY = 'cuka.theme'

function initialTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* storage unavailable */
  }
  try {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  } catch {
    /* ignore */
  }
  return 'light'
}

const theme = ref<Theme>(initialTheme())

function apply() {
  document.documentElement.dataset.theme = theme.value
}
apply()

export function useTheme() {
  apply()
  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    apply()
    try {
      localStorage.setItem(KEY, theme.value)
    } catch {
      /* storage unavailable */
    }
  }
  return { theme, toggle }
}

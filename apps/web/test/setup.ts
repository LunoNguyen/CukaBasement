import { afterEach } from 'vitest'

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.lang = ''
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
})

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Open state of a dropdown menu: closes on a click outside `root` and on Escape (focus goes back to `button`).
 */
export function useDropdown(root: Ref<HTMLElement | null>, button: Ref<HTMLElement | null>) {
  const open = ref(false)
  function onDocClick(e: MouseEvent) {
    if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open.value) return
    open.value = false
    button.value?.focus()
  }
  onMounted(() => {
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onKey)
  })
  return open
}

import { afterEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { i18n } from '@/i18n'
import Modal from '@/components/common/Modal.vue'
import Spinner from '@/components/common/Spinner.vue'
import Btn from '@/components/common/Btn.vue'

const plugins = [i18n]

const Host = defineComponent({
  setup() {
    const open = ref(false)
    return () =>
      h('div', [
        h('button', { id: 'opener', onClick: () => (open.value = true) }, 'open'),
        h(
          Modal,
          { open: open.value, 'onUpdate:open': (v: boolean) => (open.value = v), title: 'T' },
          () => [h('input', { id: 'a' }), h('input', { id: 'b' })],
        ),
      ])
  },
})

const mounted: { unmount(): void }[] = []
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
})

describe('Modal', () => {
  async function openIt() {
    const w = mount(Host, { global: { plugins }, attachTo: document.body })
    mounted.push(w)
    const opener = w.get('#opener').element as HTMLElement
    opener.focus()
    await w.get('#opener').trigger('click')
    await flushPromises()
    await nextTick()
    return { w, opener }
  }

  it('moves focus into the dialog and labels it by title', async () => {
    await openIt()
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dlg.contains(document.activeElement)).toBe(true)
    const id = dlg.getAttribute('aria-labelledby')!
    expect(document.getElementById(id)?.textContent).toBe('T')
  })

  it('Escape closes even when focus is on body, and restores focus', async () => {
    const { opener } = await openIt()
    ;(document.activeElement as HTMLElement).blur()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('traps Tab inside the dialog', async () => {
    await openIt()
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement
    const focusables = dlg.querySelectorAll<HTMLElement>('button, input')
    const last = focusables[focusables.length - 1]!
    last.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(focusables[0])
  })
})

describe('a11y bits', () => {
  it('Spinner has an accessible name', () => {
    const w = mount(Spinner, { global: { plugins } })
    expect(w.attributes('aria-label')).toBe(i18n.global.t('common.loading'))
  })
  it('Btn sets aria-busy when loading', () => {
    expect(mount(Btn, { props: { loading: true }, global: { plugins } }).attributes('aria-busy')).toBe('true')
    expect(mount(Btn, { global: { plugins } }).attributes('aria-busy')).toBeUndefined()
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { i18n } from '@/i18n'
import Modal from '@/components/common/Modal.vue'
import Spinner from '@/components/common/Spinner.vue'
import Btn from '@/components/common/Btn.vue'
import Tabs from '@/components/common/Tabs.vue'

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

  it('Shift+Tab from the dialog element itself goes to the last focusable', async () => {
    await openIt()
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement
    const focusables = dlg.querySelectorAll<HTMLElement>('button, input')
    dlg.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(focusables[focusables.length - 1])
  })
})

describe('a11y bits', () => {
  it('Spinner has an accessible name', () => {
    const w = mount(Spinner, { global: { plugins } })
    expect(w.attributes('aria-label')).toBe(i18n.global.t('common.loading'))
  })
  it('Btn primary is filled with accent-strong and square-cornered, never a pill', () => {
    const b = mount(Btn, { props: { variant: 'primary' }, global: { plugins } })
    expect(b.classes().some((c) => c.includes('--c-accent-strong'))).toBe(true)
    expect(b.classes()).not.toContain('rounded-full')
    expect(b.classes()).toContain('rounded')
  })
  it('Btn secondary is outlined, ghost has no border, danger uses the danger colour', () => {
    const sec = mount(Btn, { props: { variant: 'secondary' }, global: { plugins } })
    expect(sec.classes()).toContain('border')
    const ghost = mount(Btn, { props: { variant: 'ghost' }, global: { plugins } })
    expect(ghost.classes()).not.toContain('border')
    const danger = mount(Btn, { props: { variant: 'danger' }, global: { plugins } })
    expect(danger.classes().some((c) => c.includes('--c-danger'))).toBe(true)
  })
  it('Btn sizes: sm is 32px, md 40px', () => {
    expect(mount(Btn, { props: { size: 'sm' }, global: { plugins } }).classes()).toContain('h-8')
    expect(mount(Btn, { global: { plugins } }).classes()).toContain('sm:h-10')
  })
  it('Btn sets aria-busy when loading', () => {
    expect(mount(Btn, { props: { loading: true }, global: { plugins } }).attributes('aria-busy')).toBe('true')
    expect(mount(Btn, { global: { plugins } }).attributes('aria-busy')).toBeUndefined()
  })
})

describe('Tabs', () => {
  const tabs = [
    { key: 'a', label: 'A' },
    { key: 'b', label: 'B' },
  ]

  // Regression: tabs pulled 1px below the row (-mb-px) overflowed an overflow-x-auto row vertically, so browsers
  // drew a vertical scrollbar at its right edge.
  it('scrolls only sideways: no tab is pulled below the row, the baseline is an inset shadow', () => {
    const w = mount(Tabs, { props: { tabs, modelValue: 'a' } })
    const row = w.get('[role="tablist"]')
    expect(row.classes()).toEqual(expect.arrayContaining(['overflow-x-auto', 'overflow-y-hidden']))
    expect(row.classes()).not.toContain('border-b')
    expect(row.classes().some((c) => c.startsWith('shadow-[inset'))).toBe(true)
    for (const tab of w.findAll('[role="tab"]')) expect(tab.classes()).not.toContain('-mb-px')
  })

  it('marks the active tab and switches on click', async () => {
    const w = mount(Tabs, { props: { tabs, modelValue: 'a', 'onUpdate:modelValue': (v: string) => w.setProps({ modelValue: v }) } })
    const [a, b] = w.findAll('[role="tab"]')
    expect(a!.attributes('aria-selected')).toBe('true')
    expect(a!.classes()).toContain('border-[var(--c-accent)]')
    await b!.trigger('click')
    expect(w.findAll('[role="tab"]')[1]!.attributes('aria-selected')).toBe('true')
  })
})

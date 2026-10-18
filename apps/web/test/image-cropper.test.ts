import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { i18n, setLocale } from '@/i18n'
import ImageCropper from '@/components/upload/ImageCropper.vue'
import { FakeCropper } from './cropperMock'

vi.mock('cropperjs', async () => ({ default: (await import('./cropperMock')).FakeCropper }))

let wrapper: VueWrapper | undefined
beforeEach(() => {
  FakeCropper.resetAll()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:source'), revokeObjectURL: vi.fn() }))
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.unstubAllGlobals()
  setLocale('vi')
  document.body.innerHTML = ''
})

const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel)

async function open(shape: 'avatar' | 'banner', file = new File([new Uint8Array(4)], 'pic.png', { type: 'image/png' })) {
  setActivePinia(createPinia())
  wrapper = mount(ImageCropper, { props: { open: true, file, shape }, global: { plugins: [i18n] }, attachTo: document.body })
  await flushPromises()
  q('[data-test="cropper-image"]')!.dispatchEvent(new Event('load'))
  await flushPromises()
  return wrapper
}
const click = async (testId: string) => {
  q<HTMLButtonElement>(`[data-test="${testId}"]`)!.click()
  await flushPromises()
}

describe('ImageCropper', () => {
  it('avatar: 1:1 crop with a round preview; exports 512×512 in the input mime at quality 0.92', async () => {
    const w = await open('avatar')
    expect(q('[data-test="cropper-image"]')!.getAttribute('src')).toBe('blob:source')
    expect(FakeCropper.last.options).toMatchObject({ aspectRatio: 1, viewMode: 1 })
    expect(q('[data-test="cropper-stage"]')!.classList.contains('crop-round')).toBe(true)
    await click('cropper-confirm')
    expect(FakeCropper.last.canvasOptions[0]).toMatchObject({ width: 512, height: 512 })
    expect(FakeCropper.last.blobArgs[0]).toEqual({ type: 'image/png', quality: 0.92 })
    const [file] = w.emitted<[File]>('confirm')![0]!
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/png')
    expect(file.name).toBe('pic.png')
    expect(file.size).toBe('cropped-bytes'.length)
    expect(w.emitted('update:open')!.at(-1)).toEqual([false])
  })

  it('banner: 4:1 crop, 1600×400, square preview; jpeg stays jpeg', async () => {
    const w = await open('banner', new File([new Uint8Array(4)], 'b.jpg', { type: 'image/jpeg' }))
    expect(FakeCropper.last.options).toMatchObject({ aspectRatio: 4 })
    expect(q('[data-test="cropper-stage"]')!.classList.contains('crop-round')).toBe(false)
    await click('cropper-confirm')
    expect(FakeCropper.last.canvasOptions[0]).toMatchObject({ width: 1600, height: 400 })
    const [file] = w.emitted<[File]>('confirm')![0]!
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toBe('b.jpg')
  })

  it('webp stays webp', async () => {
    const w = await open('avatar', new File([new Uint8Array(4)], 'w.webp', { type: 'image/webp' }))
    await click('cropper-confirm')
    expect(w.emitted<[File]>('confirm')![0]![0].type).toBe('image/webp')
  })

  it('zoom in/out, rotate 90°, flip horizontal and reset drive the cropper; every control is a labelled button', async () => {
    await open('avatar')
    const c = FakeCropper.last
    await click('cropper-zoom-in')
    expect(c.zoom).toHaveBeenLastCalledWith(0.1)
    await click('cropper-zoom-out')
    expect(c.zoom).toHaveBeenLastCalledWith(-0.1)
    await click('cropper-rotate')
    expect(c.rotate).toHaveBeenLastCalledWith(90)
    await click('cropper-flip')
    expect(c.scaleX).toHaveBeenLastCalledWith(-1)
    await click('cropper-flip')
    expect(c.scaleX).toHaveBeenLastCalledWith(1)
    await click('cropper-reset')
    expect(c.reset).toHaveBeenCalled()
    for (const id of ['zoom-in', 'zoom-out', 'rotate', 'flip', 'reset']) {
      const b = q<HTMLButtonElement>(`[data-test="cropper-${id}"]`)!
      expect(b.tagName).toBe('BUTTON')
      expect(b.getAttribute('aria-label'), id).toBeTruthy()
    }
    expect(q('[data-test="cropper-confirm"]')!.textContent).toContain('Dùng ảnh này')
    expect(q('[data-test="cropper-cancel"]')!.textContent).toContain('Hủy')
  })

  it('keyboard: arrows move the image, +/- zoom on the focused stage', async () => {
    await open('avatar')
    const c = FakeCropper.last
    const stage = q('[data-test="cropper-stage"]')!
    expect(stage.getAttribute('tabindex')).toBe('0')
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(c.move).toHaveBeenLastCalledWith(-10, 0)
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(c.move).toHaveBeenLastCalledWith(0, 10)
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))
    expect(c.zoom).toHaveBeenLastCalledWith(0.1)
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }))
    expect(c.zoom).toHaveBeenLastCalledWith(-0.1)
  })

  it('cancel emits cancel, closes and destroys the cropper; nothing is confirmed', async () => {
    const w = await open('avatar')
    const c = FakeCropper.last
    await click('cropper-cancel')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('confirm')).toBeUndefined()
    expect(w.emitted('update:open')!.at(-1)).toEqual([false])
    await w.setProps({ open: false })
    await flushPromises()
    expect(c.destroy).toHaveBeenCalled()
  })

  it('an image the browser cannot decode shows an error instead of a cropper; confirm emits nothing', async () => {
    setActivePinia(createPinia())
    const file = new File([new Uint8Array(4)], 'broken.png', { type: 'image/png' })
    const w = mount(ImageCropper, { props: { open: true, file, shape: 'avatar' }, global: { plugins: [i18n] }, attachTo: document.body })
    wrapper = w
    await flushPromises()
    q('[data-test="cropper-image"]')!.dispatchEvent(new Event('error'))
    await flushPromises()
    expect(q('[data-test="cropper-unreadable"]')!.textContent).toContain('Không mở được ảnh này')
    expect(q('[data-test="cropper-unreadable"]')!.getAttribute('role')).toBe('alert')
    expect(FakeCropper.instances).toHaveLength(0)
    await click('cropper-confirm')
    expect(w.emitted('confirm')).toBeUndefined()
    setLocale('en')
    await flushPromises()
    expect(q('[data-test="cropper-unreadable"]')!.textContent).toContain('could not be opened')
  })

  it('English copy', async () => {
    setLocale('en')
    await open('banner')
    expect(q('[data-test="cropper-confirm"]')!.textContent).toContain('Use this image')
  })
})

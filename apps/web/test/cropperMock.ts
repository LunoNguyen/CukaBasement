import { vi } from 'vitest'

/** Stand-in for a cropperjs instance: records options and calls; the cropped canvas yields a small blob. */
export class FakeCropper {
  static instances: FakeCropper[] = []
  static blobFails = false
  scaleXValue = 1
  canvasOptions: unknown[] = []
  blobArgs: Array<{ type?: string; quality?: number }> = []
  zoom = vi.fn()
  rotate = vi.fn()
  reset = vi.fn(() => {
    this.scaleXValue = 1
  })
  destroy = vi.fn()
  move = vi.fn()
  scaleX = vi.fn((v: number) => {
    this.scaleXValue = v
  })

  constructor(
    public element: HTMLImageElement,
    public options: Record<string, unknown>,
  ) {
    FakeCropper.instances.push(this)
  }

  getData() {
    return { x: 0, y: 0, width: 10, height: 10, rotate: 0, scaleX: this.scaleXValue, scaleY: 1 }
  }

  getCroppedCanvas(options: unknown) {
    this.canvasOptions.push(options)
    return {
      toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => {
        this.blobArgs.push({ type, quality })
        queueMicrotask(() => cb(FakeCropper.blobFails ? null : new Blob(['cropped-bytes'], { type })))
      },
    }
  }

  static resetAll() {
    FakeCropper.instances = []
    FakeCropper.blobFails = false
  }

  static get last(): FakeCropper {
    return FakeCropper.instances[FakeCropper.instances.length - 1]!
  }
}

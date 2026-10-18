import { vi } from 'vitest'

/**
 * Stand-in for XMLHttpRequest (the presigned POST to the object store). Each `send` is recorded;
 * with `auto` it answers 204 on the next microtask, otherwise the test calls `respond()`.
 */
export class FakeXhr {
  static instances: FakeXhr[] = []
  static auto = true

  method = ''
  url = ''
  body: FormData | null = null
  status = 0
  done = false
  aborted = false
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  send(body: FormData) {
    this.body = body
    FakeXhr.instances.push(this)
    if (FakeXhr.auto) queueMicrotask(() => this.respond())
  }

  abort() {
    if (this.done) return
    this.done = true
    this.aborted = true
    this.onabort?.()
  }

  respond(status = 204) {
    if (this.done) return
    this.done = true
    const file = this.body?.get('file') as File | null
    const size = file?.size ?? 0
    this.upload.onprogress?.({ lengthComputable: true, loaded: size, total: size })
    this.status = status
    this.onload?.()
  }

  static get pending(): FakeXhr[] {
    return FakeXhr.instances.filter((x) => !x.done)
  }
}

export function installFakeXhr(auto = true) {
  FakeXhr.instances = []
  FakeXhr.auto = auto
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
}

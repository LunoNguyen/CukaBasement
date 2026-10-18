import { afterEach, beforeEach, describe, expect, it, vi as vitest } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { BACKUP_RESTORE_CONFIRM, DEFAULT_BACKUP_SCHEDULE } from '@cuka/shared'
import { i18n } from '@/i18n'
import { createAppRouter } from '@/router'
import { useAuth } from '@/stores/auth'
import { MAINTENANCE_POLL_MS } from '@/stores/maintenance'
import type { BackupFileDto, BackupOverviewDto, BackupRunDto } from '@/api/types'
import App from '@/App.vue'
import vi from '@/i18n/vi'
import en from '@/i18n/en'
import { installFakeFetch, makeMe, type FakeFetch, type FakeRoute } from './fakeApi'

let fake: FakeFetch | undefined
let wrapper: VueWrapper | undefined
beforeEach(() => vitest.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  fake?.restore()
  fake = undefined
  document.body.innerHTML = ''
  vitest.useRealTimers()
  vitest.unstubAllGlobals()
  vitest.restoreAllMocks()
})

const ok = (body: unknown) => ({ status: 200, body })
const err = (status: number, code: string) => ({ status, body: { error: { code, message: 'raw' } } })
const modal = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null

async function mountAt(path: string, routes: Record<string, FakeRoute>, role: 'admin' | 'user' = 'admin') {
  fake = installFakeFetch(routes)
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuth()
  auth.ready = true
  auth.setSession({ accessToken: 't', user: makeMe({ id: 'u1', role }) })
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
  await flushPromises()
  return { w: wrapper, router }
}

const file = (o: Partial<BackupFileDto> = {}): BackupFileDto => ({
  name: 'cuka-backup-20261018-030000-ab12.tar.gz',
  sizeBytes: 3 * 1024 * 1024,
  createdAt: '2026-10-18T03:00:00Z',
  scheduled: false,
  ...o,
})
const run = (o: Partial<BackupRunDto> = {}): BackupRunDto => ({
  id: 'r1',
  kind: 'backup',
  trigger: 'manual',
  status: 'running',
  file: 'cuka-backup-20261018-030000-ab12.tar.gz',
  startedAt: '2026-10-18T03:00:00Z',
  finishedAt: null,
  error: null,
  progress: null,
  ...o,
})
const overview = (o: Partial<BackupOverviewDto> = {}): BackupOverviewDto => ({
  items: [file(), file({ name: 'cuka-backup-sched-20261017-030000-cd34.tar.gz', scheduled: true })],
  run: null,
  busy: false,
  maintenance: false,
  schedule: { schedule: DEFAULT_BACKUP_SCHEDULE, timeZone: 'Asia/Ho_Chi_Minh', nextRunAt: null, lastRun: null },
  maxUploadBytes: 1024 * 1024 * 1024,
  ...o,
})

async function setVal(el: Element, v: string, ev = 'input') {
  ;(el as HTMLInputElement).value = v
  el.dispatchEvent(new Event(ev))
  await flushPromises()
}
async function tick(ms: number) {
  await vitest.advanceTimersByTimeAsync(ms)
  await flushPromises()
}

describe('Admin backups tab', () => {
  it('has vi and en labels and shows the backups with size and the scheduled badge', async () => {
    expect(vi.admin.tabs.backups).toBe('Sao lưu')
    expect(en.admin.tabs.backups).toBe('Backups')
    const { w } = await mountAt('/admin?tab=backups', { 'GET /api/admin/backups': ok(overview()) })
    expect(w.find('[role="tab"][aria-selected="true"]').text()).toBe('Sao lưu')
    const rows = w.findAll('[data-test="backup-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('cuka-backup-20261018-030000-ab12.tar.gz')
    expect(rows[0]!.text()).toContain('3 MB')
    expect(rows[0]!.text()).not.toContain(vi.admin.backups.scheduledBadge)
    expect(rows[1]!.text()).toContain(vi.admin.backups.scheduledBadge)
    expect(w.find('[data-test="sched-next"]').text()).toContain(vi.admin.backups.schedule.off)
    expect(w.find('[data-test="sched-last"]').text()).toContain(vi.admin.backups.schedule.never)
  })

  it('creating a backup polls the run until it ends', async () => {
    const { w } = await mountAt('/admin?tab=backups', {
      'GET /api/admin/backups': [ok(overview({ items: [] })), ok(overview({ items: [], busy: true, run: run({ progress: { phase: 'files', done: 1, total: 4 } }) })), ok(overview({ run: run({ status: 'succeeded' }) }))],
      'POST /api/admin/backups': { status: 202, body: run() },
    })
    expect(w.text()).toContain(vi.admin.backups.empty)
    await w.find('[data-test="backup-create"]').trigger('click')
    await flushPromises()
    expect(fake!.callsTo('POST /api/admin/backups')).toHaveLength(1)
    expect(w.find('[data-test="backup-run"]').text()).toContain(vi.admin.backups.status.running)
    await tick(2000)
    expect(w.find('[data-test="backup-run"]').text()).toContain('25%')
    expect((w.find('[data-test="backup-create"]').element as HTMLButtonElement).disabled).toBe(true)
    await tick(2000)
    expect(w.find('[data-test="backup-run"]').text()).toContain(vi.admin.backups.status.succeeded)
    expect(document.body.textContent).toContain(vi.admin.backups.backupSucceeded)
    expect(w.findAll('[data-test="backup-row"]')).toHaveLength(2)
    const calls = fake!.callsTo('GET /api/admin/backups').length
    await tick(10_000)
    expect(fake!.callsTo('GET /api/admin/backups')).toHaveLength(calls)
  })

  it('shows a failed run with its error and the BACKUP_BUSY message', async () => {
    const { w } = await mountAt('/admin?tab=backups', {
      'GET /api/admin/backups': ok(overview({ run: run({ kind: 'restore', status: 'failed', error: 'Checksum mismatch for "db/users.jsonl"' }) })),
      'POST /api/admin/backups': err(409, 'BACKUP_BUSY'),
    })
    expect(w.find('[data-test="backup-run-error"]').text()).toContain('Checksum mismatch')
    await w.find('[data-test="backup-create"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain(vi.errors.BACKUP_BUSY)
  })

  it('restore needs the site name typed, then polls and asks to log in again', async () => {
    const name = file().name
    const { w, router } = await mountAt('/admin?tab=backups', {
      'GET /api/admin/backups': [ok(overview()), ok(overview({ busy: true, maintenance: true, run: run({ kind: 'restore' }) })), ok(overview({ run: run({ kind: 'restore', status: 'succeeded' }) }))],
      [`POST /api/admin/backups/${name}/restore`]: { status: 202, body: run({ kind: 'restore' }) },
    })
    await w.findAll('[data-test="backup-restore"]')[0]!.trigger('click')
    await flushPromises()
    expect(modal()!.textContent).toContain(vi.admin.backups.restoreWarning)
    const submit = modal()!.querySelector('[data-test="restore-submit"]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await setVal(modal()!.querySelector('[data-test="restore-confirm"]')!, 'cukabasement')
    expect(submit.disabled).toBe(true)
    modal()!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo(`POST /api/admin/backups/${name}/restore`)).toHaveLength(0)
    await setVal(modal()!.querySelector('[data-test="restore-confirm"]')!, BACKUP_RESTORE_CONFIRM)
    expect(submit.disabled).toBe(false)
    modal()!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo(`POST /api/admin/backups/${name}/restore`)[0]!.body).toEqual({ confirm: BACKUP_RESTORE_CONFIRM })
    expect(modal()).toBeNull()
    await tick(2000)
    expect(w.text()).toContain(vi.admin.backups.maintenanceHint)
    await tick(2000)
    expect(w.find('[data-test="restore-done"]').exists()).toBe(true)
    await w.find('[data-test="restore-done"] button').trigger('click')
    await vitest.waitFor(() => expect(router.currentRoute.value.path).toBe('/login'))
    expect(useAuth().isLoggedIn).toBe(false)
  })

  it('delete asks first, then removes the row', async () => {
    const name = file().name
    const { w } = await mountAt('/admin?tab=backups', {
      'GET /api/admin/backups': ok(overview()),
      [`DELETE /api/admin/backups/${name}`]: { status: 204 },
    })
    await w.findAll('[data-test="backup-delete"]')[0]!.trigger('click')
    await flushPromises()
    expect(fake!.callsTo(`DELETE /api/admin/backups/${name}`)).toHaveLength(0)
    expect(modal()!.textContent).toContain(name)
    modal()!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo(`DELETE /api/admin/backups/${name}`)).toHaveLength(1)
    expect(w.findAll('[data-test="backup-row"]')).toHaveLength(1)
  })

  it('download asks for a one-time link and lets the browser fetch it', async () => {
    const name = file().name
    const clicked: string[] = []
    vitest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.getAttribute('href')!)
    })
    const { w } = await mountAt('/admin?tab=backups', {
      'GET /api/admin/backups': ok(overview()),
      [`POST /api/admin/backups/${name}/download`]: ok({ url: '/api/admin/backups/download/tok', expiresAt: '2026-10-18T03:01:00Z' }),
    })
    await w.findAll('[data-test="backup-download"]')[0]!.trigger('click')
    await flushPromises()
    expect(clicked).toEqual(['/api/admin/backups/download/tok'])
  })

  it('upload sends the raw file with the bearer token, then offers to restore it', async () => {
    const sent: Array<{ url: string; headers: Record<string, string>; body: unknown }> = []
    class Xhr {
      url = ''
      headers: Record<string, string> = {}
      status = 0
      responseText = ''
      upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      open(_m: string, url: string) {
        this.url = url
      }
      setRequestHeader(k: string, v: string) {
        this.headers[k] = v
      }
      send(body: unknown) {
        sent.push({ url: this.url, headers: this.headers, body })
        queueMicrotask(() => {
          this.status = 201
          this.responseText = JSON.stringify(file({ name: 'cuka-upload-20261018-040000-ef56.tar.gz' }))
          this.onload?.()
        })
      }
      abort() {}
    }
    vitest.stubGlobal('XMLHttpRequest', Xhr)
    const { w } = await mountAt('/admin?tab=backups', { 'GET /api/admin/backups': ok(overview()) })
    const input = w.find('[data-test="backup-upload"]').element as HTMLInputElement
    const archive = new File([new Uint8Array([0x1f, 0x8b, 1, 2])], 'site.tar.gz', { type: 'application/gzip' })
    Object.defineProperty(input, 'files', { value: [archive], configurable: true })
    input.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ url: '/api/admin/backups/upload', headers: { 'Content-Type': 'application/octet-stream', Authorization: 'Bearer t' } })
    expect(sent[0]!.body).toBe(archive)
    expect(w.findAll('[data-test="backup-row"]')[0]!.text()).toContain('cuka-upload-20261018-040000-ef56.tar.gz')
    expect(modal()!.textContent).toContain('cuka-upload-20261018-040000-ef56.tar.gz')

    // Wrong extension and over the limit are refused before sending.
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'notes.zip')], configurable: true })
    input.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(sent).toHaveLength(1)
    expect(document.body.textContent).toContain(vi.admin.backups.uploadType)
  })

  it('schedule: validates, toggles weekly with a weekday, and shows next and last run', async () => {
    const saved = {
      schedule: { enabled: true, frequency: 'weekly', weekday: 3, time: '23:30', keep: 4 },
      timeZone: 'Asia/Ho_Chi_Minh',
      nextRunAt: '2026-10-21T16:30:00.000Z',
      lastRun: { at: '2026-10-14T16:31:00.000Z', outcome: 'skipped', name: null, error: 'Another backup or restore was running' },
    }
    const { w } = await mountAt('/admin?tab=backups', {
      'GET /api/admin/backups': ok(overview()),
      'PUT /api/admin/backups/schedule': ok(saved),
    })
    expect(w.find('[data-test="sched-weekday"]').exists()).toBe(false)
    await w.find('[data-test="sched-enabled"]').setValue(true)
    await setVal(w.find('[data-test="sched-frequency"]').element, 'weekly', 'change')
    expect(w.find('[data-test="sched-weekday"]').exists()).toBe(true)
    expect(w.findAll('[data-test="sched-weekday"] option')[0]!.text()).toMatch(/Chủ nhật/i)
    await setVal(w.find('[data-test="sched-weekday"]').element, '3', 'change')
    await setVal(w.find('[data-test="sched-time"]').element, '23:30')
    await setVal(w.find('[data-test="sched-keep"]').element, '0')
    w.find('[data-test="backup-schedule"] form').element.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo('PUT /api/admin/backups/schedule')).toHaveLength(0)
    expect(w.find('[data-test="backup-schedule"] [role="alert"]').exists()).toBe(true)
    await setVal(w.find('[data-test="sched-keep"]').element, '4')
    w.find('[data-test="backup-schedule"] form').element.dispatchEvent(new Event('submit', { cancelable: true }))
    await flushPromises()
    expect(fake!.callsTo('PUT /api/admin/backups/schedule')[0]!.body).toEqual(saved.schedule)
    expect(w.find('[data-test="sched-next"]').text()).toContain('Asia/Ho_Chi_Minh')
    expect(w.find('[data-test="sched-next"]').text()).toContain('23:30')
    expect(w.find('[data-test="sched-last"]').text()).toContain(vi.admin.backups.schedule.outcome.skipped)
  })

  it('is admin-only: a moderator is sent to the forbidden page', async () => {
    fake = installFakeFetch({})
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuth()
    auth.ready = true
    auth.setSession({ accessToken: 't', user: makeMe({ id: 'u1', role: 'moderator' }) })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/admin?tab=backups')
    wrapper = mount(App, { global: { plugins: [pinia, router, i18n] }, attachTo: document.body })
    await flushPromises()
    expect(fake.callsTo('GET /api/admin/backups')).toHaveLength(0)
    expect(document.body.textContent).toContain(vi.forbidden.title)
  })
})

describe('maintenance mode', () => {
  it('a 503 MAINTENANCE swaps the page for a notice until health says the site is back', async () => {
    const { w } = await mountAt(
      '/notifications',
      {
        'GET /api/notifications': [err(503, 'MAINTENANCE'), ok({ items: [], nextCursor: null })],
        'GET /api/health': [ok({ ok: true, maintenance: true }), ok({ ok: true, maintenance: false })],
      },
      'user',
    )
    expect(w.find('[data-test="maintenance"]').exists()).toBe(true)
    expect(w.text()).toContain(vi.maintenance.title)
    await tick(MAINTENANCE_POLL_MS)
    expect(fake!.callsTo('GET /api/health')).toHaveLength(1)
    expect(w.find('[data-test="maintenance"]').exists()).toBe(true)
    await tick(MAINTENANCE_POLL_MS)
    expect(w.find('[data-test="maintenance"]').exists()).toBe(false)
    expect(fake!.callsTo('GET /api/notifications').length).toBeGreaterThanOrEqual(2)
  })
})

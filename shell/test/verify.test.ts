import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { FrameOptions } from '../src/frame.js'
import { NOTE, VERIFY_PARTITION, VERIFY_URL, VerifyWindow, type VerifyDeps } from '../src/verify.js'

type Listener = (...args: any[]) => void

class FakeContents {
  constructor(private readonly events: string[] = []) {}
  listeners = new Map<string, Listener[]>()
  loaded: string[] = []
  opener: ((details: { url: string }) => any) | null = null
  loadURL(url: string): Promise<void> {
    this.loaded.push(url)
    this.events.push('load')
    return Promise.resolve()
  }
  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  setWindowOpenHandler(handler: (details: { url: string }) => any): void {
    this.opener = handler
  }
  emit(event: string, ...args: any[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args)
  }
}

class FakeWindow {
  constructor(events: string[]) {
    this.contents = new FakeContents(events)
  }
  contents: FakeContents
  closers: (() => void)[] = []
  opened = 0
  closed = false
  onClosed(cb: () => void): void { this.closers.push(cb) }
  open(): void { this.opened += 1 }
  close(): void { if (!this.closed) { this.closed = true; for (const cb of this.closers) cb() } }
}

const STORED = { ltoken_v2: 'made-up-ltoken', ltuid_v2: '1234', cookie_token_v2: 'made-up-cookie-token', lrsag: 'made-up-lrsag' }

function rig(stored: Record<string, string> | null = STORED) {
  const windows: FakeWindow[] = []
  const calls: string[] = []
  const events: string[] = []
  const set: any[] = []
  const options: FrameOptions[] = []
  const deps: VerifyDeps = {
    call: async (name) => {
      calls.push(name)
      events.push(name)
      return name === 'verify_cookies' ? stored : null
    },
    session: {
      cookies: { set: async (details) => { events.push('set'); set.push(details) } },
      clearStorageData: async () => { events.push('clear') },
    },
    createWindow: (o) => {
      options.push(o)
      const win = new FakeWindow(events)
      windows.push(win)
      return win
    },
    warn: (text) => events.push(`warn: ${text}`),
  }
  return { verify: new VerifyWindow(deps), windows, calls, events, set, options }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('the page and the note are the Qt window’s', () => {
  expect(VERIFY_URL).toBe('https://act.hoyolab.com/app/community-game-records-sea/index.html#/ys')
  expect(NOTE).toBe(
    'HoYoLAB asked for a check before it answers Guild Board again. Pass the check on this page, ' +
      'then close this window. Syncing goes on at the next sync.',
  )
})

test('cookies are set httpOnly where HoYoLAB does, on .hoyolab.com, after the session is emptied, and the page loads', async () => {
  const r = rig()
  r.verify.open()
  await flush()
  expect(r.calls).toEqual(['verify_cookies'])
  expect(r.events.slice(0, 2)).toEqual(['verify_cookies', 'clear'])
  const byName = Object.fromEntries(r.set.map((c) => [c.name, c]))
  expect(Object.keys(byName).sort()).toEqual(['cookie_token_v2', 'lrsag', 'ltoken_v2', 'ltuid_v2'])
  for (const cookie of r.set) {
    expect(cookie).toMatchObject({ url: VERIFY_URL, domain: '.hoyolab.com', path: '/', secure: true })
  }
  expect(byName.ltoken_v2.httpOnly).toBe(true)
  expect(byName.cookie_token_v2.httpOnly).toBe(true)
  expect(byName.ltuid_v2.httpOnly).toBe(false)
  expect(byName.lrsag.httpOnly).toBe(false)
  expect(r.windows[0].contents.loaded).toEqual([VERIFY_URL])
  expect(r.windows[0].opened).toBe(1)
  // the page loads once, and only after every cookie is in
  const load = r.events.indexOf('load')
  expect(r.events.filter((e) => e === 'load')).toHaveLength(1)
  expect(r.events.filter((e) => e === 'set')).toHaveLength(4)
  expect(r.events.lastIndexOf('set')).toBeLessThan(load)
})

test('the window’s own options: its title, its session and the note', async () => {
  const r = rig()
  r.verify.open()
  await flush()
  expect(VERIFY_PARTITION).toBe('gb-verify')
  expect(r.options).toEqual([{ title: 'Verify on HoYoLAB', partition: 'gb-verify', bar: { note: NOTE } }])
})

test('closing calls verification_done once, and empties the session', async () => {
  const r = rig()
  r.verify.open()
  await flush()
  r.windows[0].close()
  r.windows[0].close()
  await flush()
  expect(r.calls.filter((c) => c === 'verification_done')).toHaveLength(1)
  expect(r.events.filter((e) => e === 'clear')).toHaveLength(2)
})

test('open while the window is open brings it forward; after a close a new window opens', async () => {
  const r = rig()
  r.verify.open()
  r.verify.open() // asked again before the first has its login
  await flush()
  r.verify.open()
  expect(r.windows).toHaveLength(1)
  expect(r.windows[0].opened).toBe(2)
  expect(r.calls.filter((c) => c === 'verify_cookies')).toHaveLength(1)
  r.windows[0].close()
  await flush()
  r.verify.open()
  await flush()
  expect(r.windows).toHaveLength(2)
})

test('with no login stored nothing opens, and the core is not told the check is done', async () => {
  const r = rig(null)
  r.verify.open()
  await flush()
  expect(r.windows).toHaveLength(0)
  expect(r.calls).toEqual(['verify_cookies'])
  expect(r.events.some((e) => e.startsWith('warn:'))).toBe(true)
})

test('the page stays on HoYoverse and the sign-in sites, and opens no window', async () => {
  const r = rig()
  r.verify.open()
  await flush()
  const contents = r.windows[0].contents
  expect(contents.opener!({ url: 'https://accounts.google.com/' })).toEqual({ action: 'deny' })
  const attempt = (url: string, isMainFrame: boolean | undefined) => {
    let prevented = false
    contents.emit('will-frame-navigate', { preventDefault: () => { prevented = true }, url, isMainFrame })
    return prevented
  }
  expect(attempt('https://act.hoyolab.com/x', true)).toBe(false)
  expect(attempt('https://accounts.google.com/o/oauth2', true)).toBe(false)
  expect(attempt('https://example.com/', true)).toBe(true)
  expect(attempt('https://example.com/captcha', false)).toBe(false)
  contents.emit('did-navigate', {}, 'about:blank')
  expect(contents.loaded).toEqual([VERIFY_URL, VERIFY_URL])
})

test('opening the verification prints nothing', async () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined))
  const r = rig()
  r.verify.open()
  await flush()
  r.windows[0].close()
  await flush()
  expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([])
  expect(r.events.filter((e) => e.includes('made-up'))).toEqual([])
})

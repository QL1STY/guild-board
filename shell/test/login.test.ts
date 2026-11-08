import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  accountLabel,
  ANOTHER_SERVICE,
  CHECKING,
  CookieCollector,
  FAILED,
  LOGIN_PARTITION,
  LOGIN_URL,
  LoginFlow,
  type LoginDeps,
  type LoginPopupLike,
  loginMessage,
  MOST_POPUPS,
  NO_ACCOUNT,
  NOT_PASTED,
  PASTE_STEPS,
  SETTLE_MS,
  UNREACHABLE,
} from '../src/login.js'
import type { FrameAction, FrameOptions } from '../src/frame.js'

type Listener = (...args: any[]) => void

const COOKIES = { ltoken_v2: 'made-up-ltoken', ltuid_v2: '1234', ltmid_v2: 'made-up-ltmid' }
const ACCOUNT = { uid: 700000001, nickname: 'Traveler', server: 'os_euro', level: 60 }
const OTHER = { uid: 700000002, nickname: 'Second', server: 'os_usa', level: 45 }
const GOOGLE = 'https://accounts.google.com/o/oauth2/auth'
const ICON = 'Z:\\repo\\shell\\assets\\icon.ico'

const outcome = (status: string, extra: object = {}) => ({ status, account: null, accounts: [], known_uid: null, ...extra })

// ---- the collector

function collectorRig() {
  const settled: Record<string, string>[] = []
  const collector = new CookieCollector(
    (cookies) => settled.push(cookies),
    (fn, ms) => {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    },
  )
  return { collector, settled }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('the collector does not settle before ltoken_v2 and ltuid_v2 are both there', async () => {
  const { collector, settled } = collectorRig()
  expect(SETTLE_MS).toBe(2000)
  collector.changed('ltoken_v2', 'made-up-ltoken', false)
  collector.changed('ltmid_v2', 'made-up-ltmid', false)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(settled).toEqual([])
})

test('the collector settles once, 2 s after the last change', async () => {
  const { collector, settled } = collectorRig()
  collector.changed('ltoken_v2', 'made-up-ltoken', false)
  collector.changed('ltuid_v2', '1234', false)
  await vi.advanceTimersByTimeAsync(SETTLE_MS - 1)
  expect(settled).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(settled).toEqual([{ ltoken_v2: 'made-up-ltoken', ltuid_v2: '1234' }])
  await vi.advanceTimersByTimeAsync(10_000)
  expect(settled).toHaveLength(1)
})

test('a change during the wait restarts it, and brings its cookie in', async () => {
  const { collector, settled } = collectorRig()
  collector.changed('ltoken_v2', 'made-up-ltoken', false)
  collector.changed('ltuid_v2', '1234', false)
  await vi.advanceTimersByTimeAsync(1500)
  collector.changed('cookie_token_v2', 'made-up-cookie-token', false)
  await vi.advanceTimersByTimeAsync(1500)
  expect(settled).toEqual([])
  await vi.advanceTimersByTimeAsync(500)
  expect(settled).toEqual([{ ltoken_v2: 'made-up-ltoken', ltuid_v2: '1234', cookie_token_v2: 'made-up-cookie-token' }])
})

test('a removed cookie drops out, and the login is not settled without it', async () => {
  const { collector, settled } = collectorRig()
  collector.changed('ltoken_v2', 'made-up-ltoken', false)
  collector.changed('ltuid_v2', '1234', false)
  collector.changed('cookie_token_v2', 'made-up-cookie-token', false)
  collector.changed('cookie_token_v2', 'made-up-cookie-token', true)
  expect(collector.cookies()).toEqual({ ltoken_v2: 'made-up-ltoken', ltuid_v2: '1234' })
  collector.changed('ltuid_v2', '1234', true)
  expect(collector.complete()).toBe(false)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(settled).toEqual([])
})

test('the removal of an old value arriving after the new value leaves the new one', () => {
  const { collector } = collectorRig()
  collector.changed('ltoken_v2', 'made-up-ltoken-old', false)
  collector.changed('ltoken_v2', 'made-up-ltoken-new', false)
  collector.changed('ltoken_v2', 'made-up-ltoken-old', true)
  expect(collector.cookies()).toEqual({ ltoken_v2: 'made-up-ltoken-new' })
})

// ---- the messages

test('each status’s message is login.py’s text', () => {
  const table: [string, string][] = [
    ['missing_cookies', 'HoYoLAB did not hand over a complete login. Log in again.'],
    ['rejected', 'HoYoLAB did not accept this login. Log in again.'],
    ['no_account', 'This HoYoLAB account has no Genshin Impact game account.'],
  ]
  for (const [status, text] of table) expect(loginMessage(status), status).toBe(text)
  expect(loginMessage('other_account', { uid: 700000002, known: 700000001 })).toBe(
    'This is another game account (UID 700000002). Guild Board keeps the history of UID 700000001 and follows that account only.',
  )
  expect(loginMessage('ok')).toBeNull()
  expect(loginMessage('choose')).toBeNull()
  expect(loginMessage('something else')).toBeNull()
  expect(CHECKING).toBe('Checking the login with HoYoLAB.')
  expect(NOT_PASTED).toBe('This does not hold a HoYoLAB login. Copy the whole value of the Cookie line, as the steps say.')
  expect(UNREACHABLE).toBe('HoYoLAB could not be reached. Check the connection, then try again.')
  expect(FAILED).toBe('Guild Board could not check this login. The log file says why.')
  expect(NO_ACCOUNT).toBe('This HoYoLAB account has no Genshin Impact game account.')
  expect(ANOTHER_SERVICE).toBe(
    'Google does not allow signing in inside another app. If you sign in with Google, or through a service this window ' +
      'does not open, paste your login instead.',
  )
  expect(PASTE_STEPS).toBe(
    '1. In your usual browser, go to www.hoyolab.com and log in.\n' +
      '2. Press F12 to open the developer tools, and choose the Network tab.\n' +
      '3. Press F5 to reload the page, and click the first entry in the list.\n' +
      '4. Under Request Headers, find the line named Cookie and copy its whole value.\n' +
      '5. Paste it below.\n\n' +
      'Guild Board keeps only the login cookies, encrypted on this PC.',
  )
  expect(LOGIN_URL).toBe('https://www.hoyolab.com/home')
})

test('an account is labelled with its name, UID, server and rank', () => {
  expect(accountLabel(ACCOUNT)).toBe('Traveler, UID 700000001, Europe, Adventure Rank 60')
  expect(accountLabel({ ...ACCOUNT, server: 'os_unknown' })).toBe('Traveler, UID 700000001, os_unknown, Adventure Rank 60')
})

// ---- the flow

class FakeContents {
  listeners = new Map<string, Listener[]>()
  loaded: string[] = []
  opener: ((details: { url: string }) => any) | null = null
  loadURL(url: string): Promise<void> {
    this.loaded.push(url)
    return Promise.resolve()
  }
  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  setWindowOpenHandler(handler: (details: { url: string }) => any): void {
    this.opener = handler
  }
  close(): void {}
  isDestroyed(): boolean {
    return false
  }
  emit(event: string, ...args: any[]): void {
    for (const l of this.listeners.get(event) ?? []) l(...args)
  }
}

class FakeWindow {
  contents = new FakeContents()
  handle = { fake: 'window' }
  messages: { text: string; canRetry: boolean }[] = []
  actions: ((a: FrameAction) => void)[] = []
  closers: (() => void)[] = []
  opened = 0
  closed = false
  showMessage(text: string, canRetry: boolean): void { this.messages.push({ text, canRetry }) }
  onAction(cb: (a: FrameAction) => void): void { this.actions.push(cb) }
  onClosed(cb: () => void): void { this.closers.push(cb) }
  open(): void { this.opened += 1 }
  close(): void { if (!this.closed) { this.closed = true; for (const cb of this.closers) cb() } }
  press(action: FrameAction): void { for (const cb of this.actions) cb(action) }
  lastText(): string | undefined { return this.messages.at(-1)?.text }
}

class FakePopup implements LoginPopupLike {
  contents = new FakeContents()
  closers: (() => void)[] = []
  closed = false
  menus: (null)[] = []
  get webContents() { return this.contents }
  setMenu(menu: null): void { this.menus.push(menu) }
  on(event: string, listener: () => void): void { if (event === 'closed') this.closers.push(listener) }
  close(): void { if (!this.closed) { this.closed = true; for (const cb of this.closers) cb() } }
  isDestroyed(): boolean { return this.closed }
}

interface Rig {
  flow: LoginFlow
  options: FrameOptions[]
  windows: FakeWindow[]
  calls: { name: string; args: any }[]
  asked: { page: string; params: Record<string, string>; parent: unknown }[]
  loggedIn: unknown[]
  cleared: { n: number }
  cookieListeners: Listener[]
  removed: Listener[]
  answers: { login: (args: any) => unknown; login_text: (args: any) => unknown; ask: (page: string) => string | number | null }
  cookie(name: string, value: string, domain?: string, removed?: boolean): void
  window(): FakeWindow
}

function rig(): Rig {
  const windows: FakeWindow[] = []
  const calls: { name: string; args: any }[] = []
  const asked: Rig['asked'] = []
  const loggedIn: unknown[] = []
  const cleared = { n: 0 }
  const windowOptions: FrameOptions[] = []
  const cookieListeners: Listener[] = []
  const removed: Listener[] = []
  const answers: Rig['answers'] = {
    login: () => outcome('ok', { account: ACCOUNT }),
    login_text: () => outcome('ok', { account: ACCOUNT }),
    ask: () => null,
  }
  const deps: LoginDeps = {
    call: async (name, args) => {
      calls.push({ name, args })
      if (name === 'login') return answers.login(args)
      if (name === 'login_text') return answers.login_text(args)
      return null
    },
    session: {
      cookies: {
        on: (_event, listener) => { cookieListeners.push(listener) },
        removeListener: (_event, listener) => {
          removed.push(listener)
          const at = cookieListeners.indexOf(listener)
          if (at >= 0) cookieListeners.splice(at, 1)
        },
      },
      clearStorageData: async () => { cleared.n += 1 },
    },
    createWindow: (options) => {
      windowOptions.push(options)
      const win = new FakeWindow()
      windows.push(win)
      return win
    },
    ask: async (page, params, parent) => {
      asked.push({ page, params, parent })
      return answers.ask(page)
    },
    onLoggedIn: (account) => loggedIn.push(account),
    icon: ICON,
  }
  const r = {
    flow: new LoginFlow(deps),
    options: windowOptions,
    windows, calls, asked, loggedIn, cleared, cookieListeners, removed, answers,
    cookie: (name: string, value: string, domain = '.hoyolab.com', isRemoved = false) => {
      for (const l of cookieListeners) l({}, { name, value, domain }, 'explicit', isRemoved)
    },
    window: () => windows.at(-1)!,
  }
  return r
}

const flush = () => vi.advanceTimersByTimeAsync(0)

/** The three cookies of a login arrive, and the settle passes. */
async function logIn(r: Rig, cookies: Record<string, string> = COOKIES): Promise<void> {
  for (const [name, value] of Object.entries(cookies)) r.cookie(name, value)
  await vi.advanceTimersByTimeAsync(SETTLE_MS)
}

test('open clears the session, loads the login page, and shows the window', async () => {
  const r = rig()
  r.flow.open()
  await flush()
  expect(r.windows).toHaveLength(1)
  expect(r.cleared.n).toBe(1)
  expect(r.window().contents.loaded).toEqual([LOGIN_URL])
  expect(r.window().opened).toBeGreaterThan(0)
  expect(r.cookieListeners).toHaveLength(1)
  r.flow.open() // already open: brought to the front
  expect(r.windows).toHaveLength(1)
  expect(r.window().opened).toBe(2)
})

test('the window’s own options: its title, its session and the bar that offers the paste', async () => {
  const r = rig()
  r.flow.open()
  expect(LOGIN_PARTITION).toBe('gb-login')
  expect(r.options).toEqual([{ title: 'Log in to HoYoLAB', partition: 'gb-login', bar: { service: ANOTHER_SERVICE } }])
})

test('a settled login goes to the core, and ok closes the window', async () => {
  const r = rig()
  r.flow.open()
  await flush()
  await logIn(r)
  expect(r.calls.filter((c) => c.name === 'login')).toEqual([{ name: 'login', args: { cookies: COOKIES, uid: null } }])
  expect(r.window().messages[0]).toEqual({ text: CHECKING, canRetry: false })
  expect(r.window().closed).toBe(true)
  expect(r.loggedIn).toEqual([ACCOUNT])
  // the window’s session is emptied and no longer listened to
  expect(r.cleared.n).toBe(2)
  expect(r.removed).toHaveLength(1)
  expect(r.cookieListeners).toHaveLength(0)
})

test('only a login’s cookies, from HoYoLAB’s and HoYoverse’s domains, are collected', async () => {
  const r = rig()
  r.flow.open()
  await flush()
  r.cookie('ltoken_v2', 'made-up-ltoken', '.example.com')
  r.cookie('ltuid_v2', '1234', '.example.com')
  r.cookie('ltoken_v2', 'made-up-ltoken', '.hoyolab.com.evil.example')
  r.cookie('ltoken_v2', 'made-up-ltoken', 'account.hoyoverse.com')
  r.cookie('ltuid_v2', '1234', '.hoyolab.com')
  r.cookie('_ga', 'made-up-analytics', '.hoyolab.com')
  await vi.advanceTimersByTimeAsync(SETTLE_MS)
  expect(r.calls.find((c) => c.name === 'login')!.args.cookies).toEqual({ ltoken_v2: 'made-up-ltoken', ltuid_v2: '1234' })
})

test('the same login is not handed over twice', async () => {
  const r = rig()
  r.answers.login = () => outcome('rejected')
  r.flow.open()
  await flush()
  await logIn(r)
  r.cookie('ltuid_v2', '1234') // refreshed with the same value
  await vi.advanceTimersByTimeAsync(SETTLE_MS)
  expect(r.calls.filter((c) => c.name === 'login')).toHaveLength(1)
})

test.each([
  ['rejected', outcome('rejected'), 'HoYoLAB did not accept this login. Log in again.'],
  ['missing_cookies', outcome('missing_cookies'), 'HoYoLAB did not hand over a complete login. Log in again.'],
  ['no_account', outcome('no_account'), 'This HoYoLAB account has no Genshin Impact game account.'],
  [
    'other_account',
    outcome('other_account', { account: OTHER, known_uid: 700000001 }),
    'This is another game account (UID 700000002). Guild Board keeps the history of UID 700000001 and follows that account only.',
  ],
])('%s shows its message in the window, which stays open', async (_status, answer, text) => {
  const r = rig()
  r.answers.login = () => answer
  r.flow.open()
  await flush()
  await logIn(r)
  expect(r.window().lastText()).toBe(text)
  expect(r.window().closed).toBe(false)
  expect(r.loggedIn).toEqual([])
})

test('choose asks for the account, and the chosen UID logs in again', async () => {
  const r = rig()
  r.answers.login = (args) =>
    args.uid === null ? outcome('choose', { accounts: [ACCOUNT, OTHER] }) : outcome('ok', { account: OTHER })
  r.answers.ask = () => 1
  r.flow.open()
  await flush()
  await logIn(r)
  expect(r.asked).toEqual([
    {
      page: 'choose',
      params: { labels: JSON.stringify(['Traveler, UID 700000001, Europe, Adventure Rank 60', 'Second, UID 700000002, America, Adventure Rank 45']) },
      parent: r.window().handle,
    },
  ])
  expect(r.calls.filter((c) => c.name === 'login').map((c) => c.args.uid)).toEqual([null, 700000002])
  expect(r.loggedIn).toEqual([OTHER])
  expect(r.window().closed).toBe(true)
})

test('cancelling the chooser closes the window; a row that does not exist does the same', async () => {
  const r = rig()
  r.answers.login = () => outcome('choose', { accounts: [ACCOUNT, OTHER] })
  r.answers.ask = () => null
  r.flow.open()
  await flush()
  await logIn(r)
  expect(r.window().closed).toBe(true)
  expect(r.loggedIn).toEqual([])
  const s = rig()
  s.answers.login = () => outcome('choose', { accounts: [ACCOUNT, OTHER] })
  s.answers.ask = () => 7
  s.flow.open()
  await flush()
  await logIn(s)
  expect(s.window().closed).toBe(true)
  expect(s.calls.filter((c) => c.name === 'login')).toHaveLength(1)
})

test('"Paste a login instead" opens the paste page, and its text goes to login_text', async () => {
  const r = rig()
  r.answers.ask = () => 'ltoken_v2=made-up-ltoken; ltuid_v2=1234'
  r.flow.open()
  await flush()
  r.window().press('paste')
  await flush()
  expect(r.asked).toEqual([{ page: 'paste', params: { steps: PASTE_STEPS }, parent: r.window().handle }])
  expect(r.calls.filter((c) => c.name === 'login_text')).toEqual([
    { name: 'login_text', args: { text: 'ltoken_v2=made-up-ltoken; ltuid_v2=1234', uid: null } },
  ])
  expect(r.loggedIn).toEqual([ACCOUNT])
  expect(r.window().closed).toBe(true)
})

test('a pasted text that holds no login says so; cancelling the paste does nothing', async () => {
  const r = rig()
  r.answers.ask = () => 'hello'
  r.answers.login_text = () => outcome('missing_cookies')
  r.flow.open()
  await flush()
  r.window().press('paste')
  await flush()
  expect(r.window().lastText()).toBe(NOT_PASTED)
  expect(r.window().closed).toBe(false)
  r.answers.ask = () => null
  const before = r.calls.length
  r.window().press('paste')
  await flush()
  expect(r.calls).toHaveLength(before)
})

test('a pasted login with several game accounts is chosen from, and checked again with the text', async () => {
  const r = rig()
  r.answers.ask = (page) => (page === 'paste' ? 'ltoken_v2=made-up-ltoken; ltuid_v2=1234' : 0)
  r.answers.login_text = (args) =>
    args.uid === null ? outcome('choose', { accounts: [ACCOUNT, OTHER] }) : outcome('ok', { account: ACCOUNT })
  r.flow.open()
  await flush()
  r.window().press('paste')
  await flush()
  expect(r.calls.filter((c) => c.name === 'login_text').map((c) => c.args.uid)).toEqual([null, 700000001])
  expect(r.loggedIn).toEqual([ACCOUNT])
})

test('an offline outcome shows the connection message with Try again, and Try again asks again', async () => {
  const r = rig()
  let attempts = 0
  r.answers.login = () => {
    attempts += 1
    if (attempts === 1) return outcome('offline')
    return outcome('ok', { account: ACCOUNT })
  }
  r.flow.open()
  await flush()
  await logIn(r)
  expect(r.window().messages.at(-1)).toEqual({ text: UNREACHABLE, canRetry: true })
  r.window().press('retry')
  await flush()
  expect(r.calls.filter((c) => c.name === 'login').map((c) => c.args.cookies)).toEqual([COOKIES, COOKIES])
  expect(r.window().closed).toBe(true)
})

test('an offline pasted login shows the connection message without Try again', async () => {
  const r = rig()
  r.answers.ask = () => 'ltoken_v2=made-up-ltoken; ltuid_v2=1234'
  r.answers.login_text = () => outcome('offline')
  r.flow.open()
  await flush()
  r.window().press('paste')
  await flush()
  expect(r.window().messages.at(-1)).toEqual({ text: UNREACHABLE, canRetry: false })
  expect(r.window().closed).toBe(false)
})

test('a thrown error shows that the login could not be checked, even one that says Offline', async () => {
  const r = rig()
  r.answers.login = () => {
    throw new Error('Offline')
  }
  r.flow.open()
  await flush()
  await logIn(r)
  expect(r.window().messages.at(-1)).toEqual({ text: FAILED, canRetry: true })
})

test('any other error shows that the login could not be checked', async () => {
  const r = rig()
  r.answers.login = () => {
    throw new Error('The demo has no HoYoLAB login.')
  }
  r.flow.open()
  await flush()
  await logIn(r)
  expect(r.window().messages.at(-1)).toEqual({ text: FAILED, canRetry: true })
})

test('cookies that came while the login was checked are checked too, then the login is kept', async () => {
  const r = rig()
  let first = true
  r.answers.login = () => {
    if (first) {
      first = false
      r.cookie('cookie_token_v2', 'made-up-cookie-token') // HoYoLAB sets it while the first check runs
    }
    return outcome('ok', { account: ACCOUNT })
  }
  r.flow.open()
  await flush()
  await logIn(r)
  const logins = r.calls.filter((c) => c.name === 'login')
  expect(logins).toHaveLength(2)
  expect(logins[1].args).toEqual({ cookies: { ...COOKIES, cookie_token_v2: 'made-up-cookie-token' }, uid: ACCOUNT.uid })
  expect(r.loggedIn).toEqual([ACCOUNT])
  expect(r.window().closed).toBe(true)
})

test('when the later check fails, the login accepted before it stays', async () => {
  const r = rig()
  let n = 0
  r.answers.login = () => {
    n += 1
    if (n === 1) {
      r.cookie('cookie_token_v2', 'made-up-cookie-token')
      return outcome('ok', { account: ACCOUNT })
    }
    return outcome('offline')
  }
  r.flow.open()
  await flush()
  await logIn(r)
  expect(r.loggedIn).toEqual([ACCOUNT])
  expect(r.window().closed).toBe(true)
})

test('closing the window drops an answer that is still on its way', async () => {
  const r = rig()
  let release: (value: unknown) => void = () => undefined
  r.answers.login = () => new Promise((resolve) => { release = resolve }) as unknown
  r.flow.open()
  await flush()
  await logIn(r)
  r.window().close()
  release(outcome('ok', { account: ACCOUNT }))
  await flush()
  expect(r.loggedIn).toEqual([])
  expect(r.window().messages.map((m) => m.text)).toEqual([CHECKING])
})

test('a window opened again starts clean', async () => {
  const r = rig()
  r.answers.login = () => outcome('rejected')
  r.flow.open()
  await flush()
  await logIn(r)
  r.window().close()
  r.flow.open()
  await flush()
  expect(r.windows).toHaveLength(2)
  await logIn(r) // the same login again is a new login for a new window
  expect(r.calls.filter((c) => c.name === 'login')).toHaveLength(2)
})

// ---- pop-ups and navigation

test('up to two pop-ups open in the session, at 520 by 720, and a third is denied', async () => {
  const r = rig()
  r.flow.open()
  await flush()
  const open = r.window().contents.opener!
  expect(MOST_POPUPS).toBe(2)
  const first = open({ url: GOOGLE })
  expect(first.action).toBe('allow')
  expect(first.overrideBrowserWindowOptions).toMatchObject({
    width: 520,
    height: 720,
    useContentSize: true, // the page gets 520 by 720, as in Qt
    parent: r.window().handle, // it cannot fall behind the login window
    title: 'Log in to HoYoLAB',
    icon: ICON, // the app's, as the login window's
    webPreferences: { partition: 'gb-login', contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  })
  expect(open({ url: 'https://discord.com/oauth2/authorize' }).action).toBe('allow')
  expect(open({ url: GOOGLE })).toEqual({ action: 'deny' }) // two are on their way already
  const a = new FakePopup()
  const b = new FakePopup()
  r.window().contents.emit('did-create-window', a, {})
  r.window().contents.emit('did-create-window', b, {})
  expect(open({ url: GOOGLE })).toEqual({ action: 'deny' }) // two are open
  a.close()
  expect(open({ url: GOOGLE }).action).toBe('allow') // one has closed
  expect(a.menus).toEqual([null]) // no menu on a pop-up
  expect(b.menus).toEqual([null])
})

test('a pop-up of a pop-up also has the login window as its parent', async () => {
  const r = rig()
  r.flow.open()
  await flush()
  const popup = new FakePopup()
  r.window().contents.opener!({ url: GOOGLE })
  r.window().contents.emit('did-create-window', popup, {})
  const options = popup.contents.opener!({ url: GOOGLE }).overrideBrowserWindowOptions
  expect(options.parent).toBe(r.window().handle)
  expect(options.icon).toBe(ICON)
})

test('a pop-up goes to a sign-in site or nowhere, and not to an empty page', async () => {
  const r = rig()
  r.flow.open()
  await flush()
  const open = r.window().contents.opener!
  expect(open({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
  expect(open({ url: 'about:blank' })).toEqual({ action: 'deny' })
  expect(open({ url: '' })).toEqual({ action: 'deny' })
  expect(open({ url: 'http://accounts.google.com/' })).toEqual({ action: 'deny' })
  expect(open({ url: 'https://account.hoyolab.com/login' }).action).toBe('allow')
})

test('a pop-up has a handler of its own, so it opens no further window unchecked', async () => {
  const r = rig()
  r.flow.open()
  await flush()
  const popup = new FakePopup()
  r.window().contents.opener!({ url: GOOGLE })
  r.window().contents.emit('did-create-window', popup, {})
  const open = popup.contents.opener!
  expect(open({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
  expect(open({ url: GOOGLE }).action).toBe('allow') // the count is shared: one open, one more
  expect(open({ url: GOOGLE })).toEqual({ action: 'deny' })
})

test('closing the login window closes its pop-ups', async () => {
  const r = rig()
  r.flow.open()
  await flush()
  const popup = new FakePopup()
  r.window().contents.opener!({ url: GOOGLE })
  r.window().contents.emit('did-create-window', popup, {})
  r.window().close()
  expect(popup.closed).toBe(true)
})

function attempt(contents: FakeContents, event: string, url: string, isMainFrame: boolean | undefined): boolean {
  let prevented = false
  contents.emit(event, { preventDefault: () => { prevented = true }, url, isMainFrame })
  return prevented
}

test('the main frame stays on HoYoverse and the sign-in sites; frames inside it are free', async () => {
  const r = rig()
  r.flow.open()
  await flush()
  const contents = r.window().contents
  for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    expect(attempt(contents, event, 'https://account.hoyolab.com/login', true), event).toBe(false)
    expect(attempt(contents, event, GOOGLE, true), event).toBe(false)
    expect(attempt(contents, event, 'https://example.com/', true), event).toBe(true)
    expect(attempt(contents, event, 'https://example.com/', undefined), event).toBe(true)
    expect(attempt(contents, event, 'https://example.com/captcha', false), event).toBe(false)
    expect(attempt(contents, event, 'https://www.google.com/recaptcha/api2/anchor', false), event).toBe(false)
  }
})

test('a main frame that came to another address is sent back to the login page; a pop-up closes', async () => {
  const r = rig()
  r.flow.open()
  await flush()
  const contents = r.window().contents
  contents.emit('did-navigate', {}, 'https://account.hoyolab.com/login')
  expect(contents.loaded).toEqual([LOGIN_URL])
  contents.emit('did-navigate', {}, 'about:blank')
  expect(contents.loaded).toEqual([LOGIN_URL, LOGIN_URL])
  const popup = new FakePopup()
  contents.opener!({ url: GOOGLE })
  contents.emit('did-create-window', popup, {})
  popup.contents.emit('did-navigate', {}, GOOGLE)
  expect(popup.closed).toBe(false)
  popup.contents.emit('did-navigate', {}, 'about:blank')
  expect(popup.closed).toBe(true)
})

// ---- what is printed

test('collecting a login prints nothing', async () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined))
  const r = rig()
  r.answers.login = () => outcome('rejected')
  r.flow.open()
  await flush()
  await logIn(r, { ...COOKIES, cookie_token_v2: 'made-up-cookie-token' })
  r.answers.ask = () => 'ltoken_v2=made-up-ltoken; ltuid_v2=1234'
  r.answers.login_text = () => {
    throw new Error('Offline')
  }
  r.window().press('paste')
  await flush()
  const { collector } = collectorRig()
  collector.changed('ltoken_v2', 'made-up-ltoken', false)
  collector.changed('ltuid_v2', '1234', false)
  await vi.advanceTimersByTimeAsync(SETTLE_MS)
  const printed = spies.flatMap((spy) => spy.mock.calls).flat().map((value) => String(value))
  expect(printed.filter((text) => text.includes('made-up'))).toEqual([])
  expect(printed).toEqual([])
})

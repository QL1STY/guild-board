/**
 * The login (login.py, cookies.py): HoYoLAB's own page in a window of Guild Board's, in the in-memory session `gb-login`,
 * whose login cookies go to the core over the channel (`login`). Accounts that sign in through Google cannot use an
 * embedded browser, so they paste the login from their usual browser instead (`login_text`).
 *
 * The cookies are never logged, never written and never printed: they pass from the session's `changed` event through the
 * collector to the call, and are held only while a check or a choice is under way. Nothing here touches Electron:
 * `main.ts` hands the session, the window and the dialogs in through `LoginDeps`.
 */
import type { FrameAction, FrameOptions } from './frame.js'
import { signInSite } from './links.js'
import type { CallName } from './protocol.js'

export const LOGIN_URL = 'https://www.hoyolab.com/home'
/** The session of the window and of its pop-ups: `LoginDeps.session` is the one `hardenSession` guards under this name. */
export const LOGIN_PARTITION = 'gb-login'
const LOGIN_TITLE = 'Log in to HoYoLAB'
export const SETTLE_MS = 2000 // the other session cookies arrive moments after the first three
export const MOST_POPUPS = 2 // windows of their own a page may have open at once: a sign-in's, and one it opens in turn
const POPUP_SIZE = { width: 520, height: 720 }
// The names a login is made of (tokenstore.SESSION_COOKIES), and the sites they come from (cookies.SITES).
const SESSION_COOKIES: readonly string[] = ['ltoken_v2', 'ltuid_v2', 'ltmid_v2', 'cookie_token_v2', 'account_id_v2', 'account_mid_v2']
const SITES: readonly string[] = ['hoyolab.com', 'hoyoverse.com']
// What the core needs of a login (auth.has_required).
const REQUIRED: readonly string[] = ['ltoken_v2', 'ltuid_v2']

export const NOT_PASTED = 'This does not hold a HoYoLAB login. Copy the whole value of the Cookie line, as the steps say.'
// Google refuses to sign in inside another app, and the window shows no sign-in page but those of SIGN_IN_HOSTS.
export const ANOTHER_SERVICE =
  'Google does not allow signing in inside another app. If you sign in with Google, or through a service this window ' +
  'does not open, paste your login instead.'
export const PASTE_STEPS =
  '1. In your usual browser, go to www.hoyolab.com and log in.\n' +
  '2. Press F12 to open the developer tools, and choose the Network tab.\n' +
  '3. Press F5 to reload the page, and click the first entry in the list.\n' +
  '4. Under Request Headers, find the line named Cookie and copy its whole value.\n' +
  '5. Paste it below.\n\n' +
  'Guild Board keeps only the login cookies, encrypted on this PC.'
export const CHECKING = 'Checking the login with HoYoLAB.'
export const MISSING = 'HoYoLAB did not hand over a complete login. Log in again.'
export const REJECTED = 'HoYoLAB did not accept this login. Log in again.'
export const NO_ACCOUNT = 'This HoYoLAB account has no Genshin Impact game account.'
const OTHER_ACCOUNT =
  'This is another game account (UID {uid}). Guild Board keeps the history of UID {known} ' + 'and follows that account only.'
export const UNREACHABLE = 'HoYoLAB could not be reached. Check the connection, then try again.'
export const FAILED = 'Guild Board could not check this login. The log file says why.'

// gameday.SERVER_NAMES
const SERVER_NAMES: Record<string, string> = {
  os_euro: 'Europe',
  os_usa: 'America',
  os_asia: 'Asia',
  os_cht: 'TW, HK, MO',
  cn_gf01: 'China',
  cn_qd01: 'China',
}

/** The text a login's outcome shows in the window, or null for a status that shows none (ok, choose, or one unknown). */
export function loginMessage(status: string, details: { uid?: number; known?: number | null } = {}): string | null {
  switch (status) {
    case 'other_account':
      return OTHER_ACCOUNT.replace('{uid}', String(details.uid ?? '')).replace('{known}', String(details.known ?? ''))
    case 'missing_cookies':
      return MISSING
    case 'rejected':
      return REJECTED
    case 'no_account':
      return NO_ACCOUNT
    default:
      return null
  }
}

export interface GameAccount {
  uid: number
  nickname: string
  server: string
  level: number
}

export function accountLabel(account: GameAccount): string {
  const server = SERVER_NAMES[account.server] ?? account.server
  return `${account.nickname}, UID ${account.uid}, ${server}, Adventure Rank ${account.level}`
}

/** A cookie's domain may start with a dot; true for one of `SITES` or a subdomain of one. */
function fromSite(domain: string): boolean {
  const host = domain.replace(/^\.+/, '').toLowerCase()
  return SITES.some((site) => host === site || host.endsWith(`.${site}`))
}

type Schedule = (fn: () => void, ms: number) => () => void

function defaultSchedule(fn: () => void, ms: number): () => void {
  const timer = setTimeout(fn, ms)
  return () => clearTimeout(timer)
}

/**
 * Keeps the login cookies the session reports, and says so once they have settled: SETTLE_MS after the last change, once
 * `ltoken_v2` and `ltuid_v2` are both there (the others come moments after them).
 */
export class CookieCollector {
  private readonly held = new Map<string, string>()
  private cancelWait: (() => void) | null = null

  constructor(
    private readonly onSettled: (cookies: Record<string, string>) => void,
    private readonly schedule: Schedule = defaultSchedule,
  ) {}

  changed(name: string, value: string, removed: boolean): void {
    if (removed) {
      // When a site replaces a cookie, the removal of the old value can arrive after the new value.
      if (this.held.get(name) === value) this.held.delete(name)
      return
    }
    if (!value) return
    this.held.set(name, value) // the newest value wins
    if (this.complete()) {
      this.cancelWait?.()
      this.cancelWait = this.schedule(() => this.settle(), SETTLE_MS)
    }
  }

  complete(): boolean {
    return REQUIRED.every((name) => Boolean(this.held.get(name)))
  }

  cookies(): Record<string, string> {
    return Object.fromEntries(this.held)
  }

  /** Stops waiting, for a login that is handed over by other means. */
  cancel(): void {
    this.cancelWait?.()
    this.cancelWait = null
  }

  /** As the window closes: nothing is waited for, and nothing is kept. */
  reset(): void {
    this.cancel()
    this.held.clear()
  }

  private settle(): void {
    this.cancelWait = null
    if (this.complete()) this.onSettled(this.cookies())
  }
}

interface NavigationEvent {
  preventDefault(): void
  url?: string
  isMainFrame?: boolean
}

/** The part of an Electron web contents that the login's pages use. */
export interface LoginContentsLike {
  loadURL(url: string): Promise<void>
  on(event: string, listener: (...args: any[]) => void): unknown
  setWindowOpenHandler(handler: (details: { url: string }) => any): unknown
}

/**
 * The window has no address bar, so its main frame goes to HoYoverse's sites and the sign-in pages alone (signInSite); a
 * frame inside it loads what the page needs, as HoYoLAB's captcha does. A page that came to an address that is refused
 * (an empty page, set from another frame, never reaches the checks) is handed to `onRefused`.
 */
export function restrictToSignIn(contents: LoginContentsLike, onRefused: () => void): void {
  const kept = (event: NavigationEvent): void => {
    if (event.isMainFrame !== false && !signInSite(event.url ?? '')) event.preventDefault()
  }
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) contents.on(name, kept)
  contents.on('did-navigate', (_event: unknown, url: string) => {
    if (url !== '' && !signInSite(url)) onRefused()
  })
}

export interface LoginPopupLike {
  webContents: LoginContentsLike
  on(event: string, listener: (...args: any[]) => void): unknown
  close(): void
  isDestroyed(): boolean
  setMenu(menu: null): void
}

/** The window of `FramedWindow`. */
export interface LoginWindowLike {
  contents: LoginContentsLike
  /** The native window, for the dialogs that sit on it. */
  handle: unknown
  showMessage(text: string, canRetry: boolean): void
  onAction(cb: (action: FrameAction) => void): void
  onClosed(cb: () => void): void
  open(): void
  close(): void
}

/** The part of the `gb-login` session that the login uses. */
export interface LoginSessionLike {
  cookies: {
    on(event: 'changed', listener: (event: unknown, cookie: { name: string; value: string; domain: string }, cause: string, removed: boolean) => void): unknown
    removeListener(event: 'changed', listener: (...args: any[]) => void): unknown
  }
  clearStorageData(): Promise<void>
}

export interface LoginDeps {
  /** `CoreProcess.call`. */
  call(name: CallName, args?: object): Promise<unknown>
  session: LoginSessionLike
  /** Makes the window; `options` are the login's own (title, partition, bar), and `main.ts` only supplies Electron's objects. */
  createWindow(options: FrameOptions): LoginWindowLike
  /** Opens the paste page, or the chooser with its `labels`, over `parent`: the pasted text, the row's number, or null. */
  ask(page: 'paste' | 'choose', params: Record<string, string>, parent: unknown): Promise<string | number | null>
  /** The game account now followed. */
  onLoggedIn?(account: GameAccount): void
  /** The app's icon file (`appIconPath`), for the pop-ups' windows. */
  icon: string
  schedule?: Schedule
  /** A line for the log; it never holds a cookie. */
  warn?(text: string): void
}

interface Outcome {
  status: string
  account: GameAccount | null
  accounts: GameAccount[]
  known_uid: number | null
}

/** The login window's own options (login.py: LoginWindow): its title, its session and its bar with the paste offer. */
const LOGIN_WINDOW: FrameOptions = { title: LOGIN_TITLE, partition: LOGIN_PARTITION, bar: { service: ANOTHER_SERVICE } }

type Source = { kind: 'cookies'; cookies: Record<string, string> } | { kind: 'text'; text: string }

export class LoginFlow {
  private window: LoginWindowLike | null = null
  private collector: CookieCollector | null = null
  private listener: ((event: unknown, cookie: { name: string; value: string; domain: string }, cause: string, removed: boolean) => void) | null = null
  private handedOver: Record<string, string> | null = null // each new login once; a reload or a later cookie does not repeat it
  private attempt = 0
  private pasting = false
  private pending = 0 // pop-ups allowed, whose windows are not made yet
  private readonly popups = new Set<LoginPopupLike>()

  constructor(private readonly deps: LoginDeps) {}

  /** Opens the login window, or brings the open one forward. */
  open(): void {
    if (this.window !== null) {
      this.window.open()
      return
    }
    const window = this.deps.createWindow(LOGIN_WINDOW)
    this.window = window
    this.handedOver = null
    this.attempt += 1
    this.collector = new CookieCollector((cookies) => this.settled(window, cookies), this.deps.schedule)
    window.onAction((action) => {
      if (action === 'paste') void this.paste(window)
      else void this.retry(window)
    })
    window.onClosed(() => this.closed(window))
    this.guard(window.contents, () => void window.contents.loadURL(LOGIN_URL).catch(() => undefined))
    window.open()
    void this.start(window)
  }

  private async start(window: LoginWindowLike): Promise<void> {
    try {
      await this.deps.session.clearStorageData() // a login is made in a clean session, as the Qt window's profile was new
    } catch {
      this.deps.warn?.('The login session could not be cleared.')
    }
    if (this.window !== window) return
    this.listener = (_event, cookie, _cause, removed) => {
      if (SESSION_COOKIES.includes(cookie.name) && fromSite(cookie.domain)) this.collector?.changed(cookie.name, cookie.value, removed)
    }
    this.deps.session.cookies.on('changed', this.listener)
    window.contents.loadURL(LOGIN_URL).catch(() => undefined)
  }

  private settled(window: LoginWindowLike, cookies: Record<string, string>): void {
    if (this.window !== window || sameCookies(cookies, this.handedOver)) return
    this.handedOver = cookies
    void this.check(window, { kind: 'cookies', cookies }, null, null)
  }

  private stale(window: LoginWindowLike, attempt: number): boolean {
    return this.window !== window || attempt !== this.attempt
  }

  /** Has the core check a login, and says what came of it. `granted` is the account an earlier check of the same login accepted. */
  private async check(window: LoginWindowLike, source: Source, uid: number | null, granted: GameAccount | null): Promise<void> {
    const attempt = ++this.attempt
    window.showMessage(CHECKING, false)
    let outcome: Outcome
    try {
      outcome = (await (source.kind === 'cookies'
        ? this.deps.call('login', { cookies: source.cookies, uid })
        : this.deps.call('login_text', { text: source.text, uid }))) as Outcome
    } catch (error) {
      if (this.stale(window, attempt)) return
      if (granted !== null) return this.finish(window, granted) // the check of the later cookies failed; the login stays
      this.deps.warn?.('A login could not be checked.')
      window.showMessage(FAILED, source.kind === 'cookies')
      return
    }
    if (this.stale(window, attempt)) return
    if (granted !== null && outcome.status !== 'ok') return this.finish(window, granted)
    if (outcome.status === 'ok' && outcome.account !== null) {
      if (source.kind === 'cookies' && granted === null) {
        const grown = this.grown(source.cookies)
        // Cookies came during the check, the cookie token among them: checked too, then kept.
        if (grown !== null) return this.check(window, { kind: 'cookies', cookies: grown }, outcome.account.uid, outcome.account)
      }
      return this.finish(window, outcome.account)
    }
    if (outcome.status === 'offline') {
      // HoYoLAB could not be reached (the core's outcome, not an error).
      this.deps.warn?.('HoYoLAB could not be reached to check a login.')
      window.showMessage(UNREACHABLE, source.kind === 'cookies')
      return
    }
    if (outcome.status === 'choose') return this.choose(window, source, outcome.accounts, attempt)
    let text = loginMessage(outcome.status, { uid: outcome.account?.uid, known: outcome.known_uid })
    if (source.kind === 'text' && outcome.status === 'missing_cookies') text = NOT_PASTED
    window.showMessage(text ?? FAILED, text === null && source.kind === 'cookies')
  }

  private async choose(window: LoginWindowLike, source: Source, accounts: GameAccount[], attempt: number): Promise<void> {
    const row = await this.deps.ask('choose', { labels: JSON.stringify(accounts.map(accountLabel)) }, window.handle)
    if (this.stale(window, attempt)) return // the window closed while the player was choosing
    if (typeof row !== 'number' || row >= accounts.length) {
      window.close() // the player cancelled the login
      return
    }
    await this.check(window, source, accounts[row].uid, null)
  }

  /** The login as the browser holds it now, when it is `checked` and more, and the browser holds no other login. */
  private grown(checked: Record<string, string>): Record<string, string> | null {
    const collector = this.collector
    if (collector === null || !collector.complete()) return null
    const cookies = collector.cookies()
    if (Object.keys(cookies).length <= Object.keys(checked).length) return null
    if (Object.entries(checked).some(([name, value]) => cookies[name] !== value)) return null
    this.handedOver = cookies // it counts as handed over from here
    collector.cancel()
    return cookies
  }

  private finish(window: LoginWindowLike, account: GameAccount): void {
    this.deps.onLoggedIn?.(account)
    window.close()
  }

  private async paste(window: LoginWindowLike): Promise<void> {
    if (this.pasting) return
    this.pasting = true
    let text: string | number | null
    try {
      text = await this.deps.ask('paste', { steps: PASTE_STEPS }, window.handle)
    } finally {
      this.pasting = false
    }
    if (this.window !== window || typeof text !== 'string') return
    await this.check(window, { kind: 'text', text }, null, null)
  }

  /** "Try again": the login as the browser holds it, when it holds one. */
  private async retry(window: LoginWindowLike): Promise<void> {
    const collector = this.collector
    if (this.window !== window || collector === null || !collector.complete()) return
    await this.check(window, { kind: 'cookies', cookies: collector.cookies() }, null, null)
  }

  private closed(window: LoginWindowLike): void {
    if (this.window !== window) return
    this.window = null
    this.attempt += 1 // an answer still on its way is no longer wanted
    this.pending = 0
    if (this.listener !== null) this.deps.session.cookies.removeListener('changed', this.listener)
    this.listener = null
    this.collector?.reset()
    this.collector = null
    this.handedOver = null
    for (const popup of [...this.popups]) {
      if (!popup.isDestroyed()) popup.close()
    }
    this.popups.clear()
    this.deps.session.clearStorageData().catch(() => undefined) // the login does not stay in the session
  }

  // ------------------------------------------------------------------ pop-ups

  private guard(contents: LoginContentsLike, onRefused: () => void): void {
    restrictToSignIn(contents, onRefused)
    contents.setWindowOpenHandler(this.openHandler)
    contents.on('did-create-window', (popup: LoginPopupLike) => this.popupCreated(popup))
  }

  /**
   * A page asks for a window of its own, as a sign-in with another service does. It opens on one of the window's sites
   * alone, and MOST_POPUPS at most at once, in the same session, with its opener. An empty one never opens: whichever
   * frame asked for it would fill it, any site's frame among them, in a window titled for the login with no address bar.
   * Any other is refused, and the log says so without the address.
   */
  private readonly openHandler = (details: { url: string }): any => {
    if (this.window === null || this.pending + this.popups.size >= MOST_POPUPS || !signInSite(details.url)) {
      this.deps.warn?.('A window the HoYoLAB page asked for was not opened: too many are open, or it is no site of the login\'s.')
      return { action: 'deny' }
    }
    this.pending += 1
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        ...POPUP_SIZE,
        title: LOGIN_TITLE,
        icon: this.deps.icon,
        useContentSize: true, // the page gets 520 by 720, as in Qt
        parent: this.window.handle, // it cannot fall behind the login window
        webPreferences: {
          partition: LOGIN_PARTITION,
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          spellcheck: false,
        },
      },
    }
  }

  private popupCreated(popup: LoginPopupLike): void {
    this.pending = Math.max(0, this.pending - 1)
    if (this.window === null) {
      popup.close()
      return
    }
    popup.setMenu(null)
    this.popups.add(popup)
    popup.on('closed', () => this.popups.delete(popup))
    this.guard(popup.webContents, () => popup.close())
  }
}

function sameCookies(a: Record<string, string>, b: Record<string, string> | null): boolean {
  if (b === null) return false
  const names = Object.keys(a)
  return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name])
}

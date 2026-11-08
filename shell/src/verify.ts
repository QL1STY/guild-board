/**
 * The verification window (verify.py): HoYoLAB's Battle Chronicle page with the stored login, where the player passes the
 * check HoYoLAB asks for. Closing it lets syncing go on at the next sync (`verification_done`, app.py: _on_verify_closed).
 *
 * The login's cookies come from the core (`verify_cookies`) and go into the in-memory session `gb-verify` and nowhere else:
 * not logged, not kept in a field, and the session is emptied when the window closes. Nothing here touches Electron:
 * `main.ts` hands the session and the window in through `VerifyDeps`.
 */
import type { FrameOptions } from './frame.js'
import type { LoginContentsLike } from './login.js'
import { restrictToSignIn } from './login.js'
import type { CallName } from './protocol.js'

// The Battle Chronicle page.
export const VERIFY_URL = 'https://act.hoyolab.com/app/community-game-records-sea/index.html#/ys'
export const NOTE =
  'HoYoLAB asked for a check before it answers Guild Board again. Pass the check on this page, ' +
  'then close this window. Syncing goes on at the next sync.'
/** The session of the window: `VerifyDeps.session` is the one `hardenSession` guards under this name. */
export const VERIFY_PARTITION = 'gb-verify'
/** The verification window's own options (verify.py: VerifyWindow): its title, its session and its note. */
const VERIFY_WINDOW: FrameOptions = { title: 'Verify on HoYoLAB', partition: VERIFY_PARTITION, bar: { note: NOTE } }
const COOKIE_DOMAIN = '.hoyolab.com'
// HoYoLAB sets these HttpOnly itself.
const HIDDEN_FROM_SCRIPTS = new Set(['ltoken_v2', 'cookie_token_v2', 'ltoken', 'cookie_token'])

/** The window of `FramedWindow`. */
export interface VerifyWindowLike {
  contents: LoginContentsLike
  onClosed(cb: () => void): void
  open(): void
  close(): void
}

export interface VerifyCookie {
  url: string
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
}

export interface VerifyDeps {
  /** `CoreProcess.call`. */
  call(name: CallName, args?: object): Promise<unknown>
  /** The `gb-verify` session. */
  session: {
    cookies: { set(details: VerifyCookie): Promise<void> }
    clearStorageData(): Promise<void>
  }
  /** Makes the window; `options` are the verification's own (title, partition, note). */
  createWindow(options: FrameOptions): VerifyWindowLike
  /** A line for the log; it never holds a cookie. */
  warn?(text: string): void
}

export class VerifyWindow {
  private window: VerifyWindowLike | null = null
  private opening = false

  constructor(private readonly deps: VerifyDeps) {}

  /** Opens the window with the stored login, or brings the open one forward. */
  open(): void {
    if (this.window !== null) {
      this.window.open()
      return
    }
    if (this.opening) return
    this.opening = true
    void this.start().finally(() => {
      this.opening = false
    })
  }

  private async start(): Promise<void> {
    let cookies: Record<string, string> | null
    try {
      cookies = (await this.deps.call('verify_cookies')) as Record<string, string> | null
    } catch {
      cookies = null
    }
    if (cookies === null) {
      this.deps.warn?.('verification was asked for, but no login is stored')
      return
    }
    try {
      await this.deps.session.clearStorageData()
      for (const [name, value] of Object.entries(cookies)) {
        await this.deps.session.cookies.set({
          url: VERIFY_URL,
          name,
          value,
          domain: COOKIE_DOMAIN,
          path: '/',
          secure: true,
          httpOnly: HIDDEN_FROM_SCRIPTS.has(name),
        })
      }
    } catch {
      this.deps.warn?.('The login for the verification page could not be set.') // never with the cookies
      return
    }
    cookies = null // the session holds the login now; this keeps no copy
    const window = this.deps.createWindow(VERIFY_WINDOW)
    this.window = window
    // The page goes where the login window's goes, and opens no window of its own.
    const load = (): void => void window.contents.loadURL(VERIFY_URL).catch(() => undefined)
    restrictToSignIn(window.contents, load)
    window.contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.onClosed(() => this.closed(window))
    window.open()
    load()
  }

  private closed(window: VerifyWindowLike): void {
    if (this.window !== window) return
    this.window = null
    this.deps.session.clearStorageData().catch(() => undefined) // the login does not stay in the session
    this.deps.call('verification_done').catch(() => this.deps.warn?.('The end of the verification could not be told to the core.'))
  }
}

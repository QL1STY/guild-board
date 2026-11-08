/**
 * The window of the login and the verification page (login.py: LoginWindow, verify.py: VerifyWindow): HoYoLAB's page above
 * a bar of Guild Board's own. The Qt windows had a message line, a note and a button; here the bar is a small page of the
 * app (`pages/bar.html`, partition `gb-dialog`), told what to show through its address, and answering with the word
 * "paste" or "retry" through the dialog bridge.
 *
 * Nothing here touches Electron: `main.ts` hands a `BaseWindow` and `WebContentsView`s in through `FrameDeps`.
 */
import { listen, dialogWebPreferences, type DialogWebPreferences, type IpcLike, pageUrl } from './dialog.js'
import type { Bounds } from './placement.js'

export const BAR_HEIGHT = 120
const BACKGROUND = '#E6DDCA' // `--page-dark`, as the dashboard's

export type FrameAction = 'paste' | 'retry'

/** What the bar page shows besides a message: the verification's note, or the login's line about other services. */
export interface BarContent {
  note?: string
  service?: string
}

export interface FrameOptions {
  title: string
  /** The partition of HoYoLAB's page. */
  partition: 'gb-login' | 'gb-verify'
  bar: BarContent
}

interface NavigationEvent {
  preventDefault(): void
}

/** The part of an Electron web contents that the frame and its users need. */
export interface FrameContentsLike {
  loadURL(url: string): Promise<void>
  on(event: string, listener: (...args: any[]) => void): unknown
  setWindowOpenHandler(handler: (details: { url: string }) => any): unknown
  close(): void
  focus(): void
  isDestroyed(): boolean
}

/** The part of Electron's `WebContentsView` that the frame uses. */
export interface FrameViewLike {
  webContents: FrameContentsLike
  setBounds(bounds: Bounds): void
}

/** The part of Electron's `BaseWindow` that the frame uses. */
export interface FrameWindowLike {
  contentView: { addChildView(view: FrameViewLike): void }
  getContentSize(): [number, number]
  on(event: string, listener: (...args: any[]) => void): unknown
  setMenu(menu: null): void
  show(): void
  focus(): void
  close(): void
  isMinimized(): boolean
  restore(): void
  isDestroyed(): boolean
}

export interface FrameWindowOptions {
  title: string
  /** The app's icon file (`appIconPath`), for the taskbar and the title bar. */
  icon: string
  width: number
  height: number
  show: false
  backgroundColor: string
}

export interface FrameViewOptions {
  webPreferences:
    | DialogWebPreferences
    | {
        partition: 'gb-login' | 'gb-verify'
        contextIsolation: true
        sandbox: true
        nodeIntegration: false
        webSecurity: true
        spellcheck: false
      }
}

export interface FrameDeps {
  /** `<app>/dist/pages`. */
  pagesFolder: string
  /** `<app>/dist/pages/dialog-preload.js`. */
  preload: string
  /** The app's icon file (`appIconPath`). */
  icon: string
  ipc: IpcLike
  createWindow(options: FrameWindowOptions): FrameWindowLike
  createView(options: FrameViewOptions): FrameViewLike
}

export class FramedWindow {
  readonly contents: FrameContentsLike
  private readonly window: FrameWindowLike
  private readonly page: FrameViewLike
  private readonly bar: FrameViewLike
  private readonly stopListening: () => void
  private readonly actionCallbacks: ((action: FrameAction) => void)[] = []
  private readonly closedCallbacks: (() => void)[] = []
  private closed = false

  constructor(
    private readonly deps: FrameDeps,
    private readonly options: FrameOptions,
  ) {
    this.window = deps.createWindow({ title: options.title, icon: deps.icon, width: 1100, height: 820, show: false, backgroundColor: BACKGROUND })
    this.page = deps.createView({
      webPreferences: {
        partition: options.partition,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    })
    this.bar = deps.createView({ webPreferences: dialogWebPreferences(deps.preload) })
    this.contents = this.page.webContents
    this.window.setMenu(null)
    this.window.contentView.addChildView(this.page)
    this.window.contentView.addChildView(this.bar)
    this.layout()
    this.window.on('resize', () => this.layout())
    // The bar shows its page and nothing else, and opens nothing.
    this.bar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
      this.bar.webContents.on(name, (event: NavigationEvent) => event.preventDefault())
    }
    this.stopListening = listen(deps.ipc, this.bar.webContents, {
      submit: (value) => {
        if (value === 'paste' || value === 'retry') for (const cb of this.actionCallbacks) cb(value)
      },
      cancel: () => undefined,
    })
    this.window.on('closed', () => this.onWindowClosed())
    this.load(null)
  }

  /** `cb` is called when the player presses "Paste a login instead" or "Try again" on the bar. */
  onAction(cb: (action: FrameAction) => void): void {
    this.actionCallbacks.push(cb)
  }

  /** `cb` is called once, when the window has closed. */
  onClosed(cb: () => void): void {
    this.closedCallbacks.push(cb)
  }

  /** Shows `text` on the bar, with a "Try again" button when `canRetry`. */
  showMessage(text: string, canRetry: boolean): void {
    if (this.closed) return
    this.load({ text, canRetry })
  }

  /** The native window, for a dialog that sits on it. */
  get handle(): unknown {
    return this.window
  }

  open(): void {
    if (this.closed) return
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
    this.page.webContents.focus() // the keyboard goes to HoYoLAB's page, not to the bar
  }

  close(): void {
    if (!this.window.isDestroyed()) this.window.close()
  }

  private load(message: { text: string; canRetry: boolean } | null): void {
    const params: Record<string, string> = {}
    if (this.options.bar.note) params.note = this.options.bar.note
    if (this.options.bar.service) params.service = this.options.bar.service
    if (message !== null) {
      params.message = message.text
      if (message.canRetry) params.retry = '1'
    }
    this.bar.webContents.loadURL(pageUrl(this.deps.pagesFolder, 'bar', params)).catch(() => undefined)
  }

  private layout(): void {
    if (this.closed || this.window.isDestroyed()) return
    const [width, height] = this.window.getContentSize()
    const above = Math.max(0, height - BAR_HEIGHT)
    this.page.setBounds({ x: 0, y: 0, width, height: above })
    this.bar.setBounds({ x: 0, y: above, width, height: Math.min(BAR_HEIGHT, height) })
  }

  private onWindowClosed(): void {
    if (this.closed) return
    this.closed = true
    this.stopListening()
    // Views are not released with their window.
    for (const view of [this.page, this.bar]) {
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    for (const cb of this.closedCallbacks) cb()
  }
}

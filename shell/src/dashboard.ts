/**
 * The dashboard window (dashboard.py): the interface in a window that may show only the core's own pages. Closing hides
 * it, and the page is released a moment later, so only the core keeps running. The page zooms with the window's width,
 * from the usual 1,640 pixels up to twice the size. Nothing here touches Electron: `main.ts` hands the window in through
 * `DashboardDeps.createWindow`.
 */
import { opensOutside, sameOrigin } from './links.js'
import { type Bounds, readPlacement, restoredBounds, writePlacement } from './placement.js'

// A closed window's page is let go this long after it hides: what it sends as it hides, a note's save among them, is
// not cut off with it (Notes.tsx).
export const RELEASE_AFTER_MS = 2_000
// The window width at which the page draws at its own size: the player's usual window. A wider window zooms the page to
// fill it, and a narrower one keeps today's narrow layout.
export const REFERENCE_WIDTH = 1640
// `--page-dark` (web/src/styles/tokens.css): the window opens in the page's colour, with no white flash.
export const BACKGROUND = '#E6DDCA'

/** How large the page draws in a window this wide: the width over 1,640, from 1 to 2. */
export function zoomFor(width: number): number {
  return Math.min(2, Math.max(1, width / REFERENCE_WIDTH))
}

/**
 * The address to load for a place such as "achievements/timers". A window not shown yet takes the place with its launch
 * link; a shown one goes there with a fragment, which the page follows without loading again.
 */
export function placeUrl(link: string, place: string | null, shown: boolean): string {
  if (place === null) return link
  if (shown) return `${new URL(link).origin}/#/${place}`
  return `${link}&to=${place}`
}

interface NavigationEvent {
  preventDefault(): void
  url?: string
}

/** The part of an Electron web contents that the dashboard uses. */
export interface WebContentsLike {
  loadURL(url: string): Promise<void>
  getURL(): string
  setZoomFactor(factor: number): void
  getZoomFactor(): number
  on(event: string, listener: (...args: any[]) => void): unknown
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): unknown
}

/** The part of an Electron BrowserWindow that the dashboard uses. */
export interface WindowLike {
  webContents: WebContentsLike
  on(event: string, listener: (...args: any[]) => void): unknown
  setMenu(menu: null): void
  getContentSize(): [number, number]
  getNormalBounds(): Bounds
  isMaximized(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  isDestroyed(): boolean
  maximize(): void
  restore(): void
  show(): void
  hide(): void
  focus(): void
  destroy(): void
}

export interface WindowOptions extends Bounds {
  title: string
  /** The app's icon file (`appIconPath`), for the taskbar and the title bar. */
  icon: string
  backgroundColor: string
  show: false
  webPreferences: {
    partition: 'gb-core'
    contextIsolation: true
    sandbox: true
    nodeIntegration: false
    webSecurity: true
    spellcheck: false
  }
}

export interface DashboardDeps {
  /** The core's launch link. */
  link: string
  demo: boolean
  /** The app's icon file (`appIconPath`). */
  icon: string
  /**
   * Whether a close only hides the window, the app going on in the tray. False when there is no tray: nothing could
   * show the window again, so the close ends the app, as the demo's does. Default true.
   */
  canHide?: boolean
  /** `<data folder>\window.json`. */
  placementFile: string
  /** The displays' work areas, left to right as the system lists them, and the index of the main one. */
  displays(): { workAreas: Bounds[]; primary: number }
  createWindow(options: WindowOptions): WindowLike
  /** Opens an address in the player's own browser. */
  openExternal(url: string): void
  /** The app ends: the demo's window or a window with no tray to hide in was closed, or Windows is ending the session. */
  onEnded(): void
  /** A line for the log; the placement file that cannot be written is told of here. */
  warn?(text: string): void
}

export class Dashboard {
  private window: WindowLike | null = null
  // Windows that were closed and wait to be released: a window is destroyed RELEASE_AFTER_MS after it hides.
  private readonly releasing = new Map<WindowLike, ReturnType<typeof setTimeout>>()
  private readonly resizedCallbacks: (() => void)[] = []
  private readonly fragmentCallbacks: ((fragment: string) => void)[] = []
  private ending = false // the app is quitting, or the demo's window was closed: a close is no longer turned into a hide
  private ended = false

  constructor(private readonly deps: DashboardDeps) {}

  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  webContents(): WebContentsLike | null {
    return this.isOpen() ? this.window!.webContents : null
  }

  /** How large the page draws now: 1 while there is no window. */
  zoom(): number {
    return this.isOpen() ? zoomFor(this.window!.getContentSize()[0]) : 1
  }

  /** `cb` is called after the window changed size and the page has taken its zoom: the map views follow. */
  onResized(cb: () => void): void {
    this.resizedCallbacks.push(cb)
  }

  /** `cb` is called with the page's fragment, such as "#/map" (empty when there is none), after each navigation. */
  onFragment(cb: (fragment: string) => void): void {
    this.fragmentCallbacks.push(cb)
  }

  /**
   * Shows the window; with a place, such as "achievements/timers", on that place. A window not made yet takes the place
   * with its launch link, and a shown one goes there.
   */
  open(place: string | null = null): void {
    if (!this.isOpen()) {
      this.make(place)
    } else if (place !== null) {
      void this.window!.webContents.loadURL(placeUrl(this.deps.link, place, true)).catch(() => undefined)
    }
    const win = this.window!
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  /** Whether a close hides the window: with a tray, and not in the demo. Otherwise it ends the app. */
  private get hides(): boolean {
    return !this.deps.demo && this.deps.canHide !== false
  }

  /** Saves the place, hides the window and releases it later. In the demo, and with no tray, closing ends the app. */
  close(): void {
    const win = this.window
    if (!this.hides) {
      if (win !== null && !win.isDestroyed()) this.savePlacement(win)
      this.end()
      return
    }
    if (win === null || win.isDestroyed()) return
    this.savePlacement(win)
    win.hide()
    this.window = null
    this.releasing.set(
      win,
      setTimeout(() => this.release(win), RELEASE_AFTER_MS),
    )
  }

  /** As the app quits: every window goes at once, and a close is no longer held back. */
  destroy(): void {
    this.ending = true
    // As a quit from the tray with the window open: its place is kept first (a hidden window's is already saved).
    if (this.window !== null && !this.window.isDestroyed()) this.savePlacement(this.window)
    for (const [win, timer] of this.releasing) {
      clearTimeout(timer)
      this.releasing.delete(win)
      if (!win.isDestroyed()) win.destroy()
    }
    const win = this.window
    this.window = null
    if (win !== null && !win.isDestroyed()) win.destroy()
  }

  private make(place: string | null): void {
    const { workAreas, primary } = this.deps.displays()
    const { bounds, maximized } = restoredBounds(readPlacement(this.deps.placementFile), workAreas, primary)
    const win = this.deps.createWindow({
      ...bounds,
      title: this.deps.demo ? 'Guild Board - demo data' : 'Guild Board',
      icon: this.deps.icon,
      backgroundColor: BACKGROUND,
      show: false,
      webPreferences: {
        partition: 'gb-core',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    })
    this.window = win
    win.setMenu(null)
    this.wire(win)
    void win.webContents.loadURL(placeUrl(this.deps.link, place, false)).catch(() => undefined)
    this.applyZoom(win) // at once, so that the page does not paint at 100% until it has loaded
    if (maximized) win.maximize()
  }

  private wire(win: WindowLike): void {
    const contents = win.webContents
    const origin = new URL(this.deps.link).origin
    win.on('page-title-updated', (event: NavigationEvent) => event.preventDefault()) // the title is ours
    win.on('resize', () => {
      this.applyZoom(win) // a maximize, a restore and any change of the window's width arrive as resizes
      if (this.window === win) for (const cb of this.resizedCallbacks) cb() // not a window that is closing
    })
    win.on('close', (event: NavigationEvent) => {
      if (this.ending) return
      if (!this.hides) {
        this.close()
        return
      }
      event.preventDefault() // the X and Alt+F4 hide the window; the app goes on in the tray
      this.close()
    })
    // Windows is ending the session (logoff or shutdown): the place is kept at once, and the app starts to end. Best effort:
    // Windows may end the process soon after.
    win.on('session-end', () => {
      if (!win.isDestroyed()) this.savePlacement(win)
      this.end()
    })
    win.on('closed', () => {
      if (this.window === win) this.window = null
    })
    // Chromium keeps a zoom with the page it has loaded, so a page loaded again may have dropped it: each load asks again.
    contents.on('did-finish-load', () => this.applyZoom(win))
    const kept = (event: NavigationEvent, url?: string): void => {
      if (!sameOrigin(url ?? event.url ?? '', origin)) event.preventDefault()
    }
    contents.on('will-navigate', kept)
    contents.on('will-redirect', kept)
    contents.setWindowOpenHandler(({ url }) => {
      if (opensOutside(url)) this.deps.openExternal(url)
      return { action: 'deny' }
    })
    const fragment = (_event: unknown, url: string): void => {
      if (this.window !== win) return // a window that is closing no longer tells where the page is
      let hash: string
      try {
        hash = new URL(url).hash
      } catch {
        return
      }
      for (const cb of this.fragmentCallbacks) cb(hash)
    }
    contents.on('did-navigate', fragment)
    contents.on('did-navigate-in-page', fragment)
  }

  /** Zooms the page to the window's width when it is not at that zoom already: the page is asked, not a note kept. */
  private applyZoom(win: WindowLike): void {
    if (win.isDestroyed()) return
    const factor = zoomFor(win.getContentSize()[0])
    // The engine gives a factor back with a rounding error in its last digit.
    if (Math.abs(win.webContents.getZoomFactor() - factor) > 1e-6) win.webContents.setZoomFactor(factor)
  }

  private savePlacement(win: WindowLike): void {
    if (!win.isVisible()) return // a window never shown has no place to remember
    try {
      writePlacement(this.deps.placementFile, { ...win.getNormalBounds(), maximized: win.isMaximized() })
    } catch {
      this.deps.warn?.('The window’s place could not be kept in the data folder.')
    }
  }

  private release(win: WindowLike): void {
    this.releasing.delete(win)
    if (!win.isDestroyed()) win.destroy()
  }

  private end(): void {
    this.ending = true
    if (this.ended) return
    this.ended = true
    this.deps.onEnded()
  }
}

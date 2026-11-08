/**
 * The overlay's window (overlay.py and app.py): Guild Board's own, frameless, see-through and always on top, over a whole
 * display. It shows the interface's overlay page. Closed, it lets clicks through and never takes the focus, so the game
 * keeps both; open, on the hotkey, it takes them. For a game in full screen, which minimizes whenever it loses the focus,
 * the player turns on a setting, and the open window then takes the clicks but never the focus: the game stays in front,
 * and its own Alt shows the pointer. The window and the page say open or closed to each other through the page's address
 * alone: #/overlay or #/overlay/open.
 *
 * It never looks for the game's window, never activates it and never sends it input. Closing only makes this window
 * click-through again, or hides it, and Windows hands the focus back. Whether the game runs arrives through
 * `setGameRunning`, from the core's `game` event, and nothing else.
 *
 * Nothing here touches Electron: `main.ts` hands the window, the screen and the hotkey in through `OverlayDeps`.
 */
import { type DisplayEntry, type DisplayInfo, displayFor, displayList } from './displays.js'
import type { Hotkey, HotkeyState } from './hotkey.js'
import { opensOutside, sameOrigin } from './links.js'
import type { Bounds } from './placement.js'

export const CLOSED = '#/overlay' // the page's address fragment while the overlay is closed: pinned widgets and lines
export const OPEN = '#/overlay/open' // and while it is open: every widget, with Edit

const ABORTED = -3 // Chromium's ERR_ABORTED: a load that another load replaced

/** The settings the overlay reads: `Settings` of the channel has all of them. */
export interface OverlaySettings {
  overlay_hotkey: string
  overlay_display: string
  overlay_size: number
  overlay_full_screen: boolean
  risk_acknowledged?: unknown
}

interface NavigationEvent {
  preventDefault(): void
  url?: string
}

/** The part of an Electron web contents that the overlay uses. */
export interface OverlayContentsLike {
  loadURL(url: string): Promise<void>
  setZoomFactor(factor: number): void
  executeJavaScript(code: string): Promise<unknown>
  on(event: string, listener: (...args: any[]) => void): unknown
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): unknown
}

/** The part of an Electron BrowserWindow that the overlay uses. `setIgnoreMouseEvents` takes one argument, and only one. */
export interface OverlayWindowLike {
  webContents: OverlayContentsLike
  on(event: string, listener: (...args: any[]) => void): unknown
  setMenu(menu: null): void
  setAlwaysOnTop(flag: boolean, level: 'screen-saver'): void
  setIgnoreMouseEvents(ignore: boolean): void
  setFocusable(focusable: boolean): void
  setBounds(bounds: Bounds): void
  show(): void
  showInactive(): void
  hide(): void
  focus(): void
  destroy(): void
  isDestroyed(): boolean
}

export interface OverlayWindowOptions extends Bounds {
  title: string
  /**
   * The app's icon file (`appIconPath`), as every window of Guild Board's has. It shows nowhere: the overlay has no taskbar
   * button, no title bar and, as a toolbar, no place in Alt+Tab.
   */
  icon: string
  transparent: true
  frame: false
  resizable: false
  movable: false
  minimizable: false
  maximizable: false
  fullscreenable: false
  skipTaskbar: true
  hasShadow: false
  focusable: false
  alwaysOnTop: true
  type: 'toolbar'
  show: false
  backgroundColor: '#00000000'
  webPreferences: {
    partition: 'gb-overlay'
    contextIsolation: true
    sandbox: true
    nodeIntegration: false
    webSecurity: true
    spellcheck: false
    // On, the default: a hidden page stops drawing, which is how the hidden overlay costs nothing. (Electron has no
    // page-freeze call; none is reached for, and the debugger is not used.)
    backgroundThrottling: true
  }
}

/** The part of Electron's `screen` that the overlay uses. */
export interface ScreenLike {
  getAllDisplays(): { id: number; bounds: Bounds; scaleFactor: number }[]
  getPrimaryDisplay(): { id: number }
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
}

export interface OverlayDeps {
  createWindow(options: OverlayWindowOptions): OverlayWindowLike
  /** The app's icon file (`appIconPath`). */
  icon: string
  screen: ScreenLike
  hotkey: Pick<Hotkey, 'hold' | 'release' | 'state'>
  /** Tells the core what the Overlay settings show: `overlay_shell`. */
  report(displays: DisplayEntry[], hotkeyState: HotkeyState): void
  /** Whether any window of Guild Board's has the focus: `BrowserWindow.getFocusedWindow() !== null`. */
  anyWindowFocused(): boolean
  /** Opens an address in the player's own browser. */
  openExternal(url: string): void
  /** A line for the log. */
  warn?(text: string): void
  /** Runs `cb` once what is pending has been handled; `setTimeout(cb, 0)` unless a test says otherwise. */
  defer?(cb: () => void): void
}

const HOTKEY_FALLBACK: OverlaySettings = {
  overlay_hotkey: '',
  overlay_display: '',
  overlay_size: 100,
  overlay_full_screen: false,
}

export class Overlay {
  private readonly link: string
  private window: OverlayWindowLike | null = null
  private settings: OverlaySettings = HOTKEY_FALLBACK
  private target: Bounds | null = null // the display's bounds, kept for a window not made yet
  private opened = false
  private showing = false // the window is to be seen: shown closed, or open
  // The launch link redirects to #/overlay, and that load sets the session cookie the page needs. Until it has finished,
  // the page's address is neither read nor set: its arrival at #/overlay is not the page closing itself, and an address
  // set before then would cut the launch short. Nor is the window shown until then: the page turns see-through only once
  // its script has run, and would cover the game for a moment.
  private loaded = false
  private launchFailed = false // the last launch did not load: the next show loads it again
  private zoom = 1 // how large the page draws, kept for each load
  private fullScreenGame = false // the setting: open, the window takes the clicks but never the focus
  private tookFocus = false // the open window has the focus, which closing hands back
  private focusable = false // what the window was last told: it is made not focusable, and told only when that changes
  private gameRunning: boolean | null = null // null until the core has said
  private started = false
  private ending = false
  private displaysPending = false
  private hotkeyRefused: string | null = null
  private readonly displayEvents = ['display-added', 'display-removed', 'display-metrics-changed'] as const
  private readonly followListener = (): void => this.displaysChanged()

  constructor(
    private readonly deps: OverlayDeps,
    link: string,
  ) {
    this.link = link
  }

  get isOpen(): boolean {
    return this.opened
  }

  /** Holds the hotkey, covers the display the settings name, hears of the displays, and tells the core of both. */
  start(): void {
    if (this.started || this.ending) return
    this.started = true
    this.place()
    this.holdHotkey()
    for (const name of this.displayEvents) this.deps.screen.on(name, this.followListener)
    this.report()
  }

  /** As Guild Board ends: the overlay goes first, so nothing stays over the game taking its clicks. */
  stop(): void {
    this.hide()
    this.ending = true
    this.deps.hotkey.release()
    for (const name of this.displayEvents) this.deps.screen.removeListener(name, this.followListener)
    const win = this.window
    this.window = null
    if (win !== null && !win.isDestroyed()) win.destroy()
  }

  /** The settings, once before `start` and after every change. */
  applySettings(settings: OverlaySettings): void {
    const previous = this.settings
    this.settings = settings
    this.fullScreenGame = settings.overlay_full_screen
    if (!this.started || this.ending) return
    // A hotkey another program held is asked for again with any settings, as when the player saves it again.
    if (settings.overlay_hotkey !== previous.overlay_hotkey || this.deps.hotkey.state === 'taken') {
      this.holdHotkey()
      this.report()
    }
    if (settings.overlay_display !== previous.overlay_display || settings.overlay_size !== previous.overlay_size) {
      this.place()
    }
  }

  /** From the core's `game` event: the window shows, closed, while the game runs and hides when it stops. */
  setGameRunning(running: boolean): void {
    this.gameRunning = running
    if (this.ending || this.opened) return // an open overlay stays as it is
    if (running) this.showClosed()
    else this.hide()
  }

  setFullScreenGame(on: boolean): void {
    this.fullScreenGame = on
  }

  /** How large the page draws: the size chosen in Settings, in percent. Kept, and applied at once when the page has loaded. */
  setZoom(size: number): void {
    this.zoom = (Number.isFinite(size) && size > 0 ? size : 100) / 100
    if (this.loaded && this.live()) this.window!.webContents.setZoomFactor(this.zoom)
  }

  /** Covers all of the display. */
  placeOn(display: DisplayInfo): void {
    this.target = { ...display.bounds }
    if (this.live()) this.window!.setBounds(this.target)
  }

  /**
   * Shows the overlay closed: the pinned widgets and the lines over the game, which keeps the clicks and the focus. An
   * open overlay closes. The window shows once its page has first loaded.
   */
  showClosed(): void {
    if (this.ending) return
    this.closeOverlay(false)
    this.launch()
    this.showing = true
    if (this.loaded) {
      this.clickThrough()
      this.window!.showInactive()
    }
  }

  /**
   * Opens the overlay: the window takes the clicks and the focus, and the page shows every widget, with Edit. The window
   * shows once its page has first loaded.
   */
  open(): void {
    if (this.opened || this.ending) return
    this.launch()
    this.opened = this.showing = true
    this.window!.setIgnoreMouseEvents(false)
    if (this.loaded) this.showOpen()
  }

  /** Closes the overlay: the window stays shown and lets clicks through again, and Windows hands the focus back. */
  close(): void {
    this.closeOverlay(true)
  }

  /** Hides the window; it is kept, and the page's frames stop while it is hidden. An open overlay closes first. */
  hide(): void {
    this.closeOverlay(false)
    this.showing = false
    if (this.live()) this.window!.hide()
  }

  /** The hotkey: closes an open overlay, and opens a closed one once the risk statement has been acknowledged. */
  toggle(): void {
    if (this.ending) return
    if (this.opened) this.closeOverlay(true)
    // Until the player has read the risk statement the overlay's page shows nothing: an open overlay would be an empty
    // layer taking the game's clicks.
    else if (this.settings.risk_acknowledged === true) this.open()
  }

  /**
   * The focus left a window of Guild Board's. When it left all of them (alt-tab, or a click on the taskbar) the overlay
   * closes, so the game is never left behind a layer that takes its clicks. On its way between two of Guild Board's
   * windows the focus may pass through none at all, so this looks again once what is pending has been handled.
   */
  windowBlurred(): void {
    if (!this.opened) return
    this.defer(() => {
      if (this.opened && !this.deps.anyWindowFocused()) this.closeOverlay(true)
    })
  }

  private live(): boolean {
    return this.window !== null && !this.window.isDestroyed()
  }

  private defer(cb: () => void): void {
    if (this.deps.defer !== undefined) this.deps.defer(cb)
    else setTimeout(cb, 0)
  }

  /** The window over the display, as the settings name it, at the size the settings choose. */
  private place(): void {
    const displays = this.displays()
    if (displays.length === 0) return // no display at all, for a moment while the setup changes
    this.placeOn(displayFor(displays, this.settings.overlay_display))
    this.setZoom(this.settings.overlay_size)
  }

  private displays(): DisplayInfo[] {
    const main = this.deps.screen.getPrimaryDisplay().id
    return this.deps.screen.getAllDisplays().map((display) => ({ ...display, primary: display.id === main }))
  }

  private report(): void {
    this.deps.report(displayList(this.displays()), this.deps.hotkey.state)
  }

  /** Asks Windows for the overlay's hotkey. When another program holds it, Guild Board holds none, and the settings say so. */
  private holdHotkey(): void {
    const text = this.settings.overlay_hotkey
    const state = this.deps.hotkey.hold(text, () => this.toggle())
    if (state === 'taken') {
      // Asked for again with every settings change while another program holds it: the log tells of it once.
      if (text !== this.hotkeyRefused) {
        this.hotkeyRefused = text
        this.deps.warn?.(`Windows refused the overlay's hotkey ${text}; another program may hold it`)
      }
    } else {
      this.hotkeyRefused = null
    }
  }

  /** Windows tells of a new main display at once, and of the displays' new geometries a moment later: follow once. */
  private displaysChanged(): void {
    if (this.displaysPending || this.ending) return
    this.displaysPending = true
    this.defer(() => {
      this.displaysPending = false
      if (this.ending) return
      this.place()
      this.report()
    })
  }

  private clickThrough(): void {
    this.window!.setIgnoreMouseEvents(true)
    this.makeFocusable(false)
  }

  /** Told to the window only when it changes: removing focusability from a visible window can bring another window forward. */
  private makeFocusable(on: boolean): void {
    if (this.focusable === on) return
    this.focusable = on
    this.window!.setFocusable(on)
  }

  /**
   * `hideIfNoGame`: a close that leaves nothing to show over (the core said the game does not run) hides the window.
   */
  private closeOverlay(hideIfNoGame: boolean): void {
    if (!this.opened) return
    this.opened = false // first: the hide below takes the focus away, and the blur is then no one's business
    const win = this.window!
    win.setIgnoreMouseEvents(true)
    if (this.loaded && this.tookFocus) {
      // The window with the focus hides, and Windows hands the focus to the window that had it. Only then is it made not
      // focusable: that would otherwise be done to a visible, active window, and Windows may pick the next one itself.
      win.hide()
      this.makeFocusable(false)
      win.showInactive()
    } else {
      this.makeFocusable(false)
    }
    if (this.loaded) this.address(CLOSED)
    this.tookFocus = false
    if (hideIfNoGame && this.gameRunning === false) this.hide()
  }

  private showOpen(): void {
    const win = this.window!
    if (this.fullScreenGame) {
      // The game keeps the focus and the keyboard: the hotkey or Close closes the overlay.
      win.showInactive() // not focusable already, and not made so again
      this.tookFocus = false
    } else {
      this.makeFocusable(true)
      win.show()
      win.focus() // Esc goes to the page
      this.tookFocus = true
    }
    this.address(OPEN)
  }

  /**
   * Makes the window on the first show, and opens the overlay's launch link in it. A launch that failed is opened again;
   * a page that has loaded never is, which would lose an Edit not saved yet.
   */
  private launch(): void {
    if (this.window === null || this.window.isDestroyed()) this.make()
    else if (this.loaded || !this.launchFailed) return
    this.launchFailed = false
    this.window!.webContents.loadURL(`${this.link}&to=overlay`).catch(() => undefined) // a failure arrives as did-fail-load
  }

  private make(): void {
    const target = this.target ?? this.fallbackBounds()
    const win = this.deps.createWindow({
      ...target,
      title: 'Guild Board overlay',
      icon: this.deps.icon,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      alwaysOnTop: true,
      type: 'toolbar',
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        partition: 'gb-overlay',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: true,
      },
    })
    this.window = win
    this.loaded = false
    this.launchFailed = false
    this.focusable = false
    win.setMenu(null) // a menu's accelerators work in a frameless window too: reload, DevTools
    win.setAlwaysOnTop(true, 'screen-saver') // over a game that is not in exclusive full screen
    win.setIgnoreMouseEvents(true) // closed: the clicks go through to what lies under it
    const contents = win.webContents
    const origin = new URL(this.link).origin
    contents.on('did-finish-load', () => this.onLoaded())
    contents.on('did-fail-load', (_event: unknown, code: number, _text: string, _url: string, isMainFrame: boolean) => {
      if (isMainFrame !== false && code !== ABORTED) this.onLoadFailed()
    })
    contents.on('did-navigate-in-page', (_event: unknown, url: string) => {
      // The page asked: Esc, or Close.
      if (this.loaded && this.opened && hashOf(url) === CLOSED) this.closeOverlay(true)
    })
    const kept = (event: NavigationEvent, url?: string): void => {
      if (!sameOrigin(url ?? event.url ?? '', origin)) event.preventDefault()
    }
    contents.on('will-navigate', kept)
    contents.on('will-redirect', kept)
    contents.setWindowOpenHandler(({ url }) => {
      if (opensOutside(url)) this.deps.openExternal(url)
      return { action: 'deny' }
    })
    win.on('close', (event: NavigationEvent) => {
      if (this.ending) return
      // Alt+F4 closes the open overlay, as Esc does. The window stays, for the pinned widgets and the lines.
      event.preventDefault()
      this.closeOverlay(true)
    })
    win.on('blur', () => this.windowBlurred())
    win.on('closed', () => {
      if (this.window === win) {
        this.window = null
        this.loaded = false
        this.opened = false
        this.tookFocus = false
      }
    })
  }

  private fallbackBounds(): Bounds {
    const displays = this.displays()
    return displays.length === 0 ? { x: 0, y: 0, width: 800, height: 600 } : { ...displayFor(displays, this.settings.overlay_display).bounds }
  }

  private onLoaded(): void {
    // Before the window shows. Chromium keeps a zoom with the page it has loaded, so each load takes it again; a new
    // fragment, as on opening and closing, keeps the page and its zoom.
    this.window!.webContents.setZoomFactor(this.zoom)
    if (this.loaded) return
    // A refused connection sends did-fail-load, then did-finish-load for the error page, whose address is the one asked
    // for: the failure is told by the flag alone (`launch` clears it before each load).
    if (this.launchFailed) return
    this.loaded = true
    // The window shows now, as it is at this moment: open, shown closed, or hidden.
    if (this.opened) {
      this.showOpen() // opened while the launch loaded: the page is told now
      return
    }
    this.address(CLOSED)
    if (this.showing) this.window!.showInactive()
  }

  private onLoadFailed(): void {
    if (this.loaded) return
    this.launchFailed = true // no page to show, to tell or to hear
    this.deps.warn?.('the overlay\'s page could not be loaded; it is loaded again when the overlay next shows')
    this.closeOverlay(false) // an open overlay with nothing to show closes: the next press opens it, and loads it
  }

  /** Sets the page's address fragment, which the page follows without loading again: once the launch has loaded. */
  private address(fragment: string): void {
    if (!this.loaded || !this.live()) return
    const quoted = JSON.stringify(fragment)
    this.window!.webContents.executeJavaScript(`if (location.hash !== ${quoted}) location.hash = ${quoted}`).catch(() => undefined)
  }
}

function hashOf(url: string): string {
  try {
    return new URL(url).hash
  } catch {
    return ''
  }
}

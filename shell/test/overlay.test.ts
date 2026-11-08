import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DisplayEntry } from '../src/displays.js'
import { Hotkey, type HotkeyState } from '../src/hotkey.js'
import {
  CLOSED,
  OPEN,
  Overlay,
  type OverlayContentsLike,
  type OverlayDeps,
  type OverlaySettings,
  type OverlayWindowLike,
  type OverlayWindowOptions,
  type ScreenLike,
} from '../src/overlay.js'
import type { Bounds } from '../src/placement.js'

const ORIGIN = 'http://127.0.0.1:51234'
const LINK = `${ORIGIN}/?t=made-up-launch-token`
const ICON = 'Z:\\repo\\shell\\assets\\icon.ico'

type Listener = (...args: any[]) => void

class FakeContents implements OverlayContentsLike {
  listeners = new Map<string, Listener[]>()
  loaded: string[] = []
  zoomSet: number[] = []
  scripts: string[] = []
  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
  loadURL(url: string): Promise<void> {
    this.loaded.push(url)
    return Promise.resolve()
  }
  setZoomFactor(factor: number): void {
    this.zoomSet.push(factor)
  }
  openHandler: ((details: { url: string }) => { action: 'deny' }) | null = null
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void {
    this.openHandler = handler
  }
  executeJavaScript(code: string): Promise<unknown> {
    this.scripts.push(code)
    return Promise.resolve()
  }
  /** The fragments the window was told to go to, in order. */
  get hashes(): string[] {
    return this.scripts.map((code) => /"(#[^"]*)"/.exec(code)![1])
  }
  /** The page loads: the launch's redirect lands on the closed overlay. */
  finishLoad(): void {
    this.emit('did-finish-load')
  }
  /** As Electron does for a refused connection: did-fail-load, then did-finish-load on the error page. */
  failLoad(): void {
    this.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', LINK, true)
    this.emit('did-finish-load')
  }
  /** The page sets its own address. */
  pageGoes(hash: string): void {
    this.emit('did-navigate-in-page', {}, `${ORIGIN}/${hash}`)
  }
}

class FakeWindow implements OverlayWindowLike {
  webContents = new FakeContents()
  listeners = new Map<string, Listener[]>()
  calls: string[] = []
  ignore: boolean | null = null
  focusable: boolean
  visible = false
  destroyed = false
  bounds: Bounds
  ignoreArgs: unknown[][] = []
  constructor(public options: OverlayWindowOptions) {
    this.focusable = options.focusable
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }
  }
  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
  setAlwaysOnTop(flag: boolean, level: string): void {
    this.calls.push(`alwaysOnTop ${flag} ${level}`)
  }
  // Takes whatever it is given, so that a second argument can be seen.
  menu: unknown = 'unset'
  setMenu(menu: null): void {
    this.menu = menu
  }
  setIgnoreMouseEvents(...args: unknown[]): void {
    this.ignoreArgs.push(args)
    this.calls.push(`ignore ${String(args[0])}`)
    this.ignore = args[0] as boolean
  }
  setFocusable(focusable: boolean): void {
    this.calls.push(`focusable ${focusable}`)
    this.focusable = focusable
  }
  setBounds(bounds: Bounds): void {
    this.calls.push(`bounds ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`)
    this.bounds = bounds
  }
  show(): void {
    this.calls.push('show')
    this.visible = true
  }
  showInactive(): void {
    this.calls.push('showInactive')
    this.visible = true
  }
  hide(): void {
    this.calls.push('hide')
    this.visible = false
  }
  focus(): void {
    this.calls.push('focus')
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  destroy(): void {
    this.calls.push('destroy')
    this.destroyed = true
  }
  /** What happened from the call `from` on. */
  since(mark: number): string[] {
    return this.calls.slice(mark)
  }
}

class FakeScreen implements ScreenLike {
  listeners = new Map<string, Listener[]>()
  displays = [
    { id: 11, bounds: { x: 0, y: 0, width: 3440, height: 1440 }, scaleFactor: 1 },
    { id: 22, bounds: { x: 3440, y: 0, width: 2560, height: 1440 }, scaleFactor: 1 },
  ]
  mainId = 11
  getAllDisplays() {
    return this.displays
  }
  getPrimaryDisplay() {
    return { id: this.mainId }
  }
  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  removeListener(event: string, listener: Listener): void {
    this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== listener))
  }
  emit(event: string): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener({}, {})
  }
  count(): number {
    return [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0)
  }
}

const SETTINGS: OverlaySettings = {
  overlay_hotkey: 'Ctrl+Alt+G',
  overlay_display: '',
  overlay_size: 100,
  overlay_full_screen: false,
  risk_acknowledged: true,
}

interface Rig {
  overlay: Overlay
  windows: FakeWindow[]
  screen: FakeScreen
  reports: { displays: DisplayEntry[]; state: HotkeyState }[]
  shortcuts: Map<string, () => void>
  register: ReturnType<typeof vi.fn>
  focused: { value: boolean }
  warnings: string[]
  external: string[]
  win(): FakeWindow
}

function rig(options: { settings?: Partial<OverlaySettings>; hotkeyFree?: boolean; start?: boolean; realDefer?: boolean } = {}): Rig {
  const windows: FakeWindow[] = []
  const screen = new FakeScreen()
  const reports: { displays: DisplayEntry[]; state: HotkeyState }[] = []
  const shortcuts = new Map<string, () => void>()
  const focused = { value: false }
  const warnings: string[] = []
  const external: string[] = []
  const register = vi.fn((accelerator: string, cb: () => void) => {
    if (options.hotkeyFree === false) return false
    shortcuts.set(accelerator, cb)
    return true
  })
  const deps: OverlayDeps = {
    createWindow: (opts) => {
      const win = new FakeWindow(opts)
      windows.push(win)
      return win
    },
    screen,
    hotkey: new Hotkey(register, (accelerator) => shortcuts.delete(accelerator)),
    report: (displays, state) => reports.push({ displays, state }),
    anyWindowFocused: () => focused.value,
    warn: (text) => warnings.push(text),
    openExternal: (url) => external.push(url),
    icon: ICON,
    ...(options.realDefer === true ? {} : { defer: (cb: () => void) => cb() }),
  }
  const overlay = new Overlay(deps, LINK)
  overlay.applySettings({ ...SETTINGS, ...options.settings })
  if (options.start !== false) overlay.start()
  return { overlay, windows, screen, reports, shortcuts, register, focused, warnings, external, win: () => windows[0] }
}

/** A rig whose overlay has loaded its page and shows closed. */
function shown(options: Parameters<typeof rig>[0] = {}): Rig {
  const r = rig(options)
  r.overlay.showClosed()
  r.win().webContents.finishLoad()
  return r
}

/** A rig whose overlay is open. */
function opened(options: Parameters<typeof rig>[0] = {}): Rig {
  const r = shown(options)
  r.overlay.open()
  return r
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

test('the fragments are the page’s', () => {
  expect(CLOSED).toBe('#/overlay')
  expect(OPEN).toBe('#/overlay/open')
})

test('no window is made until the overlay is first shown', () => {
  const { windows } = rig()
  expect(windows).toHaveLength(0)
})

test('the window: see-through, frameless, a toolbar, on top at screen-saver, in its own session, and not focusable', () => {
  const r = rig()
  r.overlay.showClosed()
  expect(r.windows).toHaveLength(1)
  const { options } = r.win()
  expect(options).toMatchObject({
    transparent: true,
    frame: false,
    type: 'toolbar',
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    // The app's, as every window's: it shows nowhere, since the overlay has no taskbar button and, as a toolbar, no place in
    // Alt+Tab, and it changes nothing else.
    icon: ICON,
    x: 0,
    y: 0,
    width: 3440,
    height: 1440,
  })
  expect(options.webPreferences).toEqual({
    partition: 'gb-overlay',
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
    backgroundThrottling: true,
  })
  expect(r.win().calls).toContain('alwaysOnTop true screen-saver')
  expect(r.win().ignore).toBe(true)
})

test('showClosed loads the launch link for the overlay, and shows inactive only after the first load', () => {
  const r = rig()
  r.overlay.showClosed()
  expect(r.win().webContents.loaded).toEqual([`${LINK}&to=overlay`])
  expect(r.win().visible).toBe(false)
  r.win().webContents.finishLoad()
  expect(r.win().visible).toBe(true)
  expect(r.win().calls).toContain('showInactive')
  expect(r.win().calls).not.toContain('show')
  expect(r.win().calls).not.toContain('focus')
})

test('showClosed gives ignore true, focusable false and an inactive show', () => {
  const r = shown()
  const mark = r.win().calls.length
  r.overlay.showClosed()
  expect(r.win().since(mark)).toEqual(['ignore true', 'showInactive']) // already click-through and not focusable: no call
  expect(r.win().ignore).toBe(true)
  expect(r.win().focusable).toBe(false)
  expect(r.overlay.isOpen).toBe(false)
})

test('the page loads once: a second showClosed does not load it again', () => {
  const r = shown()
  r.overlay.showClosed()
  expect(r.win().webContents.loaded).toHaveLength(1)
})

test('the page is put on the closed fragment once it has loaded', () => {
  const r = shown()
  expect(r.win().webContents.hashes).toEqual([CLOSED])
})

test('open gives ignore false, focusable true, a show, focus, and the fragment OPEN', () => {
  const r = shown()
  const mark = r.win().calls.length
  r.overlay.open()
  expect(r.win().since(mark)).toEqual(['ignore false', 'focusable true', 'show', 'focus'])
  expect(r.win().ignore).toBe(false)
  expect(r.win().focusable).toBe(true)
  expect(r.win().webContents.hashes.at(-1)).toBe(OPEN)
  expect(r.overlay.isOpen).toBe(true)
})

test('open twice does nothing the second time', () => {
  const r = opened()
  const mark = r.win().calls.length
  r.overlay.open()
  expect(r.win().since(mark)).toEqual([])
})

test('in full-screen mode, open takes the clicks but leaves focusable false and never calls focus', () => {
  const r = shown({ settings: { overlay_full_screen: true } })
  const mark = r.win().calls.length
  r.overlay.open()
  expect(r.win().since(mark)).toEqual(['ignore false', 'showInactive']) // the window is not focusable already: no call
  expect(r.win().focusable).toBe(false)
  expect(r.win().calls.slice(mark)).not.toContain('focus')
  expect(r.win().calls.slice(mark)).not.toContain('show')
  expect(r.win().webContents.hashes.at(-1)).toBe(OPEN)
})

test('setFullScreenGame changes the next opening', () => {
  const r = shown()
  r.overlay.setFullScreenGame(true)
  r.overlay.open()
  expect(r.win().focusable).toBe(false)
  expect(r.win().calls).not.toContain('focus')
})

test('an overlay opened before its page has loaded shows open once it has', () => {
  const r = rig()
  r.overlay.open()
  expect(r.win().visible).toBe(false)
  expect(r.win().ignore).toBe(false)
  r.win().webContents.finishLoad()
  expect(r.win().visible).toBe(true)
  expect(r.win().calls).toContain('focus')
  expect(r.win().webContents.hashes.at(-1)).toBe(OPEN)
})

test('the page’s fragment CLOSED while open closes it', () => {
  const r = opened()
  r.win().webContents.pageGoes(CLOSED)
  expect(r.overlay.isOpen).toBe(false)
  expect(r.win().ignore).toBe(true)
  expect(r.win().focusable).toBe(false)
})

test('the page’s other fragments, and any while closed, change nothing', () => {
  const r = opened()
  r.win().webContents.pageGoes(OPEN)
  expect(r.overlay.isOpen).toBe(true)
  const mark = r.win().calls.length
  r.overlay.close()
  r.win().webContents.pageGoes(CLOSED)
  expect(r.win().since(mark)).toEqual(['ignore true', 'hide', 'focusable false', 'showInactive'])
})

test('a fragment before the first load is not the page closing itself', () => {
  const r = rig()
  r.overlay.open()
  r.win().webContents.pageGoes(CLOSED) // the launch's redirect
  expect(r.overlay.isOpen).toBe(true)
})

test('close after a focused open hides, then shows inactive, and the fragment becomes CLOSED', () => {
  const r = opened()
  const mark = r.win().calls.length
  r.overlay.close()
  expect(r.win().since(mark)).toEqual(['ignore true', 'hide', 'focusable false', 'showInactive'])
  expect(r.win().webContents.hashes.at(-1)).toBe(CLOSED)
  expect(r.win().visible).toBe(true)
  expect(r.overlay.isOpen).toBe(false)
})

test('close after an open without the focus does not hide', () => {
  const r = opened({ settings: { overlay_full_screen: true } })
  const mark = r.win().calls.length
  r.overlay.close()
  expect(r.win().since(mark)).toEqual(['ignore true'])
  expect(r.win().webContents.hashes.at(-1)).toBe(CLOSED)
})

test('close of a closed overlay does nothing', () => {
  const r = shown()
  const mark = r.win().calls.length
  r.overlay.close()
  expect(r.win().since(mark)).toEqual([])
})

test('the window’s close event (Alt+F4) is prevented and closes the overlay', () => {
  const r = opened()
  const event = { preventDefault: vi.fn() }
  r.win().emit('close', event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(r.overlay.isOpen).toBe(false)
  expect(r.win().destroyed).toBe(false)
})

test('focus leaving all of Guild Board’s windows closes it; a window of ours having it keeps it open', () => {
  const r = opened()
  r.focused.value = true
  r.win().emit('blur')
  expect(r.overlay.isOpen).toBe(true)
  r.focused.value = false
  r.overlay.windowBlurred() // the dashboard lost the focus
  expect(r.overlay.isOpen).toBe(false)
})

test('the window’s own blur closes it when no window of ours has the focus', () => {
  const r = opened()
  r.win().emit('blur')
  expect(r.overlay.isOpen).toBe(false)
})

test('a blur while closed does nothing', () => {
  const r = shown()
  const mark = r.win().calls.length
  r.win().emit('blur')
  expect(r.win().since(mark)).toEqual([])
})

test('the zoom is the size over 100, set after each load', () => {
  const r = rig({ settings: { overlay_size: 150 } })
  r.overlay.showClosed()
  r.win().webContents.finishLoad()
  expect(r.win().webContents.zoomSet).toEqual([1.5])
  r.win().webContents.finishLoad() // a page loaded again takes it again
  expect(r.win().webContents.zoomSet).toEqual([1.5, 1.5])
  r.overlay.setZoom(125)
  expect(r.win().webContents.zoomSet.at(-1)).toBe(1.25)
})

test('a zoom set before the page has loaded is applied at its load', () => {
  const r = rig()
  r.overlay.showClosed()
  r.overlay.setZoom(200)
  expect(r.win().webContents.zoomSet).toEqual([])
  r.win().webContents.finishLoad()
  expect(r.win().webContents.zoomSet).toEqual([2])
})

test('a failed load leaves the window unshown, and the next showClosed loads again', () => {
  const r = rig()
  r.overlay.showClosed()
  r.win().webContents.failLoad()
  expect(r.win().visible).toBe(false)
  expect(r.win().calls).not.toContain('showInactive')
  r.overlay.showClosed()
  expect(r.win().webContents.loaded).toHaveLength(2)
  r.win().webContents.finishLoad()
  expect(r.win().visible).toBe(true)
})

test('a failed load of an open overlay closes it', () => {
  const r = rig()
  r.overlay.open()
  r.win().webContents.failLoad()
  expect(r.overlay.isOpen).toBe(false)
  expect(r.win().ignore).toBe(true)
})

test('an aborted load or a failed frame is not a failed launch', () => {
  const r = rig()
  r.overlay.showClosed()
  r.win().webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', LINK, true)
  r.win().webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://example.com/', false)
  r.overlay.showClosed()
  expect(r.win().webContents.loaded).toHaveLength(1)
})

test('a failure after the page has loaded changes nothing', () => {
  const r = shown()
  r.win().webContents.failLoad()
  r.overlay.showClosed()
  expect(r.win().webContents.loaded).toHaveLength(1)
  expect(r.win().visible).toBe(true)
})

test('hide hides the window and keeps it; an open overlay closes first', () => {
  const r = opened()
  const mark = r.win().calls.length
  r.overlay.hide()
  expect(r.win().since(mark)).toEqual(['ignore true', 'hide', 'focusable false', 'showInactive', 'hide'])
  expect(r.win().visible).toBe(false)
  expect(r.win().destroyed).toBe(false)
  expect(r.overlay.isOpen).toBe(false)
})

test('hide runs nothing in the page: no freeze, no debugger', () => {
  const r = shown()
  r.overlay.hide()
  expect(r.win().webContents.scripts).toEqual([CLOSED].map((hash) => expect.stringContaining(hash)))
})

test('showClosed after a hide shows the same window again, without loading', () => {
  const r = shown()
  r.overlay.hide()
  r.overlay.showClosed()
  expect(r.windows).toHaveLength(1)
  expect(r.win().webContents.loaded).toHaveLength(1)
  expect(r.win().visible).toBe(true)
})

test('toggle opens a closed overlay and closes an open one', () => {
  const r = shown()
  r.overlay.toggle()
  expect(r.overlay.isOpen).toBe(true)
  r.overlay.toggle()
  expect(r.overlay.isOpen).toBe(false)
})

test('toggle never opens before the risk statement is acknowledged', () => {
  const r = rig({ settings: { risk_acknowledged: false } })
  r.overlay.toggle()
  expect(r.overlay.isOpen).toBe(false)
  expect(r.windows).toHaveLength(0)
  r.overlay.applySettings({ ...SETTINGS, risk_acknowledged: true })
  r.overlay.toggle()
  expect(r.overlay.isOpen).toBe(true)
})

test('setIgnoreMouseEvents is never called with two arguments', () => {
  const r = rig()
  r.overlay.showClosed()
  r.win().webContents.finishLoad()
  r.overlay.open()
  r.overlay.close()
  r.overlay.setFullScreenGame(true)
  r.overlay.open()
  r.overlay.close()
  r.overlay.hide()
  expect(r.win().ignoreArgs.length).toBeGreaterThan(4)
  for (const args of r.win().ignoreArgs) expect(args).toHaveLength(1)
})

test('the game: shows closed while it runs, hides when it stops, and leaves an open overlay as it is', () => {
  const r = rig()
  r.overlay.setGameRunning(true)
  r.win().webContents.finishLoad()
  expect(r.win().visible).toBe(true)
  r.overlay.setGameRunning(false)
  expect(r.win().visible).toBe(false)
  r.overlay.setGameRunning(true)
  expect(r.win().visible).toBe(true)
  r.overlay.open()
  r.overlay.setGameRunning(false)
  expect(r.overlay.isOpen).toBe(true)
  expect(r.win().visible).toBe(true)
  r.overlay.close() // nothing to show over any more
  expect(r.win().visible).toBe(false)
})

test('closing while the game runs leaves the closed layer shown', () => {
  const r = shown()
  r.overlay.setGameRunning(true)
  r.overlay.open()
  r.overlay.close()
  expect(r.win().visible).toBe(true)
})

test('the hotkey toggles the overlay', () => {
  const r = shown()
  expect(r.shortcuts.has('Control+Alt+G')).toBe(true)
  r.shortcuts.get('Control+Alt+G')!()
  expect(r.overlay.isOpen).toBe(true)
  r.shortcuts.get('Control+Alt+G')!()
  expect(r.overlay.isOpen).toBe(false)
})

test('start holds the hotkey, places the overlay and reports the displays and the hotkey', () => {
  const r = rig()
  expect(r.reports).toEqual([
    {
      displays: [
        { name: '11', label: 'Display 1, 3440 × 1440, main', primary: true },
        { name: '22', label: 'Display 2, 2560 × 1440', primary: false },
      ],
      state: 'held',
    },
  ])
})

test('a hotkey another program holds is reported taken, and the log tells of it once', () => {
  const r = rig({ hotkeyFree: false })
  expect(r.reports.at(-1)!.state).toBe('taken')
  r.overlay.applySettings({ ...SETTINGS, overlay_size: 120 })
  r.overlay.applySettings({ ...SETTINGS, overlay_size: 130 })
  expect(r.warnings).toHaveLength(1)
  expect(r.warnings[0]).toContain('Ctrl+Alt+G')
})

test('a new hotkey in the settings is held and reported', () => {
  const r = rig()
  r.overlay.applySettings({ ...SETTINGS, overlay_hotkey: 'Ctrl+Alt+H' })
  expect([...r.shortcuts.keys()]).toEqual(['Control+Alt+H'])
  expect(r.reports).toHaveLength(2)
  expect(r.reports.at(-1)!.state).toBe('held')
})

test('settings that change nothing about the overlay report nothing', () => {
  const r = rig()
  r.overlay.applySettings({ ...SETTINGS, risk_acknowledged: true })
  expect(r.reports).toHaveLength(1)
})

test('a chosen display is covered, and a new one in the settings moves the overlay', () => {
  const r = rig({ settings: { overlay_display: '22' } })
  r.overlay.showClosed()
  expect(r.win().options).toMatchObject({ x: 3440, y: 0, width: 2560, height: 1440 })
  r.overlay.applySettings({ ...SETTINGS, overlay_display: '' })
  expect(r.win().bounds).toEqual({ x: 0, y: 0, width: 3440, height: 1440 })
})

test('a Qt display name in the settings puts the overlay on the main display', () => {
  const r = rig({ settings: { overlay_display: '\\\\.\\DISPLAY2' } })
  r.overlay.showClosed()
  expect(r.win().options).toMatchObject({ x: 0, y: 0, width: 3440, height: 1440 })
})

test('a new size in the settings zooms the page', () => {
  const r = shown()
  r.overlay.applySettings({ ...SETTINGS, overlay_size: 150 })
  expect(r.win().webContents.zoomSet.at(-1)).toBe(1.5)
})

test('full screen in the settings reaches the next opening', () => {
  const r = shown()
  r.overlay.applySettings({ ...SETTINGS, overlay_full_screen: true })
  r.overlay.open()
  expect(r.win().calls).not.toContain('focus')
})

test('placeOn moves the window over the display', () => {
  const r = shown()
  r.overlay.placeOn({ id: 22, bounds: { x: 3440, y: 0, width: 2560, height: 1440 }, scaleFactor: 1, primary: false })
  expect(r.win().bounds).toEqual({ x: 3440, y: 0, width: 2560, height: 1440 })
})

test('a display that goes moves the overlay to the main one and reports', () => {
  const r = shown({ settings: { overlay_display: '22' } })
  expect(r.win().bounds).toEqual({ x: 3440, y: 0, width: 2560, height: 1440 })
  const placeOn = vi.spyOn(r.overlay, 'placeOn')
  const reports = r.reports.length
  r.screen.displays = r.screen.displays.filter((display) => display.id !== 22)
  r.screen.emit('display-removed')
  expect(placeOn).toHaveBeenCalledOnce()
  expect(placeOn.mock.calls[0][0]).toMatchObject({ id: 11, primary: true })
  expect(r.win().bounds).toEqual({ x: 0, y: 0, width: 3440, height: 1440 })
  expect(r.reports).toHaveLength(reports + 1)
  expect(r.reports.at(-1)!.displays).toEqual([{ name: '11', label: 'Display 1, 3440 × 1440, main', primary: true }])
})

test('a display that comes back is covered again', () => {
  const r = shown({ settings: { overlay_display: '22' } })
  const gone = r.screen.displays.filter((display) => display.id !== 22)
  const both = r.screen.displays
  r.screen.displays = gone
  r.screen.emit('display-removed')
  r.screen.displays = both
  r.screen.emit('display-added')
  expect(r.win().bounds).toEqual({ x: 3440, y: 0, width: 2560, height: 1440 })
})

test('a change of resolution or of the main display places it again and reports', () => {
  const r = shown()
  const reports = r.reports.length
  r.screen.displays = [{ id: 11, bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1 }, r.screen.displays[1]]
  r.screen.emit('display-metrics-changed')
  expect(r.win().bounds).toEqual({ x: 0, y: 0, width: 2560, height: 1440 })
  expect(r.reports).toHaveLength(reports + 1)
  r.screen.mainId = 22
  r.screen.emit('display-metrics-changed')
  expect(r.win().bounds).toEqual({ x: 3440, y: 0, width: 2560, height: 1440 })
  expect(r.reports.at(-1)!.displays.find((entry) => entry.primary)!.name).toBe('22')
})

test('changes that arrive together are followed once', () => {
  const windows: FakeWindow[] = []
  const screen = new FakeScreen()
  const reports: unknown[] = []
  const overlay = new Overlay(
    {
      createWindow: (opts) => {
        const win = new FakeWindow(opts)
        windows.push(win)
        return win
      },
      screen,
      hotkey: new Hotkey(() => true, () => {}),
      report: (displays, state) => reports.push({ displays, state }),
      anyWindowFocused: () => false,
      openExternal: () => {},
      icon: ICON,
    },
    LINK,
  )
  overlay.applySettings(SETTINGS)
  overlay.start()
  expect(reports).toHaveLength(1)
  screen.emit('display-added')
  screen.emit('display-metrics-changed')
  screen.emit('display-removed')
  expect(reports).toHaveLength(1) // pending
  vi.advanceTimersByTime(0)
  expect(reports).toHaveLength(2)
})

test('stop lets go of everything: the window goes, the hotkey is released, the displays are no longer watched', () => {
  const r = shown()
  r.overlay.open()
  r.overlay.stop()
  expect(r.win().destroyed).toBe(true)
  expect(r.shortcuts.size).toBe(0)
  expect(r.screen.count()).toBe(0)
  const reports = r.reports.length
  r.screen.emit('display-removed')
  expect(r.reports).toHaveLength(reports)
  const event = { preventDefault: vi.fn() }
  r.win().emit('close', event) // a window being destroyed is no longer held back
  expect(event.preventDefault).not.toHaveBeenCalled()
})

test('after stop the game and the hotkey show nothing', () => {
  const r = rig()
  r.overlay.stop()
  r.overlay.setGameRunning(true)
  r.overlay.toggle()
  expect(r.windows).toHaveLength(0)
})

test('the page stays on the core’s origin', () => {
  const r = shown()
  const away = { preventDefault: vi.fn(), url: 'https://example.com/' }
  r.win().webContents.emit('will-navigate', away, away.url)
  expect(away.preventDefault).toHaveBeenCalledOnce()
  const same = { preventDefault: vi.fn(), url: `${ORIGIN}/#/overlay` }
  r.win().webContents.emit('will-navigate', same, same.url)
  expect(same.preventDefault).not.toHaveBeenCalled()
})

test('a window destroyed from outside is made again at the next show', () => {
  const r = shown()
  r.win().destroyed = true
  r.win().emit('closed')
  r.overlay.showClosed()
  expect(r.windows).toHaveLength(2)
  expect(r.windows[1].webContents.loaded).toEqual([`${LINK}&to=overlay`])
})

test('a failed launch (did-fail-load, then did-finish-load on the error page) neither shows the window nor stops the next load', () => {
  const r = rig()
  r.overlay.showClosed()
  r.win().webContents.failLoad()
  expect(r.win().visible).toBe(false)
  expect(r.win().calls).not.toContain('showInactive')
  expect(r.win().webContents.hashes).toEqual([]) // the error page is not told an address
  r.overlay.open() // the hotkey: the launch is tried again, and nothing invisible takes the display's clicks
  expect(r.win().webContents.loaded).toEqual([`${LINK}&to=overlay`, `${LINK}&to=overlay`])
  expect(r.win().visible).toBe(false)
  r.win().webContents.failLoad()
  expect(r.overlay.isOpen).toBe(false)
  expect(r.win().visible).toBe(false)
  expect(r.win().ignore).toBe(true)
  r.overlay.showClosed()
  expect(r.win().webContents.loaded).toHaveLength(3)
  r.win().webContents.finishLoad()
  expect(r.win().visible).toBe(true)
  expect(r.win().webContents.hashes).toEqual([CLOSED])
})

test('setFocusable is called only when focusability changes', () => {
  const r = shown()
  const focusable = () => r.win().calls.filter((call) => call.startsWith('focusable'))
  expect(focusable()).toEqual([]) // made non-focusable, and never told so again
  r.overlay.showClosed()
  r.overlay.showClosed()
  expect(focusable()).toEqual([])
  r.overlay.open()
  expect(focusable()).toEqual(['focusable true'])
  r.overlay.close()
  expect(focusable()).toEqual(['focusable true', 'focusable false'])
})

test('in full-screen mode nothing ever changes the window’s focusability', () => {
  const r = shown({ settings: { overlay_full_screen: true } })
  r.overlay.open()
  r.overlay.close()
  r.overlay.open()
  r.overlay.hide()
  expect(r.win().calls.filter((call) => call.startsWith('focusable'))).toEqual([])
  expect(r.win().calls).not.toContain('focus')
})

test('the close order after a focused open: click-through, hide, not focusable, then shown inactive', () => {
  const r = opened()
  const mark = r.win().calls.length
  r.overlay.close()
  expect(r.win().since(mark)).toEqual(['ignore true', 'hide', 'focusable false', 'showInactive'])
})

test('the window has no menu, so its accelerators (reload, DevTools) do not exist', () => {
  const r = rig()
  r.overlay.showClosed()
  expect(r.win().menu).toBeNull()
})

test('a new window opens outside only for the listed addresses, and is always refused', () => {
  const r = rig()
  r.overlay.showClosed()
  const handler = r.win().webContents.openHandler
  expect(handler).not.toBeNull()
  expect(handler!({ url: 'https://act.hoyolab.com/ys/event/signin-sea-v3/index.html' })).toEqual({ action: 'deny' })
  expect(r.external).toEqual(['https://act.hoyolab.com/ys/event/signin-sea-v3/index.html'])
  expect(handler!({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
  expect(handler!({ url: 'file:///C:/Windows/system32/calc.exe' })).toEqual({ action: 'deny' })
  expect(r.external).toHaveLength(1)
})

test('the focus check waits a tick, and a window of ours that has the focus by then keeps the overlay open', () => {
  const r = opened({ realDefer: true })
  r.focused.value = false
  r.win().emit('blur')
  expect(r.overlay.isOpen).toBe(true) // not decided yet
  r.focused.value = true // the focus passed to another window of Guild Board's
  vi.advanceTimersByTime(0)
  expect(r.overlay.isOpen).toBe(true)
})

test('the focus check closes the overlay when the tick finds no window of ours with the focus', () => {
  const r = opened({ realDefer: true })
  r.focused.value = false
  r.win().emit('blur')
  expect(r.overlay.isOpen).toBe(true)
  vi.advanceTimersByTime(0)
  expect(r.overlay.isOpen).toBe(false)
})

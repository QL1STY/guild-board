import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  Dashboard,
  type DashboardDeps,
  placeUrl,
  RELEASE_AFTER_MS,
  REFERENCE_WIDTH,
  type WebContentsLike,
  type WindowLike,
  type WindowOptions,
  zoomFor,
} from '../src/dashboard.js'
import { readPlacement, type Bounds } from '../src/placement.js'

const LINK = 'http://127.0.0.1:51234/?t=made-up-launch-token'
const ORIGIN = 'http://127.0.0.1:51234'
const ICON = 'Z:\\repo\\shell\\assets\\icon.ico'
const WORK: Bounds[] = [
  { x: 0, y: 0, width: 3440, height: 1400 },
  { x: 3440, y: 0, width: 2560, height: 1400 },
]

test('the page zooms with the window’s width, from 1,640 up to twice', () => {
  expect(REFERENCE_WIDTH).toBe(1640)
  expect(RELEASE_AFTER_MS).toBe(2000)
  expect(zoomFor(1640)).toBe(1)
  expect(zoomFor(2460)).toBe(1.5)
  expect(zoomFor(4000)).toBe(2)
  expect(zoomFor(1200)).toBe(1)
})

test('placeUrl: the launch link, with the place; on a shown window, the origin and a fragment', () => {
  expect(placeUrl(LINK, null, false)).toBe(LINK)
  expect(placeUrl(LINK, 'board', false)).toBe(`${LINK}&to=board`)
  expect(placeUrl(LINK, 'achievements/timers', false)).toBe(`${LINK}&to=achievements/timers`)
  expect(placeUrl(LINK, 'board', true)).toBe(`${ORIGIN}/#/board`)
  expect(placeUrl(LINK, 'achievements/timers', true)).toBe(`${ORIGIN}/#/achievements/timers`)
  expect(placeUrl(LINK, null, true)).toBe(LINK)
})

type Listener = (...args: any[]) => void

class FakeContents implements WebContentsLike {
  listeners = new Map<string, Listener[]>()
  loaded: string[] = []
  zoomSet: number[] = []
  zoomNow = 1
  url = ''
  openHandler: ((details: { url: string }) => { action: 'deny' }) | null = null
  loadURL(url: string): Promise<void> {
    this.loaded.push(url)
    this.url = url
    return Promise.resolve()
  }
  getURL(): string {
    return this.url
  }
  setZoomFactor(factor: number): void {
    this.zoomSet.push(factor)
    this.zoomNow = factor
  }
  getZoomFactor(): number {
    return this.zoomNow
  }
  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void {
    this.openHandler = handler
  }
  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

class FakeWindow implements WindowLike {
  webContents = new FakeContents()
  listeners = new Map<string, Listener[]>()
  calls: string[] = []
  width = 1440
  maximized = false
  minimized = false
  visible = false
  destroyed = false
  menu: unknown = 'unset'
  normal: Bounds
  constructor(public options: WindowOptions) {
    this.normal = { x: options.x, y: options.y, width: options.width, height: options.height }
    this.width = options.width
  }
  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
  setMenu(menu: null): void {
    this.menu = menu
  }
  getContentSize(): [number, number] {
    return [this.width, 900]
  }
  getNormalBounds(): Bounds {
    return this.normal
  }
  isMaximized(): boolean {
    return this.maximized
  }
  isMinimized(): boolean {
    return this.minimized
  }
  isVisible(): boolean {
    return this.visible
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  maximize(): void {
    this.calls.push('maximize')
    this.maximized = true
  }
  restore(): void {
    this.calls.push('restore')
    this.minimized = false
  }
  show(): void {
    this.calls.push('show')
    this.visible = true
  }
  hide(): void {
    this.calls.push('hide')
    this.visible = false
  }
  focus(): void {
    this.calls.push('focus')
  }
  destroy(): void {
    this.calls.push('destroy')
    this.destroyed = true
  }
}

let folder = ''
let windows: FakeWindow[] = []
let external: string[] = []
let ended = 0

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'gb-dashboard-'))
  windows = []
  external = []
  ended = 0
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(folder, { recursive: true, force: true })
})

function make(overrides: Partial<DashboardDeps> = {}): Dashboard {
  return new Dashboard({
    link: LINK,
    demo: false,
    icon: ICON,
    placementFile: join(folder, 'window.json'),
    displays: () => ({ workAreas: WORK, primary: 0 }),
    createWindow: (options) => {
      const win = new FakeWindow(options)
      windows.push(win)
      return win
    },
    openExternal: (url) => external.push(url),
    onEnded: () => {
      ended += 1
    },
    ...overrides,
  })
}

test('open on a closed dashboard makes the window and loads the link with the place', () => {
  const dashboard = make()
  expect(dashboard.isOpen()).toBe(false)
  expect(dashboard.webContents()).toBeNull()
  dashboard.open('board')
  expect(windows).toHaveLength(1)
  expect(windows[0].webContents.loaded).toEqual([`${LINK}&to=board`])
  expect(dashboard.isOpen()).toBe(true)
  expect(dashboard.webContents()).toBe(windows[0].webContents)
})

test('open with no place loads the plain link', () => {
  make().open()
  expect(windows[0].webContents.loaded).toEqual([LINK])
})

test('open on a shown window goes to the place without a second window', () => {
  const dashboard = make()
  dashboard.open('board')
  dashboard.open('achievements/timers')
  expect(windows).toHaveLength(1)
  expect(windows[0].webContents.loaded).toEqual([`${LINK}&to=board`, `${ORIGIN}/#/achievements/timers`])
  dashboard.open()
  expect(windows[0].webContents.loaded).toHaveLength(2)
})

test('the window: title, background, session, settings and no menu', () => {
  make().open()
  const { options, menu } = windows[0]
  expect(options.title).toBe('Guild Board')
  expect(options.backgroundColor).toBe('#E6DDCA')
  expect(options.show).toBe(false)
  expect(options.webPreferences).toEqual({
    partition: 'gb-core',
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
  })
  expect(menu).toBeNull()
})

test('the demo’s window says so', () => {
  make({ demo: true }).open()
  expect(windows[0].options.title).toBe('Guild Board - demo data')
})

test('the window has the app’s icon, on the taskbar and in its title bar, and so has one made again', () => {
  const dashboard = make()
  dashboard.open()
  expect(windows[0].options.icon).toBe(ICON)
  dashboard.close()
  vi.advanceTimersByTime(RELEASE_AFTER_MS)
  dashboard.open()
  expect(windows).toHaveLength(2)
  expect(windows[1].options.icon).toBe(ICON)
})

test('the page cannot change the title', () => {
  make().open()
  const event = { preventDefault: vi.fn() }
  windows[0].emit('page-title-updated', event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
})

test('the first time it opens maximized on the second display, then where it was left', () => {
  const first = make()
  first.open()
  expect(windows[0].options).toMatchObject({ x: 3440, y: 0, width: 2560, height: 1400 })
  expect(windows[0].calls).toContain('maximize')
  expect(windows[0].calls).toContain('show')
  windows[0].normal = { x: 3500, y: 60, width: 1640, height: 1100 }
  windows[0].maximized = false
  first.close()
  expect(readPlacement(join(folder, 'window.json'))).toEqual({ x: 3500, y: 60, width: 1640, height: 1100, maximized: false })
  vi.advanceTimersByTime(RELEASE_AFTER_MS)
  first.open()
  expect(windows[1].options).toMatchObject({ x: 3500, y: 60, width: 1640, height: 1100 })
  expect(windows[1].calls).not.toContain('maximize')
})

test('open brings a minimized window back and focuses it', () => {
  const dashboard = make()
  dashboard.open()
  windows[0].minimized = true
  dashboard.open()
  expect(windows[0].calls).toContain('restore')
  expect(windows[0].calls.at(-1)).toBe('focus')
})

test('zoom follows the width on every resize, and after every load', () => {
  const dashboard = make()
  dashboard.open()
  const win = windows[0]
  expect(win.webContents.zoomNow).toBeCloseTo(2560 / 1640, 10) // the first-run window is 2,560 wide
  win.width = 2460
  win.emit('resize')
  expect(win.webContents.zoomNow).toBe(1.5)
  expect(dashboard.zoom()).toBe(1.5)
  win.webContents.zoomNow = 1 // a page loaded again may have dropped it
  win.webContents.emit('did-finish-load')
  expect(win.webContents.zoomNow).toBe(1.5)
  const sets = win.webContents.zoomSet.length
  win.emit('resize') // already at that zoom: nothing is set again
  expect(win.webContents.zoomSet).toHaveLength(sets)
})

test('onResized is called after the zoom is applied', () => {
  const dashboard = make()
  const seen: number[] = []
  dashboard.onResized(() => seen.push(windows[0].webContents.zoomNow))
  dashboard.open()
  windows[0].width = 3280
  windows[0].emit('resize')
  expect(seen).toEqual([2])
})

test('onFragment reports the fragment after a navigation and an in-page navigation', () => {
  const dashboard = make()
  const seen: string[] = []
  dashboard.onFragment((fragment) => seen.push(fragment))
  dashboard.open()
  windows[0].webContents.emit('did-navigate', {}, `${ORIGIN}/#/map`)
  windows[0].webContents.emit('did-navigate-in-page', {}, `${ORIGIN}/#/board`)
  windows[0].webContents.emit('did-navigate-in-page', {}, `${ORIGIN}/`)
  expect(seen).toEqual(['#/map', '#/board', ''])
})

test('a navigation away from the core’s origin is prevented', () => {
  make().open()
  const contents = windows[0].webContents
  const away = { preventDefault: vi.fn(), url: 'https://example.com/' }
  contents.emit('will-navigate', away, away.url)
  expect(away.preventDefault).toHaveBeenCalledOnce()
  const same = { preventDefault: vi.fn(), url: `${ORIGIN}/#/board` }
  contents.emit('will-navigate', same, same.url)
  expect(same.preventDefault).not.toHaveBeenCalled()
  const redirect = { preventDefault: vi.fn(), url: 'https://example.com/x' }
  contents.emit('will-redirect', redirect)
  expect(redirect.preventDefault).toHaveBeenCalledOnce()
  const lookAlike = { preventDefault: vi.fn(), url: 'http://127.0.0.1:51234.evil.example/' }
  contents.emit('will-navigate', lookAlike, lookAlike.url)
  expect(lookAlike.preventDefault).toHaveBeenCalledOnce()
})

test('a new window opens outside only for the listed addresses, and is always refused', () => {
  make().open()
  const handler = windows[0].webContents.openHandler
  expect(handler).not.toBeNull()
  expect(handler!({ url: 'https://enka.network/u/1' })).toEqual({ action: 'deny' })
  expect(external).toEqual(['https://enka.network/u/1'])
  expect(handler!({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
  expect(handler!({ url: 'file:///C:/Windows/system32/calc.exe' })).toEqual({ action: 'deny' })
  expect(external).toEqual(['https://enka.network/u/1'])
})

test('close hides at once, saves the place, and destroys after 2,000 ms', () => {
  const dashboard = make()
  dashboard.open()
  const win = windows[0]
  win.visible = true
  dashboard.close()
  expect(win.calls.at(-1)).toBe('hide')
  expect(win.destroyed).toBe(false)
  expect(dashboard.isOpen()).toBe(false)
  expect(dashboard.webContents()).toBeNull()
  expect(readPlacement(join(folder, 'window.json'))).not.toBeNull()
  vi.advanceTimersByTime(RELEASE_AFTER_MS - 1)
  expect(win.destroyed).toBe(false)
  vi.advanceTimersByTime(1)
  expect(win.destroyed).toBe(true)
  expect(ended).toBe(0)
})

test('the window’s own close (the X, Alt+F4) is turned into close', () => {
  const dashboard = make()
  dashboard.open()
  const win = windows[0]
  const event = { preventDefault: vi.fn() }
  win.emit('close', event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(win.calls).toContain('hide')
  expect(dashboard.isOpen()).toBe(false)
})

test('opening again before the old window is released makes a new one, and the old is still released', () => {
  const dashboard = make()
  dashboard.open()
  dashboard.close()
  dashboard.open('board')
  expect(windows).toHaveLength(2)
  expect(windows[1].webContents.loaded).toEqual([`${LINK}&to=board`])
  vi.advanceTimersByTime(RELEASE_AFTER_MS)
  expect(windows[0].destroyed).toBe(true)
  expect(windows[1].destroyed).toBe(false)
  expect(dashboard.isOpen()).toBe(true)
})

test('closing a window that was never shown saves no place', () => {
  const dashboard = make()
  dashboard.open()
  windows[0].visible = false
  dashboard.close()
  expect(readPlacement(join(folder, 'window.json'))).toBeNull()
})

test('in the demo, closing ends the app and the window is not turned into a hide', () => {
  const dashboard = make({ demo: true })
  dashboard.open()
  const win = windows[0]
  win.visible = true
  const event = { preventDefault: vi.fn() }
  win.emit('close', event)
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(ended).toBe(1)
  dashboard.close()
  expect(ended).toBe(1)
  expect(win.calls).not.toContain('hide')
  expect(readPlacement(join(folder, 'window.json'))).not.toBeNull()
})

test('with no tray (canHide false) a close ends the app as the demo’s does, and the title is not the demo’s', () => {
  const dashboard = make({ canHide: false })
  dashboard.open()
  const win = windows[0]
  win.visible = true
  expect(win.options.title).toBe('Guild Board')
  const event = { preventDefault: vi.fn() }
  win.emit('close', event)
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(ended).toBe(1)
  expect(win.calls).not.toContain('hide')
  expect(readPlacement(join(folder, 'window.json'))).not.toBeNull()
})

test('with a tray (canHide true) a close hides, and the app goes on', () => {
  const dashboard = make({ canHide: true })
  dashboard.open()
  const event = { preventDefault: vi.fn() }
  windows[0].emit('close', event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(ended).toBe(0)
})

test('Windows ending the session saves the place at once and ends the app', () => {
  const dashboard = make()
  dashboard.open()
  const win = windows[0]
  win.visible = true
  expect(readPlacement(join(folder, 'window.json'))).toBeNull()
  win.emit('session-end')
  expect(readPlacement(join(folder, 'window.json'))).not.toBeNull()
  expect(ended).toBe(1)
  win.emit('session-end')
  expect(ended).toBe(1)
})

test('destroy lets the app quit: the window goes at once and a later close is not held back', () => {
  const dashboard = make()
  dashboard.open()
  const win = windows[0]
  dashboard.destroy()
  expect(win.destroyed).toBe(true)
  expect(dashboard.isOpen()).toBe(false)
  const event = { preventDefault: vi.fn() }
  win.emit('close', event)
  expect(event.preventDefault).not.toHaveBeenCalled()
})

test('a window that is already gone is not touched again', () => {
  const dashboard = make()
  dashboard.open()
  dashboard.close()
  windows[0].destroyed = true
  expect(() => vi.advanceTimersByTime(RELEASE_AFTER_MS)).not.toThrow()
  expect(windows[0].calls.filter((call) => call === 'destroy')).toHaveLength(0)
})

test('a placement file that cannot be written does not stop the close', () => {
  const dashboard = make({ placementFile: join(folder, 'no-such-folder', 'window.json') })
  dashboard.open()
  windows[0].visible = true
  expect(() => dashboard.close()).not.toThrow()
  expect(windows[0].calls.at(-1)).toBe('hide')
})

test('destroy saves the place of the open window first, so a quit from the tray keeps it', () => {
  const dashboard = make()
  dashboard.open()
  const win = windows[0]
  win.normal = { x: 3600, y: 80, width: 1700, height: 1000 }
  win.maximized = false
  dashboard.destroy()
  expect(readPlacement(join(folder, 'window.json'))).toEqual({ x: 3600, y: 80, width: 1700, height: 1000, maximized: false })
  expect(win.destroyed).toBe(true)
})

test('destroy with no open window saves nothing, and with a hidden one keeps the place close saved', () => {
  const dashboard = make()
  dashboard.destroy()
  expect(readPlacement(join(folder, 'window.json'))).toBeNull()
  const second = make()
  second.open()
  windows[0].normal = { x: 3500, y: 60, width: 1640, height: 1100 }
  second.close()
  windows[0].normal = { x: 1, y: 1, width: 500, height: 500 } // a hidden window's bounds are not the player's place
  second.destroy()
  expect(readPlacement(join(folder, 'window.json'))).toMatchObject({ x: 3500, y: 60 })
})

test('a closing window no longer feeds onFragment or onResized', () => {
  const dashboard = make()
  const fragments: string[] = []
  let resizes = 0
  dashboard.onFragment((fragment) => fragments.push(fragment))
  dashboard.onResized(() => {
    resizes += 1
  })
  dashboard.open()
  const old = windows[0]
  old.emit('resize')
  old.webContents.emit('did-navigate', {}, `${ORIGIN}/#/map`)
  expect(resizes).toBe(1)
  expect(fragments).toEqual(['#/map'])
  dashboard.close()
  old.emit('resize')
  old.webContents.emit('did-navigate-in-page', {}, `${ORIGIN}/#/board`)
  expect(resizes).toBe(1)
  expect(fragments).toEqual(['#/map'])
  dashboard.open() // the next window feeds them
  windows[1].emit('resize')
  windows[1].webContents.emit('did-navigate', {}, `${ORIGIN}/#/stats`)
  expect(resizes).toBe(2)
  expect(fragments).toEqual(['#/map', '#/stats'])
})

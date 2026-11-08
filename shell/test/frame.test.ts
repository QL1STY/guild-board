import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { CANCEL_CHANNEL, type IpcLike, pageUrl, SUBMIT_CHANNEL } from '../src/dialog.js'
import {
  BAR_HEIGHT,
  type FrameContentsLike,
  type FrameDeps,
  type FrameViewLike,
  type FrameViewOptions,
  type FrameWindowLike,
  type FrameWindowOptions,
  FramedWindow,
} from '../src/frame.js'

const PAGES = resolve('app', 'dist', 'pages')
const ICON = 'Z:\\repo\\shell\\assets\\icon.ico'

type Listener = (...args: any[]) => void

class FakeContents implements FrameContentsLike {
  listeners = new Map<string, Listener[]>()
  loaded: string[] = []
  closed = false
  focused = 0
  focus(): void {
    this.focused += 1
  }
  opener: (() => { action: string }) | null = null
  loadURL(url: string): Promise<void> {
    this.loaded.push(url)
    return Promise.resolve()
  }
  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }
  setWindowOpenHandler(handler: () => { action: string }): void {
    this.opener = handler
  }
  close(): void {
    this.closed = true
  }
  isDestroyed(): boolean {
    return this.closed
  }
}

class FakeView implements FrameViewLike {
  webContents = new FakeContents()
  bounds: unknown = null
  constructor(readonly options: FrameViewOptions) {}
  setBounds(bounds: unknown): void {
    this.bounds = bounds
  }
}

class FakeWindow implements FrameWindowLike {
  children: FakeView[] = []
  contentView = { addChildView: (view: FrameViewLike) => { this.children.push(view as FakeView) } }
  listeners = new Map<string, Listener[]>()
  size: [number, number] = [1100, 820]
  shown = 0
  closed = false
  minimized = false
  constructor(readonly options: FrameWindowOptions) {}
  getContentSize(): [number, number] { return this.size }
  on(event: string, listener: Listener): void { this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]) }
  emit(event: string): void { for (const l of this.listeners.get(event) ?? []) l() }
  setMenu(): void {}
  show(): void { this.shown += 1 }
  focus(): void {}
  isMinimized(): boolean { return this.minimized }
  restore(): void { this.minimized = false }
  close(): void { if (!this.closed) { this.closed = true; this.emit('closed') } }
  isDestroyed(): boolean { return this.closed }
}

class FakeIpc implements IpcLike {
  listeners = new Map<string, Listener[]>()
  on(channel: string, listener: Listener): void { this.listeners.set(channel, [...(this.listeners.get(channel) ?? []), listener]) }
  removeListener(channel: string, listener: Listener): void {
    this.listeners.set(channel, (this.listeners.get(channel) ?? []).filter((l) => l !== listener))
  }
  send(channel: string, sender: unknown, ...args: unknown[]): void { for (const l of this.listeners.get(channel) ?? []) l({ sender }, ...args) }
  count(): number { return [...this.listeners.values()].reduce((n, l) => n + l.length, 0) }
}

function setup() {
  const ipc = new FakeIpc()
  const windows: FakeWindow[] = []
  const views: FakeView[] = []
  const deps: FrameDeps = {
    pagesFolder: PAGES,
    preload: 'C:\\app\\dist\\pages\\dialog-preload.js',
    icon: ICON,
    ipc,
    createWindow: (options) => { const w = new FakeWindow(options); windows.push(w); return w },
    createView: (options) => { const v = new FakeView(options); views.push(v); return v },
  }
  return { ipc, windows, views, deps }
}

test('the window holds the page above a bar, each in its own partition', () => {
  const { windows, views, deps } = setup()
  const framed = new FramedWindow(deps, { title: 'Log in to HoYoLAB', partition: 'gb-login', bar: { service: 'Use paste.' } })
  expect(windows[0].options).toMatchObject({ title: 'Log in to HoYoLAB', width: 1100, height: 820, show: false, icon: ICON })
  const [page, bar] = views
  expect(windows[0].children).toEqual([page, bar])
  expect(page.options.webPreferences).toEqual({
    partition: 'gb-login', contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false,
  })
  expect(bar.options.webPreferences).toMatchObject({ partition: 'gb-dialog', preload: 'C:\\app\\dist\\pages\\dialog-preload.js', sandbox: true })
  expect(page.bounds).toEqual({ x: 0, y: 0, width: 1100, height: 820 - BAR_HEIGHT })
  expect(bar.bounds).toEqual({ x: 0, y: 820 - BAR_HEIGHT, width: 1100, height: BAR_HEIGHT })
  windows[0].size = [900, 600]
  windows[0].emit('resize')
  expect(page.bounds).toEqual({ x: 0, y: 0, width: 900, height: 600 - BAR_HEIGHT })
  expect(bar.bounds).toEqual({ x: 0, y: 600 - BAR_HEIGHT, width: 900, height: BAR_HEIGHT })
  expect(bar.webContents.loaded).toEqual([pageUrl(PAGES, 'bar', { service: 'Use paste.' })])
  expect(framed.contents).toBe(page.webContents)
})

test('the verification’s window has the app’s icon too', () => {
  const { windows, deps } = setup()
  new FramedWindow(deps, { title: 'Verify on HoYoLAB', partition: 'gb-verify', bar: { note: 'N' } })
  expect(windows[0].options.icon).toBe(ICON)
})

test('a message reloads the bar with the text and the Try again choice', () => {
  const { views, deps } = setup()
  const framed = new FramedWindow(deps, { title: 't', partition: 'gb-login', bar: { service: 'S' } })
  framed.showMessage('Checking the login with HoYoLAB.', false)
  framed.showMessage('HoYoLAB could not be reached.', true)
  expect(views[1].webContents.loaded.slice(1)).toEqual([
    pageUrl(PAGES, 'bar', { service: 'S', message: 'Checking the login with HoYoLAB.' }),
    pageUrl(PAGES, 'bar', { service: 'S', message: 'HoYoLAB could not be reached.', retry: '1' }),
  ])
})

test('the bar’s presses are actions, from its own page alone', () => {
  const { ipc, views, deps } = setup()
  const framed = new FramedWindow(deps, { title: 't', partition: 'gb-login', bar: { service: 'S' } })
  const actions: string[] = []
  framed.onAction((action) => actions.push(action))
  ipc.send(SUBMIT_CHANNEL, views[0].webContents, 'paste') // the HoYoLAB page is not the bar
  ipc.send(SUBMIT_CHANNEL, views[1].webContents, 'paste')
  ipc.send(SUBMIT_CHANNEL, views[1].webContents, 'retry')
  ipc.send(SUBMIT_CHANNEL, views[1].webContents, 'format c:')
  ipc.send(SUBMIT_CHANNEL, views[1].webContents, 3)
  ipc.send(CANCEL_CHANNEL, views[1].webContents)
  expect(actions).toEqual(['paste', 'retry'])
})

test('the bar never leaves its page, and opens no window', () => {
  const { views, deps } = setup()
  new FramedWindow(deps, { title: 't', partition: 'gb-verify', bar: { note: 'N' } })
  const bar = views[1].webContents
  expect(bar.opener!()).toEqual({ action: 'deny' })
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    let prevented = false
    bar.listeners.get(name)![0]({ preventDefault: () => { prevented = true } })
    expect(prevented, name).toBe(true)
  }
})

test('closing tells once, releases the views and stops listening', () => {
  const { ipc, windows, views, deps } = setup()
  const framed = new FramedWindow(deps, { title: 't', partition: 'gb-login', bar: {} })
  let closed = 0
  framed.onClosed(() => { closed += 1 })
  framed.open()
  expect(windows[0].shown).toBe(1)
  framed.close()
  framed.close()
  expect(closed).toBe(1)
  expect(views.every((v) => v.webContents.closed)).toBe(true)
  expect(ipc.count()).toBe(0)
  framed.showMessage('late', false) // after the close: nothing happens
  expect(views[1].webContents.loaded).toHaveLength(1)
})

test('open brings a minimized window back', () => {
  const { windows, deps } = setup()
  const framed = new FramedWindow(deps, { title: 't', partition: 'gb-login', bar: {} })
  windows[0].minimized = true
  framed.open()
  expect(windows[0].minimized).toBe(false)
})

test('open puts the keyboard in HoYoLAB’s page, not in the bar', () => {
  const { windows, views, deps } = setup()
  const framed = new FramedWindow(deps, { title: 't', partition: 'gb-login', bar: {} })
  framed.open()
  expect(views[0].webContents.focused).toBe(1)
  expect(views[1].webContents.focused).toBe(0)
  expect(windows[0].shown).toBe(1)
})

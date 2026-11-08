import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  type ContentViewLike,
  DISCARD_AFTER_MS,
  MapHost,
  type MapContentsLike,
  type MapDeps,
  type MapViewLike,
  type MapViewOptions,
  SEEN_EVERY_MS,
  viewBounds,
} from '../src/map.js'
import type { MapSnapshot } from '../src/protocol.js'

const HERE = dirname(fileURLToPath(import.meta.url))

type Listener = (...args: any[]) => void

class FakeContents implements MapContentsLike {
  listeners = new Map<string, Listener[]>()
  loaded: string[] = []
  reloads = 0
  closed = false
  backs = 0
  openHandler: ((details: { url: string }) => { action: 'deny' }) | null = null
  navigationHistory = { canGoBack: () => true, goBack: () => { this.backs += 1 } }
  loadURL(url: string): Promise<void> {
    this.loaded.push(url)
    return Promise.resolve()
  }
  reload(): void {
    this.reloads += 1
  }
  close(): void {
    this.closed = true
  }
  isDestroyed(): boolean {
    return this.closed
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

class FakeView implements MapViewLike {
  webContents = new FakeContents()
  bounds: { x: number; y: number; width: number; height: number } | null = null
  visible = true
  constructor(readonly options: MapViewOptions) {}
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = bounds
  }
  setVisible(visible: boolean): void {
    this.visible = visible
  }
}

class FakeHolder implements ContentViewLike {
  children: FakeView[] = []
  addChildView(view: MapViewLike): void {
    this.children.push(view as FakeView)
  }
  removeChildView(view: MapViewLike): void {
    this.children = this.children.filter((child) => child !== view)
  }
}

const COOKIES = { ltoken_v2: 'made-up-ltoken', ltuid_v2: '1234', cookie_token_v2: 'made-up-cookie-token', lang: 'en' }
const ROLE = { uid: '700000001', region: 'os_euro' }

function snapshot(partial: Partial<MapSnapshot> = {}): MapSnapshot {
  return {
    tabs: [
      { id: 1, url: 'https://act.hoyolab.com/ys/app/interactive-map/index.html', reload: 0 },
      { id: 2, url: 'https://act.hoyolab.com/ys/app/interactive-map/index.html#/two', reload: 0 },
    ],
    active: 1,
    viewport: { x: 10, y: 20, w: 100, h: 50, hidden: false },
    session: 1,
    ...partial,
  }
}

interface Rig {
  host: MapHost
  holder: FakeHolder
  views: FakeView[]
  calls: { name: string; args: any }[]
  cookiesSet: any[]
  cleared: number
  release: () => void
  state: { holder: FakeHolder | null; zoom: number; cookies: Record<string, string> | null; role: typeof ROLE | null; fetchSession: (() => Promise<Record<string, string> | null>) | null; failCreate: boolean }
}

function rig(onSet?: (details: any) => Promise<void>): Rig {
  const holder = new FakeHolder()
  const views: FakeView[] = []
  const calls: { name: string; args: any }[] = []
  const cookiesSet: any[] = []
  const state = { holder: holder as FakeHolder | null, zoom: 1, cookies: COOKIES as Record<string, string> | null, role: ROLE as typeof ROLE | null, fetchSession: null as (() => Promise<Record<string, string> | null>) | null, failCreate: false }
  const out: Rig = { host: null as unknown as MapHost, holder, views, calls, cookiesSet, cleared: 0, release: () => undefined, state }
  const deps: MapDeps = {
    call: async (name, args) => {
      calls.push({ name, args })
      if (name === 'map_session') return state.fetchSession !== null ? state.fetchSession() : state.cookies
      if (name === 'map_role') return state.role
      return null
    },
    session: {
      cookies: { set: async (details) => { cookiesSet.push(details); await onSet?.(details) } },
      clearStorageData: async () => { out.cleared += 1 },
    },
    holder: () => state.holder,
    zoom: () => state.zoom,
    createView: (options) => {
      if (state.failCreate) {
        state.failCreate = false
        throw new Error('made-up failure to make a view')
      }
      const view = new FakeView(options)
      views.push(view)
      return view
    },
    preload: 'C:\\app\\dist\\map-preload.js',
  }
  out.host = new MapHost(deps)
  return out
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

test('viewBounds multiplies by the zoom and rounds', () => {
  expect(viewBounds({ x: 10, y: 20, w: 100.4, h: 50 }, 1.5)).toEqual({ x: 15, y: 30, width: 151, height: 75 })
  expect(DISCARD_AFTER_MS).toBe(60_000)
  expect(SEEN_EVERY_MS).toBe(1_000)
})

test('follow while shown makes a view for the active tab only, placed over the page', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  expect(r.views).toHaveLength(1)
  expect(r.holder.children).toEqual([r.views[0]])
  expect(r.views[0].webContents.loaded).toEqual(['https://act.hoyolab.com/ys/app/interactive-map/index.html'])
  expect(r.views[0].bounds).toEqual({ x: 10, y: 20, width: 100, height: 50 })
  expect(r.views[0].visible).toBe(true)
})

test('a new active tab destroys the old view at once', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  r.host.follow(snapshot({ active: 2 }))
  await flush()
  expect(r.views).toHaveLength(2)
  expect(r.views[0].webContents.closed).toBe(true)
  expect(r.holder.children).toEqual([r.views[1]])
  expect(r.views[1].webContents.loaded).toEqual(['https://act.hoyolab.com/ys/app/interactive-map/index.html#/two'])
})

test('no view is made off the Map page, and the page’s zoom and resizes move the view', async () => {
  const r = rig()
  r.host.fragment('#/board')
  r.host.follow(snapshot())
  await flush()
  expect(r.views).toHaveLength(0)
  r.host.fragment('#/map/sub')
  expect(r.views).toHaveLength(1)
  r.host.resized(1.5)
  expect(r.views[0].bounds).toEqual({ x: 15, y: 30, width: 150, height: 75 })
  r.host.fragment('#/mapping')
  expect(r.views[0].visible).toBe(false) // not the Map page
})

test('the view is hidden while the viewport is null or hidden', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot({ viewport: null }))
  await flush()
  expect(r.views).toHaveLength(1)
  expect(r.views[0].visible).toBe(false)
  r.host.follow(snapshot())
  expect(r.views[0].visible).toBe(true)
  r.host.follow(snapshot({ viewport: { x: 0, y: 0, w: 100, h: 50, hidden: true } }))
  expect(r.views[0].visible).toBe(false)
  r.host.follow(snapshot({ viewport: { x: 0, y: 0, w: 0, h: 50, hidden: false } }))
  expect(r.views[0].visible).toBe(false)
})

test('leaving the Map page destroys the views after 60 s, and coming back first cancels that', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  r.host.fragment('#/board')
  expect(r.views[0].visible).toBe(false)
  await vi.advanceTimersByTimeAsync(DISCARD_AFTER_MS - 1_000)
  r.host.fragment('#/map')
  await vi.advanceTimersByTimeAsync(DISCARD_AFTER_MS * 2)
  expect(r.views[0].webContents.closed).toBe(false)
  expect(r.views[0].visible).toBe(true)
  r.host.fragment('#/board')
  await vi.advanceTimersByTimeAsync(DISCARD_AFTER_MS - 1)
  expect(r.views[0].webContents.closed).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(r.views[0].webContents.closed).toBe(true)
  expect(r.holder.children).toEqual([])
  // coming back makes a fresh view
  r.host.fragment('#/map')
  expect(r.views).toHaveLength(2)
})

test('the session comes from the core: cookies on .hoyolab.com, secure, the token ones HttpOnly', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  expect(r.calls.filter((c) => c.name === 'map_session')).toHaveLength(1)
  const byName = Object.fromEntries(r.cookiesSet.map((c) => [c.name, c]))
  expect(Object.keys(byName).sort()).toEqual(['cookie_token_v2', 'lang', 'ltoken_v2', 'ltuid_v2'])
  for (const cookie of r.cookiesSet) {
    expect(cookie).toMatchObject({ url: 'https://act.hoyolab.com/', domain: '.hoyolab.com', path: '/', secure: true })
  }
  expect(byName.ltoken_v2.httpOnly).toBe(true)
  expect(byName.cookie_token_v2.httpOnly).toBe(true)
  expect(byName.ltuid_v2.httpOnly).toBe(false)
  expect(byName.ltoken_v2.value).toBe('made-up-ltoken')
})

test('no view is made before the session is known, and none starts signed out', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  expect(r.views).toHaveLength(0)
  await flush()
  expect(r.views).toHaveLength(1)
})

test('a changed session sets the cookies again and reloads the views', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  const first = r.cookiesSet.length
  r.host.follow(snapshot()) // the same session: nothing
  await flush()
  expect(r.cookiesSet).toHaveLength(first)
  expect(r.views[0].webContents.reloads).toBe(0)
  r.state.cookies = { ...COOKIES, ltoken_v2: 'made-up-ltoken-2' }
  r.host.follow(snapshot({ session: 2 }))
  await flush()
  expect(r.cleared).toBe(2) // the old cookies go, then the new are set
  expect(r.cookiesSet.length).toBe(first * 2)
  expect(r.cookiesSet.at(-first)!.httpOnly).toBe(true)
  expect(r.views).toHaveLength(1)
  expect(r.views[0].webContents.reloads).toBe(1)
})

test('a logout clears the cookies, and the view begins again without a role', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  const first = r.cookiesSet.length
  r.state.cookies = null
  r.state.role = null // a logout leaves no game account either
  r.host.follow(snapshot({ session: 2 }))
  await flush()
  expect(r.cookiesSet).toHaveLength(first)
  expect(r.views[0].webContents.closed).toBe(true)
  expect(r.views[1].options.webPreferences.additionalArguments).toEqual([])
})

test('a changed game account makes a new view, as the role is given at its start', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  const argument = r.views[0].options.webPreferences.additionalArguments[0]
  expect(argument.startsWith('--gb-map-role=')).toBe(true)
  // the game account alone: the HoYoLAB account number is not in a command line
  expect(JSON.parse(decodeURIComponent(argument.slice('--gb-map-role='.length)))).toEqual({ uid: '700000001', region: 'os_euro' })
  expect(argument).not.toContain('1234')
  r.state.role = { uid: '700000002', region: 'os_usa' }
  r.host.follow(snapshot({ session: 2 }))
  await flush()
  expect(r.views).toHaveLength(2)
  expect(r.views[0].webContents.closed).toBe(true)
  expect(r.views[1].webContents.closed).toBe(false)
})

test('the role is left out when the login has none, or it is not plain', async () => {
  const r = rig()
  r.state.role = null
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  expect(r.views[0].options.webPreferences.additionalArguments).toEqual([])
  const bad = rig()
  bad.state.role = { uid: '70000;1', region: 'os_euro' }
  bad.host.fragment('#/map')
  bad.host.follow(snapshot())
  await flush()
  expect(bad.views[0].options.webPreferences.additionalArguments).toEqual([])
})

test('the views run in gb-map, sandboxed, with the map preload', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  expect(r.views[0].options.webPreferences).toMatchObject({
    partition: 'gb-map',
    preload: 'C:\\app\\dist\\map-preload.js',
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
  })
})

test('a grown reload count reloads its tab', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  r.host.follow(snapshot())
  expect(r.views[0].webContents.reloads).toBe(0)
  r.host.follow(snapshot({ tabs: [{ id: 1, url: 'https://act.hoyolab.com/x', reload: 1 }, { id: 2, url: 'https://act.hoyolab.com/y', reload: 0 }] }))
  expect(r.views[0].webContents.reloads).toBe(1)
  r.host.follow(snapshot({ tabs: [{ id: 1, url: 'https://act.hoyolab.com/x', reload: 1 }, { id: 2, url: 'https://act.hoyolab.com/y', reload: 0 }] }))
  expect(r.views[0].webContents.reloads).toBe(1)
})

test('a tab that is gone loses its view', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  r.host.follow(snapshot({ tabs: [{ id: 2, url: 'https://act.hoyolab.com/y', reload: 0 }], active: 2 }))
  expect(r.views[0].webContents.closed).toBe(true)
  expect(r.views).toHaveLength(2)
})

test('two title changes 200 ms apart make one map_seen call, then one more after a second with the second title', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  const contents = r.views[0].webContents
  const seen = () => r.calls.filter((c) => c.name === 'map_seen')
  contents.emit('page-title-updated', {}, 'First')
  await vi.advanceTimersByTimeAsync(200)
  contents.emit('page-title-updated', {}, 'Second')
  expect(seen()).toHaveLength(1)
  expect(seen()[0].args).toEqual({ tab_id: 1, url: 'https://act.hoyolab.com/ys/app/interactive-map/index.html', title: 'First' })
  await vi.advanceTimersByTimeAsync(SEEN_EVERY_MS - 200 - 1)
  expect(seen()).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(seen()).toHaveLength(2)
  expect(seen()[1].args.title).toBe('Second')
  await vi.advanceTimersByTimeAsync(5_000)
  expect(seen()).toHaveLength(2)
})

test('the latest address wins, and what has not changed is not reported', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  const contents = r.views[0].webContents
  const seen = () => r.calls.filter((c) => c.name === 'map_seen')
  contents.emit('did-navigate', {}, 'https://act.hoyolab.com/ys/app/interactive-map/index.html') // where it started
  expect(seen()).toHaveLength(0)
  contents.emit('did-navigate-in-page', {}, 'https://act.hoyolab.com/a#1', true)
  contents.emit('did-navigate-in-page', {}, 'https://act.hoyolab.com/a#2', true)
  contents.emit('did-navigate-in-page', {}, 'https://act.hoyolab.com/a#3', true)
  contents.emit('did-navigate-in-page', {}, 'https://act.hoyolab.com/frame', false) // a frame is not the map
  expect(seen()).toHaveLength(1)
  expect(seen()[0].args.url).toBe('https://act.hoyolab.com/a#1')
  await vi.advanceTimersByTimeAsync(SEEN_EVERY_MS)
  expect(seen()).toHaveLength(2)
  expect(seen()[1].args.url).toBe('https://act.hoyolab.com/a#3')
})

test('a main-frame load failure calls map_failed(tab, true), and the error page’s finish does not undo it', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  const contents = r.views[0].webContents
  const failed = () => r.calls.filter((c) => c.name === 'map_failed').map((c) => c.args)
  contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://act.hoyolab.com/', false) // a frame: not told
  contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://act.hoyolab.com/', true) // replaced by another load: not told
  expect(failed()).toEqual([])
  // Electron's order for a load that fails: the start, the failure, then a finish for Chromium's error page
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://act.hoyolab.com/', true)
  contents.emit('did-finish-load')
  expect(failed()).toEqual([{ tab_id: 1, failed: true }])
  // a navigation that works: the start, the commit, the finish
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  contents.emit('did-navigate', {}, 'https://act.hoyolab.com/ys/app/interactive-map/index.html')
  contents.emit('did-finish-load')
  expect(failed()).toEqual([{ tab_id: 1, failed: true }, { tab_id: 1, failed: false }])
})

test('a frame’s or an in-page navigation does not clear a failure; a new document does', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  const contents = r.views[0].webContents
  const failed = () => r.calls.filter((c) => c.name === 'map_failed').map((c) => c.args)
  contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://act.hoyolab.com/', true)
  contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  contents.emit('did-finish-load')
  expect(failed()).toEqual([{ tab_id: 1, failed: true }])
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  contents.emit('did-finish-load')
  expect(failed()).toEqual([{ tab_id: 1, failed: true }, { tab_id: 1, failed: false }])
})

test('a tab switch, a discard and the end send the last position at once', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  const seen = () => r.calls.filter((c) => c.name === 'map_seen').map((c) => c.args)
  const contents = r.views[0].webContents
  contents.emit('did-navigate-in-page', {}, 'https://act.hoyolab.com/a#1', true) // told at once
  contents.emit('did-navigate-in-page', {}, 'https://act.hoyolab.com/a#2', true) // waits for the second
  expect(seen()).toHaveLength(1)
  r.host.follow(snapshot({ active: 2 })) // the tab switch destroys the view
  expect(seen()).toHaveLength(2)
  expect(seen()[1]).toEqual({ tab_id: 1, url: 'https://act.hoyolab.com/a#2', title: '' })
  await vi.advanceTimersByTimeAsync(5_000)
  expect(seen()).toHaveLength(2) // and the timer that was waiting is gone
  r.views[1].webContents.emit('did-navigate-in-page', {}, 'https://act.hoyolab.com/b#1', true)
  r.views[1].webContents.emit('did-navigate-in-page', {}, 'https://act.hoyolab.com/b#2', true)
  r.host.fragment('#/board')
  await vi.advanceTimersByTimeAsync(DISCARD_AFTER_MS) // the discard
  expect(seen().at(-1)).toEqual({ tab_id: 2, url: 'https://act.hoyolab.com/b#2', title: '' })
  r.host.fragment('#/map')
  r.views[2].webContents.emit('did-navigate-in-page', {}, 'https://act.hoyolab.com/c#1', true)
  r.views[2].webContents.emit('did-navigate-in-page', {}, 'https://act.hoyolab.com/c#2', true)
  const before = seen().length
  r.host.dispose()
  expect(seen()).toHaveLength(before + 1)
})

test('two overlapping session refreshes: the older login never overwrites the newer', async () => {
  const r = rig()
  const waiting: ((cookies: Record<string, string> | null) => void)[] = []
  r.state.fetchSession = () => new Promise((resolve) => { waiting.push(resolve) })
  r.host.fragment('#/map')
  r.host.follow(snapshot({ session: 1 }))
  await flush()
  expect(waiting).toHaveLength(1)
  r.host.follow(snapshot({ session: 1 })) // the same session again: no second refresh
  r.host.follow(snapshot({ session: 2 })) // another login before the first has answered
  await flush()
  expect(waiting).toHaveLength(1) // refreshes run one after another
  waiting[0]({ ltoken_v2: 'made-up-ltoken-OLD', ltuid_v2: '1234', old_only: 'made-up-old-only' })
  for (let i = 0; i < 5; i += 1) await flush()
  expect(waiting).toHaveLength(2)
  waiting[1]({ ltoken_v2: 'made-up-ltoken-NEW', ltuid_v2: '1234' })
  for (let i = 0; i < 5; i += 1) await flush()
  expect(r.cookiesSet.map((c) => c.value)).toEqual(['made-up-ltoken-NEW', '1234'])
  expect(r.calls.filter((c) => c.name === 'map_session')).toHaveLength(2)
  expect(r.views).toHaveLength(1)
})

test('a refresh that fails does not stop the later ones', async () => {
  const r = rig()
  r.state.failCreate = true // the first refresh throws as it makes the view
  r.host.fragment('#/map')
  r.host.follow(snapshot({ session: 1 }))
  for (let i = 0; i < 5; i += 1) await flush()
  expect(r.views).toHaveLength(0)
  r.state.cookies = null // the player logged out: the map's session must lose the login
  r.host.follow(snapshot({ session: 2 }))
  for (let i = 0; i < 5; i += 1) await flush()
  expect(r.calls.filter((c) => c.name === 'map_session')).toHaveLength(2)
  expect(r.cleared).toBe(2)
  expect(r.views).toHaveLength(1)
})

test('a refresh that a newer one overtakes while it sets cookies stops writing', async () => {
  const r = rig(async (details) => {
    if (details.value === 'made-up-ltoken') await new Promise<void>((resolve) => { r.release = resolve })
  })
  r.host.fragment('#/map')
  r.host.follow(snapshot({ session: 1 }))
  await flush()
  expect(r.cookiesSet.map((c) => c.name)).toEqual(['ltoken_v2']) // stuck on the first cookie
  r.state.cookies = { ltoken_v2: 'made-up-ltoken-NEW', ltuid_v2: '1234' }
  r.host.follow(snapshot({ session: 2 }))
  r.release()
  await flush()
  expect(r.cookiesSet.map((c) => [c.name, c.value])).toEqual([
    ['ltoken_v2', 'made-up-ltoken'], ['ltoken_v2', 'made-up-ltoken-NEW'], ['ltuid_v2', '1234'],
  ])
})

test('the views stay on HoYoverse: other addresses, and every new window, are refused', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  const contents = r.views[0].webContents
  const attempt = (event: string, url: string, isMainFrame: boolean | undefined): boolean => {
    let prevented = false
    contents.emit(event, { preventDefault: () => { prevented = true }, url, isMainFrame })
    return prevented
  }
  for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    expect(attempt(event, 'https://act.hoyolab.com/x', true)).toBe(false)
    expect(attempt(event, 'https://example.com/', true)).toBe(true)
    expect(attempt(event, 'http://act.hoyolab.com/', true)).toBe(true)
    expect(attempt(event, 'about:blank', true)).toBe(true)
    expect(attempt(event, 'about:blank', false)).toBe(false)
    expect(attempt(event, 'about:srcdoc', false)).toBe(false)
    expect(attempt(event, 'https://example.com/', false)).toBe(true)
    expect(attempt(event, 'https://example.com/', undefined)).toBe(true)
  }
  expect(contents.openHandler!({ url: 'https://act.hoyolab.com/' })).toEqual({ action: 'deny' })
  // a page that came to an address that is not HoYoverse's goes back
  contents.emit('did-navigate', {}, 'about:blank')
  expect(contents.backs).toBe(1)
  contents.emit('did-navigate', {}, 'https://act.hoyolab.com/y')
  expect(contents.backs).toBe(1)
})

test('windowGone drops the views, and dispose destroys them and clears the session', async () => {
  const r = rig()
  r.host.fragment('#/map')
  r.host.follow(snapshot())
  await flush()
  r.state.holder = null
  r.host.windowGone()
  expect(r.views[0].webContents.closed).toBe(true)
  r.state.holder = r.holder
  r.host.fragment('#/map')
  expect(r.views).toHaveLength(2)
  const cleared = r.cleared
  r.host.dispose()
  expect(r.views[1].webContents.closed).toBe(true)
  expect(r.cleared).toBe(cleared + 1)
  await vi.advanceTimersByTimeAsync(DISCARD_AFTER_MS * 2)
  r.host.follow(snapshot({ session: 5 }))
  await flush()
  expect(r.views).toHaveLength(2) // a disposed host makes nothing
})

test('the map preload exposes nothing: no bridge and no channel', () => {
  const source = readFileSync(join(HERE, '..', 'src', 'map-preload.ts'), 'utf8')
  expect(source).not.toContain('contextBridge')
  expect(source).not.toContain('ipcRenderer')
})

// Runs the preload's source as the page's world would, with a local storage of its own.
function runPreload(argv: string[], cookie = 'ltuid_v2=1234; lang=en', stored: Record<string, string> = {}): Record<string, string> {
  const source = readFileSync(join(HERE, '..', 'src', 'map-preload.ts'), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const store = new Map(Object.entries(stored))
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
  }
  runInNewContext(js, { process: { argv }, document: { cookie }, localStorage, Date, JSON, decodeURIComponent, Map })
  return Object.fromEntries(store)
}

const ROLE_ARGUMENT = `--gb-map-role=${encodeURIComponent(JSON.stringify({ uid: '700000001', region: 'os_euro' }))}`

test('the preload seeds the notices’ marks, and the role when it is given', () => {
  const stored = runPreload(['electron.exe', ROLE_ARGUMENT])
  expect(stored['user-guide-passed']).toBe('true')
  expect(JSON.parse(stored['CookieTips-mapsea_cache_by_act.hoyolab/ys/app/interactive-map/index.html']).data).toBe(true)
  expect(Number(stored['async-announcement-hidden-ts'])).toBeGreaterThan(0)
  expect(JSON.parse(stored['1234:roleGameRegionStorageKey'])).toMatchObject({ cacheTime: 0, data: 'os_euro' })
  expect(JSON.parse(stored['1234:roleGameUIDStorageKey'])).toMatchObject({ cacheTime: 0, data: '700000001' })
})

test('the preload leaves the player’s own values, and reads the role as plain JSON too', () => {
  const plain = `--gb-map-role=${JSON.stringify({ uid: '700000001', region: 'os_euro' })}`
  const stored = runPreload(['electron.exe', plain], 'ltuid_v2=1234', { 'user-guide-passed': 'mine', '1234:roleGameUIDStorageKey': 'mine' })
  expect(stored['user-guide-passed']).toBe('mine')
  expect(stored['1234:roleGameUIDStorageKey']).toBe('mine')
  expect(JSON.parse(stored['1234:roleGameRegionStorageKey']).data).toBe('os_euro')
})

test('the preload seeds no role that is missing, damaged or not plain', () => {
  for (const argv of [
    ['electron.exe'],
    ['electron.exe', '--gb-map-role=not json'],
    ['electron.exe', `--gb-map-role=${JSON.stringify({ uid: '1;', region: 'os_euro' })}`],
    ['electron.exe', `--gb-map-role=${JSON.stringify({ uid: '1', region: 'Europe!' })}`],
  ]) {
    const stored = runPreload(argv)
    expect(Object.keys(stored).filter((key) => key.includes('roleGame'))).toEqual([])
    expect(stored['user-guide-passed']).toBe('true')
  }
})

test('the preload names the role’s keys by the account in the cookie: ltuid_v2, else account_id_v2, digits only', () => {
  const keys = (cookie: string) =>
    Object.keys(runPreload(['electron.exe', ROLE_ARGUMENT], cookie)).filter((key) => key.includes('roleGame')).sort()
  expect(keys('lang=en; ltuid_v2=1234; account_id_v2=999')).toEqual(['1234:roleGameRegionStorageKey', '1234:roleGameUIDStorageKey'])
  expect(keys('account_id_v2=999')).toEqual(['999:roleGameRegionStorageKey', '999:roleGameUIDStorageKey'])
  expect(keys('ltuid_v2=12x4; account_id_v2=999')).toEqual(['999:roleGameRegionStorageKey', '999:roleGameUIDStorageKey'])
  // neither cookie, a look-alike name, or a value that is no number: no role
  expect(keys('')).toEqual([])
  expect(keys('lang=en; xltuid_v2=1234')).toEqual([])
  expect(keys('ltuid_v2=abc; account_id_v2=')).toEqual([])
  // the argument carries no account: the account in an old-style argument is not used
  const old = `--gb-map-role=${JSON.stringify({ account: '555', uid: '700000001', region: 'os_euro' })}`
  expect(Object.keys(runPreload(['electron.exe', old], 'ltuid_v2=1234')).filter((key) => key.startsWith('555'))).toEqual([])
})

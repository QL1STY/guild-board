import { afterEach, expect, test, vi } from 'vitest'
import { api, ApiError, setTransport } from './api.ts'
import { sizedArt, mapArtAddresses } from './ui/artsize.ts'
import {
  BAR_LINK, BAR_SENTENCE, GONE_FROM_RECORDING, PICTURES, REFERENCE_WIDTH, SITE_ADDRESS, showBar, showFrame, RECORDING_REFUSAL, frameFor, inDemoFrame,
  officialArt, recordedTransport, recordingKey, startSiteDemo, zoomFor, zooms,
} from './sitedemo.ts'

afterEach(() => {
  setTransport(null)
  mapArtAddresses(null)
  vi.unstubAllGlobals()
})

test('a route is a file name that tools/record-site-demo.py makes the same way', () => {
  // The same pairs are in tests/test_record_site_demo.py: a change to one without the other fails there.
  expect(recordingKey('/api/status')).toBe('status-269de7a9')
  expect(recordingKey('/api/achievements?view=left&category=0')).toBe('achievements-view-left-category-0-b6ea23d4')
  expect(recordingKey('/api/ledger/history?kind=primogem&limit=50')).toBe('ledger-history-kind-primogem-limit-50-3ad40430')
})

/** A recording served from memory, as a map of route to answer, and a clock the test moves. */
function recording(files: Record<string, unknown>, clock = { at: 1_000 }) {
  const asked: string[] = []
  const transport = recordedTransport(async (key) => {
    asked.push(key)
    const route = Object.keys(files).find((one) => recordingKey(one) === key)
    return route === undefined ? null : files[route]
  }, () => clock.at)
  return { transport, asked, clock }
}

test('a read is answered from the recording, and one it holds no file for says so', async () => {
  const { transport } = recording({ '/api/codes': { rows: [] } })
  expect(await transport('GET', '/api/codes', undefined)).toEqual({ rows: [] })
  await expect(transport('GET', '/api/week', undefined)).rejects.toMatchObject({ name: 'ApiError', status: 404, message: GONE_FROM_RECORDING })
})

test('whatever the page sends is answered as a refusal, with one plain sentence, and sent nowhere', async () => {
  const fetching = vi.fn()
  vi.stubGlobal('fetch', fetching)
  const { transport, asked } = recording({})
  for (const method of ['POST', 'PUT', 'DELETE'] as const) {
    await expect(transport(method, '/api/timers', { name: 'x' })).rejects.toMatchObject({ status: 409, message: RECORDING_REFUSAL })
  }
  expect(RECORDING_REFUSAL).toBe('This is a recording, so nothing here changes. Install Guild Board to use it.')
  expect(asked).toEqual([])
  expect(fetching).not.toHaveBeenCalled()
})

test("the time shown is the recording's own, carried forward by the time since the page opened", async () => {
  const { transport, clock } = recording({ '/api/status': { now: '2026-10-13T08:00:00+00:00', version: '0.8.0' } })
  const first = (await transport('GET', '/api/status', undefined)) as { now: string }
  expect(first.now).toBe('2026-10-13T08:00:00.000Z')
  clock.at += 90_000
  const later = (await transport('GET', '/api/status', undefined)) as { now: string }
  expect(later.now).toBe('2026-10-13T08:01:30.000Z')
})

test('a file is read once, whoever asks and however often', async () => {
  const { transport, asked } = recording({ '/api/codes': {} })
  await transport('GET', '/api/codes', undefined)
  await transport('GET', '/api/codes', undefined)
  expect(asked).toEqual([recordingKey('/api/codes')])
})

test("the api's calls go through the transport once the site demo has started, and its sentence is the error's", async () => {
  const fetching = vi.fn()
  vi.stubGlobal('fetch', fetching)
  setTransport(recording({ '/api/codes': { rows: [1] } }).transport)
  expect(await api.get('/api/codes')).toEqual({ rows: [1] })
  const refused = await api.post('/api/codes/redeem', { code: 'X' }).catch((error: unknown) => error)
  expect(refused).toBeInstanceOf(ApiError)
  expect((refused as ApiError).message).toBe(RECORDING_REFUSAL)
  expect(fetching).not.toHaveBeenCalled()
})

test("a picture of the art cache is the official address of the demo's list, and any other address is left", () => {
  const [key, entry] = Object.entries(PICTURES)[0]
  expect(officialArt(`/api/art/${key}`)).toBe(entry.url)
  expect(officialArt(`/api/art/${key}?size=256`)).toBe(entry.url)
  expect(officialArt('/api/art/not-in-the-list')).toBe('/api/art/not-in-the-list')
  expect(officialArt('/api/icon/static.primogem', {})).toBe('/api/icon/static.primogem') // no map of icons: as it was
  expect(entry.url).toMatch(/^https:\/\/(act-webstatic|act-upload|upload-static|bbs|fastcdn)\.(hoyoverse|hoyolab)\.com\//)
})

test('a picture of the icon cache is the official address its key has in the recording, and any other is left', () => {
  const icons = {
    'static.primogem': { url: 'https://upload-static.hoyoverse.com/primogem.png' },
    'banner.33201': { url: 'https://sdk.hoyoverse.com/banner.jpg' },
    'account.picture': { url: 'https://example.invalid/never' },
  }
  expect(officialArt('/api/icon/static.primogem', icons)).toBe('https://upload-static.hoyoverse.com/primogem.png')
  expect(officialArt('/api/icon/banner.33201?size=256', icons)).toBe('https://sdk.hoyoverse.com/banner.jpg')
  expect(officialArt('/api/icon/timer.nothing', icons)).toBe('/api/icon/timer.nothing')
  expect(officialArt('/api/icon/toString', icons)).toBe('/api/icon/toString') // a name on every object is no key
  expect(officialArt('/api/checkin/icon/2', icons)).toBe('/api/checkin/icon/2')
})

test('with no site demo, an address of the art cache is as it was', () => {
  expect(sizedArt('/api/art/abc', 256)).toBe('/api/art/abc?size=256')
  mapArtAddresses(officialArt)
  const [key, entry] = Object.entries(PICTURES)[0]
  expect(sizedArt(`/api/art/${key}`, 256)).toBe(entry.url)
})

test('starting the site demo takes over the calls, the pictures and the stream, and reads the icons of the recording', async () => {
  const fetching = vi.fn(async (address: string) =>
    address.endsWith('/recording/icons.json')
      ? { ok: true, json: async () => ({ 'static.resin': { url: 'https://act-upload.hoyoverse.com/resin.png' } }) }
      : { ok: false },
  )
  vi.stubGlobal('fetch', fetching)
  expect(await startSiteDemo()).toBe(true) // with no page around it, as in a test, it draws the interface
  const [key, entry] = Object.entries(PICTURES)[0]
  expect(sizedArt(`/api/art/${key}`, null)).toBe(entry.url)
  expect(sizedArt('/api/icon/static.resin', 0)).toBe('https://act-upload.hoyoverse.com/resin.png')
  expect(sizedArt('/api/icon/static.primogem', 0)).toBe('/api/icon/static.primogem')
  expect(fetching).toHaveBeenCalledTimes(1)
})

test('without an icons file the demo still starts, and the icons show their signs', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('offline')
  })
  await startSiteDemo()
  expect(sizedArt('/api/icon/static.resin', 0)).toBe('/api/icon/static.resin')
})

/** A page as far as the bar needs one: elements that keep their parts, a head and a body, and a view that is zoomed out by `scale`. */
function fakePage(scale: number) {
  const element = (tag: string) => ({
    tag, id: '', href: '', textContent: '', style: { fontSize: '' }, children: [] as unknown[], offsetHeight: 30,
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) { this.attributes[name] = value },
    append(...parts: unknown[]) { this.children.push(...parts) },
    prepend(...parts: unknown[]) { this.children.unshift(...parts) },
  })
  const properties: Record<string, string> = {}
  const listeners: Array<() => void> = []
  const view = { scale, addEventListener: (_: string, listener: () => void) => listeners.push(listener) }
  const page = {
    createElement: element,
    head: element('head'),
    body: element('body'),
    documentElement: { style: { setProperty: (name: string, value: string) => (properties[name] = value) } },
    defaultView: { visualViewport: view },
  }
  return { page: page as unknown as Document, body: page.body, properties, view, listeners }
}

test('the bar above the demo says it is a recording and links back to the site, and keeps its letters readable when zoomed out', () => {
  expect(BAR_SENTENCE).toBe('This is a recording on a made-up account.')
  expect(BAR_LINK).toBe('Back to the site')
  expect(SITE_ADDRESS).toBe('/guild-board/')
  const out = fakePage(0.3)
  showBar(out.page)
  const bar = out.body.children[0] as { id: string; children: Array<{ tag: string; textContent: string; href: string }>; style: { fontSize: string } }
  expect(bar.id).toBe('site-bar')
  expect(bar.children.map((part) => part.textContent)).toEqual([BAR_SENTENCE, BAR_LINK])
  expect(bar.children[1]).toMatchObject({ tag: 'a', href: '/guild-board/' })
  expect(parseFloat(bar.style.fontSize)).toBeCloseTo(43.3, 0) // 13 screen pixels on a page shown at 0.3
  expect(out.properties['--site-bar']).toBe('30px')
  const whole = fakePage(1)
  showBar(whole.page)
  expect((whole.body.children[0] as { style: { fontSize: string } }).style.fontSize).toBe('13px')
  const zoomedIn = fakePage(2.5)
  showBar(zoomedIn.page)
  expect((zoomedIn.body.children[0] as { style: { fontSize: string } }).style.fontSize).toBe('13px')
})

test('the interface zooms with the window’s width, from 1,640 up to twice, as the app’s window does', () => {
  // The rule and the examples of the shell's window (zoomFor in shell/src/dashboard.ts and shell/test/dashboard.test.ts).
  expect(REFERENCE_WIDTH).toBe(1640)
  expect(zoomFor(1640)).toBe(1)
  expect(zoomFor(2460)).toBe(1.5)
  expect(zoomFor(4000)).toBe(2)
  expect(zoomFor(1200)).toBe(1)
})

test('only a screen wider than the usual window gets the frame that zooms: a small screen and a phone’s page are drawn as they are', () => {
  expect(zooms(2560)).toBe(true)
  expect(zooms(1920)).toBe(true)
  expect(zooms(1640)).toBe(false)
  expect(zooms(1366)).toBe(false)
  expect(zooms(390)).toBe(false)
})

test('the frame fills the window under the bar and is laid out as the app’s window is at that zoom', () => {
  const wide = frameFor(2560, 1400, 30)
  expect(wide.zoom).toBeCloseTo(2560 / 1640, 12)
  expect(wide.width).toBeCloseTo(1640, 9) // the usual window's width, drawn 2,560 wide
  expect(wide.height).toBeCloseTo((1400 - 30) / (2560 / 1640), 9)
  expect(frameFor(1920, 1080, 30).zoom).toBeCloseTo(1920 / 1640, 12)
  expect(frameFor(1200, 900, 30)).toEqual({ zoom: 1, width: 1200, height: 870 })
  expect(frameFor(4000, 2000, 30)).toEqual({ zoom: 2, width: 2000, height: 985 })
  expect(frameFor(1800, 20, 30).height).toBe(0)
})

/** A window as far as the frame needs one, of this size and at this address, whose page `parent` frames (none: a visitor opened it). */
function fakeScreen(width: number, height: number, href: string, parent?: unknown) {
  type Listener = () => void
  const events = () => {
    const bag: Record<string, Listener[]> = {}
    return {
      on: (type: string, listener: Listener) => void (bag[type] ??= []).push(listener),
      fire: (type: string) => (bag[type] ?? []).forEach((listener) => listener()),
    }
  }
  const outer = events()
  const framed = events()
  const loads = events()
  let address = new URL(href)
  const replaced: string[] = []
  const inner = {
    focused: false,
    location: {
      hash: '',
      replace(to: string) {
        inner.location.hash = to === '#' ? '' : to
        framed.fire('hashchange')
      },
    },
    // The page's own history: a place written in place changes the address and fires no event.
    history: {
      state: null,
      replaceState(_state: unknown, _title: string, to?: string | URL | null) {
        if (typeof to === 'string' && to.startsWith('#')) inner.location.hash = to
      },
    },
    addEventListener: framed.on,
    focus() {
      inner.focused = true
    },
  }
  interface Part {
    tag: string
    id: string
    title: string
    src: string
    children: Part[]
    style: Record<string, string>
  }
  const element = (tag: string) => ({
    tag, id: '', href: '', src: '', title: '', textContent: '', children: [] as Part[], offsetHeight: tag === 'div' ? 30 : 0,
    style: { fontSize: '', zoom: '', width: '', height: '' } as Record<string, string>,
    attributes: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this.attributes[name] = value
    },
    append(...parts: Part[]) {
      this.children.push(...parts)
    },
    prepend(...parts: Part[]) {
      this.children.unshift(...parts)
    },
    addEventListener: loads.on,
    contentWindow: tag === 'iframe' ? inner : null,
  })
  const view: Record<string, unknown> = {
    screen: { width, height },
    location: {
      get href() { return address.href },
      get hash() { return address.hash },
      get pathname() { return address.pathname },
      get search() { return address.search },
    },
    history: {
      state: null,
      replaceState(_state: unknown, _title: string, to: string) {
        replaced.push(to)
        address = new URL(to, address)
      },
    },
    addEventListener: outer.on,
    visualViewport: { scale: 1, addEventListener() {} },
  }
  view.parent = parent ?? view
  const documentElement = { clientWidth: width, clientHeight: height, style: { setProperty() {} } }
  const page = { createElement: element, head: element('head'), body: element('body'), documentElement, defaultView: view }
  return {
    page: page as unknown as Document, view, body: page.body, inner, replaced,
    href: () => address.href,
    resize(to: [number, number]) {
      ;[documentElement.clientWidth, documentElement.clientHeight] = to
      outer.fire('resize')
    },
    loaded: () => loads.fire('load'),
    framedGoesTo(hash: string) {
      inner.location.hash = hash
      framed.fire('hashchange')
    },
    visitorGoesTo(hash: string) {
      address.hash = hash
      outer.fire('hashchange')
    },
  }
}

test('the page in the frame is the interface; the page a visitor opened, or one another page frames, is not', () => {
  const opened = fakeScreen(2560, 1400, 'https://example.github.io/guild-board/demo/')
  expect(inDemoFrame(opened.view as unknown as Window)).toBe(false)
  const framed = fakeScreen(2560, 1400, 'https://example.github.io/guild-board/demo/#/pulls', opened.view)
  expect(inDemoFrame(framed.view as unknown as Window)).toBe(true)
  const site = fakeScreen(2560, 1400, 'https://example.github.io/guild-board/')
  expect(inDemoFrame(fakeScreen(2560, 1400, 'https://example.github.io/guild-board/demo/', site.view).view as unknown as Window)).toBe(false)
  const elsewhere = {
    get location(): never {
      throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError')
    },
  }
  expect(inDemoFrame(fakeScreen(2560, 1400, 'https://example.github.io/guild-board/demo/', elsewhere).view as unknown as Window)).toBe(false)
})

test('the frame holds the same page at the same place, fills the window under the bar, and zooms with the window’s width', () => {
  const screen = fakeScreen(2560, 1400, 'https://example.github.io/guild-board/demo/#/pulls')
  showFrame(screen.page)
  const [bar, frame] = screen.body.children
  expect(bar.id).toBe('site-bar')
  expect(frame).toMatchObject({ tag: 'iframe', id: 'site-frame', title: 'Guild Board', src: 'https://example.github.io/guild-board/demo/#/pulls' })
  expect(Number(frame.style.zoom)).toBeCloseTo(2560 / 1640, 12)
  expect(parseFloat(frame.style.width)).toBeCloseTo(1640, 9)
  expect(parseFloat(frame.style.height)).toBeCloseTo((1400 - 30) * (1640 / 2560), 9)
  screen.resize([1200, 900])
  expect(frame.style).toMatchObject({ zoom: '1', width: '1200px', height: '870px' })
  screen.resize([3280, 1800])
  expect(frame.style).toMatchObject({ zoom: '2', width: '1640px', height: '885px' })
})

test("the address bar follows the frame's place, a place typed into it is the frame's, and the keys go to the frame", () => {
  const screen = fakeScreen(2560, 1400, 'https://example.github.io/guild-board/demo/')
  showFrame(screen.page)
  screen.inner.location.hash = '#/board'
  screen.loaded()
  expect(screen.inner.focused).toBe(true)
  expect(screen.href()).toBe('https://example.github.io/guild-board/demo/#/board')
  screen.framedGoesTo('#/stats/year')
  expect(screen.href()).toBe('https://example.github.io/guild-board/demo/#/stats/year')
  screen.visitorGoesTo('#/map')
  expect(screen.inner.location.hash).toBe('#/map')
  expect(screen.href()).toBe('https://example.github.io/guild-board/demo/#/map')
  expect(screen.replaced).toHaveLength(2) // a place both already show is not written again
})

test('the address bar also follows a place the frame writes in place with history.replaceState, which fires no event', () => {
  const screen = fakeScreen(2560, 1400, 'https://example.github.io/guild-board/demo/#/achievements')
  showFrame(screen.page)
  screen.inner.location.hash = '#/achievements'
  screen.loaded()
  // The Achievements page opens Timers and Daily commissions in place (Achievements.tsx), and Settings closes its sync log so.
  screen.inner.history.replaceState(null, '', '#/achievements/timers')
  expect(screen.inner.location.hash).toBe('#/achievements/timers') // the page's own address is written as it asked
  expect(screen.href()).toBe('https://example.github.io/guild-board/demo/#/achievements/timers')
  screen.inner.history.replaceState(null, '', '#/settings')
  expect(screen.href()).toBe('https://example.github.io/guild-board/demo/#/settings')
  screen.inner.history.replaceState({ kept: true }, '') // no address: the place stays, and so does the address bar
  expect(screen.href()).toBe('https://example.github.io/guild-board/demo/#/settings')
})

test('on a wide screen the page a visitor opens draws the frame and reads nothing; the page in it, and a small screen, draw the interface', async () => {
  const fetching = vi.fn(async () => ({ ok: false }))
  vi.stubGlobal('fetch', fetching)
  const opened = fakeScreen(2560, 1400, 'https://example.github.io/guild-board/demo/')
  expect(await startSiteDemo(opened.page)).toBe(false)
  expect(opened.body.children.map((part) => part.id)).toEqual(['site-bar', 'site-frame'])
  expect(fetching).not.toHaveBeenCalled()
  const framed = fakeScreen(2560, 1400, 'https://example.github.io/guild-board/demo/', opened.view)
  expect(await startSiteDemo(framed.page)).toBe(true)
  expect(framed.body.children).toEqual([]) // its bar is the page's around it
  expect(fetching).toHaveBeenCalledTimes(1) // the icons of the recording
  const small = fakeScreen(1366, 768, 'https://example.github.io/guild-board/demo/')
  expect(await startSiteDemo(small.page)).toBe(true)
  expect(small.body.children.map((part) => part.id)).toEqual(['site-bar'])
})

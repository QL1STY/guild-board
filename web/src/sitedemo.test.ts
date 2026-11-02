import { afterEach, expect, test, vi } from 'vitest'
import { api, ApiError, setTransport } from './api.ts'
import { sizedArt, mapArtAddresses } from './ui/artsize.ts'
import {
  BAR_LINK, BAR_SENTENCE, GONE_FROM_RECORDING, PICTURES, SITE_ADDRESS, showBar, RECORDING_REFUSAL, officialArt, recordedTransport, recordingKey, startSiteDemo,
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
  await startSiteDemo()
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

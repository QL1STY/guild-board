import { type CDPSession, chromium, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Core } from '../e2e/fixtures.ts'

/*
 * What the Characters pages cost in memory, in the Edge that Windows has (`npm run memory:characters`; MEMORY_LABEL names the
 * run, "before" or "after", and the numbers go to test-results/memory-<label>-<window>.json). Not a test of anything: it opens
 * the roster and then ten characters' cards in a row, and reads the page's JS heap, its DOM, its images (how many, and how
 * many bytes they take once decoded, which is width x height x 4) and what the browser's renderer and GPU processes hold, once
 * the page has settled. The core is tools/memory_core.py's demo, whose pictures are as large as the real ones (2048-pixel art);
 * the page's reads of the roster and of each profile are given those pictures. Both windows the player has are measured: the
 * usual one, 1,640 x 1,100, and full screen on 2,560 x 1,400, as the window's zoom shows it (1,640 x 897 CSS pixels at
 * 2,560 / 1,640 device pixels to a pixel). Each window has a browser of its own, since a GPU process never gives back what it took
 * for the window before, and each run starts from an empty page, Board and Stats, which show what any page costs.
 *
 * What the numbers are not: the player's window is Qt WebEngine, where the GPU work is done inside Guild Board's own process and
 * no spare renderer waits (about 40 MB of the renderers here). Here the GPU process's size is mostly the graphics driver's own
 * memory, and moves within 30 MB between two runs of the same page: what a page does in CSS does not show in it. The measure forces
 * a collection, which Edge does by itself and Qt WebEngine 140 does not, so the growth of the real window with each page change
 * never shows here. Numbers that decide anything about the window are read from Qt WebEngine (the Characters design, 11.7).
 */
const TAG = '@memory'
test.use({ demoNow: '2026-10-25T08:00:00+00:00', bigArt: true, weekAndEndgame: false })

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CARDS = 10
const LABEL = process.env.MEMORY_LABEL ?? 'run'
const MB = 1024 * 1024

type Counters = {
  jsHeapMB: number
  nodes: number
  imagesInPage: number
  imagesLoaded: number
  imagesDecodedMB: number
  artRequests: number
  artBodyMB: number
  rendererMB: number
  gpuMB: number
}

/** Gives the characters the large pictures of tools/memory_core.py: a face each, and the card now open its art and chart. */
async function withBigPictures(page: Page, opened: { index: number }): Promise<void> {
  await page.route(/\/api\/characters$/, async (route) => {
    const response = await route.fetch()
    const roster = (await response.json()) as { entries: { icon: string | null }[] }
    roster.entries.forEach((entry, index) => {
      entry.icon = `/api/art/bigface${String(index % 160).padStart(3, '0')}`
    })
    await route.fulfill({ response, json: roster })
  })
  await page.route(/\/api\/characters\/[a-z0-9-]+$/, async (route) => {
    const response = await route.fetch()
    const profile = (await response.json()) as { art: string | null; chart: string | null }
    profile.art = `/api/art/bigart${String(opened.index % 12).padStart(2, '0')}`
    profile.chart = `/api/art/bigchart${String(opened.index % 12).padStart(2, '0')}`
    await route.fulfill({ response, json: profile })
  })
}

/** Private bytes of these processes, by process id. */
function processMemory(ids: number[]): Map<number, number> {
  if (ids.length === 0) return new Map()
  const text = execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $($_.PrivateMemorySize64)" }; exit 0`],
    { encoding: 'utf8' },
  )
  return new Map(
    text
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => line.trim().split(' ').map(Number) as [number, number]),
  )
}

async function measure(page: Page, browser: CDPSession, session: CDPSession): Promise<Counters> {
  // The images that are in view or near it have loaded; a lazy one far down the page waits to be near.
  await page.waitForFunction(() =>
    [...document.images]
      .filter((image) => !image.hidden && image.getBoundingClientRect().top < innerHeight + 1000 && image.getBoundingClientRect().bottom > -1000)
      .every((image) => image.complete),
  )
  await page.waitForTimeout(1500) // decoding, and the browser's own tidying, settle
  await session.send('HeapProfiler.collectGarbage')
  const metrics = (await session.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] }
  const metric = (name: string) => metrics.metrics.find((one) => one.name === name)?.value ?? 0
  const counters = (await session.send('Memory.getDOMCounters')) as { nodes: number }
  const images = await page.evaluate(() => {
    const all = [...document.images]
    const loaded = all.filter((image) => image.complete && image.naturalWidth > 0)
    const resources = performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/art/')) as PerformanceResourceTiming[]
    return {
      inPage: all.length,
      loaded: loaded.length,
      decodedBytes: loaded.reduce((sum, image) => sum + image.naturalWidth * image.naturalHeight * 4, 0),
      requests: resources.length,
      bodyBytes: resources.reduce((sum, entry) => sum + entry.decodedBodySize, 0),
    }
  })
  const info = (await browser.send('SystemInfo.getProcessInfo')) as { processInfo: { type: string; id: number }[] }
  const memory = processMemory(info.processInfo.map((one) => one.id))
  const sum = (type: string) =>
    info.processInfo.filter((one) => one.type === type).reduce((total, one) => total + (memory.get(one.id) ?? 0), 0)
  return {
    jsHeapMB: +(metric('JSHeapUsedSize') / MB).toFixed(1),
    nodes: counters.nodes,
    imagesInPage: images.inPage,
    imagesLoaded: images.loaded,
    imagesDecodedMB: +(images.decodedBytes / MB).toFixed(1),
    artRequests: images.requests,
    artBodyMB: +(images.bodyBytes / MB).toFixed(1),
    rendererMB: +(sum('renderer') / MB).toFixed(1),
    gpuMB: +(sum('GPU') / MB).toFixed(1),
  }
}

async function run(core: Core, name: string, viewport: { width: number; height: number }, scale: number): Promise<void> {
  const browser = await chromium.launch({ channel: 'msedge' })
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale })
  try {
    await context.request.get(core.launch, { maxRedirects: 0 })
    await context.request.put(`${core.origin}/api/settings`, { data: { risk_acknowledged: true } })
    const page = await context.newPage()
    const session = await context.newCDPSession(page)
    const whole = await browser.newBrowserCDPSession()
    await session.send('Performance.enable')
    const opened = { index: 0 }
    await withBigPictures(page, opened)
    const roster = (await (await context.request.get(`${core.origin}/api/characters`)).json()) as { entries: { key: string }[] }
    const keys = roster.entries.slice(0, CARDS).map((entry) => entry.key)
    const found: Record<string, Counters> = {}
    await page.goto('about:blank')
    found['an empty page'] = await measure(page, whole, session)
    await page.goto(`${core.origin}/#/board`)
    await expect(page.getByTestId('board')).toBeVisible()
    found.Board = await measure(page, whole, session)
    await page.evaluate(() => (window.location.hash = '#/stats'))
    found.Stats = await measure(page, whole, session)
    await page.evaluate(() => (window.location.hash = '#/characters'))
    await expect(page.locator('.cr-card').first()).toBeVisible()
    found['roster opened'] = await measure(page, whole, session)
    for (const [index, key] of keys.entries()) {
      opened.index = index
      await page.evaluate((hash) => (window.location.hash = hash), `#/characters/${key}`)
      await expect(page.locator('.pf-name')).toBeVisible()
      await page.waitForFunction(() => [...document.querySelectorAll('.pf-art img')].every((image) => (image as HTMLImageElement).complete))
      await page.waitForTimeout(250)
    }
    found[`after ${CARDS} cards`] = await measure(page, whole, session)
    await page.evaluate(() => (window.location.hash = '#/characters'))
    await expect(page.locator('.cr-card').first()).toBeVisible()
    found['back on the roster'] = await measure(page, whole, session)
    mkdirSync(path.join(WEB, 'test-results'), { recursive: true })
    writeFileSync(path.join(WEB, 'test-results', `memory-${LABEL}-${name}.json`), JSON.stringify(found, null, 2))
    console.log(`\n== ${LABEL}, ${name} ==`)
    console.table(found)
  } finally {
    await browser.close()
  }
}

test('memory: the usual window', { tag: TAG }, async ({ core }) => {
  test.setTimeout(180_000)
  await run(core, 'usual-1640x1100', { width: 1640, height: 1100 }, 1)
})

test('memory: full screen on 2560 x 1400', { tag: TAG }, async ({ core }) => {
  test.setTimeout(180_000)
  await run(core, 'full-2560x1400', { width: 1640, height: 897 }, 2560 / 1640)
})

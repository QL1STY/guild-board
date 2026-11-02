import { type BrowserContext, chromium } from '@playwright/test'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, type Core } from '../e2e/fixtures.ts'

/*
 * The proof that the constellation stars sit on their charts (`npm run proof:stars`): every chart of stars.json, drawn by the real
 * page in Edge, in the player's two windows and at two picture qualities. Not a test of anything: for each character and window
 * it keeps a picture of the chart as the page draws it, with the stars hidden, and where the page drew the stars, in that picture's
 * pixels. tools/research/stars_check.py then measures the one against the other and makes the contact sheets. `<key>-page.png` is
 * the stage as the player sees it, with the stars' icons on.
 *
 * The core is tools/stars_core.py's demo, which serves the real charts (STARS_CHARTS, the folder of the research run's charts);
 * the page's read of Sandrone's card is given each chart and its stars in turn, and everything after that is the live page's own.
 * STARS_LABEL names the run, "before" or "after", and the results go to test-results/stars/<label>/<window>-<quality>/.
 */
const TAG = '@stars'
const CHARTS = process.env.STARS_CHARTS ?? ''
test.use({ demoNow: '2026-10-25T08:00:00+00:00', realCharts: CHARTS, weekAndEndgame: false })

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STARS = path.join(WEB, '..', 'src', 'guildboard', 'reference', 'characters', 'stars.json')
const LABEL = process.env.STARS_LABEL ?? 'run'
const ONLY = process.env.STARS_ONLY?.split(',') ?? null

/** The usual window, and a full screen of 2,560 x 1,440 as the window's zoom shows it. */
const WINDOWS = [
  { name: 'usual', viewport: { width: 1640, height: 1100 }, scale: 1 },
  { name: 'full', viewport: { width: 1640, height: 922 }, scale: 2560 / 1640 },
]
const QUALITIES = ['high', 'low'] as const

/** What hides everything but the chart, so that the picture holds its stars alone. Nothing here moves anything. */
const CHART_ALONE = `
  .pf-cwrap svg, .pf-art, .pf-who, .pf-actions, .pf-giant, .pf-hero::before, .pf-hero::after { visibility: hidden !important; }
  .pf-cwrap img { -webkit-mask-image: none !important; mask-image: none !important; }
`

type Entry = { size: [number, number]; points: [number, number][] }

async function pass(core: Core, context: BrowserContext, name: string, quality: string, scale: number, entries: [string, Entry][]): Promise<void> {
  const folder = path.join(WEB, 'test-results', 'stars', LABEL, `${name}-${quality}`)
  mkdirSync(folder, { recursive: true })
  await context.request.get(core.launch, { maxRedirects: 0 })
  await context.request.put(`${core.origin}/api/settings`, { data: { risk_acknowledged: true, picture_quality: quality } })
  const page = await context.newPage()
  let current: [string, Entry] = entries[0]
  await page.route(/\/api\/characters\/[a-z0-9-]+$/, async (route) => {
    const response = await route.fetch()
    const profile = (await response.json()) as Record<string, unknown>
    const [key, entry] = current
    profile.chart = `/api/art/chart${key.replaceAll('-', '')}`
    profile.stars = entry.points
    profile.chart_size = entry.size
    await route.fulfill({ response, json: profile })
  })
  for (const entry of entries) {
    current = entry
    const [key] = entry
    await page.goto(`${core.origin}/#/characters/sandrone`)
    await page.reload()
    await page.getByRole('navigation', { name: "Sandrone's pages" }).getByRole('button', { name: 'Constellation' }).click()
    const wrap = page.locator('.pf-cwrap')
    await wrap.locator('img').evaluate(async (image: HTMLImageElement) => {
      for (let i = 0; i < 400 && (!image.getAttribute('src') || !image.complete || image.naturalWidth === 0); i += 1) {
        await new Promise((done) => setTimeout(done, 25))
      }
      await image.decode()
    })
    const drawn = await wrap.evaluate((box, ratio) => {
      const place = box.getBoundingClientRect()
      const image = box.querySelector('img')!
      const rings = [...box.querySelectorAll('.pf-ring')].map((ring) => {
        const circle = ring.getBoundingClientRect()
        return [((circle.left + circle.right) / 2 - place.left) * ratio, ((circle.top + circle.bottom) / 2 - place.top) * ratio]
      })
      const first = box.querySelector('.pf-ring')!.getBoundingClientRect()
      return {
        box: [place.width * ratio, place.height * ratio],
        natural: [image.naturalWidth, image.naturalHeight],
        address: image.getAttribute('src'),
        fit: getComputedStyle(image).objectFit,
        ring: (first.width * ratio) / 2,
        stars: rings,
      }
    }, scale)
    await page.locator('.pf-stage').screenshot({ path: path.join(folder, `${key}-page.png`), animations: 'disabled' })
    await page.evaluate((css) => {
      const sheet = new CSSStyleSheet() // the page's policy refuses a style tag
      sheet.replaceSync(css)
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    }, CHART_ALONE)
    await wrap.screenshot({ path: path.join(folder, `${key}.png`), animations: 'disabled' })
    writeFileSync(path.join(folder, `${key}.json`), JSON.stringify({ key, ...drawn, size: entry[1].size, points: entry[1].points }))
  }
  await page.close()
}

test(`every chart with its stars, as the page draws them ${TAG}`, async ({ core }) => {
  test.setTimeout(3_600_000)
  test.skip(CHARTS === '', 'STARS_CHARTS names the folder of the real charts')
  const all = JSON.parse(readFileSync(STARS, 'utf-8')) as Record<string, Entry>
  const have = new Set(readdirSync(CHARTS).map((file) => path.parse(file).name))
  const entries = Object.entries(all).filter(([key]) => have.has(key) && (ONLY === null || ONLY.includes(key)))
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    for (const window of WINDOWS) {
      for (const quality of QUALITIES) {
        const context = await browser.newContext({ viewport: window.viewport, deviceScaleFactor: window.scale, reducedMotion: 'reduce' })
        await pass(core, context, window.name, quality, window.scale, entries)
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
})

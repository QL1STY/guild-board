import type { Page } from '@playwright/test'
import path from 'node:path'
import type { Ledger } from '../src/ledgertypes.ts'
import { changeAnswer } from '../e2e/answers.ts'
import { SCREENS_OUT } from './out.ts'
import { expect, test, type Core } from '../e2e/fixtures.ts'

/*
 * The Ledger's pictures, which only `npm run screens:ledger` takes, to be looked at against the Ledger revamp design (section
 * 11) and its mockups, ledger.html (Primogems) and views.html (Crystals, Resin and Artifacts). Each is what the window shows,
 * in the player's usual window, 1,640 × 1,100, and full screen on their 2,560-pixel display as the window's zoom shows it (the
 * page lays out as the usual window, enlarged), once the motion has settled: each of the four views, the Primogems chart with the pointer on a day, Spent on Genshin hidden, half
 * peeled and shown, the page before any import, and the Primogems view on Midnight and on Mist; and, once, the Primogems view at
 * full screen with the page size of 70 (`primogems-2560-size70`), where the page is wide enough for the layout with a feed down the right. The demo's history is made up;
 * nothing in it is the player's.
 *
 * They go into the folder 2026-11-09-ledger-revamp-screens of the directory GB_SCREENS_DIR names (the design's assets folder, as
 * the Stats pictures do), else of `screenshots`. The earlier Ledger, gallery and settings pictures (2026-10-27-ledger-screens) stay
 * as they were.
 */

const NAME = '2026-11-09-ledger-revamp-screens'
const FOLDER = path.join(SCREENS_OUT, NAME)
const LEDGER = '@ledger'

/** Waits until no animation or transition runs (a paused one rests) and every counted number shows its value (look pass spec 6.3). */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const moving = document.getAnimations().some((animation) => animation.playState === 'running')
    const counting = [...document.querySelectorAll('span[aria-hidden="true"] + .sr-only')].some(
      (real) => real.previousElementSibling?.textContent !== real.textContent,
    )
    return !moving && !counting
  })
}

/** The window's picture, once the fonts and pictures are in and the motion has settled; `hover` rests the pointer where the scene says, else it is out of the window. */
async function shot(page: Page, name: string, hover?: () => Promise<void>): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.hidden || (image.complete && image.naturalWidth > 0)),
  )
  await page.evaluate(() => window.scrollTo(0, 0))
  if (hover === undefined) await page.mouse.move(0, 0)
  else await hover()
  await settled(page)
  await page.screenshot({ path: path.join(FOLDER, `${name}.png`) })
}

type Scene = {
  name: string
  /** Settings the scene needs before the page opens: the look, whether the spending is hidden. */
  settings?: Record<string, unknown>
  /** Opens the page and waits until it has read what it shows. */
  open: (page: Page, core: Core) => Promise<void>
  /** Where the pointer rests for the picture. */
  hover?: (page: Page) => () => Promise<void>
}

const tab = (name: 'Primogems' | 'Crystals' | 'Resin' | 'Artifacts') => async (page: Page, core: Core) => {
  await page.goto(`${core.origin}/#/ledger`)
  await expect(page.getByTestId('ledger-tx').getByRole('listitem').first()).toBeVisible()
  await expect(page.getByTestId('ledger-wishes')).toBeVisible()
  if (name !== 'Primogems') {
    await page.getByRole('radio', { name, exact: true }).click()
    await expect(page.getByTestId('ledger-card-where')).toBeVisible()
    await expect(page.getByTestId('ledger-tx').getByRole('listitem').first()).toBeVisible()
  }
  await expect(page.getByTestId('ledger-chart-label')).toBeVisible()
}

const spentCard = (page: Page) => page.getByTestId('ledger-spent')

const SCENES: Scene[] = [
  { name: 'primogems', open: tab('Primogems') },
  { name: 'crystals', open: tab('Crystals') },
  { name: 'resin', open: tab('Resin') },
  { name: 'artifacts', open: tab('Artifacts') },
  {
    name: 'primogems-pointer',
    open: tab('Primogems'),
    // The pointer on a day three quarters along the month, where the line has moved.
    hover: (page) => async () => {
      const svg = page.getByTestId('ledger-chart').locator('svg.ld-svg')
      const found = await svg.boundingBox()
      if (found === null) throw new Error('the chart is not drawn')
      await page.mouse.move(found.x + found.width * 0.72, found.y + found.height / 2)
      await expect(page.getByTestId('ledger-chart-line')).toContainText('that day')
    },
  },
  {
    name: 'spent-hidden',
    settings: { ledger_spent_hidden: true },
    open: async (page, core) => {
      await tab('Primogems')(page, core)
      await expect(page.getByTestId('ledger-spent-cover')).toBeVisible()
      await expect(spentCard(page).getByRole('button', { name: 'Show', exact: true })).toBeVisible()
    },
  },
  {
    name: 'spent-peeling',
    settings: { ledger_spent_hidden: true },
    open: async (page, core) => {
      await tab('Primogems')(page, core)
      await spentCard(page).getByRole('button', { name: 'Show', exact: true }).click()
      // Half way through the 0.75 s of the peel: the cover, its gold edge and the figures coming into focus stop there.
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) {
          animation.pause()
          animation.currentTime = 375
        }
      })
    },
  },
  { name: 'spent-shown', settings: { ledger_spent_hidden: false }, open: tab('Primogems') },
  {
    name: 'before-import',
    open: async (page, core) => {
      await changeAnswer<Ledger>(page, '/api/ledger', (data) => {
        data.empty = true
        data.last_import = null
      })
      await page.goto(`${core.origin}/#/ledger`)
      await expect(page.getByTestId('ledger-empty')).toBeVisible()
    },
  },
  { name: 'primogems-midnight', settings: { theme: 'midnight' }, open: tab('Primogems') },
  { name: 'primogems-mist', settings: { theme: 'mist' }, open: tab('Primogems') },
]

for (const scene of SCENES) {
  test(`ledger: ${scene.name} in the usual window`, { tag: LEDGER }, async ({ page, core, api }) => {
    await api.put('/api/settings', { ledger_spent_hidden: false, ...scene.settings })
    await page.setViewportSize({ width: 1640, height: 1100 })
    await page.reload() // the page fixture loaded the page before the settings were set
    await scene.open(page, core)
    await shot(page, `${scene.name}-1640`, scene.hover?.(page))
  })

  // Full screen on the 2,560-pixel display, the window zooms its page by 2,560 / 1,640 (the scaling pass spec, section
  // 5): a browser of its own does the same, at 1,640 × 897 and 2,560 / 1,640 device pixels to a pixel, logged in through
  // the launch link. At the page size of 100 the page lays out as the usual window, enlarged.
  test(`ledger: ${scene.name} full screen at 2560, zoomed`, { tag: LEDGER }, async ({ browser, core, api }) => {
    await api.put('/api/settings', { ledger_spent_hidden: false, ...scene.settings })
    const context = await browser.newContext({ viewport: { width: 1640, height: 897 }, deviceScaleFactor: 2560 / 1640 })
    try {
      await context.request.get(core.launch, { maxRedirects: 0 })
      const zoomed = await context.newPage()
      await scene.open(zoomed, core)
      await shot(zoomed, `${scene.name}-2560`, scene.hover?.(zoomed))
    } finally {
      await context.close()
    }
  })
}

// The wide layout (the transactions a feed down the right, the cards in two rows under the chart): a maximized window at the
// page size of 70, which the window zooms by 2,560 / 1,640 × 70% = 1.09, so that the page is 2,343 pixels wide.
test('ledger: primogems full screen at 2560, page size 70', { tag: LEDGER }, async ({ browser, core, api }) => {
  await api.put('/api/settings', { ledger_spent_hidden: false })
  const zoom = (2560 / 1640) * 0.7
  const context = await browser.newContext({
    viewport: { width: Math.round(2560 / zoom), height: Math.round(1400 / zoom) },
    deviceScaleFactor: zoom,
  })
  try {
    await context.request.get(core.launch, { maxRedirects: 0 })
    const wide = await context.newPage()
    await tab('Primogems')(wide, core)
    await shot(wide, 'primogems-2560-size70')
  } finally {
    await context.close()
  }
})

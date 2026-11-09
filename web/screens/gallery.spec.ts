import type { Locator, Page } from '@playwright/test'
import path from 'node:path'
import { SCREENS_OUT } from './out.ts'
import { expect, test, type Core } from '../e2e/fixtures.ts'

/*
 * The gallery and settings pictures, which only `npm run screens:gallery` takes, to be looked at (they were `screens:ledger`'s
 * before the Ledger revamp, which has its own pictures now). Each is what the window shows, in the
 * player's usual window, 1,640 × 1,100, and full screen on their 2,560-pixel display as the window's zoom shows it, once
 * the motion has settled: Stats with the primogems stacked by source and a tooltip; Settings with the overlay's settings open, and its Extras with the gallery on and the price list open; the
 * Gallery's grid and its large view. The demo's history and pictures are made up; nothing in them is the player's.
 */

const FOLDER = path.join(SCREENS_OUT, '2026-10-27-ledger-screens')
const GALLERY = '@gallery'
const DEMO_PICTURES = 24

/** Waits until no animation or transition runs and every counted number shows its value (look pass spec 6.3). */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const moving = document.getAnimations().some((animation) => animation.playState === 'running')
    const counting = [...document.querySelectorAll('span[aria-hidden="true"] + .sr-only')].some(
      (real) => real.previousElementSibling?.textContent !== real.textContent,
    )
    return !moving && !counting
  })
}

/**
 * The window's picture, once the fonts and pictures are in and the motion has settled. With `at`, the window is first
 * scrolled to that element, 12 pixels under its top, as the player scrolls to it; with `hover`, the pointer rests on
 * that element, for its tooltip, else it is out of the window.
 */
async function shot(page: Page, name: string, at?: Locator, hover?: Locator): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.hidden || (image.complete && image.naturalWidth > 0)),
  )
  if (at === undefined) await page.evaluate(() => window.scrollTo(0, 0))
  else await at.evaluate((element) => window.scrollTo(0, Math.max(0, element.getBoundingClientRect().top + window.scrollY - 12)))
  if (hover === undefined) await page.mouse.move(0, 0)
  else await hover.hover()
  await settled(page)
  await page.screenshot({ path: path.join(FOLDER, `${name}.png`) })
}

type Scene = {
  name: string
  /** Opens the page and waits until it has read what it shows. */
  open: (page: Page, core: Core) => Promise<void>
  at?: (page: Page) => Locator
  hover?: (page: Page) => Locator
}

const primogemDays = (page: Page) => page.getByRole('region', { name: 'Primogems earned per day' })
const guildBoardGroup = (page: Page) => page.getByRole('region', { name: 'Guild Board', exact: true })
const extrasGroup = (page: Page) => page.getByRole('region', { name: 'Extras', exact: true })

const openStats = async (page: Page, core: Core) => {
  await page.goto(`${core.origin}/#/stats`)
  await expect(primogemDays(page).locator('.col-item')).toHaveCount(30)
}

const openSettings = async (page: Page, core: Core) => {
  await page.goto(`${core.origin}/#/settings`)
  await expect(page.getByRole('region', { name: 'Extras', exact: true })).toBeVisible()
}

const openGallery = async (page: Page, core: Core) => {
  await page.goto(`${core.origin}/#/gallery`)
  await expect(page.getByTestId('gallery-count')).toHaveText(`${DEMO_PICTURES} photos`, { timeout: 20_000 })
  await expect(page.getByTestId('gallery-tile')).toHaveCount(DEMO_PICTURES)
}

const SCENES: Scene[] = [
  {
    name: 'stats',
    open: openStats,
    at: primogemDays,
    hover: (page) => primogemDays(page).locator('.col-item').nth(2), // 16 Sep, the highest day
  },
  {
    name: 'settings-overlay',
    open: async (page, core) => {
      await openSettings(page, core)
      const group = guildBoardGroup(page)
      await group.getByRole('button', { name: 'Change', exact: true }).click()
      await expect(group.getByRole('group', { name: 'Overlay', exact: true })).toBeVisible()
    },
    at: guildBoardGroup,
  },
  {
    name: 'settings-extras',
    open: async (page, core) => {
      await openSettings(page, core)
      const extras = extrasGroup(page)
      await expect(extras.getByRole('button', { name: 'Screenshot gallery' })).toHaveAttribute('aria-pressed', 'true')
      await extras.getByRole('button', { name: 'Edit prices' }).click()
      await expect(extras.getByRole('group', { name: 'Prices' }).getByRole('spinbutton')).toHaveCount(8)
    },
    at: extrasGroup,
  },
  { name: 'gallery', open: openGallery },
  {
    name: 'gallery-large',
    open: async (page, core) => {
      await openGallery(page, core)
      await page.getByTestId('gallery-tile').first().click()
      await expect(page.getByTestId('gallery-view')).toBeVisible()
      await expect.poll(() => page.getByTestId('gallery-view').locator('img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    },
  },
]

/** The gallery is on for the scenes that show it, and for Settings' Extras. */
const GALLERY_ON = new Set(['settings-extras', 'gallery', 'gallery-large'])

for (const scene of SCENES) {
  test(`gallery: ${scene.name} in the usual window`, { tag: GALLERY }, async ({ page, core, api }) => {
    if (GALLERY_ON.has(scene.name)) {
      await api.put('/api/settings', { gallery_enabled: true })
      await page.reload() // the page fixture loaded the page before the gallery was on
    }
    await page.setViewportSize({ width: 1640, height: 1100 })
    await scene.open(page, core)
    await shot(page, `${scene.name}-1640`, scene.at?.(page), scene.hover?.(page))
  })

  // Full screen on the 2,560-pixel display, the window zooms its page by 2,560 / 1,640 (the scaling pass spec, section
  // 5): a browser of its own does the same, at 1,640 × 897 and 2,560 / 1,640 device pixels to a pixel, logged in through
  // the launch link.
  test(`gallery: ${scene.name} full screen at 2560, zoomed`, { tag: GALLERY }, async ({ browser, core, api }) => {
    if (GALLERY_ON.has(scene.name)) await api.put('/api/settings', { gallery_enabled: true })
    const context = await browser.newContext({ viewport: { width: 1640, height: 897 }, deviceScaleFactor: 2560 / 1640 })
    try {
      await context.request.get(core.launch, { maxRedirects: 0 })
      const zoomed = await context.newPage()
      await scene.open(zoomed, core)
      await shot(zoomed, `${scene.name}-2560`, scene.at?.(zoomed), scene.hover?.(zoomed))
    } finally {
      await context.close()
    }
  })
}

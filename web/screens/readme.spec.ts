import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { tidyOverlay } from './overlay-layout.ts'
import { SCREENS_OUT } from './out.ts'
import { expect, test } from '../e2e/fixtures.ts'

/**
 * The pictures of the public README (the releases repository's), on the demo account: the player's usual window,
 * 1,640 wide, one picture of each page worth showing. Only the tests tagged README write here, and only
 * `npm run screens:readme` runs them.
 */
const FOLDER = path.join(SCREENS_OUT, '2026-10-26-readme-screens')
const README = '@readme'
const SIZE = { width: 1640, height: 1000 }

async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await page.waitForFunction(() => {
    const moving = document.getAnimations().some((animation) => animation.playState === 'running')
    const counting = [...document.querySelectorAll('span[aria-hidden="true"] + .sr-only')].some(
      (real) => real.previousElementSibling?.textContent !== real.textContent,
    )
    const loaded = [...document.images].every((image) => image.hidden || (image.complete && image.naturalWidth > 0))
    return !moving && !counting && loaded
  })
  await page.mouse.move(0, 0) // no tooltip in the picture
}

async function take(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  await settled(page)
  await page.screenshot({ path: path.join(FOLDER, `${name}.png`), clip })
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(SIZE)
})

test('readme: the Board', { tag: README }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/board`)
  await expect(page.locator('[data-widget="start-timers"] li.tm-row').first()).toBeVisible()
  await take(page, 'board')
})

test('readme: Achievements', { tag: README }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/achievements`)
  await expect(page.getByText('of 1,854 ticked')).toBeVisible()
  await take(page, 'achievements')
})

test('readme: Pulls', { tag: README }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/pulls`)
  await expect(page.getByTestId('pity-card')).toHaveCount(4)
  await expect(page.getByTestId('history-row')).toHaveCount(100)
  await take(page, 'pulls')
})

test('readme: Stats', { tag: README }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats`)
  await expect(page.getByText('Exploration gained')).toBeVisible()
  // The whole page at the usual width: from the title, the tabs and the tiles down to the whole Endgame card. The page is
  // scrolled to its foot first, so that the card has come into view and played its motion; then the window is made as tall
  // as the page, so that the rail runs its whole height, and the picture is the window's.
  const endgame = page.getByRole('region', { name: 'Endgame' })
  await expect(endgame.getByTestId('ec-stygian')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await settled(page)
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.setViewportSize({ width: SIZE.width, height })
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
  await take(page, 'stats')
})

test('readme: the Year', { tag: README }, async ({ page, core }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }) // Wrapped at rest: its counters at their values
  await page.goto(`${core.origin}/#/stats/year`)
  await expect(page.getByTestId('year-hero')).toBeVisible()
  await expect(page.getByTestId('year-card').first()).toBeVisible()
  await take(page, 'year')
})

test('readme: Backlog', { tag: README }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/backlog`)
  await expect(page.getByText('Unfinished regions')).toBeVisible()
  await take(page, 'backlog')
})

test('readme: gift codes', { tag: README }, async ({ page, core }) => {
  await page.goto(`${core.origin}/#/codes`)
  await expect(page.getByTestId('codes-history')).toContainText('DEMOGIFT1')
  await take(page, 'codes', { x: 580, y: 70, width: 630, height: 430 })
})

/*
 * The overlay, laid out tidily for the picture alone (overlay-layout.ts, on this test's own core), over the maintainer's photograph
 * from the game when GB_OVERLAY_BACKGROUND names it, as the site's picture is, else over a gradient. The photograph is never kept
 * in this repository.
 */
test('readme: the overlay over the game', { tag: README }, async ({ page, core, api }) => {
  await tidyOverlay(api)
  await page.setViewportSize({ width: 1640, height: 680 })
  await page.goto(`${core.origin}/#/overlay/open`)
  await expect(page.locator('[data-widget="pic-timers"] li.tm-row').first()).toBeVisible()
  await expect(page.locator('[data-widget="pic-commissions"] li')).not.toHaveCount(0)
  const photograph = process.env.GB_OVERLAY_BACKGROUND
  const background =
    photograph === undefined || photograph === ''
      ? 'linear-gradient(135deg, #0B1020 0%, #1E2A3A 55%, #26331F 100%) fixed'
      : `url(data:image/png;base64,${readFileSync(photograph).toString('base64')}) -230px 0 / 2000px 1125px no-repeat fixed`
  await page.evaluate((value) => {
    document.documentElement.style.background = value
  }, background)
  await take(page, 'overlay')
})

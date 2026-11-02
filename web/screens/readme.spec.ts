import type { Page } from '@playwright/test'
import path from 'node:path'
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
  await take(page, 'stats')
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

test('readme: the overlay over a stand-in for the game', { tag: README }, async ({ page, core }) => {
  await page.setViewportSize({ width: 1640, height: 680 })
  await page.goto(`${core.origin}/#/overlay/open`)
  await expect(page.locator('[data-widget="start-ov-timers"] li.tm-row').first()).toBeVisible()
  await page.evaluate(() => {
    document.documentElement.style.background = 'linear-gradient(135deg, #0B1020 0%, #1E2A3A 55%, #26331F 100%) fixed'
  })
  await take(page, 'overlay')
})

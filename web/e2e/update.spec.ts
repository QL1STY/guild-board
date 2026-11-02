import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Status } from '../src/types.ts'
import { expect, test } from './fixtures.ts'

/** The newest notes, which the demo's notice shows (core.py, demo_update): the first entry of the list of changes. */
type Item = { kind: 'new' | 'better' | 'fixed' | null; title: string; text: string }
const changesFile = fileURLToPath(new URL('../../src/guildboard/reference/changes.json', import.meta.url))
const [NEWEST, ITEMS] = Object.entries(JSON.parse(readFileSync(changesFile, 'utf-8')) as Record<string, Item[]>)[0]

/** The demo core shows the notice of a newer Guild Board on request (api/app.py, /api/demo/update). */
const notice = (page: Page) => page.getByTestId('update-notice')
const modal = (page: Page) => page.getByTestId('changes-modal')

test('a newer version shows at the bottom of the page until it is installed, with no way to close it', async ({ page, api, core }) => {
  await expect(notice(page)).toHaveCount(0)
  await api.post('/api/demo/update', { state: 'available' })
  await expect(notice(page)).toBeVisible()
  await expect(notice(page)).toContainText(`A new Guild Board is ready: ${NEWEST}`)
  await expect(page.getByTestId('update-sub')).toHaveText(ITEMS[0].title)
  await expect(notice(page).getByRole('button')).toHaveText(["What's new", 'Update now'])
  // At the bottom centre of the page area, which starts after the rail.
  const box = (await notice(page).boundingBox())!
  const rail = (await page.getByRole('navigation', { name: 'Pages' }).boundingBox())!
  const view = page.viewportSize()!
  expect(view.height - (box.y + box.height)).toBeGreaterThan(10)
  expect(view.height - (box.y + box.height)).toBeLessThan(40)
  expect(Math.abs(box.x + box.width / 2 - (rail.width + (view.width - rail.width) / 2))).toBeLessThan(4)
  // It follows the player to another page, and stays.
  await page.goto(`${core.origin}/#/stats`)
  await expect(notice(page)).toBeVisible()
})

test('the notice shows the download, the restart and a failure that can be tried again', async ({ page, api }) => {
  await api.post('/api/demo/update', { state: 'downloading' })
  await expect(page.getByTestId('update-sub')).toHaveText('Downloading… 62 %')
  await expect(notice(page).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '62')
  await expect(notice(page).getByRole('button', { name: 'Update now' })).toBeDisabled()
  await api.post('/api/demo/update', { state: 'installing' })
  await expect(page.getByTestId('update-sub')).toHaveText('Restarting…')
  await expect(notice(page).getByRole('progressbar')).toHaveCount(0)
  await api.post('/api/demo/update', { state: 'failed' })
  await expect(page.getByTestId('update-sub')).toContainText('could not be downloaded')
  await expect(notice(page).getByRole('button', { name: 'Update now' })).toBeEnabled()
})

test('What\'s new opens the list over the page area alone, and Later and Escape close it', async ({ page, api }) => {
  await api.post('/api/demo/update', { state: 'available' })
  await notice(page).getByRole('button', { name: "What's new" }).click()
  await expect(modal(page)).toBeVisible()
  await expect(modal(page).getByRole('heading', { name: `Guild Board ${NEWEST}` })).toBeVisible()
  await expect(modal(page)).toContainText('Released 26 October 2026')
  const items = modal(page).locator('.chg-item')
  await expect(items).toHaveCount(ITEMS.length)
  await expect(modal(page).locator('.chg-tag')).toHaveText(ITEMS.flatMap((item) => (item.kind === null ? [] : [item.kind.toUpperCase()])))
  await expect(items.first()).toContainText(ITEMS[0].text)
  await expect(modal(page).getByRole('button')).toHaveText(['Later', 'Update now'])
  // The items come in one after another, and have all arrived a moment later.
  await expect(items.last()).toHaveCSS('opacity', '1')
  // The dim covers the page area and leaves the rail alone: the rail's links take the pointer.
  const rail = (await page.getByRole('navigation', { name: 'Pages' }).boundingBox())!
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('nav') !== null, [20, 300])).toBe(true)
  const dim = (await page.getByTestId('changes-dim').boundingBox())!
  expect(Math.round(dim.x)).toBe(Math.round(rail.width))
  await page.keyboard.press('Escape')
  await expect(modal(page)).toHaveCount(0)
  await expect(notice(page)).toBeVisible() // Later leaves the notice
  await notice(page).getByRole('button', { name: "What's new" }).click()
  await page.getByTestId('changes-dim').click({ position: { x: 20, y: 20 } })
  await expect(modal(page)).toHaveCount(0)
  await notice(page).getByRole('button', { name: "What's new" }).click()
  await modal(page).getByRole('button', { name: 'Later' }).click()
  await expect(modal(page)).toHaveCount(0)
})

test('Update now in the list starts the update as the notice does', async ({ page, api }) => {
  await api.post('/api/demo/update', { state: 'available' })
  await notice(page).getByRole('button', { name: "What's new" }).click()
  await modal(page).getByRole('button', { name: 'Update now' }).click()
  await expect(modal(page)).toHaveCount(0)
  // The demo downloads nothing, so the update fails there as an offline player's does.
  await expect(page.getByTestId('update-sub')).toContainText('could not be downloaded')
  expect((await api.get<Status>('/api/status')).update.state).toBe('failed')
})

test('the undo note stands just above the notice and does not overlap it', async ({ page, api, core }) => {
  await api.post('/api/demo/update', { state: 'available' })
  await page.goto(`${core.origin}/#/achievements`)
  const letter = page.getByRole('article', { name: "Winter Night's Letter" })
  await letter.getByRole('checkbox', { name: 'Done: Complete "Secret Tsarist Assignment: Part I."' }).check()
  const note = page.getByTestId('note')
  await expect(note).toBeVisible()
  await expect(note).toHaveCSS('opacity', '1')
  const above = (await note.boundingBox())!
  const toast = (await notice(page).boundingBox())!
  expect(above.y + above.height).toBeLessThanOrEqual(toast.y)
})

test('after an update the list opens by itself with one button, and does not come back once seen', async ({ page, api }) => {
  await api.post('/api/demo/whats-new')
  await expect(modal(page)).toBeVisible()
  await expect(modal(page)).toHaveAttribute('data-mode', 'after')
  await expect(modal(page).getByRole('button')).toHaveText(['Got it'])
  await expect(modal(page)).not.toContainText('Released') // the core knows no date for an installed version
  await page.keyboard.press('Escape') // Escape is Got it
  await expect(modal(page)).toHaveCount(0)
  expect((await api.get<Status>('/api/status')).whats_new).toBeNull()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(modal(page)).toHaveCount(0)
})

test('the demo has redeemed codes, so the Codes page asks for no login first', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/codes`)
  await expect(page.getByTestId('codes-primogems')).toBeVisible()
  await expect(page.getByTestId('codes-login-first')).toHaveCount(0)
  await expect(page.getByLabel('Codes')).toBeEnabled()
})

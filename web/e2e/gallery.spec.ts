import type { Page } from '@playwright/test'
import type { GalleryModel } from '../src/pages/galleryview.ts'
import { expect, test } from './fixtures.ts'

/** The demo's pictures (gallery.py, fill_demo_folder): 24 over the three months before the demo's now. */
const DEMO_COUNT = 24

/**
 * Waits until the thumbnails in sight have loaded: the core makes them on request, and a core stopped while it writes
 * one would leave its data folder busy.
 */
async function thumbnailsLoaded(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('.ga-tile img')]
          .filter((img) => img.getBoundingClientRect().top < window.innerHeight)
          .every((img) => img.complete),
      ),
    )
    .toBe(true)
  await page.waitForLoadState('networkidle')
}

test('gallery hidden in the rail until switched on', async ({ page, core, api }) => {
  await page.goto(`${core.origin}/#/board`)
  const rail = page.getByRole('navigation', { name: 'Pages' })
  await expect(rail.getByRole('link', { name: 'Settings' })).toBeVisible()
  await expect(rail.getByRole('link', { name: 'Gallery' })).toHaveCount(0)
  expect(await api.get('/api/gallery')).toEqual({ enabled: false })
  // Its address opens Settings while it is off.
  await page.goto(`${core.origin}/#/gallery`)
  await expect(page).toHaveURL(/#\/settings$/)
  await api.put('/api/settings', { gallery_enabled: true })
  await page.reload()
  await expect(rail.getByRole('link', { name: 'Gallery' })).toBeVisible()
  // Between Pulls and Settings.
  const names = await rail.getByRole('link').allTextContents()
  expect(names.indexOf('Gallery')).toBe(names.indexOf('Settings') - 1)
  await rail.getByRole('link', { name: 'Gallery' }).click()
  await expect(page).toHaveURL(/#\/gallery$/)
  await expect(page.getByTestId('gallery-count')).toHaveText(`${DEMO_COUNT} photos`, { timeout: 20_000 })
  await thumbnailsLoaded(page)
})

test.describe('with the gallery on', () => {
  test.beforeEach(async ({ page, core, api }) => {
    await api.put('/api/settings', { gallery_enabled: true })
    await page.reload() // the page fixture loaded the page before the gallery was on
    await page.goto(`${core.origin}/#/gallery`)
    // The demo makes its pictures the first time its gallery looks, which takes a moment with other cores running.
    await expect(page.getByTestId('gallery-count')).toHaveText(`${DEMO_COUNT} photos`, { timeout: 20_000 })
  })

  test.afterEach(async ({ page }) => {
    await thumbnailsLoaded(page)
  })

  test('grid shows demo photos by month', async ({ page, api }) => {
    await expect(page.getByTestId('gallery-count')).toHaveText(`${DEMO_COUNT} photos`)
    const model = await api.get<GalleryModel>('/api/gallery')
    if (!model.enabled) throw new Error('the gallery is off')
    expect(model.months.length).toBeGreaterThanOrEqual(3)
    const headings = page.locator('.ga-month-h')
    await expect(headings).toHaveCount(model.months.length)
    await expect(headings.first()).toContainText(model.months[0].label)
    await expect(headings.first()).toContainText(`${model.months[0].pictures.length} photo`)
    await expect(page.getByTestId('gallery-tile')).toHaveCount(DEMO_COUNT)
    // Newest first, and a thumbnail of the core's, loaded.
    const first = page.getByTestId('gallery-tile').first()
    await expect(first).toHaveAttribute('data-id', model.months[0].pictures[0].id)
    await expect(first).toContainText(model.months[0].pictures[0].time)
    await expect.poll(() => first.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480)
    // Five across in the usual window.
    const tops = await page
      .getByTestId('gallery-tile')
      .evaluateAll((tiles) => tiles.slice(0, 6).map((tile) => Math.round(tile.getBoundingClientRect().top)))
    expect(tops.filter((top) => top === tops[0]).length).toBeGreaterThanOrEqual(4)
  })

  test('large view opens, arrows move, Esc closes', async ({ page, api }) => {
    const model = await api.get<GalleryModel>('/api/gallery')
    if (!model.enabled) throw new Error('the gallery is off')
    const [one, two] = model.months.flatMap((month) => month.pictures)
    await page.getByTestId('gallery-tile').first().click()
    const view = page.getByTestId('gallery-view')
    await expect(view).toBeVisible()
    await expect(page.getByTestId('gallery-taken')).toHaveText(one.when)
    await expect(page.getByTestId('gallery-size')).toHaveText(/^(1600 × 900|960 × 540)$/)
    await expect(view.getByRole('button', { name: 'Previous photo' })).toBeDisabled()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('gallery-taken')).toHaveText(two.when)
    await view.getByRole('button', { name: 'Previous photo' }).click()
    await expect(page.getByTestId('gallery-taken')).toHaveText(one.when)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('gallery-taken')).toHaveText(one.when)
    await page.keyboard.press('Escape')
    await expect(view).toHaveCount(0)
    // A click on the dim closes it too.
    await page.getByTestId('gallery-tile').nth(1).click()
    await expect(page.getByTestId('gallery-taken')).toHaveText(two.when)
    await page.getByTestId('gallery-dim').click({ position: { x: 5, y: 5 } })
    await expect(view).toHaveCount(0)
  })

  test('favourite persists after reload', async ({ page }) => {
    const second = page.getByTestId('gallery-tile').nth(1)
    const id = await second.getAttribute('data-id')
    await second.click()
    const favourite = page.getByTestId('gallery-view').getByRole('button', { name: /Favourite/ })
    await expect(favourite).toHaveAttribute('aria-pressed', 'false')
    await favourite.click()
    await expect(favourite).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(page.locator(`[data-id="${id}"] .ga-star`)).toBeVisible()
    await page.reload()
    // The reloaded page lists the folder again, which takes a moment with other cores running.
    await expect(page.locator(`[data-id="${id}"] .ga-star`)).toBeVisible({ timeout: 20_000 })
    await page.getByRole('radio', { name: 'Favourites' }).click()
    await expect(page.getByTestId('gallery-tile')).toHaveCount(1)
    await expect(page.getByTestId('gallery-tile')).toHaveAttribute('data-id', id ?? '')
  })

  test('copy picture puts a PNG on the clipboard', async ({ page, context, core }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: core.origin })
    await page.getByTestId('gallery-tile').first().click()
    await page.getByRole('button', { name: 'Copy picture' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible()
    const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types))
    expect(types).toContain('image/png')
  })

})

test('an unknown picture is not served', async ({ page, core, api }) => {
  await api.put('/api/settings', { gallery_enabled: true })
  await api.post('/api/gallery/rescan') // the listing, of the demo's own pictures
  for (const id of ['..%5Cguildboard.db', 'C%3A%5Cx.png', 'unknown.png', '..']) {
    const answer = await page.request.get(`${core.origin}/api/gallery/${id}/full`)
    expect(answer.status()).toBe(404)
  }
})

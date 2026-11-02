import { expect, test } from './fixtures.ts'

/*
 * The window's engine does not collect the pages left behind by itself, and the shell gives the page `gbCollect` to ask with
 * (ui/collect.ts, shell/app.py). Edge has no `gbCollect`, so this one stands in for it, and counts.
 */
test('a page change asks for one collection once the new page has settled', async ({ page, core }) => {
  await page.addInitScript(() => {
    const counting = window as unknown as { gbCollect: () => void; asked: number }
    counting.asked = 0
    counting.gbCollect = () => {
      counting.asked += 1
    }
  })
  await page.goto(`${core.origin}/#/stats`)
  await page.reload() // the address only changed its fragment: the script above runs with a new document
  await expect(page.locator('.gb-main').first()).toBeVisible()
  const asked = () => page.evaluate(() => (window as unknown as { asked: number }).asked)
  await expect.poll(asked, { timeout: 5_000 }).toBe(1)
  await page.evaluate(() => (window.location.hash = '#/board'))
  await page.evaluate(() => (window.location.hash = '#/characters'))
  await expect(page.locator('.cr-card').first()).toBeVisible()
  await expect.poll(asked, { timeout: 5_000 }).toBe(2)
  await page.waitForTimeout(500)
  expect(await asked()).toBe(2) // two changes in a row cost one
})

import { expect, test } from './fixtures.ts'

// The core of an e2e test has no Guild Board window, so the map itself is not drawn: the page says so, and the tabs work.
test.beforeEach(async ({ page, core }) => {
  await page.goto(`${core.origin}/#/map`)
})

test('the page opens with one tab, and says where the map shows', async ({ page }) => {
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('tab').first()).toContainText('Map')
  await expect(page.getByTestId('map-area')).toContainText('The map shows in the Guild Board window')
  await expect(page.getByTestId('map-account')).toContainText('Demo data')
})

test('tabs open, are named, duplicated, closed and opened again', async ({ page }) => {
  await page.getByRole('button', { name: 'New tab' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab').nth(1).dblclick()
  await page.getByLabel('Tab name').fill('Fishing')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab').nth(1)).toContainText('Fishing')
  await page.getByRole('tab').nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()
  await expect(page.getByRole('tab')).toHaveCount(3)
  await expect(page.getByRole('tab').nth(2)).toContainText('Fishing 2')
  await page.getByRole('button', { name: 'Close Fishing 2' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.getByRole('button', { name: 'Reopen closed tab' }).click()
  await expect(page.getByRole('tab')).toHaveCount(3)
})

test('a rename is sent once on Enter, and Esc sends none', async ({ page }) => {
  const renames: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PUT' && /\/api\/map\/tabs\/\d+$/.test(request.url())) renames.push(request.postData() ?? '')
  })
  await page.getByRole('tab').first().dblclick()
  await page.getByLabel('Tab name').fill('Fishing')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab').first()).toContainText('Fishing')
  await page.getByRole('tab').first().dblclick()
  await page.getByLabel('Tab name').fill('Exploring')
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Tab name')).toHaveCount(0)
  await page.getByRole('button', { name: 'New tab' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  expect(renames).toEqual([JSON.stringify({ name: 'Fishing' })])
  await expect(page.getByRole('tab').first()).toContainText('Fishing')
})

test('closing the last tab leaves a fresh one', async ({ page }) => {
  await page.getByRole('button', { name: /^Close/ }).click()
  await expect(page.getByRole('tab')).toHaveCount(1)
})

test('Wide takes the rail and the title away, and brings them back', async ({ page }) => {
  await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible()
  await page.getByRole('button', { name: 'Wide: hide the rail and the title' }).click()
  await expect(page.getByRole('navigation', { name: 'Pages' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Show the rail and the title' }).click()
  await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible()
})

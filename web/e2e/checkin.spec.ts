import { setBoard, widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'

/* The daily check-in widget on the demo's Board: its made-up month, and the one press that claims the day. */

const widget = (id: string, w: number, h: number) => ({ id, type: 'checkin', w, h, settings: {} })

test('one press claims the day, and the widget says when the next one is', async ({ page, api }) => {
  await setBoard(api, page, [widget('checkin-1', 5, 3)])
  const card = widgetById(page, 'checkin-1')
  await expect(card.getByRole('button', { name: 'Claim' })).toBeVisible()
  await expect(card.locator('.w-head')).toContainText('11 of 30')
  await expect(card.locator('.checkin-day')).toHaveCount(30)
  await expect(card.locator('.checkin-day[data-state="claimed"]')).toHaveCount(11)
  await expect(card.locator('.checkin-day[data-state="today"]')).toHaveCount(1)

  await card.getByRole('button', { name: 'Claim' }).click()
  await expect(card.getByRole('button', { name: 'Claim' })).toBeHidden()
  await expect(card.locator('.w-head')).toContainText('12 of 30')
  await expect(card.locator('.checkin-day[data-state="claimed"]')).toHaveCount(12)
  await expect(card.locator('.checkin-day[data-state="today"]')).toHaveCount(0)
  await expect(card.getByText(/^Next reward in /)).toBeVisible()
  await expect(card.locator('.checkin-sparks')).toHaveCount(1)

  // The day stays claimed for a page opened afterwards, which plays nothing.
  await page.reload()
  await expect(card.getByText(/^Next reward in /)).toBeVisible()
  await expect(card.locator('.checkin-sparks')).toHaveCount(0)
})

test('at its smallest it is the reward and the button alone, without running over its frame', async ({ page, api }) => {
  await setBoard(api, page, [widget('checkin-1', 2, 2)])
  const card = widgetById(page, 'checkin-1')
  const claim = card.getByRole('button', { name: 'Claim' })
  await expect(claim).toBeVisible()
  await expect(card.locator('.checkin-month')).toBeHidden()
  const [frame, button] = await Promise.all([card.boundingBox(), claim.boundingBox()])
  expect(button!.x + button!.width).toBeLessThanOrEqual(frame!.x + frame!.width)
  expect(button!.y + button!.height).toBeLessThanOrEqual(frame!.y + frame!.height)
})

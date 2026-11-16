import { layoutOf, PLAY_WEEK, playAs, setBoard, widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'

/*
 * The Playtime widget's time in all (the widgets polish mockup, section 3): the total Guild Board counted, and the day it
 * began, beside the session in quiet figures by default and on a gold plate in the other style. The tests show the widget
 * the game as playAs has it, not as this PC has it.
 */

// Noon UTC is the same calendar day on every PC the tests may run on.
const TOTAL = { minutes: 412 * 60 + 20, since: '2025-10-03T12:00:00Z' }
const playtime = (w: number, h: number, settings: Record<string, unknown> = {}, id = 'play') => ({ id, type: 'playtime', w, h, x: 0, y: 0, settings })

test('a widget saved with no settings shows the total in quiet figures beside the session at 2 × 1, and says from when', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await playAs(page, { running: false, started: null, last: 93, week: PLAY_WEEK, total: TOTAL })
  await setBoard(api, page, [playtime(2, 1)])
  const frame = widgetById(page, 'play')
  await expect(frame.locator('[data-centre] .seal')).toHaveText('Not playing') // the widget as it was
  await expect(frame.locator('.w-meta')).toHaveText('Today 45 min')
  const total = frame.locator('.play-total')
  await expect(total.locator('.fig')).toHaveText('412h')
  await expect(total).toContainText('in all')
  await expect(total).toContainText('since 3 Oct 2025')
  await expect(total.locator('.sr-only')).toHaveText('412 hours in all, counted by Guild Board since 3 Oct 2025')
  await expect(frame.locator('.play-foot')).toBeHidden()
  expect((await layoutOf(api)).widgets[0].settings).toEqual({})
})

test('at 2 × 2 the total is a line at the foot with the day it began, and at 3 × 1 it stands beside the week', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await playAs(page, { running: false, started: null, last: 93, week: PLAY_WEEK, total: TOTAL })
  await setBoard(api, page, [playtime(2, 2, {}, 'tall'), playtime(3, 1, {}, 'wide')])
  const tall = widgetById(page, 'tall')
  await expect(tall.locator('.play-foot')).toContainText('412 h in all · counted since 3 Oct 2025')
  await expect(tall.locator('.play-total')).toBeHidden()
  const wide = widgetById(page, 'wide')
  await expect(wide.locator('.play-total')).toBeVisible()
  await expect(wide.locator('.play-foot')).toBeHidden()
  const [week, total] = await Promise.all([wide.locator('.play-week').boundingBox(), wide.locator('.play-total').boundingBox()])
  expect(total!.x).toBeGreaterThanOrEqual(week!.x + week!.width - 0.5)
})

test('before Guild Board counted a session there is no total and no line about it', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await playAs(page, { running: false, started: null, last: null, week: PLAY_WEEK })
  await setBoard(api, page, [playtime(2, 1, {}, 'a'), playtime(2, 2, { style: 'plate' }, 'b')])
  for (const id of ['a', 'b']) {
    const frame = widgetById(page, id)
    await expect(frame.locator('[data-centre] .seal')).toHaveText('Not playing')
    await expect(frame.locator('.play-total, .play-foot, .pl.gold')).toHaveCount(0)
  }
})

test('the gold plate holds the session on one plate and the total on a gold one, and at 2 × 2 says from when', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await playAs(page, { running: true, started: new Date(Date.now() - 42 * 60_000).toISOString(), last: 93, week: PLAY_WEEK, total: TOTAL })
  await setBoard(api, page, [playtime(2, 1, { style: 'plate' }, 'small'), playtime(2, 2, { style: 'plate' }, 'big')])
  const small = widgetById(page, 'small')
  await expect(small.locator('.play-plates .pl')).toHaveCount(2)
  await expect(small.locator('.pl .seal')).toHaveText('Playing now')
  await expect(small.locator('.pl.gold')).toContainText('In all')
  await expect(small.locator('.pl.gold .fig')).toHaveText('412h')
  await expect(small.locator('.play-total')).toHaveCount(0)
  const big = widgetById(page, 'big')
  await expect(big.locator('.play-foot')).toHaveText('Counted by Guild Board since 3 Oct 2025')
  await expect(big.locator('.play-week')).toBeVisible()
})

test('a Playtime widget chooses its style in Settings, and the choice is kept', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await playAs(page, { running: false, started: null, last: 93, week: PLAY_WEEK, total: TOTAL })
  await setBoard(api, page, [playtime(2, 1)])
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await widgetById(page, 'play').getByRole('button', { name: 'Settings of Playtime' }).click()
  const sheet = page.getByRole('region', { name: 'Settings of Playtime' })
  await expect(sheet.getByRole('radio', { name: 'Quiet figures' })).toHaveAttribute('aria-checked', 'true')
  await sheet.getByRole('radio', { name: 'Gold plate' }).click()
  await expect(widgetById(page, 'play').locator('.pl.gold')).toBeVisible()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  expect((await layoutOf(api)).widgets[0].settings).toEqual({ style: 'plate' })
})

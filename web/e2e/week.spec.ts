import { clockWidget, setBoard, widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'

/*
 * Your week and the Today widget against the demo core (the Characters plan, Task U9). The core starts on Sunday 25
 * October 2026 at 08:00 UTC, the day before the weekly reset, with Sandrone, Odette, Alyosha and Jahoda in the focus.
 */
test.use({ viewport: { width: 1640, height: 1100 }, demoNow: '2026-10-25T08:00:00+00:00' })

type Week = { focus: { key: string }[]; today: { day: string; tasks: { key: string; done: boolean }[] } }

test("the week's Sunday has its steps and the loud alert, and a tick stays ticked after a reload", async ({ page, core, api }) => {
  await page.goto(`${core.origin}/#/week`)
  const sunday = page.locator('.wk-sec[data-sec="0"]')
  await expect(sunday.locator('.wk-date')).toContainText('Today, Sunday 25 October')
  await expect(sunday.locator('.wk-alert')).toHaveText('Weekly bosses reset tomorrow at 04:00: do them today.')
  await expect(sunday.locator('.wk-step').first()).toContainText('The Doctor, weekly boss')
  const first = sunday.locator('.wk-tick').first()
  await expect(first).toHaveAttribute('aria-pressed', 'false')
  await first.click()
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(page.locator('.wk-sec[data-sec="0"] .wk-tick').first()).toHaveAttribute('aria-pressed', 'true')
  const week = await api.get<Week>('/api/week')
  expect(week.today.tasks.filter((task) => task.done)).toHaveLength(1)
  // A step of another day has no tick: the core takes a tick for today's steps only.
  await expect(page.locator('.wk-sec[data-sec="1"] .wk-tick')).toHaveCount(0)
})

test('a focus card moves up with its arrow, and the plan serves her first, still so after a reload', async ({ page, core, api }) => {
  await page.goto(`${core.origin}/#/week`)
  const cards = page.locator('[data-testid="week-focus"] .wk-fc-text b')
  await expect(cards.first()).toHaveText('1. Sandrone')
  await page.getByRole('button', { name: 'Plan Odette earlier' }).click()
  await expect(cards.first()).toHaveText('1. Odette')
  await expect(cards.nth(1)).toHaveText('2. Sandrone')
  expect((await api.get<Week>('/api/week')).focus.map((one) => one.key).slice(0, 2)).toEqual(['odette', 'sandrone'])
  await page.reload()
  await expect(page.locator('[data-testid="week-focus"] .wk-fc-text b').first()).toHaveText('1. Odette')
})

test('with four in the focus the list says so at its top, and a fifth cannot be picked', async ({ page, core, api }) => {
  await page.goto(`${core.origin}/#/week`)
  await page.getByRole('button', { name: 'Add a character' }).click()
  const list = page.getByRole('dialog', { name: 'Add a character' })
  await expect(list.locator('.wk-full')).toHaveText('Four at most: take one out first.')
  await list.getByRole('searchbox').fill('flin')
  const flins = list.getByRole('button', { name: /Flins/ })
  await expect(flins).toHaveAttribute('aria-disabled', 'true')
  await flins.click({ force: true }) // a press anyway: Playwright waits for a button marked disabled otherwise
  await expect(list).toBeVisible()
  expect((await api.get<Week>('/api/week')).focus).toHaveLength(4)
})

test('the cross takes a character out and gives the focus to Add a character, and it sits clear of the arrows and the text', async ({ page, core, api }) => {
  await page.goto(`${core.origin}/#/week`)
  // The cross sits in the corner, above the arrows, and the ready line keeps the one line it had before the cross.
  const sandrone = page.locator('[data-testid="week-focus"] .wk-fc').first()
  const cross = await sandrone.locator('.wk-out').boundingBox()
  const up = await sandrone.locator('.wk-ord button').first().boundingBox()
  expect(cross!.y + cross!.height).toBeLessThanOrEqual(up!.y)
  await expect(sandrone.locator('.when')).toHaveText('Ready Mon 26 Oct; the goblet is luck')
  expect((await sandrone.locator('.when').boundingBox())!.height).toBeLessThan(24)
  await page.getByRole('button', { name: 'Take Jahoda out of the focus' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Room for one more')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Add a character' })).toBeFocused()
  expect((await api.get<Week>('/api/week')).focus.map((one) => one.key)).toEqual(['sandrone', 'odette', 'alyosha'])
})

test('a week with no focus says to choose a character once, with no empty slots, chart or grid', async ({ page, core, api }) => {
  await api.put('/api/focus', { characters: [] })
  await page.goto(`${core.origin}/#/week`)
  await expect(page.getByText('Choose up to four characters to plan for.')).toHaveCount(1)
  await expect(page.getByText('Room for one more')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'When each is ready' })).toHaveCount(0)
  await expect(page.locator('.wk-week')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Add a character' })).toBeVisible()
})

test('the focus shows its four places and one Add a character button, whose list is searched, marks the focus and adds one', async ({ page, core, api }) => {
  await page.goto(`${core.origin}/#/week`)
  await expect(page.locator('.wk-rc')).toHaveCount(0)
  await expect(page.locator('[data-testid="week-focus"] .wk-fc')).toHaveCount(4)
  const opener = page.getByRole('button', { name: 'Add a character' })
  await expect(opener).toHaveAttribute('aria-expanded', 'false')
  await opener.click()
  const list = page.getByRole('dialog', { name: 'Add a character' })
  await expect(list.getByRole('searchbox', { name: 'Search characters' })).toBeFocused()
  // The ones the player has come first, then the rest greyed as pre-farm; the four in the focus are marked.
  const options = list.locator('.wk-opt')
  expect(await options.count()).toBeGreaterThan(6)
  await expect(list.locator('.wk-opt.in')).toHaveCount(4)
  const owned = await list.locator('.wk-opt:not(.pre)').count()
  const first = await list.locator('.wk-opt.pre').first().evaluate((el) => [...el.parentElement!.parentElement!.children].indexOf(el.parentElement!))
  expect(first).toBe(owned)
  await expect(list.locator('.wk-opt.pre').first()).toContainText('Pre-farm')
  // Searching narrows the list; Esc shuts it and gives the focus back to the button.
  await list.getByRole('searchbox').fill('flin')
  await expect(options).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(opener).toBeFocused()
  // Take one out, then add Flins.
  await page.getByRole('button', { name: 'Take Jahoda out of the focus' }).click()
  await expect(page.locator('[data-testid="week-focus"] .wk-fc')).toHaveCount(4)
  await expect(page.getByText('Room for one more')).toHaveCount(1)
  await opener.click()
  await list.getByRole('searchbox').fill('flin')
  await list.getByRole('button', { name: /Flins/ }).click()
  await expect(list).toHaveCount(0)
  await expect(page.locator('[data-testid="week-focus"] .wk-fc-text b').nth(3)).toHaveText('4. Flins')
  expect((await api.get<Week>('/api/week')).focus.map((one) => one.key)).toEqual(['sandrone', 'odette', 'alyosha', 'flins'])
})

test("opening a day in the grid scrolls the agenda to it, and scrolling the agenda moves the grid's frame", async ({ page, core }) => {
  await page.goto(`${core.origin}/#/week`)
  const agenda = page.locator('.wk-agenda')
  await page.locator('.wk-dh[data-d="3"]').click()
  await expect(page.locator('.wk-sec[data-sec="3"]')).toHaveClass(/on/)
  await expect.poll(() => agenda.evaluate((box) => box.scrollTop)).toBeGreaterThan(300)
  // The agenda's own scroll to that day goes on for a moment, in which it does not move the frame back.
  await page.waitForTimeout(900)
  await agenda.evaluate((box) => {
    box.scrollTop = 0
  })
  await expect(page.locator('.wk-sec[data-sec="0"]')).toHaveClass(/on/)
  await expect(page.locator('.wk-dh[data-d="0"]')).toHaveAttribute('aria-current', 'date')
})

test("the Today widget on the Board shows today's steps and shares its ticks with the week", async ({ page, core, api }) => {
  await setBoard(api, page, [clockWidget('c1'), { id: 'today1', type: 'today', w: 3, h: 3, settings: {} }])
  const widget = widgetById(page, 'today1')
  await expect(widget.locator('.td-row').first()).toContainText('The Doctor, weekly boss')
  await expect(widget).toContainText('0 of 5 done')
  await widget.getByRole('checkbox', { name: /The Doctor, weekly boss/ }).click()
  await expect(widget).toContainText('1 of 5 done')
  await page.goto(`${core.origin}/#/week`)
  await expect(page.locator('.wk-sec[data-sec="0"] .wk-tick').first()).toHaveAttribute('aria-pressed', 'true')
})

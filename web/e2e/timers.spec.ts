import type { Locator, Page } from '@playwright/test'
import type { Status, Timer, TimersModel } from '../src/types.ts'
import { changeAnswer, holding } from './answers.ts'
import { type Api, expect, test } from './fixtures.ts'

/*
 * The demo at its 08:00 UTC: Teapot · Jade Field and Fishing spot · Luhua Pool are ready; the Unusual Hilichurl (ready
 * at 18:00), Teapot · Luxuriant Glebe, Teapot · Orderly Meadow (on a Set ready time) and Fishing spot · Cider Lake (1)
 * run; the player's own Parametric Transformer and Shrine visits (2 of 3 visits) run too.
 */
test.beforeEach(async ({ page, core }) => {
  await page.goto(`${core.origin}/#/achievements/timers`)
})

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FISHING_NOTE = 'Guides disagree, so Settings → Achievements can change this for every fishing spot.'

const categories = (page: Page) => page.getByRole('navigation', { name: 'Categories' })
/** What the undo note says (ui/note.tsx), without its button. */
const noteText = (page: Page) => page.getByTestId('note').locator('.note-text')
const title = (page: Page) => page.getByRole('heading', { level: 2 })
/** One of the Timers category's groups: Ready now, Running or Your own timers. */
const group = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const groupHeading = (page: Page, name: string) => group(page, name).getByRole('heading', { level: 3 })
/** A timer's card, by the timer's name. */
const card = (scope: Page | Locator, name: string) => scope.getByRole('article', { name, exact: true })
const stateOf = (timer: Locator) => timer.getByTestId('timer-state')
const button = (timer: Locator, name: string) => timer.getByRole('button', { name, exact: true })
/** A timer's panel under its card's row, by the timer's name, once it is open. */
const panelOf = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

/** Opens the panel of the timer named `name` with its card's More, and answers the panel. */
async function openMore(page: Page, name: string): Promise<Locator> {
  await button(card(page, name), 'More').click()
  const panel = panelOf(page, name)
  await expect(panel).toBeVisible()
  return panel
}

test('a panel opened at the end of the page is brought into view whole once it has grown', async ({ page }) => {
  // The short Timers page, scrolled to its end: the page is not yet tall enough for the panel as it starts to grow.
  await page.setViewportSize({ width: 1440, height: 700 })
  const more = page.getByRole('button', { name: 'More', exact: true }).last()
  await expect(more).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await more.click()
  await expect(page.locator('.ach-panel')).toBeInViewport({ ratio: 1 })
})

/** The timer the core holds by this name. Browser tests find timers by their names, never by their numbers. */
async function timerNamed(api: Api, name: string): Promise<Timer> {
  const { timers } = await api.get<TimersModel>('/api/timers')
  const found = timers.find((timer) => timer.name === name)
  if (found === undefined) throw new Error(`The core has no timer named ${name}.`)
  return found
}

/** The core's time, in milliseconds. */
async function coreNow(api: Api): Promise<number> {
  return Date.parse((await api.get<Status>('/api/status')).now)
}

/** A ready time less than a week away as the page shows it, in this PC's time: "Tue 20:00". */
function shownAt(instant: string): string {
  const at = new Date(instant)
  const clock = [at.getHours(), at.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':')
  return `${WEEKDAYS[at.getDay()]} ${clock}`
}

test("the Timers category groups the demo's timers", async ({ page }) => {
  await expect(title(page)).toHaveText('Timers')
  const timers = categories(page).getByRole('button', { name: 'Timers' })
  await expect(timers).toHaveText('Timers 2')
  await expect(timers).toHaveAttribute('aria-current', 'true')
  // The special categories open the column (spec 12.3).
  const places = categories(page).getByRole('button')
  await expect(places.nth(0)).toContainText('Timers')
  await expect(places.nth(1)).toContainText('Daily commissions')
  await expect(places.nth(2)).toContainText('Pinned')
  // The ready ones first, ready longest at the top; then the running pre-sets, soonest first; then the player's own.
  await expect(page.getByTestId('timers').getByRole('heading', { level: 3 }))
    .toHaveText(['Ready now 2', 'Running 4', 'Your own timers 2'])
  const names = (name: string) => group(page, name).getByRole('heading', { level: 4 })
  await expect(groupHeading(page, 'Ready now')).toHaveText('Ready now 2')
  await expect(names('Ready now')).toHaveText(['Fishing spot · Luhua Pool, Liyue', 'Teapot · Jade Field'])
  await expect(groupHeading(page, 'Running')).toHaveText('Running 4')
  await expect(names('Running')).toHaveText([
    'Unusual Hilichurl', 'Teapot · Orderly Meadow', 'Fishing spot · Cider Lake (1), Mondstadt', 'Teapot · Luxuriant Glebe',
  ])
  await expect(groupHeading(page, 'Your own timers')).toHaveText('Your own timers 2')
  await expect(names('Your own timers')).toHaveText(['Shrine visits', 'Parametric Transformer'])
  // A ready card says so with the Ready seal and since when, its ring full and green with a tick; a running one says
  // how long until it is ready and then when, its ring the time passed.
  const jade = card(page, 'Teapot · Jade Field')
  await expect(stateOf(jade)).toHaveText(/^Ready since \S.*\d\d:\d\d$/)
  await expect(stateOf(jade).locator('.seal')).toHaveText('Ready')
  await expect(jade.locator('.dial')).toHaveClass(/\bready\b/)
  await expect(jade.locator('.dial-tick')).toBeVisible()
  const hilichurl = card(page, 'Unusual Hilichurl')
  await expect(stateOf(hilichurl)).toHaveText(
    new RegExp(`^in (9 h 5\\d|10 h 0) min · ${shownAt('2026-10-13T18:00:00+00:00')}$`),
  )
  await expect(hilichurl.locator('.dial')).not.toHaveClass(/\bready\b/)
  await expect(hilichurl.locator('.dial .d-fill')).toBeAttached() // the time passed since it was cleared
  // The achievement it serves, with its count, which its Cleared adds to.
  await expect(hilichurl.getByText('...Well, That Was Strange', { exact: true })).toBeVisible()
  await expect(hilichurl.getByText('37 of 50 kills', { exact: true })).toBeVisible()
  // HoYoLAB's picture, through the core, in the dial. The demo downloads none, so the picture hides itself, and the
  // timer's sign shows in its place.
  const icon = hilichurl.locator('img')
  await expect(icon).toHaveAttribute('src', '/api/icon/timer.hilichurl')
  await expect(icon).toHaveAttribute('alt', '')
  await expect(icon).toBeHidden()
  await expect(hilichurl.locator('.dial svg.sign')).toBeVisible()
  // A timer of the player's own, which serves no achievement, shows its rule on the card.
  const shrines = card(page, 'Shrine visits')
  await expect(shrines).toContainText('At the next daily reset (04:00 server time) · made by you')
  await expect(card(page, 'Parametric Transformer')).toContainText('Every 166 hours · made by you')
  // Cleared, Remind me, Pin to Board and More on every card; the rest in the panel.
  await expect(page.getByRole('button', { name: 'Cleared', exact: true })).toHaveCount(8)
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(8)
  await expect(button(hilichurl, 'Remind me')).toHaveAttribute('aria-pressed', 'true')
  for (const name of ['Cleared earlier…', 'Set ready time…', 'Edit', 'Remove']) await expect(button(hilichurl, name)).toHaveCount(0)
  // The rule in full and the visits are in the panel; Edit only in the panels of the player's own.
  const hilichurlPanel = await openMore(page, 'Unusual Hilichurl')
  await expect(hilichurlPanel).toContainText(
    'Up to two appear in 12 hours, and it comes back 12 hours after the second is defeated',
  )
  await expect(button(hilichurlPanel, 'Edit')).toHaveCount(0)
  await expect(await openMore(page, 'Teapot · Jade Field')).toContainText('Crops ripen 70 hours after planting')
  await expect(await openMore(page, 'Fishing spot · Luhua Pool, Liyue')).toContainText(
    `Fish come back 3 days after the spot is emptied. ${FISHING_NOTE}`,
  )
  const shrinesPanel = await openMore(page, 'Shrine visits')
  await expect(shrinesPanel).toContainText('2 of 3 visits')
  await expect(button(shrinesPanel, 'Edit')).toBeVisible()
  // The view switch and the search go.
  await expect(page.getByRole('radiogroup', { name: 'Show' })).toHaveCount(0)
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  await expect(
    page.getByText(
      'Things in the game that come back on their own clock. Press Cleared when you have done one, and its timer starts.',
    ),
  ).toBeVisible()
})

test('the Daily commissions entry counts the commission achievements left in the region in Settings', async ({ page, api }) => {
  // Three are left in Liyue, where Settings starts, and four in Mondstadt.
  const commissions = categories(page).getByRole('button', { name: 'Daily commissions' })
  await expect(commissions).toHaveText('Daily commissions 3')
  await api.put('/api/settings', { commission_region: 'mondstadt' })
  await page.reload()
  await expect(commissions).toHaveText('Daily commissions 4')
})

test('Cleared on the hilichurl starts it and counts a kill, and Undo puts both back', async ({ page, api }) => {
  const before = await timerNamed(api, 'Unusual Hilichurl')
  const hilichurl = card(page, 'Unusual Hilichurl')
  await expect(hilichurl.getByText('37 of 50 kills', { exact: true })).toBeVisible()
  await button(hilichurl, 'Cleared').click()
  await expect(noteText(page)).toHaveText('Cleared Unusual Hilichurl')
  await expect(hilichurl.getByText('38 of 50 kills', { exact: true })).toBeVisible()
  const cleared = await timerNamed(api, 'Unusual Hilichurl')
  expect(cleared.achievement?.counter?.value).toBe(38)
  const since = (await coreNow(api)) - Date.parse(cleared.cleared_at!)
  expect(since).toBeGreaterThanOrEqual(0)
  expect(since).toBeLessThan(60_000) // cleared now, and 12 hours from now it is ready again
  await expect(stateOf(hilichurl)).toHaveText(new RegExp(`^in (11 h 59|12 h 0) min · ${shownAt(cleared.ready_at!)}$`))
  await page.getByTestId('note').getByRole('button', { name: 'Undo' }).click()
  await expect(noteText(page)).toHaveText('Undone: Cleared Unusual Hilichurl')
  await expect(hilichurl.getByText('37 of 50 kills', { exact: true })).toBeVisible()
  await expect(stateOf(hilichurl)).toHaveText(new RegExp(`^in (9 h 5\\d|10 h 0) min · ${shownAt(before.ready_at!)}$`))
  const undone = await timerNamed(api, 'Unusual Hilichurl')
  expect([undone.cleared_at, undone.ready_at, undone.achievement?.counter?.value])
    .toEqual([before.cleared_at, before.ready_at, 37])
})

test('a teapot card counts the items gathered with − and +, and its Cleared leaves the count', async ({ page, api }) => {
  // One harvest gathers as many items as were planted, so a teapot field's Cleared counts none, and its card counts
  // them itself, with the achievement's own counter.
  const meadow = card(page, 'Teapot · Orderly Meadow')
  await expect(meadow.getByText('0 of 200', { exact: true })).toBeVisible()
  await expect(meadow.getByRole('spinbutton')).toHaveCount(0) // the typed number is in the panel
  await expect(button(meadow, 'Count down')).toHaveAttribute('aria-disabled', 'true')
  // The count stands between the buttons that change it.
  const left = async (target: Locator) => (await target.boundingBox())?.x ?? Number.NaN
  expect(await left(button(meadow, 'Count down'))).toBeLessThan(await left(meadow.getByText('0 of 200', { exact: true })))
  expect(await left(meadow.getByText('0 of 200', { exact: true }))).toBeLessThan(await left(button(meadow, 'Count up')))
  await button(meadow, 'Count up').click()
  await expect(noteText(page)).toHaveText('Set the count of Stop! Gather Time. to 1')
  await expect(meadow.getByText('1 of 200', { exact: true })).toBeVisible()
  const count = (await openMore(page, 'Teapot · Orderly Meadow')).getByRole('spinbutton', { name: 'Count' })
  await expect(count).toHaveValue('1')
  await count.fill('12')
  await count.press('Enter')
  await expect(noteText(page)).toHaveText('Set the count of Stop! Gather Time. to 12')
  await expect(meadow.getByText('12 of 200', { exact: true })).toBeVisible()
  await expect(count).toHaveValue('12')
  await button(meadow, 'Cleared').click()
  await expect(noteText(page)).toHaveText('Cleared Teapot · Orderly Meadow')
  await expect(meadow.getByText('12 of 200', { exact: true })).toBeVisible()
  expect((await timerNamed(api, 'Teapot · Orderly Meadow')).achievement?.counter?.value).toBe(12)
  // The hilichurl's Cleared counts a kill: its card says its count, without − and +, and its panel has no number to type.
  const hilichurl = card(page, 'Unusual Hilichurl')
  await expect(hilichurl.getByText('37 of 50 kills', { exact: true })).toBeVisible()
  await expect(button(hilichurl, 'Count up')).toHaveCount(0)
  await expect((await openMore(page, 'Unusual Hilichurl')).getByRole('spinbutton', { name: 'Count' })).toHaveCount(0)
})

test("every button in a card's row and in its panel's is as tall as Cleared, with as much room around its words", async ({ page }) => {
  const measure = (target: Locator) =>
    target.evaluate((element) => {
      const style = getComputedStyle(element)
      const side = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth)
      return { height: element.getBoundingClientRect().height, side }
    })
  // Cleared is solid on a ready timer and quiet on one that runs, one size either way.
  const ready = await measure(button(card(page, 'Teapot · Jade Field'), 'Cleared'))
  // The player's own timer has every button a card and its panel can have.
  const shrines = card(page, 'Shrine visits')
  const cleared = await measure(button(shrines, 'Cleared'))
  expect(cleared).toEqual(ready)
  for (const name of ['Remind me', 'Pin to Board', 'More']) expect(await measure(button(shrines, name)), name).toEqual(cleared)
  const panel = await openMore(page, 'Shrine visits')
  for (const name of ['Cleared earlier…', 'Set ready time…', 'Edit', 'Remove']) {
    expect(await measure(button(panel, name)), name).toEqual(cleared)
  }
})

test('every timer card in a group has one height', async ({ page }) => {
  for (const width of [1440, 2560]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(page.getByTestId('timer')).toHaveCount(8)
    for (const name of ['Ready now', 'Running', 'Your own timers']) {
      const heights = await group(page, name).getByTestId('timer').evaluateAll((cards) =>
        cards.map((each) => each.getBoundingClientRect().height),
      )
      expect(new Set(heights), name).toEqual(new Set([154])) // and one for the whole category
    }
  }
})

test("More opens the timer's panel under its row with Cleared earlier, Set ready time and Remove", async ({ page }) => {
  const hilichurl = card(group(page, 'Running'), 'Unusual Hilichurl')
  const more = button(hilichurl, 'More')
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await more.click()
  const panel = panelOf(page, 'Unusual Hilichurl')
  await expect(panel).toBeVisible()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await expect(more).toHaveAttribute('aria-controls', (await panel.getAttribute('id')) ?? 'no id')
  for (const name of ['Cleared earlier…', 'Set ready time…', 'Remove']) await expect(button(panel, name)).toBeVisible()
  await expect(panel).toContainText('Up to two appear in 12 hours')
  // Under the card's row, across its group: the cards after it fill the row's other places.
  const own = (await hilichurl.boundingBox())!
  const row = await group(page, 'Running').getByTestId('timer').evaluateAll((cards, top) =>
    cards.map((each) => each.getBoundingClientRect()).filter((box) => Math.abs(box.top - top) < 1).map((box) => box.bottom),
  own.y)
  expect(row.length).toBe(2) // the row is full, at the window's 1,440 pixels
  await expect.poll(async () => (await panel.boundingBox())?.y ?? 0).toBeGreaterThan(Math.max(...row))
  // A form opens in the panel as it opened on the card.
  await button(panel, 'Set ready time…').click()
  await expect(panel.getByRole('form', { name: 'Set ready time' }).getByRole('spinbutton', { name: 'Hours' })).toBeFocused()
  // Escape closes the form first, then the panel, and the focus goes back to More.
  await page.keyboard.press('Escape')
  await expect(panel.getByRole('form')).toHaveCount(0)
  await expect(button(panel, 'Set ready time…')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('timer-panel')).toHaveCount(0)
  // One panel at a time.
  await more.click()
  await openMore(page, 'Teapot · Orderly Meadow')
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('timer-panel')).toHaveCount(1)
})

test('Pin to Board puts a timer on the Board as One timer, and pressing it again takes it off', async ({ page, core, api }) => {
  const pin = button(card(page, 'Unusual Hilichurl'), 'Pin to Board')
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await timerNamed(api, 'Unusual Hilichurl')).pinned).toBe(true)
  const hilichurl = await timerNamed(api, 'Unusual Hilichurl')
  await page.goto(`${core.origin}/#/board`)
  const one = page.locator(`[data-widget="pin-${hilichurl.id}"]`)
  await expect(one.getByRole('heading', { level: 3 })).toHaveText('One timer')
  await expect(one).toContainText('Unusual Hilichurl')
  await page.goto(`${core.origin}/#/achievements/timers`)
  await button(card(page, 'Unusual Hilichurl'), 'Pin to Board').click()
  await expect(button(card(page, 'Unusual Hilichurl'), 'Pin to Board')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await timerNamed(api, 'Unusual Hilichurl')).pinned).toBe(false)
  await page.goto(`${core.origin}/#/board`)
  await expect(page.locator(`[data-widget="pin-${hilichurl.id}"]`)).toHaveCount(0)
})

test('a new timer of two days shows under Your own timers with its ready time', async ({ page, api }) => {
  const opener = page.getByRole('button', { name: '+ New timer' })
  await opener.click()
  await expect(opener).toHaveAttribute('aria-expanded', 'true')
  const form = page.getByRole('form', { name: 'New timer' })
  await form.getByRole('textbox', { name: 'Name' }).fill('Walk the dog')
  await form.getByRole('textbox', { name: 'Place (optional)' }).fill('Springvale')
  await form.getByRole('radio', { name: 'After a time' }).check()
  await form.getByRole('spinbutton', { name: 'Length' }).fill('2')
  await form.getByRole('combobox', { name: 'Hours or days' }).selectOption('days')
  await expect(form).toContainText('Leave it empty for a timer without an end')
  await form.getByRole('button', { name: 'Add' }).click()
  await expect(noteText(page)).toHaveText('Added the timer Walk the dog')
  await expect(form).toHaveCount(0)
  await expect(opener).toBeFocused()
  // Never cleared yet, it is ready.
  const ready = card(group(page, 'Ready now'), 'Walk the dog')
  await expect(stateOf(ready)).toHaveText('Ready')
  await expect(ready).toContainText('Every 2 days · made by you')
  await expect(ready).toContainText('Springvale')
  await button(ready, 'Cleared').click()
  await expect(noteText(page)).toHaveText('Cleared Walk the dog')
  const own = group(page, 'Your own timers')
  const dog = card(own, 'Walk the dog')
  await expect(groupHeading(page, 'Your own timers')).toHaveText('Your own timers 3')
  const made = await timerNamed(api, 'Walk the dog')
  expect([made.rule, made.place, made.visits]).toEqual([{ kind: 'hours', hours: 48 }, 'Springvale', null])
  await expect(stateOf(dog)).toHaveText(new RegExp(`^in (1 d 23|2 d 0) h · ${shownAt(made.ready_at!)}$`))
  // Edit, in the panels of the player's own timers: the form opens on the timer as it is.
  const panel = await openMore(page, 'Walk the dog')
  await button(panel, 'Edit').click()
  const edit = panel.getByRole('form', { name: 'Edit timer' })
  await expect(edit.getByRole('textbox', { name: 'Name' })).toHaveValue('Walk the dog')
  await expect(edit.getByRole('spinbutton', { name: 'Length' })).toHaveValue('2')
  await expect(edit.getByRole('combobox', { name: 'Hours or days' })).toHaveValue('days')
  await edit.getByRole('radio', { name: 'At the weekly reset' }).check()
  await edit.getByRole('spinbutton', { name: 'Visits (optional)' }).fill('4')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(noteText(page)).toHaveText('Changed the timer Walk the dog')
  await expect(dog).toContainText('At the weekly reset (Monday 04:00 server time) · made by you')
  await expect(panel).toContainText('1 of 4 visits')
  expect((await timerNamed(api, 'Walk the dog')).rule).toEqual({ kind: 'weekly' })
})

test('a new timer at the daily reset waits the resets given, and Edit opens on its rule', async ({ page, api }) => {
  await page.getByRole('button', { name: '+ New timer' }).click()
  const form = page.getByRole('form', { name: 'New timer' })
  await form.getByRole('textbox', { name: 'Name' }).fill('Water the herbs')
  await form.getByRole('radio', { name: 'At the daily reset' }).check()
  await form.getByRole('spinbutton', { name: 'Resets' }).fill('2')
  await form.getByRole('button', { name: 'Add' }).click()
  await expect(noteText(page)).toHaveText('Added the timer Water the herbs')
  const herbs = card(page, 'Water the herbs')
  await expect(herbs).toContainText('After 2 daily resets (04:00 server time) · made by you')
  expect((await timerNamed(api, 'Water the herbs')).rule).toEqual({ kind: 'resets', resets: 2 })
  // Edit opens on the rule as it is: on this one's two resets, and on the demo's Shrine visits, at the next daily reset,
  // with its three visits.
  const herbsPanel = await openMore(page, 'Water the herbs')
  await button(herbsPanel, 'Edit').click()
  const edit = herbsPanel.getByRole('form', { name: 'Edit timer' })
  await expect(edit.getByRole('radio', { name: 'At the daily reset' })).toBeChecked()
  await expect(edit.getByRole('spinbutton', { name: 'Resets' })).toHaveValue('2')
  await edit.getByRole('button', { name: 'Cancel' }).click()
  const shrines = await openMore(page, 'Shrine visits')
  await button(shrines, 'Edit').click()
  const shrinesEdit = shrines.getByRole('form', { name: 'Edit timer' })
  await expect(shrinesEdit.getByRole('radio', { name: 'At the daily reset' })).toBeChecked()
  await expect(shrinesEdit.getByRole('spinbutton', { name: 'Resets' })).toHaveValue('1')
  await expect(shrinesEdit.getByRole('spinbutton', { name: 'Visits (optional)' })).toHaveValue('3')
})

test('Cleared earlier and Set ready time take the times the game shows', async ({ page, api }) => {
  // Jade Field is ready. Cleared 2 h 10 min ago, it runs again, 70 hours from then.
  const jadePanel = await openMore(page, 'Teapot · Jade Field')
  await button(jadePanel, 'Cleared earlier…').click()
  const earlier = jadePanel.getByRole('form', { name: 'Cleared earlier' })
  await expect(earlier).toContainText('Cleared')
  await expect(earlier).toContainText('min ago')
  await expect(earlier.getByRole('spinbutton', { name: 'Hours' })).toBeFocused()
  await earlier.getByRole('spinbutton', { name: 'Hours' }).fill('2')
  await earlier.getByRole('spinbutton', { name: 'Minutes' }).fill('10')
  await earlier.getByRole('button', { name: 'Save' }).click()
  await expect(noteText(page)).toHaveText('Cleared Teapot · Jade Field')
  const running = card(group(page, 'Running'), 'Teapot · Jade Field')
  await expect(running).toBeVisible()
  await expect(earlier).toHaveCount(0)
  // The card moved to Running with its panel, and the focus with it, to the button that opened the form.
  await expect(button(group(page, 'Running').getByRole('region', { name: 'Teapot · Jade Field' }), 'Cleared earlier…'))
    .toBeFocused()
  const cleared = await timerNamed(api, 'Teapot · Jade Field')
  // The core's now, less 2 h 10 min: the page's clock follows the core's.
  const ago = (await coreNow(api)) - Date.parse(cleared.cleared_at!)
  expect(ago).toBeGreaterThanOrEqual((2 * 60 + 10) * 60_000)
  expect(ago).toBeLessThan((2 * 60 + 11) * 60_000)
  await expect(stateOf(running)).toHaveText(new RegExp(`^in 2 d 19 h · ${shownAt(cleared.ready_at!)}$`))

  const glebe = card(page, 'Teapot · Luxuriant Glebe')
  const glebePanel = await openMore(page, 'Teapot · Luxuriant Glebe')
  await button(glebePanel, 'Set ready time…').click()
  const ready = glebePanel.getByRole('form', { name: 'Set ready time' })
  await expect(ready).toContainText('Ready in')
  await ready.getByRole('spinbutton', { name: 'Hours' }).fill('45')
  await ready.getByRole('spinbutton', { name: 'Minutes' }).fill('10')
  await ready.getByRole('button', { name: 'Save' }).click()
  await expect(noteText(page)).toHaveText('Set when Teapot · Luxuriant Glebe is ready')
  await expect(ready).toHaveCount(0)
  const set = await timerNamed(api, 'Teapot · Luxuriant Glebe')
  const ahead = Date.parse(set.ready_at!) - (await coreNow(api))
  expect(ahead).toBeGreaterThan((45 * 60 + 9) * 60_000)
  expect(ahead).toBeLessThanOrEqual((45 * 60 + 10) * 60_000)
  await expect(stateOf(glebe)).toHaveText(new RegExp(`^in 1 d 21 h · ${shownAt(set.ready_at!)}$`))
  // Cancel sends nothing.
  await button(glebePanel, 'Set ready time…').click()
  await ready.getByRole('spinbutton', { name: 'Hours' }).fill('3')
  await ready.getByRole('button', { name: 'Cancel' }).click()
  await expect(ready).toHaveCount(0)
  expect((await timerNamed(api, 'Teapot · Luxuriant Glebe')).ready_at).toBe(set.ready_at)
  // A time the core refuses: the brown note says why, and the form stays open with what was typed. Nothing changes.
  await button(glebePanel, 'Set ready time…').click()
  await ready.getByRole('spinbutton', { name: 'Hours' }).fill('0')
  await ready.getByRole('spinbutton', { name: 'Minutes' }).fill('0')
  await ready.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('alert').getByTestId('note')).toContainText('A ready time is later than now.')
  await expect(ready.getByRole('spinbutton', { name: 'Hours' })).toHaveValue('0')
  await expect(ready.getByRole('spinbutton', { name: 'Minutes' })).toHaveValue('0')
  expect((await timerNamed(api, 'Teapot · Luxuriant Glebe')).ready_at).toBe(set.ready_at)
})

test.describe('the focus goes with a card that moves', () => {
  // At the window's first size, a card Cleared goes to the end of Running, below the window.
  test('after Cleared with the mouse, the page stays where it is', async ({ page }) => {
    const jade = card(group(page, 'Ready now'), 'Teapot · Jade Field')
    await expect(button(jade, 'Cleared')).toBeInViewport()
    const scrolled = await page.evaluate(() => window.scrollY)
    await button(jade, 'Cleared').click()
    await expect(noteText(page)).toHaveText('Cleared Teapot · Jade Field')
    const moved = button(card(group(page, 'Running'), 'Teapot · Jade Field'), 'Cleared')
    await expect(moved).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
    await expect(moved).not.toBeInViewport() // where the page did not follow it
  })

  test('from the keyboard, the page shows it in its new place', async ({ page }) => {
    await button(card(group(page, 'Ready now'), 'Teapot · Jade Field'), 'Cleared').focus()
    await page.keyboard.press('Enter')
    await expect(noteText(page)).toHaveText('Cleared Teapot · Jade Field')
    const moved = button(card(group(page, 'Running'), 'Teapot · Jade Field'), 'Cleared')
    await expect(moved).toBeFocused()
    await expect(moved).toBeInViewport()
  })
})

test('Add far down the list of pre-sets, with the mouse, gives the focus back without moving the page', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Add a pre-set timer' })
  await opener.click()
  const offers = page.getByRole('region', { name: 'Add a pre-set timer' })
  const far = offers.getByRole('listitem').filter({ hasText: 'Fishing spot · Wavey Bay: Southern Waters, Natlan' })
  await far.scrollIntoViewIfNeeded()
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)
  await far.getByRole('button', { name: 'Add' }).click()
  await expect(noteText(page)).toHaveText('Added the timer Fishing spot · Wavey Bay: Southern Waters, Natlan')
  await expect(far).toHaveCount(0)
  await expect(opener).toBeFocused() // the button that opened the list, out of sight above
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
})

test('the bell turns the reminder off and on', async ({ page, api }) => {
  const hilichurl = card(page, 'Unusual Hilichurl')
  const bell = button(hilichurl, 'Remind me')
  await expect(bell).toHaveAttribute('aria-pressed', 'true')
  const sent: (string | null)[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/timers')) {
      sent.push(request.postData())
    }
  })
  // The core's answer is held: meanwhile the bell shows the press, and the card's buttons send nothing more.
  const answer = holding()
  await page.route('**/api/timers/*/bell', async (route) => {
    await answer.held
    await route.continue()
  })
  await bell.click()
  await expect(bell).toHaveAttribute('aria-pressed', 'false')
  await expect(bell).toHaveAttribute('aria-disabled', 'true')
  // aria-disabled, which keeps the focus where disabled would drop it to the page: a press sends nothing.
  await bell.focus()
  await page.keyboard.press('Enter')
  await button(hilichurl, 'Cleared').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  answer.release()
  await expect(noteText(page)).toHaveText('Turned off the reminder for Unusual Hilichurl')
  await expect(bell).toHaveAttribute('aria-disabled', 'false')
  expect(sent).toEqual(['{"on":false}'])
  await expect.poll(async () => (await timerNamed(api, 'Unusual Hilichurl')).bell).toBe(false)
  await expect(bell).toHaveAttribute('aria-pressed', 'false')
  await bell.click()
  await expect(noteText(page)).toHaveText('Turned on the reminder for Unusual Hilichurl')
  await expect(bell).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await timerNamed(api, 'Unusual Hilichurl')).bell).toBe(true)
  // A change made elsewhere, here through the API, as from another window, shows too.
  const { id } = await timerNamed(api, 'Unusual Hilichurl')
  await api.post(`/api/timers/${id}/bell`, { on: false })
  await expect(bell).toHaveAttribute('aria-pressed', 'false')
})

test('Remove takes a timer away and Undo brings it back', async ({ page, api }) => {
  const before = await timerNamed(api, 'Parametric Transformer')
  const transformer = card(page, 'Parametric Transformer')
  // Cleared 30 hours before, every 166 hours.
  const state = new RegExp(`^in 5 d 1[56] h · ${shownAt(before.ready_at!)}$`)
  await expect(stateOf(transformer)).toHaveText(state)
  await button(await openMore(page, 'Parametric Transformer'), 'Remove').click()
  await expect(noteText(page)).toHaveText('Removed the timer Parametric Transformer')
  await expect(transformer).toHaveCount(0)
  await expect(page.getByTestId('timer-panel')).toHaveCount(0) // with its panel
  await expect(groupHeading(page, 'Your own timers')).toHaveText('Your own timers 1')
  // The focus had gone with the card: it is on the heading, from where Undo is the next stop.
  await expect(title(page)).toBeFocused()
  await page.getByTestId('note').getByRole('button', { name: 'Undo' }).click()
  await expect(noteText(page)).toHaveText('Undone: Removed the timer Parametric Transformer')
  await expect(groupHeading(page, 'Your own timers')).toHaveText('Your own timers 2')
  // With its history: it still runs from the same Cleared.
  await expect(stateOf(transformer)).toHaveText(state)
  const back = await timerNamed(api, 'Parametric Transformer')
  expect([back.cleared_at, back.ready_at]).toEqual([before.cleared_at, before.ready_at])
  // With no timer at all, the page says how to make one.
  await changeAnswer<TimersModel>(page, '/api/timers', (data) => {
    data.timers = []
  })
  await page.reload()
  await expect(
    page.getByText('No timer yet. + New timer makes one, and Add a pre-set timer lists the ones Guild Board knows.'),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Ready now' })).toHaveCount(0)
})

test('a pre-set fishing spot is added and leaves the list of pre-sets', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Add a pre-set timer' })
  await opener.click()
  await expect(opener).toHaveAttribute('aria-expanded', 'true')
  const offers = page.getByRole('region', { name: 'Add a pre-set timer' })
  // The hilichurl, the teapot and the demo's spots are in use: the other fishing spots are offered, by region.
  await expect(offers.getByRole('heading', { level: 3 })).toHaveText(['Fishing spots'])
  await expect(offers.getByRole('heading', { level: 4 }))
    .toHaveText(['Mondstadt', 'Liyue', 'Inazuma', 'Sumeru', 'Fontaine', 'Natlan', 'Nod-Krai', 'Snezhnaya'])
  await expect(offers.getByText('Fishing spot · Luhua Pool, Liyue', { exact: true })).toHaveCount(0)
  const wangshu = offers.getByRole('listitem').filter({ hasText: 'Fishing spot · Wangshu Inn, Liyue' })
  await expect(wangshu).toHaveCount(1)
  await wangshu.getByRole('button', { name: 'Add' }).click()
  await expect(noteText(page)).toHaveText('Added the timer Fishing spot · Wangshu Inn, Liyue')
  await expect(wangshu).toHaveCount(0)
  await expect(offers).toBeVisible() // the list stays, for the next one
  // Never cleared, it is ready, after the ones that were.
  const ready = group(page, 'Ready now')
  await expect(groupHeading(page, 'Ready now')).toHaveText('Ready now 3')
  await expect(ready.getByRole('heading', { level: 4 }).last()).toHaveText('Fishing spot · Wangshu Inn, Liyue')
  const added = card(ready, 'Fishing spot · Wangshu Inn, Liyue')
  await expect(stateOf(added)).toHaveText('Ready') // never cleared, so since no time
  await expect(await openMore(page, 'Fishing spot · Wangshu Inn, Liyue')).toContainText(
    `Fish come back 3 days after the spot is emptied. ${FISHING_NOTE}`,
  )
  await expect(categories(page).getByRole('button', { name: 'Timers' })).toHaveText('Timers 3')
  // With every pre-set in use, the list says so.
  await changeAnswer<TimersModel>(page, '/api/timers', (data) => {
    data.presets = []
  })
  await page.reload()
  await page.getByRole('button', { name: 'Add a pre-set timer' }).click()
  await expect(page.getByRole('region', { name: 'Add a pre-set timer' })).toContainText('Every pre-set timer is in use.')
})

/** The seconds a countdown under one minute reads: 42 for "in 42 s · Tue 20:00"; NaN for any other state. */
function secondsLeft(state: string | null): number {
  const seconds = /^in (\d+) s · /.exec(state ?? '')
  return seconds === null ? Number.NaN : Number(seconds[1])
}

test('moving the demo clock makes a running timer ready without a reload', async ({ page, api }) => {
  await expect(groupHeading(page, 'Ready now')).toHaveText('Ready now 2')
  await page.evaluate(() => {
    ;(window as Window & { notReloaded?: boolean }).notReloaded = true
  })
  const { ready_at } = await timerNamed(api, 'Unusual Hilichurl')
  const toSecondsBefore = async (seconds: number) =>
    api.advance((Date.parse(ready_at!) - (await coreNow(api))) / 1000 - seconds)
  // To 20 seconds before the hilichurl is ready: its countdown reads in seconds, on the core's clock.
  await toSecondsBefore(20)
  const counting = stateOf(card(group(page, 'Running'), 'Unusual Hilichurl'))
  await expect(counting).toHaveText(/^in (1\d|20) s · /)
  // The page counts it down by itself, once a second: nothing else happens meanwhile, and it runs far from its time. Two
  // seconds fewer can take three seconds to show, so it is read every quarter of a second for four.
  const shown = secondsLeft(await counting.textContent())
  await expect.poll(async () => secondsLeft(await counting.textContent()), { timeout: 4_000, intervals: [250] })
    .toBeLessThanOrEqual(shown - 2)
  // To a few seconds before. When its time comes, the core tells the page, and the hilichurl is ready.
  await toSecondsBefore(3)
  await expect(stateOf(card(group(page, 'Ready now'), 'Unusual Hilichurl'))).toHaveText(/^Ready since /, { timeout: 15_000 })
  await expect(groupHeading(page, 'Ready now')).toHaveText('Ready now 3')
  await expect(groupHeading(page, 'Running')).toHaveText('Running 3')
  await expect(categories(page).getByRole('button', { name: 'Timers' })).toHaveText('Timers 3')
  expect(await page.evaluate(() => (window as Window & { notReloaded?: boolean }).notReloaded)).toBe(true)
})

test('#/achievements/timers opens the Timers category', async ({ page, core }) => {
  await expect(title(page)).toHaveText('Timers')
  const timers = categories(page).getByRole('button', { name: 'Timers' })
  await expect(timers).toHaveAttribute('aria-current', 'true')
  await expect(groupHeading(page, 'Ready now')).toHaveText('Ready now 2')
  // Another category gives the page its own address back, and Timers writes its own in its place: the browser's history
  // gains no step.
  const steps = await page.evaluate(() => history.length)
  await categories(page).getByRole('button', { name: 'Wonders of the World' }).click()
  await expect(title(page)).toHaveText('Wonders of the World')
  await expect(timers).not.toHaveAttribute('aria-current', 'true')
  expect(await page.evaluate(() => location.hash)).toBe('#/achievements')
  await timers.click()
  await expect(title(page)).toHaveText('Timers')
  expect(await page.evaluate(() => location.hash)).toBe('#/achievements/timers')
  expect(await page.evaluate(() => history.length)).toBe(steps)
  // A change of the address to it, as the shell makes after a click on a reminder, opens Timers.
  await categories(page).getByRole('button', { name: 'Pinned' }).click()
  await expect(title(page)).toHaveText('Pinned')
  await page.evaluate(() => {
    location.hash = '#/achievements/timers'
  })
  await expect(title(page)).toHaveText('Timers')
  await expect(groupHeading(page, 'Ready now')).toHaveText('Ready now 2')
  // From another page too, and again after a reload.
  await page.goto(`${core.origin}/#/stats`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stats')
  await page.evaluate(() => {
    location.hash = '#/achievements/timers'
  })
  await expect(title(page)).toHaveText('Timers')
  await page.reload()
  await expect(title(page)).toHaveText('Timers')
  // Daily commissions has its address too.
  await categories(page).getByRole('button', { name: 'Daily commissions' }).click()
  await expect(title(page)).toHaveText('Daily commissions')
  expect(await page.evaluate(() => location.hash)).toBe('#/achievements/commissions')
  await expect(page.getByRole('radiogroup', { name: 'Show' })).toHaveCount(0)
  await expect(page.getByRole('searchbox')).toHaveCount(0)
})

test('at 2,560 pixels the timers keep their width', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await expect(page.getByTestId('timer')).toHaveCount(8)
  const column = await page.getByTestId('timers').evaluate((element) => element.getBoundingClientRect().width)
  expect(column).toBeLessThanOrEqual(1440)
  const boxes = await page.getByTestId('timer').evaluateAll((cards) =>
    cards.map((card) => {
      const { top, width } = card.getBoundingClientRect()
      return { top, width }
    }),
  )
  expect(Math.max(...boxes.map((box) => box.width))).toBeLessThanOrEqual(640)
  // The four running pre-sets lie side by side, in fewer rows than cards.
  const running = await group(page, 'Running').getByTestId('timer').evaluateAll((cards) =>
    cards.map((card) => card.getBoundingClientRect().top),
  )
  expect(new Set(running).size).toBeLessThan(running.length)
})

/** The changes the page sends to the timers from now on, in order, as "POST /api/timers/4/cleared". */
function changesSent(page: Page): string[] {
  const sent: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() !== 'GET' && path.startsWith('/api/timers')) sent.push(`${request.method()} ${path}`)
  })
  return sent
}

/** The counts the page sets from now on, in order, as the bodies it sends: { value: 9 }. */
function countsSent(page: Page): unknown[] {
  const sent: unknown[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'POST' && path.startsWith('/api/achievements/counter/')) sent.push(request.postDataJSON())
  })
  return sent
}

/**
 * Clicks `button`, then clicks again at the same place on the screen as soon as `next` has moved up there, as the
 * second click of a double-click lands: the page draws the cards anew a few hundredths of a second after the first.
 */
async function clickAgainAsItMoves(page: Page, button: Locator, next: Locator): Promise<void> {
  await button.scrollIntoViewIfNeeded()
  const box = await button.boundingBox()
  if (box === null) throw new Error('The button is not on the screen.')
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const arriving = await next.elementHandle()
  await button.click()
  await page.waitForFunction(
    ({ point, arriving }) => {
      const under = document.elementFromPoint(point.x, point.y)
      return under !== null && arriving.contains(under)
    },
    { point, arriving },
    { polling: 'raf' },
  )
  await page.mouse.click(point.x, point.y)
}

test.describe('a second click as quick as a double-click', () => {
  // The player's dashboard, where every card these tests move stays on the screen.
  test.use({ viewport: { width: 2560, height: 1440 } })

  /** Two timers of the player's own, alike, made as + New timer makes them: ready, never cleared, side by side. */
  async function twoAlike(page: Page, api: Api): Promise<[Timer, Timer]> {
    for (const name of ['Garden bed one', 'Garden bed two']) {
      await api.post('/api/timers', { name, place: '', rule: { kind: 'hours', hours: 48 }, visits: null })
    }
    await page.reload()
    return [await timerNamed(api, 'Garden bed one'), await timerNamed(api, 'Garden bed two')]
  }

  test('after Cleared, does not reach the card that moved up under the pointer', async ({ page, api }) => {
    const [one, two] = await twoAlike(page, api)
    const ready = group(page, 'Ready now')
    const sent = changesSent(page)
    await clickAgainAsItMoves(page, button(card(ready, one.name), 'Cleared'), button(card(ready, two.name), 'Cleared'))
    await expect(noteText(page)).toHaveText(`Cleared ${one.name}`)
    await page.waitForTimeout(300) // a second change would have gone by now
    expect(sent).toEqual([`POST /api/timers/${one.id}/cleared`])
    await expect(stateOf(card(ready, two.name))).toHaveText('Ready')
    expect((await timerNamed(api, two.name)).cleared_at).toBeNull()
    // Once the cards have settled, a click is sent again.
    await button(card(ready, two.name), 'Cleared').click()
    await expect(noteText(page)).toHaveText(`Cleared ${two.name}`)
  })

  test('after Remove in its panel, a press at once on what moved up sends nothing until the cards rest', async ({ page, api }) => {
    const [one, two] = await twoAlike(page, api)
    const ready = group(page, 'Ready now')
    const sent = changesSent(page)
    await button(await openMore(page, one.name), 'Remove').click()
    // As soon as the card and its panel are gone, as the second click of a double-click comes: the cards after them have
    // moved up, and a press on the next timer's Cleared sends nothing. With the mouse itself, which waits for nothing.
    await page.waitForFunction(
      (name) => ![...document.querySelectorAll('[data-testid="timer"] h4')].some((each) => each.textContent === name),
      one.name,
      { polling: 'raf' },
    )
    const box = await button(card(ready, two.name), 'Cleared').boundingBox()
    if (box === null) throw new Error('The button is not on the screen.')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(noteText(page)).toHaveText(`Removed the timer ${one.name}`)
    await page.waitForTimeout(300)
    expect(sent).toEqual([`DELETE /api/timers/${one.id}`])
    await expect(stateOf(card(ready, two.name))).toHaveText('Ready')
    expect((await timerNamed(api, two.name)).cleared_at).toBeNull()
  })

  test('after Add, does not reach the pre-set that moved up under the pointer', async ({ page, api }) => {
    await page.getByRole('button', { name: 'Add a pre-set timer' }).click()
    const offers = page.getByRole('region', { name: 'Add a pre-set timer' })
    const offer = (name: string) => offers.getByRole('listitem').filter({ hasText: name })
    const wangshu = offer('Fishing spot · Wangshu Inn, Liyue')
    const next = wangshu.locator('xpath=following-sibling::li[1]')
    const nextName = (await next.locator('span').textContent())!
    const sent = changesSent(page)
    await clickAgainAsItMoves(page, wangshu.getByRole('button', { name: 'Add' }), next.getByRole('button', { name: 'Add' }))
    await expect(noteText(page)).toHaveText('Added the timer Fishing spot · Wangshu Inn, Liyue')
    await page.waitForTimeout(300)
    expect(sent).toEqual(['POST /api/timers'])
    await expect(offer(nextName)).toHaveCount(1) // still offered
    const { timers } = await api.get<TimersModel>('/api/timers')
    expect(timers.map((timer) => timer.name)).not.toContain(nextName)
  })

  test('after Cleared on a running timer that stays in its place, does not count it again', async ({ page, api }) => {
    const hilichurl = card(group(page, 'Running'), 'Unusual Hilichurl')
    await expect(hilichurl.getByText('37 of 50 kills', { exact: true })).toBeVisible()
    const cleared = button(hilichurl, 'Cleared')
    const box = await cleared.boundingBox()
    if (box === null) throw new Error('The button is not on the screen.')
    const sent = changesSent(page)
    await cleared.click()
    // As soon as the core has answered: the hilichurl is still the first to run, so the click lands on its Cleared.
    await page.waitForFunction(
      () => document.querySelector('[data-testid="note"] .note-text')?.textContent === 'Cleared Unusual Hilichurl',
      undefined,
      { polling: 'raf' },
    )
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(300)
    expect(sent).toHaveLength(1)
    await expect(hilichurl.getByText('38 of 50 kills', { exact: true })).toBeVisible()
    expect((await timerNamed(api, 'Unusual Hilichurl')).achievement?.counter?.value).toBe(38)
  })

  test('while the cards rest, + on a count sends nothing, and a number typed is still set', async ({ page, api }) => {
    const meadow = card(group(page, 'Running'), 'Teapot · Orderly Meadow')
    const up = button(meadow, 'Count up')
    const count = (await openMore(page, 'Teapot · Orderly Meadow')).getByRole('spinbutton', { name: 'Count' })
    await expect(count).toHaveValue('0')
    const box = await up.boundingBox()
    if (box === null) throw new Error('The button is not on the screen.')
    const sent = countsSent(page)
    // The hilichurl stays the first to run, so no card moves; the cards rest for a moment all the same.
    await button(card(group(page, 'Running'), 'Unusual Hilichurl'), 'Cleared').click()
    await page.waitForFunction(
      () => document.querySelector('[data-testid="note"] .note-text')?.textContent === 'Cleared Unusual Hilichurl',
      undefined,
      { polling: 'raf' },
    )
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await count.fill('9')
    await count.press('Enter')
    await expect(noteText(page)).toHaveText('Set the count of Stop! Gather Time. to 9')
    expect(sent).toEqual([{ value: 9 }])
    expect((await timerNamed(api, 'Teapot · Orderly Meadow')).achievement?.counter?.value).toBe(9)
    // Once the cards have rested, + counts again.
    await up.click()
    await expect(noteText(page)).toHaveText('Set the count of Stop! Gather Time. to 10')
    expect(sent).toEqual([{ value: 9 }, { value: 10 }])
  })
})

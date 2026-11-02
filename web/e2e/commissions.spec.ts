import type { Locator, Page } from '@playwright/test'
import type { Commission, CommissionsModel, Status } from '../src/types.ts'
import { changeAnswer } from './answers.ts'
import { type Api, expect, test } from './fixtures.ts'

/*
 * The demo at its 08:00 UTC, in Liyue, where Settings starts: Pirates! Argh! (in progress, two of its three parts
 * done, last appeared on 12 Oct), All's Well That Ends Well (a chain of three parts, with what to do first) and
 * Swordseeker (a Liyue one only by Guild Board's notes, a chain of two parts) are left, and the other 13 are done.
 * Mondstadt has 4 left, Inazuma 2 and Sumeru 3; Guild Board knows none in Fontaine, and Natlan's 4 are all done.
 * HoYoLAB's count, read at the start, has the day's four commissions done.
 */
test.beforeEach(async ({ page, core }) => {
  await page.goto(`${core.origin}/#/achievements/commissions`)
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** What the undo note says (ui/note.tsx), without its button. */
const noteText = (page: Page) => page.getByTestId('note').locator('.note-text')
const title = (page: Page) => page.getByRole('heading', { level: 2 })
const categories = (page: Page) => page.getByRole('navigation', { name: 'Categories' })
const regionSwitch = (page: Page) => page.getByRole('radiogroup', { name: 'Region' })
const region = (page: Page, name: string) => regionSwitch(page).getByRole('radio', { name, exact: true })
/** A commission achievement's card, by its name. */
const card = (scope: Page | Locator, name: string) => scope.getByRole('article', { name, exact: true })
/** The names of the cards shown, in order: those still to do, then the folded ones while the fold is open. */
const cardNames = (scope: Page | Locator) => scope.getByTestId('commission').getByRole('heading', { level: 3 })
const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true })
const doneBox = (scope: Locator) => scope.getByRole('checkbox', { name: /^Done: / })
const lookingFor = (page: Page) => page.getByRole('region', { name: 'Commissions to look for' })
/** The done achievements, while the fold is open. */
const fold = (page: Page) => page.getByRole('region', { name: 'Done', exact: true })
/** A commission achievement's panel under its card's row, by its name, once it is open. */
const panelOf = (page: Page, name: string) => page.getByRole('region', { name, exact: true })

/** Opens the panel of the card named `name` with its Details, and answers the panel. */
async function openDetails(page: Page, name: string, scope: Page | Locator = page): Promise<Locator> {
  await button(card(scope, name), 'Details').click()
  const panel = panelOf(page, name)
  await expect(panel).toBeVisible()
  return panel
}

/** The Daily commissions model, for the region set in Settings unless another is named. */
function model(api: Api, region?: string): Promise<CommissionsModel> {
  return api.get<CommissionsModel>(region === undefined ? '/api/commissions' : `/api/commissions?region=${region}`)
}

/**
 * The commission achievement the core holds by this name, in the region set in Settings. Browser tests find cards by
 * their names, never by their numbers.
 */
async function commissionNamed(api: Api, name: string): Promise<Commission> {
  const { cards, done } = await model(api)
  const found = [...cards, ...done].find((one) => one.name === name)
  if (found === undefined) throw new Error(`The core has no commission achievement named ${name}.`)
  return found
}

/** Moves the demo clock into the next game day, which begins at 04:00 server time: 03:00 UTC on its Europe server. */
async function toTheNextGameDay(api: Api): Promise<void> {
  const now = Date.parse((await api.get<Status>('/api/status')).now)
  await api.advance((Date.parse('2026-10-14T03:01:00+00:00') - now) / 1000)
}

/** An instant's time of day in this PC's time, as the HoYoLAB line shows it: "10:00". */
function clockOf(instant: string): string {
  const at = new Date(instant)
  return [at.getHours(), at.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':')
}

/** An instant's day in this PC's time, as a part done shows it: "13 Oct". */
function dayOf(instant: string): string {
  const at = new Date(instant)
  return `${at.getDate()} ${MONTHS[at.getMonth()]}`
}

/** Where a card is on the page, whatever the scroll, once the fonts are in: a font that lands later moves the cards. */
function placeOf(element: Locator): Promise<{ x: number; y: number }> {
  return element.evaluate(async (shown) => {
    await document.fonts.ready
    const box = shown.getBoundingClientRect()
    return { x: box.x + window.scrollX, y: box.y + window.scrollY }
  })
}

/**
 * Where each of the cards is on the page, in order, as placeOf gives it, once their pictures have loaded or hidden: a
 * primogem the demo does not have hides itself, which can change a card's height by a fraction of a pixel.
 */
function placesOf(cards: Locator): Promise<{ x: number; y: number }[]> {
  return cards.evaluateAll(async (shown) => {
    await document.fonts.ready
    const loading = shown.flatMap((one) => [...one.querySelectorAll('img')]).filter((picture) => !picture.complete)
    await Promise.all(
      loading.map(
        (picture) =>
          new Promise((settled) => {
            picture.addEventListener('load', settled, { once: true })
            picture.addEventListener('error', settled, { once: true })
          }),
      ),
    )
    return shown.map((one) => {
      const box = one.getBoundingClientRect()
      return { x: box.x + window.scrollX, y: box.y + window.scrollY }
    })
  })
}

/** How tall an element is, once the fonts are in. */
function heightOf(element: Locator): Promise<number> {
  return element.evaluate(async (shown) => {
    await document.fonts.ready
    return shown.getBoundingClientRect().height
  })
}

/** How many lines the commissions to look for take in their panel, once the fonts are in. */
function linesOf(panel: Locator): Promise<number> {
  return panel.getByRole('listitem').evaluateAll(async (names) => {
    await document.fonts.ready
    return new Set(names.map((name) => name.getBoundingClientRect().top)).size
  })
}

/** The changes the page sends from now on, in order, as "POST /api/commissions/84524/appeared". */
function changesSent(page: Page): string[] {
  const sent: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (request.method() !== 'GET' && (path.startsWith('/api/commissions/') || path.startsWith('/api/achievements/'))) {
      sent.push(`${request.method()} ${path}`)
    }
  })
  return sent
}

test('Daily commissions opens on the region in Settings and switches regions', async ({ page, api }) => {
  await expect(title(page)).toHaveText('Daily commissions')
  const entry = categories(page).getByRole('button', { name: 'Daily commissions' })
  await expect(entry).toHaveAttribute('aria-current', 'true')
  // The six regions, each with how many are left there; the one in Settings is chosen.
  await expect(regionSwitch(page).getByRole('radio'))
    .toHaveText(['Mondstadt 4', 'Liyue 3', 'Inazuma 2', 'Sumeru 3', 'Fontaine 0', 'Natlan 0'])
  await expect(region(page, 'Liyue 3')).toHaveAttribute('aria-checked', 'true')
  // The ones left, in the list's order.
  await expect(cardNames(page)).toHaveText(['Pirates! Argh!', "All's Well That Ends Well", 'Swordseeker'])
  await region(page, 'Mondstadt 4').click()
  await expect(region(page, 'Mondstadt 4')).toHaveAttribute('aria-checked', 'true')
  await expect(cardNames(page))
    .toHaveText(['For the Love of Godwin', 'Making Do', 'In the Name of Favonius', 'Telling It How It Is'])
  // Guild Board knows none in Fontaine, and every one in Natlan is done.
  await region(page, 'Fontaine 0').click()
  await expect(page.getByText('Guild Board knows no commission achievements in Fontaine yet.')).toBeVisible()
  await expect(cardNames(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Show \d+ done$/ })).toHaveCount(0)
  await region(page, 'Natlan 0').click()
  await expect(page.getByText('Every commission achievement in Natlan is done.')).toBeVisible()
  await expect(cardNames(page)).toHaveCount(0)
  await expect(button(page, 'Show 4 done')).toBeVisible()
  // The region in Settings decides where the category opens.
  await api.put('/api/settings', { commission_region: 'sumeru' })
  await page.reload()
  await expect(region(page, 'Sumeru 3')).toHaveAttribute('aria-checked', 'true')
  const sumeru = await model(api)
  expect(sumeru.region).toBe('sumeru')
  await expect(cardNames(page)).toHaveText(sumeru.cards.map((one) => one.name))
})

test('commissions to look for name each commission once', async ({ page, api }) => {
  const panel = lookingFor(page)
  await expect(panel.getByRole('heading')).toHaveText('Commissions to look for')
  await expect(panel.getByRole('listitem'))
    .toHaveText(["For Old Time's Sake", 'Pirate Invasion, in Liyue Harbor!', 'Where Is the Unseen Razor?'])
  await expect(card(page, 'Pirates! Argh!')).toContainText('Look for: Pirate Invasion, in Liyue Harbor!')
  // Love Is All Around and Open to Interpretation both come from Good Sign. Left again, here through the API as from
  // another window, both cards name it, and the panel names it once.
  for (const name of ['Love Is All Around', 'Open to Interpretation']) {
    const { id } = await commissionNamed(api, name)
    await api.post(`/api/achievements/stage/${id}`, { status: 'not_started' })
  }
  await expect(cardNames(page)).toHaveCount(5)
  const names = ["For Old Time's Sake", 'Good Sign', 'Pirate Invasion, in Liyue Harbor!', 'Where Is the Unseen Razor?']
  await expect(panel.getByRole('listitem')).toHaveText(names)
  expect((await model(api)).looking_for).toEqual(names)
  for (const name of ['Love Is All Around', 'Open to Interpretation']) {
    await expect(card(page, name)).toContainText('Look for: Good Sign')
  }
  // Where nothing is left, there is nothing to look for.
  await region(page, 'Natlan 0').click()
  await expect(panel).toContainText('Nothing to look for here.')
  await expect(panel.getByRole('listitem')).toHaveCount(0)
})

test('Appeared today is once per game day and Undo takes it back', async ({ page, api }) => {
  // A card with parts, as Liyue's three have, says when it last appeared in its panel.
  await expect(await openDetails(page, 'Pirates! Argh!')).toContainText('Last appeared 12 Oct.')
  const alls = await openDetails(page, "All's Well That Ends Well")
  const appeared = button(card(page, "All's Well That Ends Well"), 'Appeared today')
  await expect(alls).toContainText('Not seen yet.')
  await expect(appeared).toHaveAttribute('aria-disabled', 'false')
  const { id } = await commissionNamed(api, "All's Well That Ends Well")
  const sent = changesSent(page)
  // A double-click marks it once: the button rests as soon as it is pressed.
  await appeared.dblclick()
  await expect(noteText(page)).toHaveText("Marked All's Well That Ends Well as appeared today")
  await expect(alls).toContainText('Appeared today.')
  await expect(appeared).toHaveAttribute('aria-disabled', 'true')
  await page.waitForTimeout(300) // a second request would have gone by now
  expect(sent).toEqual([`POST /api/commissions/${id}/appeared`])
  await expect(page.getByRole('alert').getByTestId('note')).toHaveCount(0) // nothing was refused
  const today = await commissionNamed(api, "All's Well That Ends Well")
  expect([today.appeared_today, today.last_appeared]).toEqual([true, '2026-10-13'])
  // Undo takes it back.
  await page.getByTestId('note').getByRole('button', { name: 'Undo' }).click()
  await expect(noteText(page)).toHaveText("Undone: Marked All's Well That Ends Well as appeared today")
  await expect(alls).toContainText('Not seen yet.')
  await expect(appeared).toHaveAttribute('aria-disabled', 'false')
  expect((await commissionNamed(api, "All's Well That Ends Well")).last_appeared).toBeNull()
  // Marked again, it can be marked once more in the next game day, which begins at 04:00 server time.
  await appeared.click()
  await expect(alls).toContainText('Appeared today.')
  await expect(appeared).toHaveAttribute('aria-disabled', 'true')
  await toTheNextGameDay(api)
  await expect(alls).toContainText('Last appeared 13 Oct.')
  await expect(appeared).toHaveAttribute('aria-disabled', 'false')
  await appeared.click()
  await expect(alls).toContainText('Appeared today.')
  expect((await commissionNamed(api, "All's Well That Ends Well")).last_appeared).toBe('2026-10-14')
  // Read again from the start, as after a restart, it still rests for the rest of the game day. The press is gone with
  // the page, so here only the core's model can say so.
  await page.reload()
  await expect(cardNames(page)).toHaveCount(3)
  await expect(await openDetails(page, "All's Well That Ends Well")).toContainText('Appeared today.')
  await expect(appeared).toHaveAttribute('aria-disabled', 'true')
  const again = changesSent(page)
  await appeared.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300) // a request would have gone by now
  expect(again).toEqual([])
})

test("a chain's parts show as chips with Next on the next one, and tick on the card", async ({ page, api }) => {
  const alls = card(page, "All's Well That Ends Well")
  const { parts } = await commissionNamed(api, "All's Well That Ends Well")
  const chips = alls.getByRole('listitem')
  const box = (index: number) => alls.getByRole('checkbox', { name: parts[index].name, exact: true })
  const next = (index: number) => chips.nth(index).getByText('Next', { exact: true })
  await expect(chips).toHaveCount(3)
  // Nothing done yet: the first part is next, and the later ones are dimmed.
  await expect(next(0)).toBeVisible()
  await expect(chips.nth(0)).not.toContainClass('later')
  await expect(chips.nth(1)).toContainClass('later')
  await expect(chips.nth(2)).toContainClass('later')
  await expect(alls).not.toContainText('At part')
  await box(0).check()
  await expect(noteText(page)).toHaveText("Ticked a part of All's Well That Ends Well")
  // The mark moves on, and the card says where the chain is.
  await expect(next(1)).toBeVisible()
  await expect(next(0)).toHaveCount(0)
  await expect(chips.nth(1)).not.toContainClass('later')
  await expect(chips.nth(2)).toContainClass('later')
  await expect(alls).toContainText(`At part 2 of 3: ${parts[1].name}`)
  // The panel says when each part was done.
  const panel = await openDetails(page, "All's Well That Ends Well")
  const ticked = await commissionNamed(api, "All's Well That Ends Well")
  await expect(panel.getByRole('listitem').nth(0)).toContainText(`done ${dayOf(ticked.parts[0].done_at!)}`)
  // A later part can be ticked before its turn; the chain still waits for the second.
  await box(2).check()
  const third = async () => (await commissionNamed(api, "All's Well That Ends Well")).parts[2].done_at
  await expect.poll(third).not.toBeNull()
  await expect(panel.getByRole('listitem').nth(2)).toContainText('done ')
  await expect(next(1)).toBeVisible()
  await expect(alls).toContainText(`At part 2 of 3: ${parts[1].name}`)
  // With every part done, the box has a gold outline and the panel offers the tick: only the player ticks (spec 7.2).
  await box(1).check()
  await expect(panel).toContainText('All parts are done. Tick it once the game shows it.')
  await expect(alls.locator('.ach-box')).toHaveClass(/\breached\b/)
  await expect(alls.getByText('Next', { exact: true })).toHaveCount(0)
  await expect(alls).not.toContainText('At part')
  await expect(doneBox(alls)).not.toBeChecked()
  // Each card's box is named by its commission, so that a screen reader tells one card's from another's.
  await expect(doneBox(alls)).toHaveAccessibleName("Done: All's Well That Ends Well")
})

test('every commission card has one height', async ({ page }) => {
  await button(page, 'Show 13 done').click()
  for (const width of [1440, 2560]) {
    await page.setViewportSize({ width, height: 1000 })
    const cards = page.getByTestId('commission')
    await expect(cards).toHaveCount(16)
    const heights = await cards.evaluateAll((all) => all.map((one) => one.getBoundingClientRect().height))
    expect(new Set(heights)).toEqual(new Set([154]))
  }
  // Its buttons are one size.
  const measure = (target: Locator) => target.evaluate((element) => element.getBoundingClientRect().height)
  const pirates = card(page, 'Pirates! Argh!')
  const sizes = await Promise.all(['In progress', 'Pin', 'Appeared today', 'Details'].map((name) => measure(button(pirates, name))))
  expect(new Set(sizes).size).toBe(1)
})

test("Details opens the commission's panel with what to do first and how", async ({ page, api }) => {
  const alls = card(page, "All's Well That Ends Well")
  const { first, how, description, parts } = await commissionNamed(api, "All's Well That Ends Well")
  // The card says what to look for, its reward and its parts; the rest is in the panel.
  await expect(alls).toContainText('Look for: ')
  await expect(alls).not.toContainText(`First: ${first}`)
  const details = button(alls, 'Details')
  await expect(details).toHaveAttribute('aria-expanded', 'false')
  await details.click()
  const panel = panelOf(page, "All's Well That Ends Well")
  await expect(panel).toBeVisible()
  await expect(details).toHaveAttribute('aria-expanded', 'true')
  await expect(details).toHaveAttribute('aria-controls', (await panel.getAttribute('id')) ?? 'no id')
  await expect(panel).toContainText(description)
  await expect(panel).toContainText(`First: ${first}`)
  await expect(panel).toContainText(how!)
  await expect(panel).toContainText('Not seen yet.')
  for (const part of parts) await expect(panel.getByRole('checkbox', { name: part.name, exact: true })).toBeVisible()
  // Under the card's row.
  const own = (await alls.boundingBox())!
  await expect.poll(async () => (await panel.boundingBox())?.y ?? 0).toBeGreaterThan(own.y + own.height)
  // Escape inside it closes it and gives the focus back to Details.
  await panel.getByRole('checkbox').first().focus()
  await page.keyboard.press('Escape')
  await expect(details).toBeFocused()
  await expect(details).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('commission-panel')).toHaveCount(0)
  // One at a time, and another region is moving on, which closes it.
  await details.click()
  await openDetails(page, 'Swordseeker')
  await expect(page.getByTestId('commission-panel')).toHaveCount(1)
  await region(page, 'Mondstadt 4').click()
  await expect(cardNames(page)).toHaveCount(4)
  await expect(page.getByTestId('commission-panel')).toHaveCount(0)
  // A card without parts says on the card itself when it last appeared.
  const plain = (await model(api, 'mondstadt')).cards.filter((one) => one.parts.length === 0)
  expect(plain.length).toBeGreaterThan(0)
  for (const one of plain) {
    await expect(card(page, one.name).locator('.com-prog')).toHaveText(/^(Not seen yet|Last appeared \d+ \w+|Appeared today)\.$/)
  }
})

test('a part done can be unticked, and the core forgets its day', async ({ page, api }) => {
  // Pirates! Argh! starts with its first two parts done.
  const pirates = card(page, 'Pirates! Argh!')
  const { parts } = await commissionNamed(api, 'Pirates! Argh!')
  expect(parts.map((part) => part.done_at !== null)).toEqual([true, true, false])
  const box = pirates.getByRole('checkbox', { name: parts[1].name, exact: true })
  const row = (await openDetails(page, 'Pirates! Argh!')).getByRole('listitem').nth(1)
  const day = `done ${dayOf(parts[1].done_at!)}`
  await expect(box).toBeChecked()
  await expect(row).toContainText(day)
  await box.uncheck()
  await expect(noteText(page)).toHaveText('Unticked a part of Pirates! Argh!')
  await expect(box).not.toBeChecked()
  await expect(row.getByRole('checkbox')).not.toBeChecked() // the panel's box follows the card's at once
  await expect(row).not.toContainText(day)
  expect((await commissionNamed(api, 'Pirates! Argh!')).parts[1].done_at).toBeNull()
})

test('the done achievements fold away under Show {n} done', async ({ page, api }) => {
  const { done } = await model(api)
  expect(done.length).toBe(13)
  const show = button(page, `Show ${done.length} done`)
  await expect(show).toHaveAttribute('aria-expanded', 'false')
  await expect(fold(page)).toHaveCount(0)
  await expect(card(page, 'Love Is All Around')).toHaveCount(0)
  await show.click()
  const hide = button(page, 'Hide done')
  await expect(hide).toHaveAttribute('aria-expanded', 'true')
  await expect(cardNames(fold(page))).toHaveText(done.map((one) => one.name))
  await expect(doneBox(card(fold(page), 'Love Is All Around'))).toBeChecked()
  await hide.click()
  await expect(fold(page)).toHaveCount(0)
  await expect(button(page, `Show ${done.length} done`)).toHaveAttribute('aria-expanded', 'false')
})

test('In progress and Pin are pressed and pressed again, but In progress rests on a done one', async ({ page, api }) => {
  // Pirates! Argh! starts in progress and pinned, as the core has it.
  const pirates = card(page, 'Pirates! Argh!')
  await expect(button(pirates, 'In progress')).toHaveAttribute('aria-pressed', 'true')
  await expect(button(pirates, 'Pin')).toHaveAttribute('aria-pressed', 'true')
  const pinned = categories(page).getByRole('button', { name: 'Pinned' })
  await expect(pinned).toHaveText('Pinned 3')
  // Pin pins, and pressed again unpins.
  const alls = card(page, "All's Well That Ends Well")
  const pin = button(alls, 'Pin')
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await pin.click()
  await expect(noteText(page)).toHaveText("Pinned All's Well That Ends Well")
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  expect((await commissionNamed(api, "All's Well That Ends Well")).pinned).toBe(true)
  await expect(pinned).toHaveText('Pinned 4')
  await pin.click()
  await expect(noteText(page)).toHaveText("Unpinned All's Well That Ends Well")
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  expect((await commissionNamed(api, "All's Well That Ends Well")).pinned).toBe(false)
  await expect(pinned).toHaveText('Pinned 3')
  // In progress marks it, and pressed again marks it as not started.
  const sword = card(page, 'Swordseeker')
  const started = button(sword, 'In progress')
  await expect(started).toHaveAttribute('aria-pressed', 'false')
  await started.click()
  await expect(noteText(page)).toHaveText('Marked Swordseeker as in progress')
  await expect(started).toHaveAttribute('aria-pressed', 'true')
  expect((await commissionNamed(api, 'Swordseeker')).status).toBe('in_progress')
  await started.click()
  await expect(noteText(page)).toHaveText('Marked Swordseeker as not started')
  await expect(started).toHaveAttribute('aria-pressed', 'false')
  expect((await commissionNamed(api, 'Swordseeker')).status).toBe('not_started')
  // A done one is unticked first: its In progress rests, and a press sends nothing.
  await button(page, 'Show 13 done').click()
  const love = card(fold(page), 'Love Is All Around')
  const rests = button(love, 'In progress')
  await expect(rests).toHaveAttribute('aria-disabled', 'true')
  await expect(rests).toHaveAttribute('aria-pressed', 'false')
  const sent = changesSent(page)
  await rests.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300) // a request would have gone by now
  expect(sent).toEqual([])
  expect((await commissionNamed(api, 'Love Is All Around')).status).toBe('done')
  await expect(noteText(page)).toHaveText('Marked Swordseeker as not started')
})

test("the HoYoLAB line shows today's count", async ({ page, api }) => {
  const line = page.getByTestId('commissions').getByText(/^HoYoLAB: /)
  // Read at the start, in the demo's game day, whose four commissions are done.
  const { hoyolab } = await model(api)
  expect(hoyolab).toMatchObject({ done: 4, of: 4 })
  await expect(line).toHaveText(`HoYoLAB: 4 of 4 done, at ${clockOf(hoyolab!.at)}`)
  // Once the game day turns at 04:00 server time, that count is the day before's, and no line shows.
  await toTheNextGameDay(api)
  await expect(line).toHaveCount(0)
  expect((await model(api)).hoyolab).toBeNull()
  // A sync reads the new day's count.
  expect(await api.sync()).toBe('ok')
  const synced = (await model(api)).hoyolab
  expect(synced).not.toBeNull()
  await expect(line).toHaveText(`HoYoLAB: ${synced!.done} of ${synced!.of} done, at ${clockOf(synced!.at)}`)
  // A count the core does not have for today shows nothing either.
  await changeAnswer<CommissionsModel>(page, '/api/commissions', (data) => {
    data.hoyolab = null
  })
  await page.reload()
  await expect(cardNames(page)).toHaveCount(3)
  await expect(line).toHaveCount(0)
})

test('at 2,560 pixels the cards keep their width', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await expect(page.getByTestId('commission')).toHaveCount(3)
  const column = await page.getByTestId('commissions').evaluate((element) => element.getBoundingClientRect().width)
  expect(column).toBeLessThanOrEqual(1440)
  const boxes = await page.getByTestId('commission').evaluateAll((cards) =>
    cards.map((one) => {
      const { top, width } = one.getBoundingClientRect()
      return { top, width }
    }),
  )
  expect(Math.max(...boxes.map((box) => box.width))).toBeLessThanOrEqual(640)
  // Side by side, in fewer rows than cards.
  expect(new Set(boxes.map((box) => box.top)).size).toBeLessThan(boxes.length)
})

test('a changed card stays where it is until the player moves on', async ({ page }) => {
  // A tick would take the card into the fold, and the next card would move up under the pointer (spec 24).
  const pirates = card(page, 'Pirates! Argh!')
  const after = card(page, "All's Well That Ends Well")
  await expect(after).toBeVisible()
  const before = await placeOf(after)
  await doneBox(pirates).check()
  await expect(noteText(page)).toHaveText('Ticked Pirates! Argh!')
  await expect(region(page, 'Liyue 2')).toBeVisible() // the page has read the model since the tick
  await expect(doneBox(pirates)).toBeChecked()
  expect(await placeOf(after)).toEqual(before)
  await expect(button(page, 'Show 13 done')).toBeVisible()
  // Another region is moving on: back in Liyue, the card is folded away with the done ones.
  await region(page, 'Mondstadt 4').click()
  await expect(cardNames(page)).toHaveCount(4)
  await region(page, 'Liyue 2').click()
  await expect(cardNames(page)).toHaveText(["All's Well That Ends Well", 'Swordseeker'])
  await button(page, 'Show 14 done').click()
  // In the fold, an unticked card stays too, until a choice in the categories, even of the place shown.
  const folded = card(fold(page), 'Pirates! Argh!')
  const below = card(fold(page), 'Love Is All Around')
  const there = await placeOf(below)
  await doneBox(folded).uncheck()
  await expect(noteText(page)).toHaveText('Unticked Pirates! Argh!')
  await expect(region(page, 'Liyue 3')).toBeVisible()
  await expect(doneBox(folded)).not.toBeChecked()
  expect(await placeOf(below)).toEqual(there)
  await categories(page).getByRole('button', { name: 'Daily commissions' }).click()
  await expect(folded).toHaveCount(0)
  await expect(doneBox(card(page, 'Pirates! Argh!'))).not.toBeChecked()
  await expect(cardNames(page).first()).toHaveText('Pirates! Argh!')
})

test.describe('the keyboard keeps its place', () => {
  // A change made elsewhere, here through the API as from another window, takes a card into the fold.
  test('a card ticked elsewhere takes the focus with it into the open fold', async ({ page, api }) => {
    await button(page, 'Show 13 done').click()
    await button(card(page, "All's Well That Ends Well"), 'Pin').focus()
    const { id } = await commissionNamed(api, "All's Well That Ends Well")
    await api.post(`/api/achievements/stage/${id}`, { status: 'done' })
    const folded = card(fold(page), "All's Well That Ends Well")
    await expect(folded).toBeVisible()
    await expect(button(folded, 'Pin')).toBeFocused()
  })

  test('with the fold closed, the focus goes to the heading', async ({ page, api }) => {
    await button(card(page, "All's Well That Ends Well"), 'Pin').focus()
    const { id } = await commissionNamed(api, "All's Well That Ends Well")
    await api.post(`/api/achievements/stage/${id}`, { status: 'done' })
    await expect(card(page, "All's Well That Ends Well")).toHaveCount(0)
    await expect(title(page)).toBeFocused()
  })
})

test('the category reads its model again each minute, as the game day turns unannounced', async ({ page, api }) => {
  // The core announces no new game day at 04:00 server time. Here the page hears none of its events at all.
  await page.clock.install()
  await page.route('**/api/events', (route) => route.abort())
  await page.reload()
  const alls = card(page, "All's Well That Ends Well")
  const panel = await openDetails(page, "All's Well That Ends Well") // it has parts: it says when it appeared there
  await button(alls, 'Appeared today').click()
  await expect(noteText(page)).toHaveText("Marked All's Well That Ends Well as appeared today")
  await expect(panel).toContainText('Appeared today.')
  await toTheNextGameDay(api)
  await page.waitForTimeout(500)
  await expect(panel).toContainText('Appeared today.') // nothing has told the page
  await page.clock.fastForward('01:00')
  await expect(panel).toContainText('Last appeared 13 Oct.')
  await expect(button(alls, 'Appeared today')).toHaveAttribute('aria-disabled', 'false')
})

test.describe('what sits above the cards keeps its room while the changed cards stay', () => {
  // The commissions to look for, and the sentence of a region with no card left, sit above the cards. A change of the
  // player's that made them shorter or taller would move the changed card and every card after it, and a quick second
  // click would reach what moved under the pointer (spec 24).

  test('a Done tick that takes a line off the commissions to look for moves no card', async ({ page }) => {
    // At 1,040 pixels, the frame's narrowest, Mondstadt's four commissions take two lines.
    await page.setViewportSize({ width: 1040, height: 900 })
    await region(page, 'Mondstadt 4').click()
    const names = lookingFor(page).getByRole('listitem')
    await expect(names)
      .toHaveText(['A Surprise Gift', 'Tales of Winter', 'The Limitations of an Adventurer', 'Whispers in the Wind'])
    expect(await linesOf(lookingFor(page))).toBe(2)
    const cards = page.getByTestId('commission')
    const before = await placesOf(cards)
    const godwin = card(page, 'For the Love of Godwin')
    await doneBox(godwin).check()
    await expect(noteText(page)).toHaveText('Ticked For the Love of Godwin')
    await expect(region(page, 'Mondstadt 3')).toBeVisible() // the page has read the model since the tick
    expect(await placesOf(cards)).toEqual(before)
    // Its commission is no longer one to look for, and the others take one line.
    await expect(names).toHaveText(['A Surprise Gift', 'Tales of Winter', 'The Limitations of an Adventurer'])
    expect(await linesOf(lookingFor(page))).toBe(1)
    expect(await placesOf(cards)).toEqual(before)
    // Another region is moving on: back in Mondstadt, the cards left come up under the one line.
    await region(page, 'Liyue 3').click()
    await expect(cardNames(page)).toHaveText(['Pirates! Argh!', "All's Well That Ends Well", 'Swordseeker'])
    await region(page, 'Mondstadt 3').click()
    await expect(cardNames(page)).toHaveText(['Making Do', 'In the Name of Favonius', 'Telling It How It Is'])
    expect((await placeOf(card(page, 'Making Do'))).y).toBeLessThan(before[0].y)
  })

  test('an untick in the fold moves no card, and its commission joins the list once the player moves on', async ({
    page,
  }) => {
    // At 1,040 pixels Liyue's three commissions take one line, and a fourth, Good Sign, would take a second.
    await page.setViewportSize({ width: 1040, height: 1800 })
    const panel = lookingFor(page)
    const names = panel.getByRole('listitem')
    const three = ["For Old Time's Sake", 'Pirate Invasion, in Liyue Harbor!', 'Where Is the Unseen Razor?']
    await expect(names).toHaveText(three)
    await button(page, 'Show 13 done').click()
    const cards = page.getByTestId('commission')
    await expect(cards).toHaveCount(16)
    const love = card(fold(page), 'Love Is All Around')
    const before = { places: await placesOf(cards), panel: await heightOf(panel) }
    await doneBox(love).uncheck()
    await expect(noteText(page)).toHaveText('Unticked Love Is All Around')
    await expect(region(page, 'Liyue 4')).toBeVisible() // the page has read the model since the untick
    await expect(doneBox(love)).not.toBeChecked()
    expect(await placesOf(cards)).toEqual(before.places)
    // Good Sign waits, as the card does in the fold, until the player moves on.
    await expect(names).toHaveText(three)
    expect(await heightOf(panel)).toBe(before.panel)
    // A choice in the categories is moving on: the card joins those left, and Good Sign the list, on a second line.
    await categories(page).getByRole('button', { name: 'Daily commissions' }).click()
    await expect(card(fold(page), 'Love Is All Around')).toHaveCount(0)
    await expect(doneBox(card(page, 'Love Is All Around'))).not.toBeChecked()
    await expect(names)
      .toHaveText(["For Old Time's Sake", 'Good Sign', 'Pirate Invasion, in Liyue Harbor!', 'Where Is the Unseen Razor?'])
    expect(await linesOf(panel)).toBe(2)
  })

  test('an untick where every one was done moves no card, and the sentence goes', async ({ page }) => {
    await region(page, 'Natlan 0').click()
    const sentence = page.getByText('Every commission achievement in Natlan is done.')
    await expect(sentence).toBeVisible()
    await expect(lookingFor(page)).toContainText('Nothing to look for here.')
    await button(page, 'Show 4 done').click()
    const cards = page.getByTestId('commission')
    await expect(cards).toHaveCount(4)
    const before = await placesOf(cards)
    const saurian = card(fold(page), "Saurian's Cradle")
    await doneBox(saurian).uncheck()
    await expect(noteText(page)).toHaveText("Unticked Saurian's Cradle")
    await expect(region(page, 'Natlan 1')).toBeVisible() // the page has read the model since the untick
    await expect(doneBox(saurian)).not.toBeChecked()
    expect(await placesOf(cards)).toEqual(before)
    // The sentence is no longer so, and goes, but keeps its room. With no other card left above the fold to name one,
    // the commission of the card unticked is to look for at once: "Nothing to look for here." would not be so either.
    await expect(sentence).toHaveCount(0)
    await expect(lookingFor(page).getByRole('listitem')).toHaveText(['How to Make Friends'])
    expect(await placesOf(cards)).toEqual(before)
    // A choice in the categories is moving on: the card leaves the fold for the cards left.
    await categories(page).getByRole('button', { name: 'Daily commissions' }).click()
    await expect(card(fold(page), "Saurian's Cradle")).toHaveCount(0)
    await expect(cardNames(page).first()).toHaveText("Saurian's Cradle")
    expect((await placeOf(card(page, "Saurian's Cradle"))).y).toBeLessThan(before[0].y)
  })
})

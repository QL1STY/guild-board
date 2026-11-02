import type { Locator, Page } from '@playwright/test'
import type { Timer, TimersModel } from '../src/types.ts'
import { dashesOf, setBoard, shownAt, widgetById } from './board.ts'
import { type Api, DEMO_NOW, expect, test } from './fixtures.ts'

/*
 * The Timers and One timer widgets on the demo's Board at its 08:00 UTC: Fishing spot · Luhua Pool and Teapot · Jade
 * Field are ready; the hilichurl, the other teapot fields and Cider Lake (1) run; the player's own Shrine visits and
 * Parametric Transformer run too. The page's clock runs on a few seconds from the demo's start, so a time left is
 * matched to the minute before it.
 */

/** The demo's timers as the core gives them: the ready ones first, then the others, soonest first. */
async function timersOf(api: Api): Promise<Timer[]> {
  return (await api.get<TimersModel>('/api/timers')).timers
}

/** One of them, by its name. */
function named(timers: readonly Timer[], name: string): Timer {
  const found = timers.find((timer) => timer.name === name)
  if (found === undefined) throw new Error(`The demo has no timer called ${name}.`)
  return found
}

/** What a time left, such as "in 1 d 10 h", "in 10 h 5 min" or "in 5 min", comes to in minutes. */
function minutesLeft(text: string): number {
  const [days, hours, minutes] = [/(\d+) d/, /(\d+) h/, /(\d+) min/].map((part) => Number(part.exec(text)?.[1] ?? 0))
  return days * 1440 + hours * 60 + minutes
}

/** The 10 hours and a bit that bring the hilichurl back, from the demo's start. */
const HILICHURL_BACK_SECONDS = 10 * 3600 + 120

/** The solid button's fill (--w-btn), the progress gold (--w-fill) and the ready green (--w-done), as the page draws them. */
const SOLID = 'rgb(74, 83, 102)'
const GOLD = 'rgb(166, 117, 31)'
const GREEN = 'rgb(95, 149, 80)'

test("the Timers widget lists the demo's timers, ready first, and its Cleared goes through the undo line", async ({ page }) => {
  const widget = widgetById(page, 'start-timers')
  const rows = widget.getByRole('listitem')
  await expect(rows).toHaveCount(8)
  await expect(rows.nth(0)).toContainText('Fishing spot · Luhua Pool, Liyue')
  await expect(rows.nth(0)).toContainText('Ready')
  await expect(rows.nth(1)).toContainText('Teapot · Jade Field')
  await widget.getByRole('button', { name: 'Cleared Teapot · Jade Field' }).click()
  await expect(page.getByTestId('note').locator('.note-text')).toHaveText('Cleared Teapot · Jade Field')
  await expect(rows.filter({ hasText: 'Teapot · Jade Field' })).not.toContainText('Ready')
})

test('the Timers widget groups the ready timers above the running ones, soonest first, each in its dial', async ({ page, api }) => {
  const timers = await timersOf(api)
  const ready = timers.filter((timer) => timer.state === 'ready')
  const running = timers
    .filter((timer) => timer.state === 'running')
    .sort((a, b) => Date.parse(a.ready_at!) - Date.parse(b.ready_at!))
  const widget = widgetById(page, 'start-timers')
  // Each group is headed, and the rows follow their heading.
  await expect(widget.getByRole('heading', { level: 4 })).toHaveText(['Ready', 'Running'])
  const shape = await widget.locator('.tm-list > li').evaluateAll((items) =>
    items.map((item) => {
      if (item.classList.contains('tm-group')) return item.textContent ?? ''
      return item.classList.contains('ready') ? 'ready row' : 'row'
    }),
  )
  expect(shape).toEqual(['Ready', 'ready row', 'ready row', 'Running', 'row', 'row', 'row', 'row', 'row', 'row'])
  await expect(widget.locator('.tm-name')).toHaveText([...ready, ...running].map((timer) => timer.name))
  // The ready ones say since when; the running ones the time left first, then when, and the times only grow.
  await expect(widget.locator('.tm-row.ready .tm-state')).toHaveText(ready.map((timer) => `Ready since ${shownAt(timer.ready_at!)}`))
  for (const [index, timer] of running.entries()) {
    await expect(widget.locator('.tm-row:not(.ready) .tm-state').nth(index)).toHaveText(
      new RegExp(`^in \\d+ (d \\d+ h|h \\d+ min|min) · ${shownAt(timer.ready_at!)}$`),
    )
  }
  const lefts = (await widget.locator('.tm-row:not(.ready) .tm-state b').allInnerTexts()).map(minutesLeft)
  expect(lefts).toEqual([...lefts].sort((a, b) => a - b))
  // Each timer is in a dial with the sign of its kind, which stands in for the picture the demo does not download; the
  // ready ones' dials are ready ones.
  await expect(widget.locator('.tm-row .dial')).toHaveCount(8)
  await expect(widget.locator('.tm-row.ready .dial.ready')).toHaveCount(2)
  await expect(widget.locator('.tm-row:not(.ready) .dial.ready')).toHaveCount(0)
  const signs = await widget.locator('.tm-row').evaluateAll((all) =>
    all.map((row) => [row.querySelector('.tm-name')!.textContent ?? '', row.querySelector('.dial-art svg')!.innerHTML]),
  )
  const kind = (name: string) => {
    if (name.startsWith('Fishing spot')) return 'fish'
    if (name.startsWith('Teapot')) return 'teapot'
    return name === 'Unusual Hilichurl' ? 'mask' : 'hourglass'
  }
  const drawings = new Map<string, Set<string>>()
  for (const [name, drawing] of signs) drawings.set(kind(name), (drawings.get(kind(name)) ?? new Set()).add(drawing))
  expect([...drawings.keys()].sort()).toEqual(['fish', 'hourglass', 'mask', 'teapot'])
  for (const group of drawings.values()) expect(group.size).toBe(1) // every timer of a kind has the same sign
  expect(new Set([...drawings.values()].map((group) => [...group][0])).size).toBe(4) // and each kind its own
  // The player's own timers have the hourglass of the heading, and nothing more particular.
  expect([...drawings.get('hourglass')!][0]).toBe(await widget.locator('.w-head svg').innerHTML())
})

test("only a ready timer's Cleared is solid", async ({ page }) => {
  const widget = widgetById(page, 'start-timers')
  const ready = widget.locator('.tm-row.ready .gb-btn')
  const running = widget.locator('.tm-row:not(.ready) .gb-btn')
  await expect(ready).toHaveCount(2)
  await expect(running).toHaveCount(6)
  for (const button of await ready.all()) await expect(button).not.toHaveClass(/\bquiet\b/)
  for (const button of await running.all()) await expect(button).toHaveClass(/\bquiet\b/)
  // The solid one is filled and the quiet one is outlined, and they are one size, as buttons in one place are.
  await expect(ready.first()).toHaveCSS('background-color', SOLID)
  await expect(running.first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(running.first()).toHaveCSS('border-top-color', 'rgb(217, 205, 176)') // --w-quiet
  const sizes = await widget.locator('.tm-row .gb-btn').evaluateAll((all) =>
    all.map((one) => {
      const box = one.getBoundingClientRect()
      return `${Math.round(box.width * 10) / 10} × ${Math.round(box.height * 10) / 10}`
    }),
  )
  expect(new Set(sizes).size).toBe(1)
  expect(sizes[0]).toMatch(/ × 24$/)
})

test("a timer's dial draws the time passed as its ring, and a ready timer's as a full green ring with a tick badge", async ({
  page,
  api,
}) => {
  const hilichurl = named(await timersOf(api), 'Unusual Hilichurl')
  const widget = widgetById(page, 'start-timers')
  const running = widget.locator('.tm-row', { hasText: 'Unusual Hilichurl' }).locator('.dial')
  const ready = widget.locator('.tm-row', { hasText: 'Teapot · Jade Field' }).locator('.dial')
  // The ring is the share of the time passed on a track, in the progress gold: 2 of the hilichurl's 12 hours at the start.
  const passed = (Date.parse(DEMO_NOW) - Date.parse(hilichurl.started_at!)) / (Date.parse(hilichurl.ready_at!) - Date.parse(hilichurl.started_at!))
  const [filled, whole] = await dashesOf(running.locator('.d-fill'))
  expect(whole).toBe(100)
  expect(filled).toBeCloseTo(passed * 100, 0)
  await expect(running.locator('.d-fill')).toHaveCSS('stroke', GOLD)
  await expect(running.locator('.d-track')).toHaveCSS('stroke', 'rgb(221, 211, 187)') // --w-track
  await expect(running.locator('.dial-tick')).toHaveCount(0)
  // A ready timer's is full and green, with the tick badge in the green at the ring's lower right.
  expect(await dashesOf(ready.locator('.d-fill'))).toEqual([100, 100])
  await expect(ready.locator('.d-fill')).toHaveCSS('stroke', GREEN)
  const tick = ready.locator('.dial-tick')
  await expect(tick).toBeVisible()
  await expect(tick).toHaveCSS('background-color', GREEN)
  await expect(tick.locator('svg')).toBeVisible()
  // The dial is 38 pixels across and the ring in it 3 thick, drawn inside its box with no edge cut off, and the picture
  // lies inside the ring. The ring's own line runs half its thickness in from the dial's edge.
  for (const dial of [running, ready]) {
    const drawn = await dial.evaluate((one) => {
      const box = one.getBoundingClientRect()
      const ring = one.querySelector('.d-track')!.getBoundingClientRect()
      const art = one.querySelector('.dial-art')!.getBoundingClientRect()
      return {
        size: [box.width, box.height],
        line: (ring.left - box.left) * 2,
        outer: ring.width + (ring.left - box.left) * 2,
        inset: Math.min(art.left - box.left, art.top - box.top),
      }
    })
    expect(drawn.size).toEqual([38, 38])
    expect(drawn.line).toBeCloseTo(3, 1)
    expect(drawn.outer).toBeCloseTo(38, 1) // the ring's outer edge is the dial's edge, and no further out
    expect(drawn.inset).toBeGreaterThan(drawn.line) // the picture is inside the ring
  }
})

test('a timer with no known start has an empty track, and one that has done all its visits too', async ({ page, api }) => {
  const shrines = named(await timersOf(api), 'Shrine visits')
  // Set ready time on a timer that waits for a reset: the game gave the time left, and nothing says when it began.
  await api.post(`/api/timers/${shrines.id}/ready`, { at: new Date(Date.parse(DEMO_NOW) + 5 * 3600_000).toISOString() })
  await page.reload()
  const widget = widgetById(page, 'start-timers')
  const row = widget.locator('.tm-row', { hasText: 'Shrine visits' })
  await expect(row.locator('.tm-state')).toContainText('in 4 h')
  await expect(row.locator('.dial .d-track')).toBeVisible()
  await expect(row.locator('.dial .d-fill')).toHaveCount(0)
  // The third visit is the last: the timer says so, in the running group, with its track still empty.
  await api.post(`/api/timers/${shrines.id}/cleared`, {})
  await expect(row.locator('.tm-state')).toHaveText('All 3 visits done')
  await expect(row.locator('.dial .d-fill')).toHaveCount(0)
  await expect(row.locator('.dial')).not.toHaveClass(/\bready\b/)
  await expect(row.getByRole('button', { name: 'Cleared Shrine visits' })).toHaveClass(/\bquiet\b/)
  await expect(widget.getByRole('heading', { level: 4 })).toHaveText(['Ready', 'Running'])
})

test('after Cleared with the keyboard the focus stays on the timer, where its row has moved to', async ({ page }) => {
  const widget = widgetById(page, 'start-timers')
  const button = widget.getByRole('button', { name: 'Cleared Fishing spot · Luhua Pool, Liyue' })
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('note').locator('.note-text')).toHaveText('Cleared Fishing spot · Luhua Pool, Liyue')
  // From the ready group to the running one, among the others that run.
  const names = widget.locator('.tm-row:not(.ready) .tm-name')
  await expect(names).toHaveCount(7)
  await expect(names.filter({ hasText: 'Luhua Pool' })).toHaveCount(1)
  await expect(button).toBeFocused()
})

test('the Timers list scrolls inside the widget when it is long, and the list is not a stop of the keyboard', async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'timers-s', type: 'timers', w: 3, h: 2, settings: {} }])
  const widget = widgetById(page, 'timers-s')
  const list = widget.locator('.tm-list')
  await expect(widget.locator('.tm-row')).toHaveCount(8)
  expect(await list.evaluate((one) => one.scrollHeight > one.clientHeight + 1), 'the list scrolls').toBe(true)
  expect(await widget.locator('.w-body').evaluate((one) => one.scrollHeight <= one.clientHeight + 1), 'the body does not').toBe(true)
  // The buttons are the stops, and the list is none: Shift+Tab leaves the first one for what lies before the widget.
  const first = widget.getByRole('button', { name: 'Cleared Fishing spot · Luhua Pool, Liyue' })
  await first.focus()
  await page.keyboard.press('Shift+Tab')
  expect(await list.evaluate((one) => one === document.activeElement)).toBe(false)
  expect(await widget.evaluate((one) => one.contains(document.activeElement))).toBe(false)
  // A button that is out of sight is brought into the list's view by the keyboard.
  const last = widget.getByRole('button', { name: 'Cleared Parametric Transformer' })
  await last.focus()
  const [box, around] = [await last.boundingBox(), await list.boundingBox()]
  expect(box!.y).toBeGreaterThanOrEqual(around!.y - 0.5)
  expect(box!.y + box!.height).toBeLessThanOrEqual(around!.y + around!.height + 0.5)
})

test('the Timers widget shows only the ready ones, or the ones chosen', async ({ page }) => {
  const sheet = page.getByRole('region', { name: 'Settings of Timers' })
  const settings = async (choose: () => Promise<void>) => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await widgetById(page, 'start-timers').getByRole('button', { name: 'Settings of Timers' }).click()
    await choose()
    await sheet.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible() // saved
  }
  const widget = widgetById(page, 'start-timers')
  const names = widget.locator('.tm-name')
  await settings(() => sheet.getByRole('radio', { name: 'Ready' }).click())
  await expect(names).toHaveText(['Fishing spot · Luhua Pool, Liyue', 'Teapot · Jade Field'])
  await expect(widget.getByRole('heading', { level: 4 })).toHaveText(['Ready']) // no group without a timer
  await expect(widget.locator('.w-meta')).toHaveText('2 ready')
  await settings(async () => {
    await sheet.getByRole('radio', { name: 'Chosen' }).click()
    await sheet.getByRole('checkbox', { name: 'Shrine visits' }).check()
  })
  await expect(names).toHaveText(['Shrine visits'])
  await expect(widget.getByRole('heading', { level: 4 })).toHaveText(['Running'])
  await expect(widget.locator('.w-meta')).toHaveText('1 running')
})

test('the Timers widget says "2 ready · 6 running" in its heading, and says what it has when it shows none', async ({ page, api }) => {
  await expect(widgetById(page, 'start-timers').locator('.w-meta')).toHaveText('2 ready · 6 running')
  await setBoard(api, page, [{ id: 'timers-1', type: 'timers', w: 3, h: 2, settings: { show: 'chosen', chosen: [] } }])
  const widget = widgetById(page, 'timers-1')
  await expect(widget).toContainText('No timer chosen.')
  await expect(widget.locator('.w-meta')).toHaveCount(0) // nothing to say, so nothing is set there
})

test("One timer shows its timer's name, the time left, and at 2 × 2 the achievement it counts toward", async ({ page, api }) => {
  const hilichurl = named(await timersOf(api), 'Unusual Hilichurl')
  const settings = { timer: hilichurl.id }
  await setBoard(api, page, [
    { id: 'one-s', type: 'one-timer', w: 2, h: 1, settings },
    { id: 'one-l', type: 'one-timer', w: 2, h: 2, settings },
  ])
  const [small, large] = ['one-s', 'one-l'].map((id) => widgetById(page, id))
  const back = shownAt(hilichurl.ready_at!)
  for (const widget of [small, large]) {
    // The heading names the timer, and the widget is still named by its type for a screen reader.
    await expect(widget.getByRole('heading', { level: 3 })).toHaveText('Unusual Hilichurl')
    await expect(widget).toHaveAttribute('aria-label', 'One timer')
    // The time left in large figures, in the dial's company; Cleared quiet, as the timer runs.
    await expect(widget.locator('.one-big')).toHaveText(/^(9 h \d{1,2}|10 h 0) min$/)
    await expect(widget.locator('[data-centre] .dial')).toBeVisible()
    await expect(widget.locator('.dial')).not.toHaveClass(/\bready\b/)
    const [filled, whole] = await dashesOf(widget.locator('.d-fill'))
    expect(filled).toBeCloseTo(100 / 6, 0) // 2 of its 12 hours have passed
    expect(whole).toBe(100)
    await expect(widget.getByRole('button', { name: 'Cleared Unusual Hilichurl' })).toHaveClass(/\bquiet\b/)
  }
  // At 2 × 1 there is room for no more: the clock time is in the heading, and "Back in" and the achievement are left out.
  await expect(small.locator('.w-meta')).toHaveText(back)
  await expect(small.getByText('Back in', { exact: true })).toBeHidden()
  await expect(small.locator('.one-when')).toBeHidden()
  await expect(small.locator('.one-ach')).toBeHidden()
  // At 2 × 2 they are in the body: the clock time has moved out of the heading.
  await expect(large.locator('.w-meta')).toHaveCount(0)
  await expect(large.getByText('Back in', { exact: true })).toBeVisible()
  await expect(large.locator('.one-when')).toHaveText(back)
  await expect(large.locator('.one-ach')).toContainText('...Well, That Was Strange')
  await expect(large.locator('.one-ach b')).toHaveText('37 of 50 kills')
})

test('One timer of a ready timer shows the Ready seal and a solid Cleared', async ({ page, api }) => {
  const jade = named(await timersOf(api), 'Teapot · Jade Field')
  const settings = { timer: jade.id }
  await setBoard(api, page, [
    { id: 'one-s', type: 'one-timer', w: 2, h: 1, settings },
    { id: 'one-l', type: 'one-timer', w: 2, h: 2, settings },
  ])
  for (const id of ['one-s', 'one-l']) {
    const widget = widgetById(page, id)
    await expect(widget.getByRole('heading', { level: 3 })).toHaveText('Teapot · Jade Field')
    await expect(widget.locator('.seal')).toHaveText('Ready')
    await expect(widget.locator('.one-when')).toHaveText(`since ${shownAt(jade.ready_at!)}`)
    // The ring is full and green with its tick badge, and nothing counts down.
    await expect(widget.locator('.dial')).toHaveClass(/\bready\b/)
    expect(await dashesOf(widget.locator('.d-fill'))).toEqual([100, 100])
    await expect(widget.locator('.d-fill')).toHaveCSS('stroke', GREEN)
    await expect(widget.locator('.dial-tick')).toBeVisible()
    await expect(widget.locator('.one-big')).toHaveCount(0)
    const cleared = widget.getByRole('button', { name: 'Cleared Teapot · Jade Field' })
    await expect(cleared).not.toHaveClass(/\bquiet\b/)
    await expect(cleared).toHaveCSS('background-color', SOLID)
    await expect(widget.locator('.w-meta')).toHaveCount(0) // "since" is in the body, so the heading has nothing to add
  }
  // The achievement it counts toward is named where there is room. Its count is not read beside this Cleared, which
  // does not change it: it has the − and + of the tests below.
  await expect(widgetById(page, 'one-l').locator('.one-ach')).toContainText("We're Going to Need More Crops!")
  await expect(widgetById(page, 'one-s').locator('.one-ach')).toBeHidden()
})

/** The count of a timer's achievement as the core holds it. */
async function countOf(api: Api, name: string): Promise<number> {
  return named(await timersOf(api), name).achievement!.counter!.value
}

test('One timer of a teapot field counts with − and + from 2 × 2 up, and + raises the count by one, which Undo takes back', async ({
  page,
  api,
}) => {
  // One harvest gathers as many items as were planted, so a teapot field's Cleared counts none: the count is changed
  // where it is shown, as on the Timers category's card.
  const field = 'Teapot · Orderly Meadow'
  const settings = { timer: named(await timersOf(api), field).id }
  await setBoard(api, page, [
    { id: 'one-l', type: 'one-timer', w: 2, h: 2, settings },
    { id: 'one-xl', type: 'one-timer', w: 3, h: 3, settings },
  ])
  expect(await countOf(api, field)).toBe(0)
  for (const id of ['one-l', 'one-xl']) {
    const widget = widgetById(page, id)
    // The achievement's name, and under it the count between the two buttons that change it.
    await expect(widget.locator('.one-ach')).toContainText('Stop! Gather Time.')
    await expect(widget.locator('.one-ach b')).toHaveText('0 of 200')
    const [down, up] = [widget.getByRole('button', { name: 'Count down' }), widget.getByRole('button', { name: 'Count up' })]
    await expect(down).toHaveAttribute('aria-disabled', 'true') // at 0 it does nothing
    await expect(up).toBeVisible()
    // The two are one size, and the 24 pixels that buttons are at least.
    const [downBox, upBox] = [await down.boundingBox(), await up.boundingBox()]
    expect([downBox!.width, downBox!.height]).toEqual([upBox!.width, upBox!.height])
    expect(upBox!.height).toBeGreaterThanOrEqual(24)
    // The count stands between them.
    const countBox = (await widget.locator('.one-ach b').boundingBox())!
    expect(downBox!.x + downBox!.width).toBeLessThanOrEqual(countBox.x + 0.5)
    expect(countBox.x + countBox.width).toBeLessThanOrEqual(upBox!.x + 0.5)
  }
  const large = widgetById(page, 'one-l')
  const note = page.getByTestId('note')
  await large.getByRole('button', { name: 'Count up' }).click()
  await expect(large.locator('.one-ach b')).toHaveText('1 of 200')
  await expect(note.locator('.note-text')).toHaveText('Set the count of Stop! Gather Time. to 1')
  await expect.poll(() => countOf(api, field)).toBe(1) // the core's count has gone up by one
  await expect(widgetById(page, 'one-xl').locator('.one-ach b')).toHaveText('1 of 200') // and the timer's other widget follows it
  await note.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => countOf(api, field)).toBe(0)
  await expect(large.locator('.one-ach b')).toHaveText('0 of 200')
  await expect(widgetById(page, 'one-xl').locator('.one-ach b')).toHaveText('0 of 200')
})

test('the − and + of a One timer work from the keyboard, and the focus stays on them as the count changes', async ({ page, api }) => {
  const field = 'Teapot · Orderly Meadow'
  const timer = named(await timersOf(api), field)
  await api.post(`/api/achievements/counter/${timer.achievement!.id}`, { value: 2 })
  await setBoard(api, page, [{ id: 'one-l', type: 'one-timer', w: 2, h: 2, settings: { timer: timer.id } }])
  const large = widgetById(page, 'one-l')
  const [down, up] = [large.getByRole('button', { name: 'Count down' }), large.getByRole('button', { name: 'Count up' })]
  await expect(large.locator('.one-ach b')).toHaveText('2 of 200')
  await up.focus()
  await page.keyboard.press('Enter')
  await expect(large.locator('.one-ach b')).toHaveText('3 of 200')
  await expect(page.getByTestId('note').locator('.note-text')).toHaveText('Set the count of Stop! Gather Time. to 3')
  await expect(up).toBeFocused()
  await page.keyboard.press('Shift+Tab') // from + to the count's other button
  await expect(down).toBeFocused()
  for (const shown of ['2 of 200', '1 of 200', '0 of 200']) {
    await page.keyboard.press('Space')
    await expect(large.locator('.one-ach b')).toHaveText(shown)
  }
  // At 0 there is nothing to take away: the button keeps the focus, says it does nothing, and sends nothing.
  await expect(page.getByTestId('note').locator('.note-text')).toHaveText('Set the count of Stop! Gather Time. to 0')
  await expect(down).toBeFocused()
  await expect(down).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  expect(await countOf(api, field)).toBe(0)
  await expect(large.locator('.one-ach b')).toHaveText('0 of 200')
})

test("One timer of the hilichurl says its count as text, with no − or +, and its Cleared adds the kill", async ({ page, api }) => {
  // The hilichurl's Cleared counts a kill, so its count moves with the button beside it and needs no buttons of its own.
  const settings = { timer: named(await timersOf(api), 'Unusual Hilichurl').id }
  await setBoard(api, page, [
    { id: 'one-l', type: 'one-timer', w: 2, h: 2, settings },
    { id: 'one-xl', type: 'one-timer', w: 3, h: 3, settings },
  ])
  for (const id of ['one-l', 'one-xl']) {
    const widget = widgetById(page, id)
    await expect(widget.locator('.one-ach')).toContainText('...Well, That Was Strange')
    await expect(widget.locator('.one-ach b')).toHaveText('37 of 50 kills')
    await expect(widget.getByRole('button', { name: 'Count up' })).toHaveCount(0)
    await expect(widget.getByRole('button', { name: 'Count down' })).toHaveCount(0)
    await expect(widget.getByRole('spinbutton')).toHaveCount(0)
  }
  await widgetById(page, 'one-l').getByRole('button', { name: 'Cleared Unusual Hilichurl' }).click()
  await expect(page.getByTestId('note').locator('.note-text')).toHaveText('Cleared Unusual Hilichurl')
  await expect(widgetById(page, 'one-l').locator('.one-ach b')).toHaveText('38 of 50 kills')
  await expect(widgetById(page, 'one-xl').locator('.one-ach b')).toHaveText('38 of 50 kills')
  expect(await countOf(api, 'Unusual Hilichurl')).toBe(38)
})

test('at 2 × 1 One timer shows no count, whether the timer is counted by Cleared or by − and +', async ({ page, api }) => {
  const timers = await timersOf(api)
  await setBoard(api, page, [
    { id: 'one-clear', type: 'one-timer', w: 2, h: 1, settings: { timer: named(timers, 'Unusual Hilichurl').id } },
    { id: 'one-steps', type: 'one-timer', w: 2, h: 1, settings: { timer: named(timers, 'Teapot · Orderly Meadow').id } },
  ])
  for (const [id, name] of [['one-clear', 'Unusual Hilichurl'], ['one-steps', 'Teapot · Orderly Meadow']]) {
    const widget = widgetById(page, id)
    await expect(widget.getByRole('heading', { level: 3 })).toHaveText(name) // it has read its timer
    await expect(widget.locator('.one-ach')).toBeHidden()
    await expect(widget.getByRole('button', { name: /^Count (up|down)$/ })).toHaveCount(0)
    await expect(widget).not.toContainText(/\d of \d/, { useInnerText: true })
    await expect(widget.getByRole('button', { name: `Cleared ${name}` })).toBeVisible() // and Cleared is all it has to press
  }
})

test("One timer's Cleared clears its timer through the undo line, rests after a press, and the widget follows the timer", async ({
  page,
  api,
}) => {
  const jade = named(await timersOf(api), 'Teapot · Jade Field')
  await setBoard(api, page, [{ id: 'one-1', type: 'one-timer', w: 2, h: 2, settings: { timer: jade.id } }])
  const one = widgetById(page, 'one-1')
  const cleared = one.getByRole('button', { name: 'Cleared Teapot · Jade Field' })
  await expect(one.locator('.seal')).toHaveText('Ready')
  await cleared.click()
  await expect(cleared).toHaveAttribute('aria-disabled', 'true') // it rests, so that a second click of a double-click does nothing
  await expect(page.getByTestId('note').locator('.note-text')).toHaveText('Cleared Teapot · Jade Field')
  await expect(one.locator('.seal')).toHaveCount(0)
  await expect(one.locator('.one-big')).toHaveText(/^2 d \d+ h$/) // the teapot's 70 hours
  await expect(one.locator('.dial')).not.toHaveClass(/\bready\b/)
  await expect(cleared).toHaveClass(/\bquiet\b/)
  await expect(cleared).toHaveAttribute('aria-disabled', 'false') // and is pressed again once it has rested
})

test("One timer's heading names its timer instead of the type, and has a meta only when there is something to say", async ({
  page,
  api,
}) => {
  const timers = await timersOf(api)
  const [hilichurl, jade] = [named(timers, 'Unusual Hilichurl'), named(timers, 'Teapot · Jade Field')]
  await setBoard(api, page, [
    { id: 'one-none', type: 'one-timer', w: 2, h: 1, settings: {} },
    { id: 'one-run', type: 'one-timer', w: 2, h: 1, settings: { timer: hilichurl.id } },
    { id: 'one-ready', type: 'one-timer', w: 2, h: 1, settings: { timer: jade.id } },
  ])
  const [none, run, ready] = ['one-none', 'one-run', 'one-ready'].map((id) => widgetById(page, id))
  const name = (widget: Locator) => widget.getByRole('heading', { level: 3 })
  // No timer chosen yet: the heading says the type, and there is no meta.
  await expect(none).toContainText('Choose a timer in Edit.')
  await expect(name(none)).toHaveText('One timer')
  await expect(none.locator('.w-meta')).toHaveCount(0)
  // A running timer's own name, and its clock time as the meta at the size that has no room for it in the body.
  await expect(name(run)).toHaveText('Unusual Hilichurl')
  await expect(run.locator('.w-meta')).toHaveText(shownAt(hilichurl.ready_at!))
  // A ready timer has nothing to put there.
  await expect(name(ready)).toHaveText('Teapot · Jade Field')
  await expect(ready.locator('.w-meta')).toHaveCount(0)
  // The meta follows the size: no longer one cell tall, the body has the clock time. (In Edit the heading holds the
  // widget's buttons instead.)
  const resize = async (key: string) => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await run.focus()
    await page.keyboard.press(key)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  }
  await resize('Shift+ArrowDown') // 2 × 2
  await expect(run.locator('.w-meta')).toHaveCount(0)
  await expect(name(run)).toHaveText('Unusual Hilichurl')
  await resize('Shift+ArrowUp') // 2 × 1
  await expect(run.locator('.w-meta')).toHaveText(shownAt(hilichurl.ready_at!))
  // The settings come into view with the focus on them, and choosing a timer there puts its name in the heading.
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await none.getByRole('button', { name: 'Settings of One timer' }).click()
  const sheet = page.getByRole('region', { name: 'Settings of One timer' })
  await expect(sheet).toBeInViewport()
  await expect(sheet).toBeFocused()
  await sheet.getByRole('radio', { name: 'Shrine visits' }).check()
  await expect(name(none)).toHaveText('Shrine visits')
})

test('One timer says when its timer was removed, and Undo brings it back', async ({ page, core, api }) => {
  const { timers } = await api.get<TimersModel>('/api/timers')
  const shrines = timers.find((timer) => timer.name === 'Shrine visits')!
  await setBoard(api, page, [{ id: 'one-1', type: 'one-timer', w: 2, h: 2, settings: { timer: shrines.id } }])
  const one = widgetById(page, 'one-1')
  await expect(one).toContainText('Shrine visits')
  await expect(one.getByRole('heading', { level: 3 })).toHaveText('Shrine visits')
  await page.goto(`${core.origin}/#/achievements/timers`)
  // Remove is in the timer's panel, which its card's More opens.
  await page.getByRole('article', { name: 'Shrine visits' }).getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('region', { name: 'Shrine visits' }).getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByRole('article', { name: 'Shrine visits' })).toHaveCount(0)
  await page.goto(`${core.origin}/#/board`)
  await expect(one).toContainText('This timer was removed.')
  await expect(one.getByRole('heading', { level: 3 })).toHaveText('One timer') // the removed timer's name is not kept
  await expect(page.getByTestId('note')).toHaveCount(0) // a page change closed the note
  await page.keyboard.press('Control+z') // the Board's Ctrl+Z reaches the change made on the other page
  await expect(one).toContainText('Shrine visits')
  await expect(one.getByRole('heading', { level: 3 })).toHaveText('Shrine visits')
})

test('One timer asks for a timer until it has one', async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'one-1', type: 'one-timer', w: 2, h: 2, settings: {} }])
  await expect(widgetById(page, 'one-1')).toContainText('Choose a timer in Edit.')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await widgetById(page, 'one-1').getByRole('button', { name: 'Settings of One timer' }).click()
  const sheet = page.getByRole('region', { name: 'Settings of One timer' })
  await sheet.getByRole('radio', { name: 'Unusual Hilichurl' }).check()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(widgetById(page, 'one-1')).toContainText('Unusual Hilichurl')
})

/**
 * Records the animations of the page from now on, and answers what they have done so far: each one that starts or goes
 * round again, with the element it is on, whether that is the ring of a ready dial, and, when one ends, whether it ran
 * for any time ("after a while") or ended as it began ("at once"). A dial that turns ready draws a new ring, whose
 * animation is the one that fills it; a ring that was only given the green would start none.
 */
async function recordAnimations(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { seen: string[] }).seen = seen
    for (const type of ['animationstart', 'animationiteration', 'animationend'] as const) {
      document.addEventListener(type, (event) => {
        const { animationName, elapsedTime, target } = event as AnimationEvent
        const element = target as Element
        const ready = element.closest('.dial')?.classList.contains('ready') === true
        const how = type === 'animationend' ? (elapsedTime === 0 ? ' at once' : ' after a while') : ''
        seen.push(`${type.replace('animation', '')} ${animationName} ${element.getAttribute('class') ?? ''}${ready ? ' (ready)' : ''}${how}`)
      })
    }
  })
  return () => page.evaluate(() => (window as unknown as { seen: string[] }).seen)
}

/** The hilichurl's One timer, on the screen with its ring drawn and still, ready to be watched as its time comes. */
async function watchHilichurl(page: Page, api: Api): Promise<Locator> {
  const hilichurl = named(await timersOf(api), 'Unusual Hilichurl')
  await setBoard(api, page, [{ id: 'one-1', type: 'one-timer', w: 2, h: 2, settings: { timer: hilichurl.id } }])
  const one = widgetById(page, 'one-1')
  await expect(one.locator('.one-big')).toBeVisible()
  await expect(one.locator('.dial')).not.toHaveClass(/\bready\b/)
  // The ring filled, in the gold, as the page opened; that is over before the timer's time is.
  await expect.poll(() => one.locator('.d-fill').evaluate((ring) => ring.getAnimations().length)).toBe(0)
  return one
}

test('when a One timer turns ready on the screen its ring fills to green once, and then holds still', async ({ page, api }) => {
  const one = await watchHilichurl(page, api)
  const seen = await recordAnimations(page)
  await api.advance(HILICHURL_BACK_SECONDS)
  await expect(one.locator('.dial.ready')).toBeVisible()
  await expect(one.locator('.seal')).toHaveText('Ready')
  expect(await dashesOf(one.locator('.d-fill'))).toEqual([100, 100])
  await expect(one.locator('.d-fill')).toHaveCSS('stroke', GREEN)
  // The ring is filled once, over the time the motion tokens give it.
  const filled = ['start sweep d-fill (ready)', 'end sweep d-fill (ready) after a while']
  await expect.poll(seen).toEqual(filled)
  // And then it holds still: nothing starts or repeats, though the page's clock goes on ticking.
  await expect.poll(() => one.locator('.d-fill').evaluate((ring) => ring.getAnimations().length)).toBe(0)
  await page.waitForTimeout(2200)
  expect(await seen()).toEqual(filled)
  await expect(one.locator('.d-fill')).toHaveCSS('animation-iteration-count', '1')
})

test('with reduced motion the ring of a One timer that turns ready is filled at once', async ({ page, api }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const one = await watchHilichurl(page, api)
  const seen = await recordAnimations(page)
  await api.advance(HILICHURL_BACK_SECONDS)
  await expect(one.locator('.dial.ready')).toBeVisible()
  expect(await dashesOf(one.locator('.d-fill'))).toEqual([100, 100])
  await expect(one.locator('.d-fill')).toHaveCSS('animation-duration', '0s')
  await expect.poll(seen).toEqual(['start sweep d-fill (ready)', 'end sweep d-fill (ready) at once'])
})

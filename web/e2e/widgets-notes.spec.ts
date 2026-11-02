import type { Locator } from '@playwright/test'
import type { BoardModel, Status, Widget } from '../src/types.ts'
import { changeAnswer } from './answers.ts'
import { clockOf, counted, dashesOf, PLAY_WEEK, playAs, setBoard, shownAt, widgetById } from './board.ts'
import { type Api, expect, test } from './fixtures.ts'

/*
 * The widgets of HoYoLAB's Real-Time Notes, the resets and the play time, on the demo at its 08:00 UTC on Tuesday
 * 2026-10-13, Europe server. The demo's notes: five expeditions, three back and two out for 2 h and 5 h 30 min; the
 * transformer ready in 3 d 4 h; realm currency 1,800 of 2,400, full in 10 h; boss discounts 1 of 3. The commissions
 * done depend on the demo's day, and the resin is counted on from the clock the demo starts at, so the tests read them
 * from the core and do not hold a number of their own. The page's clock runs on a few seconds from the demo's start,
 * so a time left is matched to the minute or the hour before it.
 */

/** The resin and its maximum as the core counts them now, which is what the Resin widget must show. */
async function resinNow(api: Api): Promise<{ resin: number; max: number }> {
  const { account } = await api.get<Status>('/api/status')
  return { resin: account!.resin!, max: account!.resin_max! }
}

const NOTES_BOARD: Widget[] = [
  { id: 'resin-1', type: 'resin', w: 2, h: 2, settings: {} },
  { id: 'expeditions-1', type: 'expeditions', w: 3, h: 3, settings: {} },
  { id: 'daily-1', type: 'daily-notes', w: 3, h: 2, settings: {} },
  { id: 'resets-1', type: 'resets', w: 2, h: 2, settings: {} },
  { id: 'playtime-1', type: 'playtime', w: 2, h: 2, settings: {} },
]

/** The notes as the core last read them, which the demo's figures come from. */
async function notesOf(api: Api): Promise<NonNullable<BoardModel['notes']>> {
  return (await api.get<BoardModel>('/api/board')).notes!
}

/** The `val` or `sub` of a Daily notes row as it is seen: the text of the other size (display: none) is left out. */
const seen = { useInnerText: true }

test("Daily notes shows commissions and boss discounts as pips, realm currency as a bar, and the transformer's time", async ({
  page,
  api,
}) => {
  const notes = await notesOf(api)
  const done = notes.commissions_done // the demo's depends on its day
  await setBoard(api, page, [
    { id: 'daily-s', type: 'daily-notes', w: 2, h: 2, settings: {} },
    { id: 'daily-l', type: 'daily-notes', w: 3, h: 3, settings: {} },
  ])
  const [small, large] = ['daily-s', 'daily-l'].map((id) => widgetById(page, id))
  for (const widget of [small, large]) {
    // The four rows are the visual centre, under the heading that says when the notes were read.
    await expect(widget.locator('[data-centre]')).toBeVisible()
    await expect(widget.locator('[data-centre]').getByRole('listitem')).toHaveCount(4)
    await expect(widget.locator('.w-meta')).toHaveText(/^Read at \d{2}:\d{2}$/)
    // Commissions: four pips, one filled for each done, named by what they say.
    const commissions = widget.locator('.dn-commissions').getByRole('img', { name: `${done} of 4 done` })
    await expect(commissions.locator('i')).toHaveCount(4)
    await expect(commissions.locator('i.on')).toHaveCount(done)
    await expect(commissions).not.toHaveClass(/unknown/)
    // Boss discounts: three pips, one filled for each left.
    const discounts = widget.locator('.dn-discounts').getByRole('img', { name: '1 of 3 left' })
    await expect(discounts.locator('i')).toHaveCount(3)
    await expect(discounts.locator('i.on')).toHaveCount(1)
    // Realm currency: a bar of 1,800 against 2,400, 75 in a hundred.
    const bar = widget.locator('.dn-realm .bar')
    await expect(bar).toBeVisible()
    expect(parseFloat((await bar.locator('.bar-fill').getAttribute('style'))!.replace('width:', ''))).toBeCloseTo(75, 1)
    // Each row has a sign; the demo downloads no picture, so the realm currency and the transformer show theirs.
    for (const row of ['commissions', 'discounts', 'realm', 'transformer']) {
      await expect(widget.locator(`.dn-${row} .ic .sign`)).toBeVisible()
    }
  }
  // 2 × 2 is compact: short labels, the value alone, and the transformer's wait.
  await expect(small.locator('.dn-commissions .lab')).toHaveText('Commissions', seen)
  await expect(small.locator('.dn-commissions .val')).toHaveText(`${done} of 4`, seen)
  await expect(small.locator('.dn-discounts .lab')).toHaveText('Boss discounts', seen)
  await expect(small.locator('.dn-discounts .val')).toHaveText('1 left', seen)
  await expect(small.locator('.dn-realm .val')).toHaveText('1,800', seen)
  await expect(small.locator('.dn-transformer .lab')).toHaveText('Transformer', seen)
  await expect(small.locator('.dn-transformer .val')).toHaveText(/^in 3 d [34] h$/, seen)
  await expect(small.locator('.sub:visible')).toHaveCount(0)
  // 3 × 3 has the full labels, the visual on a line of its own, and the times.
  await expect(large.locator('.dn-commissions .lab')).toHaveText('Commissions', seen)
  await expect(large.locator('.dn-commissions .val')).toHaveText(`${done} of 4 done`, seen)
  await expect(large.locator('.dn-commissions .sub')).toHaveText('Today, since 04:00')
  await expect(large.locator('.dn-discounts .lab')).toHaveText('Weekly boss discounts', seen)
  await expect(large.locator('.dn-discounts .val')).toHaveText('1 of 3 left', seen)
  await expect(large.locator('.dn-discounts .sub')).toHaveText('This week, since Monday')
  await expect(large.locator('.dn-realm .val')).toHaveText('1,800 of 2,400', seen)
  await expect(large.locator('.dn-realm .sub')).toHaveText(`Full ${shownAt(notes.realm_currency_full_at!)}`)
  await expect(large.locator('.dn-transformer .lab')).toHaveText('Parametric Transformer', seen)
  await expect(large.locator('.dn-transformer .val')).toHaveText(shownAt(notes.transformer!.ready_at!), seen)
  await expect(large.locator('.dn-transformer .sub')).toHaveText(/^Ready in 3 d [34] h$/)
  const tops = (widget: Locator) =>
    widget.locator('.dn-commissions').evaluate((row) => {
      const top = (selector: string) => row.querySelector(selector)!.getBoundingClientRect().top
      return { pips: top('.pips'), label: top('.lab') }
    })
  const [compact, spacious] = [await tops(small), await tops(large)]
  expect(Math.abs(compact.pips - compact.label), 'compact: the pips are on the line of the label').toBeLessThan(10)
  expect(spacious.pips - spacious.label, 'full: the pips are on a line of their own under it').toBeGreaterThan(20)
})

test('Daily notes read before the daily reset shows dotted pips and says so', async ({ page, api }) => {
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    board.notes!.read_today = false // yesterday's count of commissions is not today's
  })
  await setBoard(api, page, [
    { id: 'daily-s', type: 'daily-notes', w: 2, h: 2, settings: {} },
    { id: 'daily-l', type: 'daily-notes', w: 3, h: 3, settings: {} },
  ])
  for (const id of ['daily-s', 'daily-l']) {
    const widget = widgetById(page, id)
    const commissions = widget.locator('.dn-commissions').getByRole('img', { name: 'Not read since 04:00' })
    await expect(commissions).toHaveClass(/unknown/)
    await expect(commissions.locator('i')).toHaveCount(4)
    await expect(commissions.locator('i.on')).toHaveCount(0) // none filled: the count is not known
    await expect(commissions.locator('i').first()).toHaveCSS('border-top-style', 'dotted')
    await expect(widget.locator('.dn-commissions .val')).toHaveText('Not read since 04:00', seen)
    // The week's boss discounts are still this week's.
    await expect(widget.locator('.dn-discounts').getByRole('img', { name: '1 of 3 left' })).not.toHaveClass(/unknown/)
  }
})

test("Daily notes read before Monday's reset shows dotted pips for the boss discounts and says so", async ({ page, api }) => {
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    board.notes!.read_this_week = false
  })
  await setBoard(api, page, [
    { id: 'daily-s', type: 'daily-notes', w: 2, h: 2, settings: {} },
    { id: 'daily-l', type: 'daily-notes', w: 3, h: 3, settings: {} },
  ])
  for (const id of ['daily-s', 'daily-l']) {
    const widget = widgetById(page, id)
    const discounts = widget.locator('.dn-discounts').getByRole('img', { name: 'Not read since Monday' })
    await expect(discounts).toHaveClass(/unknown/)
    await expect(discounts.locator('i')).toHaveCount(3)
    await expect(discounts.locator('i.on')).toHaveCount(0)
    await expect(discounts.locator('i').first()).toHaveCSS('border-top-style', 'dotted')
    await expect(widget.locator('.dn-discounts .val')).toHaveText('Not read since Monday', seen)
    await expect(widget.locator('.dn-commissions .pips')).not.toHaveClass(/unknown/)
  }
})

test('Daily notes says when the transformer is ready and the realm currency is full', async ({ page, api }) => {
  const notes = await notesOf(api)
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    board.notes!.transformer = { ready_at: notes.read_at } // HoYoLAB gives the time it was read when it can be used
    board.notes!.realm_currency = board.notes!.realm_currency_max
    board.notes!.realm_currency_full_at = null
  })
  await setBoard(api, page, [
    { id: 'daily-s', type: 'daily-notes', w: 2, h: 2, settings: {} },
    { id: 'daily-l', type: 'daily-notes', w: 3, h: 3, settings: {} },
  ])
  const [small, large] = ['daily-s', 'daily-l'].map((id) => widgetById(page, id))
  for (const widget of [small, large]) {
    await expect(widget.locator('.dn-transformer .seal')).toHaveText('Ready')
    await expect(widget.locator('.dn-transformer .seal')).toBeVisible() // one seal, not one for each size
    await expect(widget.locator('.dn-realm .bar-fill')).toHaveAttribute('style', /width:\s*100%/)
  }
  await expect(small.locator('.dn-realm .val')).toHaveText('2,400', seen)
  await expect(large.locator('.dn-realm .val')).toHaveText('2,400 of 2,400', seen)
  await expect(large.locator('.dn-realm .sub')).toHaveText('Full')
})

test('Daily notes without a Parametric Transformer says so', async ({ page, api }) => {
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    board.notes!.transformer = null
  })
  await setBoard(api, page, [
    { id: 'daily-s', type: 'daily-notes', w: 2, h: 2, settings: {} },
    { id: 'daily-l', type: 'daily-notes', w: 3, h: 3, settings: {} },
  ])
  for (const id of ['daily-s', 'daily-l']) {
    const row = widgetById(page, id).locator('.dn-transformer')
    await expect(row).toHaveText('No Parametric Transformer yet', seen)
    await expect(row.locator('.seal')).toHaveCount(0)
  }
})

/** The demo's two expeditions out return in 2 h and 5 h 30 min: the first of them is the soonest. */
const SOONEST = 3

test('Expeditions shows each face, a tick on those back, and the empty slots', async ({ page, api }) => {
  const notes = await notesOf(api)
  // The demo sends five of five; here the last is not sent.
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    board.notes!.expeditions!.pop()
  })
  await setBoard(api, page, [{ id: 'exp-l', type: 'expeditions', w: 3, h: 2, settings: {} }])
  const widget = widgetById(page, 'exp-l')
  const slots = widget.locator('[data-centre]').getByRole('listitem')
  await expect(slots).toHaveCount(5) // four sent, and a slot for the one that could be
  await expect(widget.locator('.w-meta')).toHaveText(/^3 of 4 back · Read at \d{2}:\d{2}$/)
  // The three back have a tick on their face; the one out has none.
  await expect(widget.locator('li.back')).toHaveCount(3)
  await expect(widget.locator('li.back .face-tick')).toHaveCount(3)
  await expect(widget.locator('.face-tick')).toHaveCount(3)
  // The demo downloads no picture, so each face shows the sign of a person; the slot not sent has no face in it.
  await expect(widget.locator('.face-pic .sign')).toHaveCount(4)
  const empty = widget.locator('li.empty')
  await expect(empty).toHaveCount(1)
  await expect(empty.locator('.face')).toHaveCSS('border-top-style', 'dashed')
  await expect(empty.locator('.face-pic')).toHaveCount(0)
  await expect(empty).toHaveText('Not sent', seen)
  // A ring of gold round a face that is back, and a muted one round the face out.
  const ring = (selector: string) => widget.locator(selector).first().locator('.face').evaluate((face) => getComputedStyle(face).boxShadow)
  expect(await ring('li.back')).toMatch(/^rgb\(166, 117, 31\) /)
  expect(await ring('li:not(.back):not(.empty)')).toMatch(/^rgb\(138, 128, 107\) /)
  // Under a face: "Back", or when it comes back and how long it is to wait.
  await expect(widget.locator('li.back .t')).toHaveText(['Back', 'Back', 'Back'], seen)
  const out = widget.locator('li:not(.back):not(.empty)')
  await expect(out.locator('.t b')).toHaveText(clockOf(notes.expeditions![SOONEST].back_at!))
  await expect(out.locator('.t')).toHaveText(/^\d{2}:\d{2}\s+in 1 h \d{1,2} min$/, seen) // the demo's is out for 2 h
  // The faces are not smaller than they were (the old ones were 24 pixels) and not larger than 80.
  for (const face of await widget.locator('.face').all()) {
    const box = (await face.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(50)
    expect(box.width).toBeLessThanOrEqual(80.5)
    expect(Math.abs(box.width - box.height)).toBeLessThan(0.5)
  }
})

test('Expeditions at 2 × 1 is a row of faces with the next return in the heading', async ({ page, api }) => {
  const notes = await notesOf(api)
  await setBoard(api, page, [{ id: 'exp-s', type: 'expeditions', w: 2, h: 1, settings: {} }])
  const widget = widgetById(page, 'exp-s')
  await expect(widget.locator('.w-meta')).toHaveText(`3 of 5 back · next ${clockOf(notes.expeditions![SOONEST].back_at!)}`)
  await expect(widget.locator('li')).toHaveCount(5)
  await expect(widget.locator('li.empty')).toHaveCount(0) // five sent of five
  await expect(widget.locator('li.back .face-tick')).toHaveCount(3)
  // One row, the faces larger than a line of text.
  const faces = await widget.locator('.face').evaluateAll((all) =>
    all.map((one) => {
      const box = one.getBoundingClientRect()
      return { top: Math.round(box.top), width: Math.round(box.width) }
    }),
  )
  expect(new Set(faces.map((one) => one.top)).size).toBe(1)
  expect(faces.every((one) => one.width >= 48)).toBe(true)
  // What stands under a face at greater sizes is not drawn here, but a screen reader has it.
  const labels = widget.locator('.t')
  await expect(labels).toHaveCount(5)
  for (const label of await labels.all()) expect((await label.boundingBox())!.width).toBeLessThanOrEqual(1)
  await expect(widget.getByRole('listitem').filter({ hasText: 'Back' })).toHaveCount(3)
  await expect(widget.getByRole('listitem').filter({ hasText: /in [12] h \d+ min/ })).toHaveCount(1) // 2 h and 5 h 30 min
})

test('Expeditions that are all back name no next return, and the heading says when they were read', async ({ page, api }) => {
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    for (const expedition of board.notes!.expeditions!) expedition.back_at = null // all five are back
  })
  await setBoard(api, page, [
    { id: 'exp-s', type: 'expeditions', w: 2, h: 1, settings: {} },
    { id: 'exp-l', type: 'expeditions', w: 3, h: 2, settings: {} },
  ])
  // With none to wait for there is no next return to name, so the heading says when the notes were read at 2 × 1 too.
  for (const id of ['exp-s', 'exp-l']) {
    await expect(widgetById(page, id).locator('.w-meta')).toHaveText(/^5 of 5 back · Read at \d{2}:\d{2}$/)
    await expect(widgetById(page, id).locator('li.back .face-tick')).toHaveCount(5)
  }
})

test('Expeditions with none out, or no details yet, says so and when it was read', async ({ page, api }) => {
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    board.notes!.expeditions = []
  })
  await setBoard(api, page, [{ id: 'exp-1', type: 'expeditions', w: 3, h: 2, settings: {} }])
  const widget = widgetById(page, 'exp-1')
  await expect(widget).toContainText('No expeditions are out.')
  await expect(widget.locator('.w-meta')).toHaveText(/^Read at \d{2}:\d{2}$/)
})

test('Resin shows its ring of twenty-resin segments, the number and when it is full, at 1 × 1 and 2 × 2', async ({ page, api }) => {
  const { resin, max } = await resinNow(api)
  const full = (await api.get<BoardModel>('/api/board')).notes!.resin_full_at! // in 16 h 24 min: within a day
  await setBoard(api, page, [
    { id: 'resin-s', type: 'resin', w: 1, h: 1, settings: {} },
    { id: 'resin-l', type: 'resin', w: 2, h: 2, settings: {} },
  ])
  const [small, large] = ['resin-s', 'resin-l'].map((id) => widgetById(page, id))
  for (const widget of [small, large]) {
    // The ring is the visual centre: 200 resin in ten segments of twenty, filled to the resin now, with the resin's
    // picture in it, which the demo does not download, so its sign shows.
    await expect(widget.locator('[data-centre]')).toBeVisible()
    const ring = widget.locator('[data-centre] .ring')
    await expect.poll(() => dashesOf(ring.locator('.r-fill'))).toEqual([resin, max])
    await expect.poll(() => dashesOf(ring.locator('.r-gaps'))).toEqual([1.6, 18.4]) // a gap in every twenty of the 200
    await expect(ring.locator('.pic .sign')).toBeVisible()
    await expect(widget.locator('.w-meta')).toHaveText(/^Read at \d{2}:\d{2}$/) // the heading has the read time
  }
  // 1 × 1: the picture alone in the ring, then "77/200" and when it is full.
  await expect(counted(small.locator('.resin-now .fig'))).toHaveText(String(resin))
  await expect(small.locator('.resin-now .fig')).toContainText(`/${max}`)
  await expect(small.getByText(`Full ${clockOf(full)}`)).toBeVisible()
  await expect(small.locator('.ring-in .fig')).toBeHidden()
  await expect(small.getByText('Full in', { exact: true })).toBeHidden()
  // 2 × 2: the number and "of 200" inside a large ring, and beside it "Full in", the time left large, and the clock time.
  await expect(counted(large.locator('.ring-in .fig'))).toHaveText(String(resin))
  await expect(large.locator('.ring-in .of')).toHaveText(`of ${max}`)
  await expect(large.getByText('Full in', { exact: true })).toBeVisible()
  await expect(large.locator('.resin-left .big')).toHaveText(/^\d+ h \d+ min$/)
  await expect(large.locator('.resin-left .at')).toHaveText(shownAt(full))
  await expect(large.locator('.resin-now')).toBeHidden()
})

test('Resin at 2 × 1 has the figure and when it is full, and how long to full beside them', async ({ page, api }) => {
  const { resin, max } = await resinNow(api)
  const full = (await api.get<BoardModel>('/api/board')).notes!.resin_full_at!
  await setBoard(api, page, [{ id: 'resin-m', type: 'resin', w: 2, h: 1, settings: {} }])
  const medium = widgetById(page, 'resin-m')
  await expect.poll(() => dashesOf(medium.locator('[data-centre] .r-fill'))).toEqual([resin, max])
  await expect(counted(medium.locator('.resin-now .fig'))).toHaveText(String(resin))
  await expect(medium.getByText(`Full ${clockOf(full)}`)).toBeVisible()
  await expect(medium.getByText('Full in', { exact: true })).toBeVisible()
  await expect(medium.locator('.resin-left .big')).toHaveText(/^\d+ h \d+ min$/)
  await expect(medium.locator('.resin-left .at')).toBeHidden() // the clock time is for two cells tall
})

test('full resin shows the whole ring and the Full seal', async ({ page, api }) => {
  const { max } = await resinNow(api)
  const since = (await api.get<BoardModel>('/api/board')).notes!.resin_full_at!
  await setBoard(api, page, [
    { id: 'resin-s', type: 'resin', w: 1, h: 1, settings: {} },
    { id: 'resin-m', type: 'resin', w: 2, h: 1, settings: {} },
    { id: 'resin-l', type: 'resin', w: 2, h: 2, settings: {} },
  ])
  const [small, medium, large] = ['resin-s', 'resin-m', 'resin-l'].map((id) => widgetById(page, id))
  expect(await dashesOf(small.locator('.r-fill'))).not.toEqual([max, max])
  await api.advance(60_000) // 16 h 40 min: the demo's resin is full 16 h 24 min after it was read
  for (const widget of [small, medium, large]) {
    await expect.poll(() => dashesOf(widget.locator('.r-fill'))).toEqual([max, max])
    await expect(widget.locator('.seal:visible')).toHaveText('Full') // one seal, not one under the figure and one beside it
    await expect(widget.getByText('Full in', { exact: true })).toHaveCount(0)
  }
  await expect(counted(small.locator('.resin-now .fig'))).toHaveText(String(max))
  await expect(counted(medium.locator('.resin-now .fig'))).toHaveText(String(max))
  await expect(counted(large.locator('.ring-in .fig'))).toHaveText(String(max))
  await expect(medium.getByText(`since ${shownAt(since)}`)).toBeVisible() // "Full since Wed 00:24"
  await expect(large.getByText(`since ${shownAt(since)}`)).toBeVisible()
})

test('Resets shows the day and the week as bars, with the time left', async ({ page, api }) => {
  await setBoard(api, page, [
    { id: 'resets-s', type: 'resets', w: 2, h: 1, settings: {} },
    { id: 'resets-l', type: 'resets', w: 2, h: 2, settings: {} },
  ])
  const { daily_at: daily, weekly_at: weekly } = (await api.get<BoardModel>('/api/board')).resets
  const [small, large] = ['resets-s', 'resets-l'].map((id) => widgetById(page, id))
  // It is 08:00 UTC on Tuesday: the game day, from 03:00 UTC (04:00 server time), is 5 of 24 hours old, and the week,
  // from Monday's 03:00 UTC, 29 of 168. The page's clock is a few seconds on.
  const widths = (widget: Locator) =>
    widget.locator('.bar-fill').evaluateAll((all) => all.map((one) => parseFloat((one as HTMLElement).style.width)))
  for (const widget of [small, large]) {
    await expect(widget.locator('.bar')).toHaveCount(2)
    await expect(widget.locator('.bar-notch')).toHaveCount(6) // the week's bar, in its seven days
    await expect(widget.locator('.reset').first().locator('.bar-notch')).toHaveCount(0) // the day's has none
    const [day, week] = await widths(widget)
    expect(day).toBeCloseTo((5 / 24) * 100, 0)
    expect(week).toBeCloseTo((29 / 168) * 100, 0)
    await expect(widget.locator('.reset-name')).toHaveText(['Daily reset', 'Weekly reset'])
    await expect(widget.locator('.reset-left')).toHaveText([/^in (18 h [45]\d|19 h 0) min$/, /^in 5 d 1[89] h$/])
  }
  // The clock times come with more room.
  await expect(small.locator('.reset-at').first()).toBeHidden()
  await expect(large.locator('.reset-at')).toHaveText([shownAt(daily), shownAt(weekly)])
})

// The tests of Playtime show it the game as playAs has it, not as this PC has it: the demo core reads the real process list.

test('Playtime says whether the game runs, the length of the session and today', async ({ page, api }) => {
  const { now } = await api.get<Status>('/api/status')
  await playAs(page, { running: false, started: null, last: 93, week: PLAY_WEEK })
  await setBoard(api, page, NOTES_BOARD)
  const playtime = widgetById(page, 'playtime-1')
  // Not playing: the quiet seal, the last session's length, and today's play in the heading.
  const seal = playtime.locator('[data-centre] .seal')
  await expect(seal).toHaveText('Not playing')
  await expect(seal).toHaveClass(/quiet/)
  await expect(counted(playtime.locator('[data-centre] .fig'))).toHaveText('1h 33min')
  await expect(playtime.locator('[data-centre]').getByText('last session')).toBeVisible()
  await expect(playtime.locator('.w-meta')).toHaveText('Today 45 min')
  // Playing: the green seal and the session so far, from the time the game began on the core's clock.
  await playAs(page, { running: true, started: new Date(Date.parse(now) - 72 * 60_000).toISOString(), last: 93, week: PLAY_WEEK })
  await page.reload()
  await expect(seal).toHaveText('Playing now')
  await expect(seal).not.toHaveClass(/quiet/)
  await expect(counted(playtime.locator('[data-centre] .fig'))).toHaveText(/^1h 1[23]min$/)
  await expect(playtime.locator('[data-centre]').getByText('this session')).toBeVisible()
  await expect(playtime.locator('.w-meta')).toHaveText('Today 45 min')
  // A screen reader is given the length of the session as one phrase, not as figures and letters.
  await expect(playtime.locator('[data-centre] .fig .sr-only')).toHaveText(/^1 h 1[23] min$/)
})

test('Playtime says there is no session yet before the first one', async ({ page, api }) => {
  await playAs(page, { running: false, started: null, last: null, week: PLAY_WEEK.map((day) => ({ ...day, minutes: 0 })) })
  await setBoard(api, page, [{ id: 'playtime-1', type: 'playtime', w: 2, h: 1, settings: {} }])
  const playtime = widgetById(page, 'playtime-1')
  await expect(playtime.locator('[data-centre] .seal')).toHaveText('Not playing')
  await expect(playtime.locator('[data-centre] .fig')).toHaveCount(0)
  await expect(playtime.getByText('No session yet')).toBeVisible()
  await expect(playtime.locator('.w-meta')).toHaveText('Today 0 min')
})

test("Playtime at 2 × 2 shows the last seven days as columns in gold, today's its own", async ({ page, api }) => {
  await playAs(page, { running: false, started: null, last: 93, week: PLAY_WEEK })
  await setBoard(api, page, [
    { id: 'play-s', type: 'playtime', w: 2, h: 1, settings: {} },
    { id: 'play-w', type: 'playtime', w: 3, h: 1, settings: {} },
    { id: 'play-l', type: 'playtime', w: 2, h: 2, settings: {} },
  ])
  const [small, wide, large] = ['play-s', 'play-w', 'play-l'].map((id) => widgetById(page, id))
  // Two cells wide and one tall has the seal and the session alone.
  await expect(small.locator('[data-centre]')).toBeVisible()
  await expect(small.locator('.play-week')).toBeHidden()
  const names = [
    'Wed 7 Oct: none recorded', 'Thu 8 Oct: 1 h 35 min', 'Fri 9 Oct: none recorded', 'Sat 10 Oct: 2 h 59 min',
    'Sun 11 Oct: 1 h 32 min', 'Mon 12 Oct: 1 h 33 min', 'Tue 13 Oct: 45 min',
  ]
  for (const widget of [wide, large]) {
    const columns = widget.locator('.play-week').getByRole('img')
    await expect(columns).toHaveCount(7)
    // Each is named for a screen reader by its day and its minutes, and has its day under it ("Today" for the last).
    expect(await columns.evaluateAll((all) => all.map((one) => one.getAttribute('aria-label')))).toEqual(names)
    await expect(widget.locator('.pw-day')).toHaveText(['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Today'])
    // Their heights are their shares of the longest day, 179 minutes; a day with none is the stub of an empty one.
    const heights = await widget.locator('.pw-bar').evaluateAll((all) => all.map((one) => parseFloat((one as HTMLElement).style.height)))
    expect(heights.map((height) => Math.round(height))).toEqual([0, 53, 0, 100, 51, 52, 25])
    // The days played are in the progress gold, today's a deeper step of it, and a day with none the track's.
    const fills = await widget.locator('.pw-bar').evaluateAll((all) => all.map((one) => getComputedStyle(one).backgroundColor))
    expect(fills[1]).toBe('rgb(166, 117, 31)') // --w-fill, #A6751F
    expect([fills[3], fills[4], fills[5]]).toEqual([fills[1], fills[1], fills[1]]) // one gold for every day played
    expect(fills[0]).toBe('rgb(221, 211, 187)') // --w-track, #DDD3BB
    expect(fills[2]).toBe(fills[0])
    expect(fills[6]).not.toBe(fills[1]) // today's own mark, with "Today" in bold under it
    expect(fills[6]).not.toBe(fills[0])
    await expect(widget.locator('.pw-col.today .pw-day')).toHaveCSS('font-weight', '800')
    // The tallest column is drawn inside the widget's body.
    const body = (await widget.locator('.w-body').boundingBox())!
    const tallest = (await widget.locator('.pw-bar').nth(3).boundingBox())!
    expect(tallest.y).toBeGreaterThanOrEqual(body.y)
    expect(tallest.y + tallest.height).toBeLessThanOrEqual(body.y + body.height)
  }
  // At 3 × 1 the columns are beside the seal; at 2 × 2 they are under it.
  const beside = (await wide.locator('[data-centre]').boundingBox())!
  const besideWeek = (await wide.locator('.play-week').boundingBox())!
  expect(besideWeek.x).toBeGreaterThanOrEqual(beside.x + beside.width)
  const under = (await large.locator('[data-centre]').boundingBox())!
  const underWeek = (await large.locator('.play-week').boundingBox())!
  expect(underWeek.y).toBeGreaterThanOrEqual(under.y + under.height)
})

test('Playtime says the minutes of a day on hover and on the keyboard, one tab stop for the columns', async ({ page, api }) => {
  await playAs(page, { running: false, started: null, last: 93, week: PLAY_WEEK })
  await setBoard(api, page, [{ id: 'play-l', type: 'playtime', w: 2, h: 2, settings: {} }])
  const playtime = widgetById(page, 'play-l')
  const columns = playtime.locator('.play-week').getByRole('img')
  const meta = playtime.locator('.w-meta')
  await expect(meta).toHaveText('Today 45 min')
  // Hover: the heading says the day's minutes while the pointer is on its column, and today's again after it.
  await columns.nth(3).hover()
  await expect(meta).toHaveText('Sat 10 Oct: 2 h 59 min')
  await columns.nth(1).hover()
  await expect(meta).toHaveText('Thu 8 Oct: 1 h 35 min')
  await page.mouse.move(5, 5)
  await expect(meta).toHaveText('Today 45 min')
  // The keyboard: the columns are one tab stop, and the arrows, Home and End move between them.
  await expect(playtime.locator('.play-week [tabindex="0"]')).toHaveCount(1)
  await columns.first().focus()
  await expect(meta).toHaveText('Wed 7 Oct: none recorded')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(columns.nth(2)).toBeFocused()
  await expect(meta).toHaveText('Fri 9 Oct: none recorded')
  // The column keeps its own ring, drawn inside it, and the frame shows none: one ring for the one focus.
  await expect(columns.nth(2)).toHaveCSS('outline-style', 'solid')
  await expect(columns.nth(2)).toHaveCSS('outline-offset', '-2px')
  await expect(playtime).toHaveCSS('outline-style', 'none')
  await page.keyboard.press('End')
  await expect(meta).toHaveText('Tue 13 Oct: 45 min')
  await page.keyboard.press('Home')
  await expect(meta).toHaveText('Wed 7 Oct: none recorded')
  await columns.first().blur()
  await expect(meta).toHaveText('Today 45 min')
  // The pointer and the keyboard share the heading: it says the column that came to it last.
  await columns.nth(4).hover()
  await expect(meta).toHaveText('Sun 11 Oct: 1 h 32 min')
  await columns.nth(1).focus()
  await expect(meta).toHaveText('Thu 8 Oct: 1 h 35 min')
  await page.mouse.move(5, 5) // the pointer leaves a column that the focus has left
  await expect(meta).toHaveText('Thu 8 Oct: 1 h 35 min')
})

test('with nothing read from HoYoLAB, its widgets say so', async ({ page, api }) => {
  await setBoard(api, page, NOTES_BOARD)
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    board.notes = null
  })
  await page.reload()
  for (const id of ['resin-1', 'expeditions-1', 'daily-1']) {
    await expect(widgetById(page, id)).toContainText('Nothing read from HoYoLAB yet.')
  }
  await expect(widgetById(page, 'resin-1').locator('.w-meta')).toHaveCount(0) // no read time to say
})

test('notes read before this plan say that expedition details come with the next sync', async ({ page, api }) => {
  await setBoard(api, page, NOTES_BOARD)
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    board.notes!.expeditions = null
  })
  await page.reload()
  await expect(widgetById(page, 'expeditions-1')).toContainText('Expedition details come with the next sync.')
})

test('each widget of HoYoLAB data shows when it was read inside its frame, at its smallest size', async ({ page, api }) => {
  await setBoard(api, page, [
    { id: 'resin-1', type: 'resin', w: 1, h: 1, settings: {} },
    { id: 'expeditions-1', type: 'expeditions', w: 3, h: 2, settings: {} },
    { id: 'daily-1', type: 'daily-notes', w: 3, h: 2, settings: {} },
  ])
  for (const id of ['resin-1', 'expeditions-1', 'daily-1']) {
    const frame = (await widgetById(page, id).boundingBox())!
    const read = (await widgetById(page, id).getByText(/Read at \d{2}:\d{2}/).boundingBox())!
    expect(read.y + read.height, id).toBeLessThanOrEqual(frame.y + frame.height)
  }
})

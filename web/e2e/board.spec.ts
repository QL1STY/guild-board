import type { Page } from '@playwright/test'
import type { TimersModel, Widget } from '../src/types.ts'
import { cellOf, clockWidget, dragGrip, dragTo, layoutOf, pitchOf, setBoard, widgetById, widgetIds } from './board.ts'
import { expect, test } from './fixtures.ts'

/** A Notes widget, which can be any size from 2 × 1 to 6 × 6, at a saved place or without one. */
const notesWidget = (id: string, w: number, h: number, place?: { x: number; y: number }): Widget => ({
  id, type: 'notes', w, h, settings: {}, ...place,
})

/*
 * The demo at its 08:00 UTC, on the Europe server, with the starting Board of spec 13.2: Timers, Commissions to look
 * for, Pinned achievements, Resin, Expeditions, Resets, Clock and Notes.
 */

test('Guild Board opens on the Board, with its clock on the server time', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Board')
  const rail = page.getByRole('navigation', { name: 'Pages' })
  await expect(rail.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page')
  await expect(widgetById(page, 'start-clock')).toContainText('Server 09:00 · Europe') // DEMO_NOW is 08:00 UTC
  await expect(widgetById(page, 'start-clock').getByRole('heading', { level: 3 })).toHaveText('Clock')
})

test('the starting Board shows the eight widgets of spec 13.2', async ({ page }) => {
  await expect(page.getByTestId('board').locator('[data-widget] .w-name')).toHaveText([
    'Timers', 'Commissions to look for', 'Pinned achievements', 'Resin', 'Expeditions', 'Resets', 'Clock', 'Notes',
  ])
  await expect(page.getByRole('region', { name: 'Not available' })).toHaveCount(0)
  await expect(widgetById(page, 'start-notes').getByRole('textbox', { name: 'Notes' })).toHaveValue(
    'Fishing: Luhua Pool comes back on Friday.',
  )
})

test('a widget of a type this version does not know says so', async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'map-1', type: 'map', w: 6, h: 4, settings: { tab: 'fishing' } }])
  await expect(widgetById(page, 'map-1')).toHaveText('Not available in this version.')
  await expect(page.getByRole('region', { name: 'Not available' })).toHaveCount(1)
})

test('an empty Board says how to add widgets', async ({ page, api }) => {
  await setBoard(api, page, [])
  await expect(page.getByText('Nothing is on the Board. Edit adds widgets.')).toBeVisible()
})

test('the Board at the narrowest window wraps every widget and cuts none', async ({ page, api }) => {
  await page.setViewportSize({ width: 1040, height: 900 })
  const cutNone = async (count: number) => {
    const grid = (await page.getByTestId('board').boundingBox())!
    const rights = await page.locator('[data-widget]').evaluateAll((all) => all.map((one) => one.getBoundingClientRect().right))
    expect(rights).toHaveLength(count)
    for (const right of rights) expect(right).toBeLessThanOrEqual(grid.x + grid.width + 0.5)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
  await expect(widgetById(page, 'start-notes')).toBeVisible()
  await cutNone(8)
  // An arrangement made on the 2,560-pixel dashboard, with places out to its thirteenth column.
  await setBoard(api, page, [
    notesWidget('wide', 6, 2, { x: 0, y: 0 }),
    notesWidget('right', 3, 2, { x: 10, y: 0 }),
    { ...clockWidget('far'), x: 11, y: 3 },
  ])
  await expect(widgetById(page, 'far')).toBeVisible()
  await cutNone(3)
})

test('a Board saved before places shows as the grid packed it', async ({ page, api }) => {
  // The window of 1,440 pixels has 7 columns: c (3 × 1) fills the room right of a, and b goes to the next row.
  await setBoard(api, page, [notesWidget('a', 4, 1), notesWidget('b', 4, 1), notesWidget('c', 3, 1)])
  await expect(widgetById(page, 'c')).toBeVisible()
  expect(await cellOf(page, 'a')).toEqual({ x: 0, y: 0 })
  expect(await cellOf(page, 'c')).toEqual({ x: 4, y: 0 })
  expect(await cellOf(page, 'b')).toEqual({ x: 0, y: 1 })
  expect(await widgetIds(page)).toEqual(['a', 'c', 'b']) // in reading order, for the keyboard and screen readers
})

test('saved places show where they were put, gaps included', async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 5, y: 2 }, { ...clockWidget('clock-b'), x: 1, y: 0 }])
  await expect(widgetById(page, 'clock-a')).toBeVisible()
  expect(await cellOf(page, 'clock-a')).toEqual({ x: 5, y: 2 })
  expect(await cellOf(page, 'clock-b')).toEqual({ x: 1, y: 0 })
  expect(await widgetIds(page)).toEqual(['clock-b', 'clock-a'])
  // The cells before them stay empty: the Board is as tall as the rows down to the clock at row 3.
  expect((await page.getByTestId('board').boundingBox())!.height).toBe(3 * 96 + 2 * 12)
})

test('a pinned timer shows at the first free place', async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }, notesWidget('notes-a', 3, 2, { x: 4, y: 0 })])
  await expect(widgetById(page, 'notes-a')).toBeVisible()
  const { timers } = await api.get<TimersModel>('/api/timers')
  const hilichurl = timers.find((timer) => timer.preset === 'hilichurl')!
  await api.post(`/api/timers/${hilichurl.id}/pin`, { on: true }) // as Pin to Board on its card does
  // Its One timer of 2 × 2 has no place: it goes to the first room it fits, between the clock and the notes.
  await expect(widgetById(page, `pin-${hilichurl.id}`)).toBeVisible()
  await expect.poll(() => cellOf(page, `pin-${hilichurl.id}`)).toEqual({ x: 2, y: 0 })
  expect(await cellOf(page, 'notes-a')).toEqual({ x: 4, y: 0 })
})

test("Add a widget's list is as wide as the Board, in more columns on a wider one, and a widget's settings keep 1,440", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await expect(widgetById(page, 'start-notes')).toBeVisible()
  await edit(page)
  await page.getByRole('button', { name: 'Add a widget' }).click()
  const sheet = page.getByRole('region', { name: 'Add a widget' })
  const [sheetBox, board] = await Promise.all([sheet.boundingBox(), page.getByTestId('board').boundingBox()])
  expect(Math.abs(sheetBox!.x + sheetBox!.width - (board!.x + board!.width))).toBeLessThan(1) // to the Board's right edge
  const columns = await sheet.locator('.board-types').evaluate((list) => getComputedStyle(list).gridTemplateColumns.split(' ').length)
  expect(columns).toBeGreaterThan(4) // 1,440 pixels held four
  await page.keyboard.press('Escape')
  await widgetById(page, 'start-clock').getByRole('button', { name: 'Settings of Clock' }).click()
  const settings = await page.locator('.board-sheet').boundingBox()
  expect(settings!.width).toBeLessThanOrEqual(1440)
})

test('the Board uses the whole width at 2,560 pixels, with more widgets side by side', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await expect(widgetById(page, 'start-notes')).toBeVisible()
  // Thirteen columns of 168 pixels and 12-pixel gaps fit the 2,370 pixels beside the rail, and they share the 42 left
  // over, so that the last ends at the Board's right edge.
  const grid = page.getByTestId('board')
  const [tracks, box] = await Promise.all([
    grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').map(parseFloat)),
    grid.boundingBox(),
  ])
  expect(tracks).toHaveLength(13)
  for (const track of tracks) {
    expect(track).toBeCloseTo((box!.width - 12 * 12) / 13, 1)
    expect(track).toBeGreaterThanOrEqual(168)
    expect(track).toBeLessThan(168 + 180 / 13) // what is left over is less than a fourteenth column
  }
  // Each widget is as wide as its columns and the gaps between them.
  const widths = await page.locator('[data-widget]').evaluateAll((all) => all.map((one) => one.getBoundingClientRect().width))
  for (const width of widths) {
    const columns = (width + 12) / (tracks[0] + 12)
    expect(Math.abs(columns - Math.round(columns)), `${width}`).toBeLessThan(0.01)
  }
})

test('the last column of the Board ends where the top bar ends, in a window of any width', async ({ page, api }) => {
  // The 1,366-pixel window has six columns sharing 108 pixels left over, the 1,640 eight sharing 22, and the 1,920 nine
  // sharing 122. Guild Board's own window lays its page out at 1,640 pixels from there up, zoomed to the window.
  for (const [width, wanted] of [[1366, 6], [1640, 8], [1920, 9]]) {
    await page.setViewportSize({ width, height: 900 })
    // The Board counts its columns when the window has resized, a moment after the viewport changes: read them once they are the width's.
    const count = () => page.getByTestId('board').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length)
    await expect.poll(count, { message: `${width}: the Board's columns` }).toBe(wanted)
    const columns = await count()
    await setBoard(api, page, [{ ...clockWidget('clock-right'), x: columns - 2, y: 0 }])
    await expect(widgetById(page, 'clock-right')).toBeVisible()
    expect(await cellOf(page, 'clock-right'), `${width}`).toEqual({ x: columns - 2, y: 0 })
    const [right, plate] = await Promise.all([
      widgetById(page, 'clock-right').evaluate((one) => one.getBoundingClientRect().right),
      page.getByTestId('plate').evaluate((one) => one.getBoundingClientRect().right),
    ])
    expect(Math.abs(right - plate), `${width}: the clock ends at ${right}, the plate at ${plate}`).toBeLessThanOrEqual(0.5)
  }
})

test('the Board shows no note on load, and a change made there shows one whose Undo takes it back', async ({ page, api }) => {
  const { timers } = await api.get<TimersModel>('/api/timers')
  const hilichurl = timers.find((timer) => timer.preset === 'hilichurl')!
  await api.post(`/api/timers/${hilichurl.id}/cleared`, {})
  await page.reload()
  const note = page.getByTestId('note')
  await expect(widgetById(page, 'start-timers').getByRole('listitem').first()).toBeVisible()
  await expect(note).toHaveCount(0) // the core holds the change, but it was made before this visit
  await widgetById(page, 'start-timers').getByRole('button', { name: 'Cleared Teapot · Jade Field' }).click()
  await expect(note.locator('.note-text')).toHaveText('Cleared Teapot · Jade Field')
  await note.getByRole('button', { name: 'Undo' }).click()
  await expect(note.locator('.note-text')).toHaveText('Undone: Cleared Teapot · Jade Field')
})

test('the note stands at the middle of the Board at 2,560 pixels', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1400 })
  await widgetById(page, 'start-timers').getByRole('button', { name: 'Cleared Teapot · Jade Field' }).click()
  const note = page.getByTestId('note')
  await expect(note).toBeVisible()
  await page.waitForTimeout(400) // its entrance has settled
  const [box, main] = await Promise.all([note.boundingBox(), page.locator('.gb-main').boundingBox()])
  expect(Math.abs(box!.x + box!.width / 2 - (main!.x + main!.width / 2))).toBeLessThanOrEqual(2)
})

test('Ctrl+Z does nothing while Edit is open, and works again after Cancel', async ({ page }) => {
  await widgetById(page, 'start-timers').getByRole('button', { name: 'Cleared Teapot · Jade Field' }).click()
  const text = page.getByTestId('note').locator('.note-text')
  await expect(text).toHaveText('Cleared Teapot · Jade Field')
  const undos: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/achievements/undo')) undos.push(request.method())
  })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(600)
  expect(undos).toEqual([])
  await expect(text).toHaveText('Cleared Teapot · Jade Field')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.keyboard.press('Control+z')
  await expect(text).toHaveText('Undone: Cleared Teapot · Jade Field')
  expect(undos).toEqual(['POST'])
})

const edit = (page: Page) => page.getByRole('button', { name: 'Edit', exact: true }).click()
const done = (page: Page) => page.getByRole('button', { name: 'Done' }).click()
/** Where Edit reads out each move and size (a polite live region). */
const said = (page: Page) => page.locator('[aria-live="polite"]')
const HELP =
  'Drag a widget to move it, or its edge or corner to resize it. On a chosen widget, the arrow keys move it and Shift with the arrow keys resizes it.'

test('a refused Done keeps its line in Edit, and Cancel takes it away with Edit', async ({ page }) => {
  await page.route('**/api/layouts/board', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 400, json: { detail: 'The Board could not be saved.' } }) : route.fallback(),
  )
  await edit(page)
  await done(page)
  await expect(page.getByText('The Board could not be saved.')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await expect(page.getByText('The Board could not be saved.')).toHaveCount(0)
})

test('in Edit, the arrow keys move a widget and Shift with them resizes it, and Done keeps it after a reload', async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }])
  await edit(page)
  const clock = widgetById(page, 'clock-a')
  await expect(clock).toHaveAttribute('role', 'group')
  await expect(clock).toHaveAccessibleName('Clock, 2 by 1, column 1, row 1')
  await expect(clock).toHaveAccessibleDescription(HELP)
  await expect(page.locator('#board-help')).toHaveText(HELP)
  await clock.focus()
  await page.keyboard.press('ArrowRight')
  await expect(said(page)).toHaveText('Clock, column 2, row 1.')
  await expect(said(page)).toHaveAttribute('aria-atomic', 'true') // each sentence is read whole
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(said(page)).toHaveText('Clock, 2 by 2.')
  await expect(clock).toBeFocused() // the focus stays on the widget
  await expect(clock).toHaveAccessibleName('Clock, 2 by 2, column 3, row 1')
  await page.keyboard.press('ArrowUp')
  await expect(said(page)).toHaveText('Clock is at the top.')
  await done(page)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await page.reload()
  await expect(widgetById(page, 'clock-a')).toBeVisible()
  expect((await layoutOf(api)).widgets[0]).toMatchObject({ x: 2, y: 0, w: 2, h: 2 })
  expect(await cellOf(page, 'clock-a')).toEqual({ x: 2, y: 0 })
})

test("a maximized window keeps an arrangement of its own, and Done there leaves the window's as it was", async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }, { ...clockWidget('clock-b'), x: 2, y: 0 }])
  // The shell says the window is maximized; until that window is arranged, it shows the window's arrangement.
  await expect(page.getByTestId('board')).toHaveAttribute('data-arrangement', 'window')
  await api.post('/api/demo/window', { maximized: true })
  await expect(page.getByTestId('board')).toHaveAttribute('data-arrangement', 'maximized')
  expect(await cellOf(page, 'clock-b')).toEqual({ x: 2, y: 0 })
  await edit(page)
  await widgetById(page, 'clock-b').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(said(page)).toHaveText('Clock, column 5, row 1.')
  await done(page)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  const saved = (await layoutOf(api)).widgets
  expect(saved.find((one) => one.id === 'clock-b')).toMatchObject({ x: 2, y: 0, w: 2, h: 1, full: { x: 4, y: 0, w: 2, h: 1 } })
  expect(saved.find((one) => one.id === 'clock-a')).toMatchObject({ x: 0, y: 0, full: { x: 0, y: 0, w: 2, h: 1 } })
  await expect.poll(() => cellOf(page, 'clock-b')).toEqual({ x: 4, y: 0 })
  // Restored, the window shows its own arrangement again, and maximized once more, the other.
  await api.post('/api/demo/window', { maximized: false })
  await expect(page.getByTestId('board')).toHaveAttribute('data-arrangement', 'window')
  await expect.poll(() => cellOf(page, 'clock-b')).toEqual({ x: 2, y: 0 })
  await api.post('/api/demo/window', { maximized: true })
  await expect(page.getByTestId('board')).toHaveAttribute('data-arrangement', 'maximized')
  await expect.poll(() => cellOf(page, 'clock-b')).toEqual({ x: 4, y: 0 })
})

test('a widget moved onto another pushes it down, and the move is read out', async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }, { ...clockWidget('clock-b'), x: 2, y: 0 }])
  await edit(page)
  await widgetById(page, 'clock-a').focus()
  await page.keyboard.press('ArrowRight')
  await expect(said(page)).toHaveText('Clock, column 2, row 1. Clock moved down.')
  await expect.poll(() => cellOf(page, 'clock-b')).toEqual({ x: 2, y: 1 })
  await expect(widgetById(page, 'clock-a')).toBeFocused()
  // Tab goes through the widgets in reading order, each with its Settings and Remove.
  await page.keyboard.press('Tab')
  await expect(widgetById(page, 'clock-a').getByRole('button', { name: 'Settings of Clock' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(widgetById(page, 'clock-a').getByRole('button', { name: 'Remove Clock' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(widgetById(page, 'clock-b')).toBeFocused()
  await done(page)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await layoutOf(api)).widgets).toMatchObject([{ id: 'clock-a', x: 1, y: 0 }, { id: 'clock-b', x: 2, y: 1 }])
})

test('a widget moved with the keyboard comes into view after every step', async ({ page, api }) => {
  // The only widget: no step puts it elsewhere among the grid's elements, so its group keeps the focus all along.
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }])
  await edit(page)
  const clock = widgetById(page, 'clock-a')
  await clock.focus()
  // One step at a time, each glide over before the next step.
  for (let row = 2; row <= 7; row += 1) {
    await page.keyboard.press('ArrowDown')
    await expect(said(page)).toHaveText(`Clock, column 1, row ${row}.`)
    await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 0, y: row - 1 })
    await expect(clock).toBeInViewport({ ratio: 1 })
  }
  // Steps in quick succession, as a held arrow key makes them: each begins while the glide of the one before still runs.
  for (let row = 8; row <= 12; row += 1) {
    await page.keyboard.press('ArrowDown')
    await expect(said(page)).toHaveText(`Clock, column 1, row ${row}.`)
  }
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 0, y: 11 })
  await expect(clock).toBeInViewport({ ratio: 1 })
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(400) // row 12 is far below the window's 900 pixels
  await expect(clock).toBeFocused()
})

test('the Edit grid shows its empty cells, and they are hidden from screen readers', async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }])
  const cells = page.getByTestId('board').locator('.board-cell')
  await expect(cells).toHaveCount(0) // only in Edit
  await edit(page)
  // Seven columns, down to two rows below the clock: 21 cells, of which the clock takes 2.
  await expect(cells).toHaveCount(19)
  for (const hidden of await cells.evaluateAll((all) => all.map((one) => one.closest('[aria-hidden="true"]') !== null))) {
    expect(hidden).toBe(true)
  }
  const [first, board, pitch] = [(await cells.first().boundingBox())!, (await page.getByTestId('board').boundingBox())!, await pitchOf(page)]
  expect([Math.round((first.x - board.x) / pitch.x), Math.round((first.y - board.y) / pitch.y)]).toEqual([2, 0]) // right of the clock
  expect(board.height).toBe(3 * 96 + 2 * 12)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(cells).toHaveCount(0)
})

test('Add a widget puts it in the first free place', async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }, notesWidget('notes-a', 3, 2, { x: 4, y: 0 })])
  await edit(page)
  await page.getByRole('button', { name: 'Add a widget' }).click()
  const sheet = page.getByRole('region', { name: 'Add a widget' })
  // The fourteen of spec 13.3, the Pulls plan's six, the Characters plan's Today widget and the daily check-in.
  await expect(sheet.getByRole('listitem')).toHaveCount(22)
  await expect(sheet.locator('li svg.sign')).toHaveCount(22) // each type with its sign
  await sheet.getByRole('button', { name: 'Add Clock' }).click()
  await expect(page.locator('[data-widget]')).toHaveCount(3)
  const added = (await widgetIds(page)).find((id) => id.startsWith('clock-') && id !== 'clock-a')!
  await expect.poll(() => cellOf(page, added)).toEqual({ x: 2, y: 0 }) // between the clock and the notes
  await expect(widgetById(page, added)).toContainClass('glint') // once, as it arrives
  await expect(widgetById(page, added)).not.toContainClass('glint')
  await done(page)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await layoutOf(api)).widgets.find((one) => one.id === added)).toMatchObject({ type: 'clock', w: 2, h: 1, x: 2, y: 0 })
})

test('a widget added where the Board has no room on screen is scrolled into view', async ({ page, api }) => {
  await setBoard(api, page, [notesWidget('notes-a', 6, 6, { x: 0, y: 0 }), notesWidget('notes-b', 6, 6, { x: 0, y: 6 })])
  await edit(page)
  await page.getByRole('button', { name: 'Add a widget' }).click()
  await page.getByRole('region', { name: 'Add a widget' }).getByRole('button', { name: 'Add Timers' }).click()
  const added = (await widgetIds(page)).find((id) => id.startsWith('timers-'))!
  await expect.poll(() => cellOf(page, added)).toEqual({ x: 0, y: 12 }) // the first free place, below both notes
  await expect(widgetById(page, added)).toBeInViewport()
})

test('in a window narrower than the arrangement, Edit says so', async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 11, y: 0 }, { ...clockWidget('clock-b'), x: 0, y: 0 }])
  const notice = page.getByText('This window shows 7 of the 13 columns your arrangement uses.', { exact: false })
  await expect(widgetById(page, 'clock-a')).toBeVisible()
  await expect(notice).toHaveCount(0) // only in Edit
  await edit(page)
  await expect(notice).toHaveText(
    'This window shows 7 of the 13 columns your arrangement uses. The widgets beyond them show below, and Done saves the arrangement as you see it here.',
  )
  expect(await cellOf(page, 'clock-a')).toEqual({ x: 2, y: 0 }) // the first free place in this window
  await done(page)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await layoutOf(api)).widgets).toMatchObject([{ id: 'clock-a', x: 2, y: 0 }, { id: 'clock-b', x: 0, y: 0 }])
  await page.setViewportSize({ width: 2560, height: 1440 }) // the arrangement saved is the one Edit showed
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 2, y: 0 })
})

test('a window as wide as the arrangement says nothing of columns in Edit', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 11, y: 0 }])
  await edit(page)
  await expect(widgetById(page, 'clock-a')).toHaveAccessibleName('Clock, 2 by 1, column 12, row 1')
  await expect(page.getByText(/columns your arrangement uses/)).toHaveCount(0)
})

test('Cancel puts the Board back as it was', async ({ page, api }) => {
  await setBoard(api, page, [clockWidget('clock-a'), clockWidget('clock-b')])
  const before = await layoutOf(api)
  await edit(page)
  await widgetById(page, 'clock-b').focus()
  await page.keyboard.press('ArrowDown')
  await widgetById(page, 'clock-a').getByRole('button', { name: 'Remove Clock' }).click()
  await expect(widgetById(page, 'clock-a')).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(widgetById(page, 'clock-a')).toBeVisible()
  expect(await widgetIds(page)).toEqual(['clock-a', 'clock-b'])
  await expect.poll(() => cellOf(page, 'clock-b')).toEqual({ x: 2, y: 0 })
  expect(await layoutOf(api)).toEqual(before)
})

/** The size a widget shows at, in cells, from its frame's pixels. */
const cellsOf = async (page: Page, id: string) => {
  const [box, pitch] = await Promise.all([widgetById(page, id).boundingBox(), pitchOf(page)])
  return { w: Math.round((box!.width + 12) / pitch.x), h: Math.round((box!.height + 12) / pitch.y) }
}

test('dragging a widget to a cell puts it there, and a widget in the way slides down', async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }, { ...clockWidget('clock-b'), x: 3, y: 1 }])
  await edit(page)
  await dragTo(page, 'clock-a', { x: 3, y: 1 })
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 3, y: 1 })
  await expect.poll(() => cellOf(page, 'clock-b')).toEqual({ x: 3, y: 2 })
  await expect(widgetById(page, 'clock-a')).toHaveAccessibleName('Clock, 2 by 1, column 4, row 2')
  await done(page)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await layoutOf(api)).widgets).toMatchObject([{ id: 'clock-a', x: 3, y: 1 }, { id: 'clock-b', x: 3, y: 2 }])
})

test('a widget dragged lands in the cell under the pointer however wide the columns are', async ({ page, api }) => {
  // A window of 1,437 pixels has six columns of 197.83, a pixel short of seven, and one of 1,920 nine of 181.56: counted
  // in cells of 168 pixels, the pointer would be a column further on.
  for (const [width, column] of [[1437, 4], [1920, 7]] as const) {
    await page.setViewportSize({ width, height: 900 })
    await setBoard(api, page, [{ ...clockWidget('clock-a'), w: 1, h: 1, x: 0, y: 0 }])
    await edit(page)
    await dragTo(page, 'clock-a', { x: column, y: 2 })
    await expect.poll(() => cellOf(page, 'clock-a'), `${width}`).toEqual({ x: column, y: 2 })
    await expect(widgetById(page, 'clock-a')).toHaveAccessibleName(`Clock, 1 by 1, column ${column + 1}, row 3`)
    await page.getByRole('button', { name: 'Cancel' }).click()
  }
})

/** The width the Board's grid is drawn at. */
const boardWidth = (page: Page) => page.getByTestId('board').evaluate((grid) => grid.getBoundingClientRect().width)

test('a drag takes the pointer over the columns as they are when the Board changes its width on the way', async ({ page, api }) => {
  // Seven columns of 168.29 at 1,440 pixels as the drag begins, and the same seven of 191.14 at 1,600 as it ends, as a
  // scroll bar that comes or goes changes them, by less. By the columns of the press, the pointer would be a column on.
  await setBoard(api, page, [{ ...clockWidget('clock-a'), w: 1, h: 1, x: 0, y: 2 }])
  await edit(page)
  const clock = widgetById(page, 'clock-a')
  const [box, head] = [(await clock.boundingBox())!, (await clock.locator('.w-head').boundingBox())!]
  const grab = { x: head.x + 12, y: head.y + head.height / 2 }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x + 30, grab.y, { steps: 3 })
  await expect(clock).toContainClass('lifted')
  await page.setViewportSize({ width: 1600, height: 900 })
  await expect.poll(() => boardWidth(page)).toBe(1410)
  const [board, pitch] = [(await page.getByTestId('board').boundingBox())!, await pitchOf(page)]
  await page.mouse.move(board.x + 5 * pitch.x + grab.x - box.x, board.y + 2 * pitch.y + grab.y - box.y, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 5, y: 2 })
  await expect(clock).toHaveAccessibleName('Clock, 1 by 1, column 6, row 3')
})

test('after the Board changes its width, a step glides only the widget it moved', async ({ page, api }) => {
  // The same seven columns, wider, with nothing moved among the cells: each widget's place moves with its column, and
  // the next change glides only what it moves, not the widgets that were only taken along by the width.
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }, { ...clockWidget('clock-b'), x: 4, y: 0 }])
  await edit(page)
  await page.setViewportSize({ width: 1600, height: 900 })
  await expect.poll(() => boardWidth(page)).toBe(1410)
  await page.evaluate(() => document.documentElement.style.setProperty('--t-move', '4s')) // a glide long enough to look at
  await widgetById(page, 'clock-a').focus()
  await page.keyboard.press('ArrowDown')
  await expect(said(page)).toHaveText('Clock, column 1, row 2.')
  const gliding = await page.getByTestId('board').evaluate((grid) =>
    [...grid.querySelectorAll('[data-widget]')]
      .filter((one) => one.getAnimations().some((animation) => animation.id === 'glide'))
      .map((one) => one.getAttribute('data-widget')),
  )
  expect(gliding).toEqual(['clock-a'])
})

test('a widget dragged later in the reading order keeps the focus, and so does one resized', async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }, { ...clockWidget('clock-b'), x: 2, y: 0 }])
  await edit(page)
  await dragTo(page, 'clock-a', { x: 4, y: 0 })
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 4, y: 0 })
  expect(await widgetIds(page)).toEqual(['clock-b', 'clock-a']) // its element was put after the other clock's
  await expect(widgetById(page, 'clock-a')).toBeFocused()
  await dragGrip(page, 'clock-b', 's', { w: 2, h: 2 })
  await expect.poll(() => cellsOf(page, 'clock-b')).toEqual({ w: 2, h: 2 })
  await expect(widgetById(page, 'clock-b')).toBeFocused()
})

test('Escape during a drag puts every widget back', async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }, { ...clockWidget('clock-b'), x: 3, y: 1 }])
  await edit(page)
  await dragTo(page, 'clock-a', { x: 3, y: 1 }, { hold: true })
  // The widget is lifted and follows the mouse; a gold outline shows where it would land, and the clock there slid down.
  await expect(widgetById(page, 'clock-a')).toContainClass('lifted')
  const landing = page.getByTestId('board').locator('.board-landing')
  await expect(landing).toBeVisible()
  const [outline, board, pitch] = [(await landing.boundingBox())!, (await page.getByTestId('board').boundingBox())!, await pitchOf(page)]
  expect([Math.round((outline.x - board.x) / pitch.x), Math.round((outline.y - board.y) / pitch.y)]).toEqual([3, 1])
  const held = (await widgetById(page, 'clock-a').boundingBox())!
  expect(Math.abs(held.x - (board.x + 3 * pitch.x))).toBeLessThan(6) // under the pointer, a little larger as it is lifted
  expect(Math.abs(held.y - (board.y + pitch.y))).toBeLessThan(6)
  await expect.poll(() => cellOf(page, 'clock-b')).toEqual({ x: 3, y: 2 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(landing).toHaveCount(0)
  await expect(widgetById(page, 'clock-a')).not.toContainClass('lifted')
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 0, y: 0 })
  await expect.poll(() => cellOf(page, 'clock-b')).toEqual({ x: 3, y: 1 })
  await done(page)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await layoutOf(api)).widgets).toMatchObject([{ id: 'clock-a', x: 0, y: 0 }, { id: 'clock-b', x: 3, y: 1 }])
})

test('a drag near the bottom of the window scrolls the page, and the widget lands further down', async ({ page, api }) => {
  await setBoard(api, page, [notesWidget('notes-a', 6, 6, { x: 0, y: 0 }), { ...clockWidget('clock-a'), x: 6, y: 0 }])
  await edit(page)
  const head = (await widgetById(page, 'clock-a').locator('.w-head').boundingBox())!
  await page.mouse.move(head.x + 12, head.y + 8)
  await page.mouse.down()
  await page.mouse.move(head.x + 12, 890, { steps: 8 }) // within 40 pixels of the bottom of the window, 900 tall
  // Well past the 157 pixels at which a release at 600 lands on row 6 rather than row 5, so a look that catches the
  // page early in its scroll cannot leave the widget on row 5.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(250)
  await page.mouse.move(head.x + 12, 600, { steps: 2 }) // away from the edge: the page stops
  const scrolled = await page.evaluate(() => window.scrollY)
  await page.mouse.up()
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
  // It landed where the pointer let it go, on the page as it was scrolled.
  const { y } = await cellOf(page, 'clock-a')
  expect(y).toBeGreaterThan(5)
})

test('dragging the corner resizes a widget in whole cells within its limits', async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }, { ...clockWidget('clock-b'), x: 2, y: 1 }])
  await edit(page)
  const tag = widgetById(page, 'clock-a').locator('.size-tag')
  await dragGrip(page, 'clock-a', 'se', { w: 4, h: 3 }, { hold: true })
  await expect(tag).toHaveText('3 × 2, largest') // a clock is at most 3 × 2
  expect(await cellsOf(page, 'clock-a')).toEqual({ w: 3, h: 2 }) // the frame follows at once, cell by cell
  await page.mouse.up()
  await expect(tag).toHaveCount(0)
  expect(await cellsOf(page, 'clock-a')).toEqual({ w: 3, h: 2 })
  await expect.poll(() => cellOf(page, 'clock-b')).toEqual({ x: 2, y: 2 }) // the clock it ran into slid down
  await dragGrip(page, 'clock-b', 'e', { w: 0, h: 1 }, { hold: true }) // narrower than a clock can be
  await expect(widgetById(page, 'clock-b').locator('.size-tag')).toHaveText('1 × 1, smallest')
  await page.mouse.up()
  await dragGrip(page, 'clock-b', 's', { w: 1, h: 2 }, { hold: true }) // exactly as tall as a clock can be
  await expect(widgetById(page, 'clock-b').locator('.size-tag')).toHaveText('1 × 2, largest')
  await page.mouse.up()
  await dragGrip(page, 'clock-b', 's', { w: 1, h: 3 }, { hold: true }) // taller than a clock can be
  await expect(widgetById(page, 'clock-b').locator('.size-tag')).toHaveText('1 × 2, largest')
  await page.mouse.up()
  await done(page)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await layoutOf(api)).widgets).toMatchObject([
    { id: 'clock-a', x: 0, y: 0, w: 3, h: 2 },
    { id: 'clock-b', x: 2, y: 2, w: 1, h: 2 },
  ])
})

test('Escape during a resize puts the size back', async ({ page, api }) => {
  await setBoard(api, page, [notesWidget('notes-a', 2, 1, { x: 0, y: 0 }), { ...clockWidget('clock-b'), x: 2, y: 0 }])
  await edit(page)
  await dragGrip(page, 'notes-a', 'e', { w: 3, h: 1 }, { hold: true })
  await expect(widgetById(page, 'notes-a').locator('.size-tag')).toHaveText('3 × 1')
  await expect.poll(() => cellOf(page, 'clock-b')).toEqual({ x: 2, y: 1 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(widgetById(page, 'notes-a').locator('.size-tag')).toHaveCount(0)
  expect(await cellsOf(page, 'notes-a')).toEqual({ w: 2, h: 1 })
  await expect.poll(() => cellOf(page, 'clock-b')).toEqual({ x: 2, y: 0 })
  await done(page)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await layoutOf(api)).widgets).toMatchObject([{ id: 'notes-a', w: 2, h: 1 }, { id: 'clock-b', x: 2, y: 0 }])
})

test('a click on a widget in Edit moves nothing', async ({ page, api }) => {
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }, { ...clockWidget('clock-b'), x: 2, y: 0 }])
  await edit(page)
  const head = (await widgetById(page, 'clock-a').locator('.w-head').boundingBox())!
  await widgetById(page, 'clock-a').locator('.w-head').click({ position: { x: 12, y: head.height / 2 } })
  // A press that moves less than 4 pixels is no drag either.
  await page.mouse.move(head.x + 12, head.y + 8)
  await page.mouse.down()
  await page.mouse.move(head.x + 15, head.y + 8, { steps: 3 })
  await expect(widgetById(page, 'clock-a')).not.toContainClass('lifted')
  await page.mouse.up()
  await expect(page.getByTestId('board').locator('.board-landing')).toHaveCount(0)
  expect(await cellOf(page, 'clock-a')).toEqual({ x: 0, y: 0 })
  expect(await cellOf(page, 'clock-b')).toEqual({ x: 2, y: 0 })
  await done(page)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await layoutOf(api)).widgets).toMatchObject([{ id: 'clock-a', x: 0, y: 0 }, { id: 'clock-b', x: 2, y: 0 }])
})

test('every widget in Edit has its grips, with resize pointers, and a type it does not know has none', async ({ page, api }) => {
  await setBoard(api, page, [clockWidget('clock-a'), { id: 'map-1', type: 'map', w: 2, h: 2, settings: {} }])
  await edit(page)
  const clock = widgetById(page, 'clock-a')
  for (const [grip, cursor, least] of [['e', 'ew-resize', 10], ['s', 'ns-resize', 10], ['se', 'nwse-resize', 20]] as const) {
    const element = clock.locator(`.grip-${grip}`)
    await expect(element).toHaveCSS('cursor', cursor)
    const box = (await element.boundingBox())!
    expect(Math.min(box.width, box.height), grip).toBeGreaterThanOrEqual(least)
  }
  await expect(widgetById(page, 'map-1').locator('.grip-e, .grip-s, .grip-se')).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(clock.locator('.grip-se')).toHaveCount(0) // only in Edit
})

test("in Edit, a widget's buttons fit its heading at any height, and its body stays where it was", async ({ page, api }) => {
  // One cell tall the heading is 21 pixels, and two cells tall 24.
  await setBoard(api, page, [{ ...clockWidget('clock-a'), x: 0, y: 0 }, { ...clockWidget('clock-b'), w: 2, h: 2, x: 2, y: 0 }])
  // Where the body's top is in its frame: Edit's line of help moves the whole Board down.
  const bodyTop = (id: string) =>
    widgetById(page, id).evaluate((frame) => frame.querySelector('.w-body')!.getBoundingClientRect().top - frame.getBoundingClientRect().top)
  for (const [id, size] of [['clock-a', 21], ['clock-b', 24]] as const) {
    await expect(widgetById(page, id)).toBeVisible()
    const body = await bodyTop(id)
    await edit(page)
    const head = (await widgetById(page, id).locator('.w-head').boundingBox())!
    expect(head.height, id).toBe(size)
    const tools = await widgetById(page, id).locator('.w-tool').evaluateAll((all) =>
      all.map((one) => one.getBoundingClientRect()).map(({ top, bottom, width, height }) => ({ top, bottom, width, height })),
    )
    expect(tools, id).toHaveLength(2) // Settings and Remove
    for (const tool of tools) {
      expect(tool, id).toMatchObject({ width: size, height: size }) // as tall as the heading, and both one size
      expect(tool.top, id).toBeGreaterThanOrEqual(head.y)
      expect(tool.bottom, id).toBeLessThanOrEqual(head.y + head.height)
    }
    expect(await bodyTop(id), id).toBe(body)
    await page.getByRole('button', { name: 'Cancel' }).click()
  }
})

test("a widget's Settings change it: the clock shows seconds", async ({ page, api }) => {
  await setBoard(api, page, [clockWidget('clock-a')])
  await edit(page)
  await widgetById(page, 'clock-a').getByRole('button', { name: 'Settings of Clock' }).click()
  const sheet = page.getByRole('region', { name: 'Settings of Clock' })
  await sheet.getByRole('checkbox', { name: 'Show seconds' }).check()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await done(page)
  await expect(widgetById(page, 'clock-a').locator('[data-centre]')).toHaveText(/^\d{2}:\d{2}:\d{2}$/)
  expect((await layoutOf(api)).widgets[0].settings).toEqual({ seconds: true })
})

test('a widget of a type this version does not know is kept through Edit and Done', async ({ page, api }) => {
  const later = { id: 'map-1', type: 'map', w: 6, h: 4, settings: { tab: 'fishing' }, anchor: 'top-right' }
  await setBoard(api, page, [later, clockWidget('clock-a')])
  await edit(page)
  const map = widgetById(page, 'map-1')
  await expect(map).toHaveAccessibleName('Not available, 6 by 4, column 1, row 1')
  await expect(map.getByRole('button')).toHaveCount(1) // Remove only: it has no settings here
  await expect(map.getByRole('button', { name: 'Remove this widget' })).toBeVisible()
  await map.focus()
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(said(page)).toHaveText('Not available, 6 by 4.') // its sizes are not known here
  await widgetById(page, 'clock-a').getByRole('button', { name: 'Remove Clock' }).click()
  await done(page)
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await layoutOf(api)).widgets).toEqual([{ ...later, x: 0, y: 0 }])
})

test('a Board changed meanwhile is not overwritten', async ({ page, api }) => {
  await setBoard(api, page, [clockWidget('clock-a'), clockWidget('clock-b')])
  await edit(page)
  const { timers } = await api.get<TimersModel>('/api/timers')
  const hilichurl = timers.find((timer) => timer.preset === 'hilichurl')!
  await api.post(`/api/timers/${hilichurl.id}/pin`, { on: true }) // from the Timers page, say, while Edit is open
  await widgetById(page, 'clock-a').getByRole('button', { name: 'Remove Clock' }).click()
  await done(page)
  await expect(page.getByRole('alert').filter({ hasText: 'changed meanwhile' })).toHaveText(
    'The Board changed meanwhile. Look at it again.',
  )
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await expect(widgetById(page, `pin-${hilichurl.id}`)).toBeVisible()
  await expect(widgetById(page, 'clock-a')).toBeVisible() // the removal was not saved over the newer Board
})

test('a widget that fails as it is drawn says so, the rest of the Board stays, and it tries again', async ({ page, api }) => {
  // A Board model of another shape, as a core of another version might answer: the widgets that read it fail.
  await page.route('**/api/board', (route) => route.fulfill({ json: {} }))
  await page.reload()
  const resets = widgetById(page, 'start-resets')
  await expect(resets).toContainText('This widget could not be shown.')
  await expect(widgetById(page, 'start-notes').getByRole('textbox', { name: 'Notes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await page.unroute('**/api/board')
  await api.post('/api/quick-timers', { seconds: 60 }) // an event: the Board model is read again
  await expect(resets).toContainText('Daily reset')
  await expect(resets).not.toContainText('could not be shown')
})

import type { Locator, Page } from '@playwright/test'
import type { Layout, Widget } from '../src/types.ts'
import { type Api, expect, test } from './fixtures.ts'

/*
 * The overlay's page (plan 2A-4), which Guild Board's own see-through window shows over the game's display: closed at
 * `#/overlay`, open at `#/overlay/open`. The shell sets the address; here a browser window of 1,440 × 900 stands in
 * for the display, on the demo core.
 */

/** The overlay's layout as the core holds it. */
const overlayOf = (api: Api): Promise<Layout> => api.get<Layout>('/api/layouts/overlay')

/** Puts these widgets on the overlay through the core, over the revision it has. */
async function setOverlay(api: Api, widgets: Widget[]): Promise<void> {
  const { revision } = await overlayOf(api)
  await api.put('/api/layouts/overlay', { revision, widgets })
}

/** A Clock of 2 × 1 at a cell of the overlay's grid, pinned over the game or not. */
const clockAt = (id: string, x: number, y: number, pinned = false): Widget => ({
  id, type: 'clock', w: 2, h: 1, x, y, settings: {}, pinned,
})

const widgetById = (page: Page, id: string): Locator => page.locator(`[data-widget="${id}"]`)
const hashOf = (page: Page): Promise<string> => page.evaluate(() => window.location.hash)
/** The overlay as its window shows it, closed or open: the shell sets these addresses. */
const showClosed = (page: Page, origin: string) => page.goto(`${origin}/#/overlay`)
const showOpen = (page: Page, origin: string) => page.goto(`${origin}/#/overlay/open`)
/** The bar of the open overlay, at the top centre. */
const bar = (page: Page): Locator => page.getByRole('region', { name: 'Overlay' })
const edit = (page: Page) => bar(page).getByRole('button', { name: 'Edit', exact: true }).click()
/** A widget's pin sign in its heading, which the open overlay shows on each pinned widget. */
const pinSign = (widget: Locator): Locator => widget.getByRole('img', { name: 'Pinned over the game' })
const HELP =
  'Drag a widget to move it, or its edge or corner to resize it. On a chosen widget, the arrow keys move it and Shift with the arrow keys resizes it.'

/** The cell where a widget shows on the overlay's grid, its column and row from 0, as cellOf finds it on the Board. */
async function cellOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const [box, grid] = await Promise.all([widgetById(page, id).boundingBox(), page.getByTestId('overlay').boundingBox()])
  if (box === null || grid === null) throw new Error(`The widget ${id} is not on the overlay.`)
  return { x: Math.round((box.x - grid.x) / 180), y: Math.round((box.y - grid.y) / 108) }
}

test('closed, the overlay shows only the pinned widgets, faded by the opacity setting, and takes no clicks', async ({ page, core, api }) => {
  await setOverlay(api, [clockAt('pinned-clock', 0, 0, true), clockAt('other-clock', 3, 0)])
  await api.put('/api/settings', { overlay_opacity: 60 })
  await showClosed(page, core.origin)
  const pinned = widgetById(page, 'pinned-clock')
  await expect(pinned).toBeVisible()
  await expect(widgetById(page, 'other-clock')).toHaveCount(0)
  await expect(pinned).toHaveCSS('opacity', '0.6')
  await expect(pinSign(pinned)).toHaveCount(0) // over the game every widget shown is pinned
  // No bar and no dim layer.
  await expect(bar(page)).toHaveCount(0)
  await expect(page.locator('.ov-dim')).toHaveCount(0)
  // The grid starts 16 pixels in from the display's top left edge.
  const grid = (await page.getByTestId('overlay').boundingBox())!
  expect([grid.x, grid.y]).toEqual([16, 16])
  // Nothing of the overlay takes a click: one where the widget shows goes through it, to the game.
  await expect(page.locator('.ov')).toHaveCSS('pointer-events', 'none')
  const box = (await pinned.boundingBox())!
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('.ov') ?? null,
    [box.x + box.width / 2, box.y + box.height / 2],
  )
  expect(hit).toBeNull()
  // Turned off in the settings, the pinned widgets go at once.
  await api.put('/api/settings', { overlay_pinned: false })
  await expect(pinned).toHaveCount(0)
})

test('open, it dims the display and shows every widget with its bar, and Close goes back to closed', async ({ page, core, api }) => {
  await setOverlay(api, [clockAt('pinned-clock', 0, 0, true), clockAt('other-clock', 3, 0)])
  await api.put('/api/settings', { overlay_opacity: 60 })
  await showOpen(page, core.origin)
  const pinned = widgetById(page, 'pinned-clock')
  await expect(widgetById(page, 'other-clock')).toBeVisible()
  await expect(pinned).toBeVisible()
  await expect(pinned).toHaveCSS('opacity', '1') // the opacity is for the closed overlay
  await expect(pinSign(pinned)).toBeVisible()
  await expect(pinSign(widgetById(page, 'other-clock'))).toHaveCount(0)
  // The dim layer: the rail's colour at 45%, over the whole display.
  const dim = page.locator('.ov-dim')
  const railAt45 = /^(rgba\(59, 66, 85, 0\.45\)|color\(srgb 0\.231\d* 0\.258\d* 0\.333\d* \/ 0\.45\))$/ // #3B4255, as written
  await expect(dim).toHaveCSS('background-color', railAt45)
  expect(await dim.boundingBox()).toEqual({ x: 0, y: 0, width: 1440, height: 900 })
  // The bar, at the top centre: its title, how it closes, Edit and Close.
  await expect(bar(page).getByRole('heading', { level: 1 })).toHaveText('Overlay')
  await expect(bar(page)).toContainText('Ctrl+Alt+G or Esc closes it.')
  await expect(bar(page).getByRole('button')).toHaveText(['Edit', 'Close'])
  const place = (await bar(page).boundingBox())!
  expect(Math.abs(place.x + place.width / 2 - 720)).toBeLessThanOrEqual(1)
  expect(place.y).toBe(16)
  // The hotkey is the one the core holds (GET /api/overlay), and a new one shows at once.
  await api.put('/api/settings', { overlay_hotkey: 'Ctrl+Shift+F9' })
  await expect(bar(page)).toContainText('Ctrl+Shift+F9 or Esc closes it.')
  await bar(page).getByRole('button', { name: 'Close' }).click()
  await expect.poll(() => hashOf(page)).toBe('#/overlay')
  await expect(bar(page)).toHaveCount(0)
  await expect(dim).toHaveCount(0)
  await expect(widgetById(page, 'other-clock')).toHaveCount(0)
  await expect(pinned).toHaveCSS('opacity', '0.6')
})

test("a change the core refuses to an open overlay's widget shows in the overlay's own line, which has no note", async ({ page, core, api }) => {
  await setOverlay(api, [{ id: 'timers-o', type: 'timers', w: 3, h: 2, x: 0, y: 0, settings: {}, pinned: true }])
  await showOpen(page, core.origin)
  await page.route('**/api/timers/*/cleared', (route) =>
    route.fulfill({ status: 404, json: { error: 'There is no timer with this number.' } }),
  )
  await widgetById(page, 'timers-o').getByRole('button', { name: 'Cleared Teapot · Jade Field' }).click()
  await expect(bar(page).getByRole('alert')).toHaveText('There is no timer with this number.')
  await expect(page.getByTestId('note')).toHaveCount(0)
  await page.unroute('**/api/timers/*/cleared')
  // The widget rests a moment after a press; the next change that succeeds clears the line.
  await expect(async () => {
    await widgetById(page, 'timers-o').getByRole('button', { name: 'Cleared Teapot · Jade Field' }).click({ timeout: 1_000 })
    await expect(bar(page).getByRole('alert')).toHaveCount(0, { timeout: 1_000 }) // an empty line is not shown
  }).toPass()
})

test('Esc closes the open overlay, but not in Edit', async ({ page, core, api }) => {
  await setOverlay(api, [clockAt('clock-a', 0, 0, true)])
  await showOpen(page, core.origin)
  await expect(bar(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(() => hashOf(page)).toBe('#/overlay')
  await expect(bar(page)).toHaveCount(0)
  // In Edit, Esc closes nothing: neither the overlay, nor Edit, nor a sheet's, nor a drag's, beyond its own. The bar
  // does not say Esc closes it there.
  await showOpen(page, core.origin)
  await expect(bar(page)).toContainText('Ctrl+Alt+G or Esc closes it.')
  await edit(page)
  await expect(page.locator('#overlay-help')).toHaveText(HELP)
  await expect(bar(page)).not.toContainText('Esc closes it')
  await page.keyboard.press('Escape')
  await expect(bar(page).getByRole('button', { name: 'Done' })).toBeVisible()
  expect(await hashOf(page)).toBe('#/overlay/open')
  // Add a widget: Esc closes the sheet alone, and the focus goes back to the button that opened it.
  const addButton = bar(page).getByRole('button', { name: 'Add a widget' })
  await addButton.click()
  const add = page.getByRole('region', { name: 'Add a widget' })
  await add.getByRole('button', { name: 'Add Clock' }).focus()
  await page.keyboard.press('Escape')
  await expect(add).toHaveCount(0)
  await expect(addButton).toBeFocused()
  await expect(bar(page).getByRole('button', { name: 'Done' })).toBeVisible()
  expect(await hashOf(page)).toBe('#/overlay/open')
  // Esc closes it too while the focus is still on that button.
  await addButton.click()
  await expect(add).toBeVisible()
  await expect(addButton).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(add).toHaveCount(0)
  await expect(addButton).toHaveAttribute('aria-expanded', 'false')
  expect(await hashOf(page)).toBe('#/overlay/open')
  // A drag: Esc puts the widget back, and the overlay stays.
  const clock = widgetById(page, 'clock-a')
  const head = (await clock.locator('.w-head').boundingBox())!
  await page.mouse.move(head.x + 12, head.y + head.height / 2)
  await page.mouse.down()
  await page.mouse.move(head.x + 12 + 2 * 180, head.y + head.height / 2 + 108, { steps: 8 })
  await expect(clock).toContainClass('lifted')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(clock).not.toContainClass('lifted')
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 0, y: 0 })
  expect(await hashOf(page)).toBe('#/overlay/open')
  // Out of Edit, Esc closes it.
  await bar(page).getByRole('button', { name: 'Cancel' }).click()
  await page.keyboard.press('Escape')
  await expect.poll(() => hashOf(page)).toBe('#/overlay')
})

test('Esc in a sheet closes the sheet, and only a second Esc closes the overlay', async ({ page, core, api }) => {
  await setOverlay(api, [clockAt('clock-a', 0, 0, true)])
  await showOpen(page, core.origin)
  await edit(page)
  const clock = widgetById(page, 'clock-a')
  await clock.getByRole('button', { name: 'Settings of Clock' }).click()
  const settings = page.getByRole('region', { name: 'Settings of Clock' })
  await expect(settings).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  await expect(clock).toBeFocused() // the focus goes back to its widget
  expect(await hashOf(page)).toBe('#/overlay/open')
  // Esc never closes the overlay in Edit (Esc closes the open overlay, but not in Edit): the second comes after Done.
  await bar(page).getByRole('button', { name: 'Done' }).click()
  await expect(bar(page).getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(() => hashOf(page)).toBe('#/overlay')
})

test("in Edit a widget can be pinned over the game, and Done saves it to the overlay's layout, not the Board's", async ({ page, core, api }) => {
  await setOverlay(api, [clockAt('clock-a', 0, 0)])
  const board = await api.get<Layout>('/api/layouts/board')
  await showOpen(page, core.origin)
  const clock = widgetById(page, 'clock-a')
  await expect(clock).toBeVisible()
  await expect(pinSign(clock)).toHaveCount(0)
  await edit(page)
  const pin = clock.getByRole('button', { name: 'Pin Clock over the game' })
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await expect(pin).toHaveAttribute('title', 'Shows over the game while the overlay is closed')
  // Its buttons in Edit: the pin, then its own.
  const tools = clock.locator('.w-tools button')
  await expect(tools).toHaveCount(3)
  await expect(tools.nth(0)).toHaveAccessibleName('Pin Clock over the game')
  await expect(tools.nth(1)).toHaveAccessibleName('Settings of Clock')
  await expect(tools.nth(2)).toHaveAccessibleName('Remove Clock')
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await expect(pin.locator('.sign')).toHaveCSS('color', 'rgb(43, 49, 66)') // pressed, a solid gold button, its sign dark
  await expect(pinSign(clock)).toBeVisible()
  await bar(page).getByRole('button', { name: 'Done' }).click()
  await expect(bar(page).getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await overlayOf(api)).widgets).toMatchObject([{ id: 'clock-a', pinned: true }])
  expect(await api.get<Layout>('/api/layouts/board')).toEqual(board)
  await showClosed(page, core.origin)
  await expect(clock).toBeVisible()
  // Unpinned again, it leaves the closed overlay.
  await showOpen(page, core.origin)
  await edit(page)
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await bar(page).getByRole('button', { name: 'Done' }).click()
  await expect(bar(page).getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await overlayOf(api)).widgets).toMatchObject([{ id: 'clock-a', pinned: false }])
  await showClosed(page, core.origin)
  await expect(clock).toHaveCount(0)
})

test("the overlay's widgets draw with the dark roles, and the page behind them is transparent", async ({ page, core, api }) => {
  await setOverlay(api, [clockAt('clock-a', 0, 0, true)])
  await showClosed(page, core.origin)
  const clock = widgetById(page, 'clock-a')
  await expect(clock).toBeVisible()
  await expect(page.locator('html')).toContainClass('ov-doc')
  for (const element of [page.locator('html'), page.locator('body')]) {
    await expect(element).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(element).toHaveCSS('background-image', 'none')
  }
  await expect(page.locator('.ov')).toContainClass('on-dark')
  await expect(clock).toHaveCSS('background-color', 'rgba(43, 49, 66, 0.93)')
  await expect(clock).toHaveCSS('color', 'rgb(241, 234, 219)') // its ink
  await expect(clock.locator('.w-name')).toHaveCSS('color', 'rgb(217, 210, 195)') // its heading's
  // Open, the bar and Edit's sheets are dark too, with parchment text.
  await showOpen(page, core.origin)
  await expect(bar(page)).toHaveCSS('background-color', 'rgb(43, 49, 66)')
  await expect(bar(page).getByRole('heading', { level: 1 })).toHaveCSS('color', 'rgb(241, 234, 219)')
  await edit(page)
  await bar(page).getByRole('button', { name: 'Add a widget' }).click()
  const add = page.getByRole('region', { name: 'Add a widget' })
  await expect(add).toHaveCSS('background-color', 'rgb(43, 49, 66)')
  await expect(add.getByText('Clock', { exact: true })).toHaveCSS('color', 'rgb(241, 234, 219)')
})

test('the overlay page is see-through by the time it has loaded, and the Board is not', async ({ page, core }) => {
  // The shell shows the overlay's window once its page has loaded: from then on, no frame may draw the parchment page.
  type Seen = { ovAtLoad?: boolean }
  await page.addInitScript(() => {
    addEventListener('load', () => {
      ;(window as unknown as Seen).ovAtLoad = document.documentElement.classList.contains('ov-doc')
    })
  })
  // Each address is loaded afresh: from the page the fixture opened, only its hash would change, with no load.
  const atLoad = async (hash: string) => {
    await page.goto('about:blank')
    await page.goto(`${core.origin}/${hash}`) // it waits for the load event
    return page.evaluate(() => (window as unknown as Seen).ovAtLoad)
  }
  expect(await atLoad('#/overlay')).toBe(true)
  expect(await atLoad('#/overlay/open')).toBe(true)
  expect(await atLoad('#/board')).toBe(false)
})

test("closed during Edit, it shows the saved layout's pinned widgets with nothing of Edit, and Edit comes back when it opens", async ({ page, core, api }) => {
  // Down the left side, below the open bar's rows.
  await setOverlay(api, [clockAt('clock-a', 0, 2, true), clockAt('clock-b', 0, 4)])
  await showOpen(page, core.origin)
  await edit(page)
  // Edit's copy: the pinned clock a column to the right, the other pinned too, and a widget's Settings open.
  const clockA = widgetById(page, 'clock-a')
  await clockA.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 1, y: 2 })
  await widgetById(page, 'clock-b').getByRole('button', { name: 'Pin Clock over the game' }).click()
  await clockA.getByRole('button', { name: 'Settings of Clock' }).click()
  await expect(page.getByRole('region', { name: 'Settings of Clock' })).toBeVisible()
  // The hotkey closes it, as the shell sets the address.
  await showClosed(page, core.origin)
  await expect(bar(page)).toHaveCount(0)
  // The saved layout's pinned widgets, where it keeps them, and nothing of Edit: no grip, tool, free cell or sheet.
  await expect(clockA).toBeVisible()
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 0, y: 2 })
  await expect(widgetById(page, 'clock-b')).toHaveCount(0)
  await expect(clockA).not.toContainClass('editing')
  await expect(clockA).not.toHaveAttribute('role', 'group')
  for (const part of ['.grip', '.w-tools', '.board-cell', '.board-sheet', '.board-landing', '#overlay-help']) {
    await expect(page.locator(part), part).toHaveCount(0)
  }
  // Open again, Edit and its copy are back, unsaved, and the widget's Settings with the focus.
  await showOpen(page, core.origin)
  await expect(bar(page).getByRole('button', { name: 'Done' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Settings of Clock' })).toBeFocused()
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 1, y: 2 })
  const pinB = widgetById(page, 'clock-b').getByRole('button', { name: 'Pin Clock over the game' })
  await expect(pinB).toHaveAttribute('aria-pressed', 'true')
  expect((await overlayOf(api)).widgets).toMatchObject([
    { id: 'clock-a', x: 0, pinned: true },
    { id: 'clock-b', pinned: false },
  ])
  await bar(page).getByRole('button', { name: 'Cancel' }).click()
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 0, y: 2 })
})

test('closed in the middle of a drag in Edit, the overlay goes on working', async ({ page, core, api }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await setOverlay(api, [clockAt('clock-a', 0, 2, true)])
  await showOpen(page, core.origin)
  await edit(page)
  // A Clock added in this Edit, which the saved layout does not have.
  const addButton = bar(page).getByRole('button', { name: 'Add a widget' })
  await addButton.click()
  await page.getByRole('region', { name: 'Add a widget' }).getByRole('button', { name: 'Add Clock' }).click()
  await addButton.click()
  await expect(page.getByTestId('overlay').locator('[data-widget]')).toHaveCount(2)
  // The pinned clock held in a drag, when the hotkey closes the overlay.
  const clock = widgetById(page, 'clock-a')
  const head = (await clock.locator('.w-head').boundingBox())!
  await page.mouse.move(head.x + 12, head.y + head.height / 2)
  await page.mouse.down()
  await page.mouse.move(head.x + 12 + 2 * 180, head.y + head.height / 2 + 108, { steps: 8 })
  await expect(clock).toContainClass('lifted')
  await showClosed(page, core.origin)
  await page.mouse.up()
  // The pinned clock shows over the game, where it is saved, and the overlay opens again with Edit's copy.
  await expect(clock).toBeVisible()
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 0, y: 2 })
  await expect(page.getByTestId('overlay').locator('[data-widget]')).toHaveCount(1)
  await showOpen(page, core.origin)
  await expect(bar(page).getByRole('button', { name: 'Done' })).toBeVisible()
  await expect(page.getByTestId('overlay').locator('[data-widget]')).toHaveCount(2)
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 0, y: 2 }) // the drag was put back
  expect(errors).toEqual([])
})

test("in Edit the overlay's widgets stay on its display, its last row the display's", async ({ page, core, api }) => {
  // The window's 900 pixels hold eight rows under the 16 above the grid: rows 1 to 8.
  await setOverlay(api, [clockAt('clock-a', 0, 6, true)])
  await showOpen(page, core.origin)
  await edit(page)
  const clock = widgetById(page, 'clock-a')
  const said = page.locator('p.sr-only[aria-live="polite"]')
  await clock.focus()
  await page.keyboard.press('ArrowDown')
  await expect(said).toHaveText('Clock, column 1, row 8.')
  await page.keyboard.press('ArrowDown')
  await expect(said).toHaveText('Clock is at the bottom.')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(said).toHaveText('Clock is at the bottom.')
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 0, y: 7 })
  // A drag past the bottom edge lands on the last row.
  const head = (await clock.locator('.w-head').boundingBox())!
  await page.mouse.move(head.x + 12, head.y + head.height / 2)
  await page.mouse.down()
  await page.mouse.move(head.x + 12 + 2 * 180, head.y + head.height / 2 + 3 * 108, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => cellOf(page, 'clock-a')).toEqual({ x: 2, y: 7 })
  // Edit's free cells reach the last row and go no further: the grid ends on the display.
  const lowest = await page
    .getByTestId('overlay')
    .locator('.board-cell')
    .evaluateAll((cells) => Math.max(...cells.map((cell) => Number(getComputedStyle(cell).gridRowStart))))
  expect(lowest).toBe(8)
  const grid = (await page.getByTestId('overlay').boundingBox())!
  expect(grid.y + grid.height).toBeLessThanOrEqual(900)
})

test("the grid reaches the display's edges: nineteen columns on 3,440 pixels, the last 16 pixels in from the right", async ({ page, core, api }) => {
  // The player's 3,440 × 1,440 main display at 100%: 3,408 pixels between the 16 at each side hold nineteen cells of 168
  // with 12-pixel gaps, and the height thirteen rows. A clock on the last two columns, at the far right.
  await page.setViewportSize({ width: 3440, height: 1440 })
  await setOverlay(api, [clockAt('clock-right', 17, 0, true)])
  await showOpen(page, core.origin)
  const clock = widgetById(page, 'clock-right')
  await expect(clock).toBeVisible()
  const grid = page.getByTestId('overlay')
  expect(await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(19)
  await expect.poll(() => cellOf(page, 'clock-right')).toEqual({ x: 17, y: 0 })
  const box = (await clock.boundingBox())!
  expect(box.width).toBe(2 * 168 + 12) // the widgets keep their size
  expect(3440 - (box.x + box.width)).toBe(16)
  // In Edit, the free cells reach the thirteenth row.
  await edit(page)
  const lowest = await grid
    .locator('.board-cell')
    .evaluateAll((cells) => Math.max(...cells.map((cell) => Number(getComputedStyle(cell).gridRowStart))))
  expect(lowest).toBe(13)
})

test("the overlay's cells stay 168 pixels wide where its width leaves room over, as the Board's columns do not", async ({ page, core, api }) => {
  // The 1,440-pixel stand-in: 1,408 pixels between the 16 at each side hold seven cells, and 160 are left over, which
  // stay at the right. The Board shares what it has left over among its columns; the overlay does not.
  await setOverlay(api, [clockAt('clock-a', 0, 0, true), clockAt('clock-b', 5, 1, true)])
  await showOpen(page, core.origin)
  await expect(widgetById(page, 'clock-b')).toBeVisible()
  const tracks = await page.getByTestId('overlay').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' '))
  expect(tracks).toEqual(Array(7).fill('168px'))
  for (const id of ['clock-a', 'clock-b']) expect((await widgetById(page, id).boundingBox())!.width, id).toBe(2 * 168 + 12)
  expect(await cellOf(page, 'clock-b')).toEqual({ x: 5, y: 1 })
})

test('larger, the overlay shows a widget saved below its last row on the display, and Done saves the place shown', async ({ page, core, api }) => {
  // A page of 2,580 × 1,080 CSS pixels, as on a smaller display or at a larger size (the shell zooms the view): fourteen
  // columns and nine rows. The layout was made on a taller one, with a clock at row 11.
  await page.setViewportSize({ width: 2580, height: 1080 })
  await setOverlay(api, [clockAt('clock-a', 0, 0, true), clockAt('clock-low', 0, 10, true)])
  await showClosed(page, core.origin)
  const low = widgetById(page, 'clock-low')
  await expect(low).toBeVisible()
  // At the first free place on the display, beside the other clock, and wholly on it.
  await expect.poll(() => cellOf(page, 'clock-low')).toEqual({ x: 2, y: 0 })
  const box = (await low.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(1080)
  // The layout keeps its place until the player saves in Edit.
  expect((await overlayOf(api)).widgets[1]).toMatchObject({ id: 'clock-low', x: 0, y: 10 })
  await showOpen(page, core.origin)
  await expect.poll(() => cellOf(page, 'clock-low')).toEqual({ x: 2, y: 0 })
  // Cancel saves nothing: the layout keeps row 10.
  await edit(page)
  await bar(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(bar(page).getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await overlayOf(api)).widgets[1]).toMatchObject({ id: 'clock-low', x: 0, y: 10 })
  await edit(page)
  await bar(page).getByRole('button', { name: 'Done' }).click()
  await expect(bar(page).getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  expect((await overlayOf(api)).widgets).toMatchObject([
    { id: 'clock-a', x: 0, y: 0 },
    { id: 'clock-low', x: 2, y: 0 },
  ])
})

/*
 * Ready lines (stage 2A spec 10): while the game runs, a timer that turns ready puts a line over the game, which the core
 * sends as an overlay_line event. The demo sends one on POST /api/demo/line.
 */

/** The line over the game that says this. */
const lineOf = (page: Page, text: string): Locator => page.locator('.ov-lines li', { hasText: text })

test('a ready line shows over the closed overlay and goes', async ({ page, core, api }) => {
  await setOverlay(api, [clockAt('clock-a', 0, 2, true)])
  await showClosed(page, core.origin)
  await expect(widgetById(page, 'clock-a')).toBeVisible()
  await api.post('/api/demo/line', { text: 'Unusual Hilichurl is ready.' })
  const line = lineOf(page, 'Unusual Hilichurl is ready.')
  await expect(line).toBeVisible()
  // At the top centre, under the open bar's place: a dark plate with parchment text, in a list that says each politely.
  const box = (await line.boundingBox())!
  expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(1)
  expect(box.y).toBeGreaterThan(72) // below the open bar's place: its top at 16 and its one row of 50
  await expect(line).toHaveCSS('background-color', 'rgb(43, 49, 66)')
  await expect(line).toHaveCSS('color', 'rgb(241, 234, 219)')
  const list = page.locator('.ov-lines')
  await expect(list).toHaveAttribute('aria-live', 'polite')
  await expect(list).toHaveCSS('pointer-events', 'none')
  // It goes six seconds after it came.
  await expect(line).toHaveCount(0, { timeout: 10_000 })
  // With lines over the game turned off in the settings, there are none.
  await api.put('/api/settings', { overlay_lines: false })
  await expect(list).toHaveCount(0)
})

test('a ready line takes no clicks while the overlay is open', async ({ page, core, api }) => {
  // Notes at the top centre, under where the lines show.
  await setOverlay(api, [{ id: 'notes-a', type: 'notes', w: 4, h: 3, x: 2, y: 0, settings: {} }])
  await showOpen(page, core.origin)
  const notes = widgetById(page, 'notes-a').getByRole('textbox', { name: 'Notes' })
  await expect(notes).toBeVisible()
  await api.post('/api/demo/line', { text: 'Unusual Hilichurl is ready.' })
  const line = lineOf(page, 'Unusual Hilichurl is ready.')
  await expect(line).toBeVisible()
  // A click on the line reaches the widget under it.
  const box = (await line.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(notes).toBeFocused()
})

test('a ready line shows under the bar, in Edit with its help too, and under the sheets', async ({ page, core, api }) => {
  await setOverlay(api, [clockAt('clock-a', 0, 2, true)])
  await showOpen(page, core.origin)
  await edit(page)
  await expect(page.locator('#overlay-help')).toBeVisible()
  await api.post('/api/demo/line', { text: 'Unusual Hilichurl is ready.' })
  const line = lineOf(page, 'Unusual Hilichurl is ready.')
  await expect(line).toBeVisible()
  const [lineBox, barBox] = await Promise.all([line.boundingBox(), bar(page).boundingBox()])
  expect(lineBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height)
  // A sheet lies over the lines: of the overlay's layers, the lines' is the lower.
  await widgetById(page, 'clock-a').getByRole('button', { name: 'Settings of Clock' }).click()
  const sheet = page.getByRole('region', { name: 'Settings of Clock' })
  await expect(sheet).toBeVisible()
  const layer = (locator: Locator) => locator.evaluate((element) => Number(getComputedStyle(element).zIndex))
  expect(await layer(page.locator('.ov-top'))).toBeLessThan(await layer(sheet))
})

test.describe('before the risk statement is acknowledged', () => {
  test.use({ firstRun: true })

  test('the overlay shows nothing, not even the first run', async ({ page, core }) => {
    // The page has read the core: the first run shows.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Guild Board')
    await showOpen(page, core.origin)
    await expect(page.locator('html')).toContainClass('ov-doc')
    await expect(page.locator('#root')).toBeEmpty()
  })
})

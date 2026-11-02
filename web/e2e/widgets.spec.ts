import type { Locator, Page } from '@playwright/test'
import type { QuickTimersModel } from '../src/types.ts'
import { dashesOf, setBoard, widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'

/* The utility widgets of spec 13.3: Notes, Quick timer and Stopwatch, on the demo's Board. */

/** The colours of a strip of the screen, as the page draws it: [red, green, blue] for each pixel, top to bottom. */
async function stripOf(page: Page, clip: { x: number; y: number; width: 1; height: number }): Promise<number[][]> {
  const picture = await page.screenshot({ clip })
  return page.evaluate(
    async ({ base64, height }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      const { data } = context.getImageData(0, 0, 1, height)
      return Array.from({ length: height }, (_, row) => [data[row * 4], data[row * 4 + 1], data[row * 4 + 2]])
    },
    { base64: picture.toString('base64'), height: clip.height },
  )
}

/** Whether a colour is `wanted`, give or take a few steps for the screen's rounding. */
const isColour = (colour: number[], wanted: readonly number[]) => colour.every((value, channel) => Math.abs(value - wanted[channel]) <= 6)

test('notes typed just before a reload are kept', async ({ page, api }) => {
  const notes = widgetById(page, 'start-notes').getByRole('textbox', { name: 'Notes' })
  await expect(notes).toBeEditable()
  await notes.fill('Buy Sweet Flowers')
  await page.reload() // at once: the text goes as the page closes
  await expect(widgetById(page, 'start-notes').getByRole('textbox', { name: 'Notes' })).toHaveValue('Buy Sweet Flowers')
  expect(await api.get('/api/widgets/start-notes/data')).toEqual({ data: { text: 'Buy Sweet Flowers' } })
})

test('notes are saved a moment after typing stops', async ({ page, api }) => {
  await widgetById(page, 'start-notes').getByRole('textbox', { name: 'Notes' }).fill('Mint for Kirara')
  await expect.poll(() => api.get('/api/widgets/start-notes/data')).toEqual({ data: { text: 'Mint for Kirara' } })
})

test('a note that another PC changed shows on an open page', async ({ page, api }) => {
  const notes = widgetById(page, 'start-notes').getByRole('textbox', { name: 'Notes' })
  await expect(notes).toBeEditable()
  await api.put('/api/widgets/start-notes/data', { data: { text: 'From the other PC' } })
  await api.advance(1) // the event of the pull that brought it
  await expect(notes).toHaveValue('From the other PC')
})

test('what is being typed stays when a note comes from another PC', async ({ page, api }) => {
  const notes = widgetById(page, 'start-notes').getByRole('textbox', { name: 'Notes' })
  await expect(notes).toBeEditable()
  await notes.fill('Still typing')
  await api.put('/api/widgets/start-notes/data', { data: { text: 'From the other PC' } })
  await api.advance(1)
  await expect.poll(() => api.get('/api/widgets/start-notes/data')).toEqual({ data: { text: 'Still typing' } })
  await expect(notes).toHaveValue('Still typing')
})

test('a note that could not be saved stays as it was typed at the next event', async ({ page, api }) => {
  const notes = widgetById(page, 'start-notes')
  const field = notes.getByRole('textbox', { name: 'Notes' })
  await expect(field).toBeEditable()
  await page.route('**/api/widgets/start-notes/data', async (route) => {
    if (route.request().method() === 'PUT') await route.abort()
    else await route.continue()
  })
  await field.fill('Not kept yet')
  await expect(notes.getByRole('alert')).toBeVisible()
  await api.advance(1)
  await page.waitForTimeout(300)
  await expect(field).toHaveValue('Not kept yet')
})

// The paper and the rules of the Notes field, as the stylesheets set them on parchment: --w-plate and --w-line.
const PAPER = [241, 234, 217]
const RULE = [230, 219, 194]
const RING = [68, 112, 180] // --focus

test('the Notes field is lightly ruled paper: a hairline under every line of text', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 }) // the whole field is on the screen, whose pixels are read
  const field = widgetById(page, 'start-notes').getByRole('textbox', { name: 'Notes' })
  await expect(field).toBeEditable()
  expect(await field.evaluate((one) => getComputedStyle(one).lineHeight)).toBe('20px')
  const box = (await field.boundingBox())!
  // A strip down the field near its right edge, clear of the text and of its rounded corners.
  const strip = await stripOf(page, { x: Math.floor(box.x + box.width - 16), y: Math.ceil(box.y) + 2, width: 1, height: Math.floor(box.height) - 4 })
  const rules = strip.flatMap((colour, row) => (isColour(colour, RULE) ? [row] : []))
  expect(rules.length).toBeGreaterThanOrEqual(3)
  // The hairlines are one line apart, and everything between them is the paper.
  expect(rules.slice(1).map((row, index) => row - rules[index])).toEqual(rules.slice(1).map(() => 20))
  expect(strip.filter((_, row) => !rules.includes(row)).every((colour) => isColour(colour, PAPER))).toBe(true)
})

test("the Notes paper is the dark panel's translucent plate over its card, not the white of a text field", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 }) // the whole field is on the screen, whose pixels are read
  const frame = widgetById(page, 'start-notes')
  const field = frame.getByRole('textbox', { name: 'Notes' })
  await expect(field).toBeEditable()
  expect(await field.evaluate((one) => getComputedStyle(one).backgroundColor)).toBe('rgba(0, 0, 0, 0)') // none of its own
  await frame.evaluate((section) => section.classList.add('on-dark'))
  const box = (await field.boundingBox())!
  // A pixel in the field's top padding, clear of any text: dark, as the card is, with the plate's faint cream on it.
  const [paper] = await stripOf(page, { x: Math.floor(box.x + box.width / 2), y: Math.floor(box.y) + 4, width: 1, height: 1 })
  expect(Math.max(...paper), `paper ${JSON.stringify(paper)}`).toBeLessThan(130)
})

test("the Notes field's focus ring is drawn whole, clear of the fade at the body's bottom edge", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 }) // the whole field is on the screen, whose pixels are read
  const field = widgetById(page, 'start-notes').getByRole('textbox', { name: 'Notes' })
  await expect(field).toBeEditable()
  await field.focus()
  const box = (await field.boundingBox())!
  const x = Math.floor(box.x + box.width / 2)
  // The ring is the 2 pixels that begin 2 pixels out of the field; the pixel row 3 pixels out is in it, whatever the
  // fraction the field's place has. At the bottom edge the ring is as strong as at the top, where nothing fades it: a ring
  // in the fade would be a blend with the card.
  const top = await stripOf(page, { x, y: Math.floor(box.y - 3), width: 1, height: 1 })
  const bottom = await stripOf(page, { x, y: Math.floor(box.y + box.height + 3), width: 1, height: 1 })
  expect(top.every((colour) => isColour(colour, RING)), `top ${JSON.stringify(top)}`).toBe(true)
  expect(bottom.every((colour) => isColour(colour, RING)), `bottom ${JSON.stringify(bottom)}`).toBe(true)
})

test('a quick timer starts in one click, is ready on time and is dismissed', async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'quick-1', type: 'quick-timer', w: 3, h: 2, settings: {} }])
  const widget = widgetById(page, 'quick-1')
  await widget.getByRole('button', { name: '5 min' }).click()
  // It fills the widget: the presets go, and the time left is in large figures inside a large dial.
  const run = widget.locator('.qt-run')
  await expect(run).toContainText(/5:00|4:59/)
  await expect(widget.getByRole('button', { name: '1 min' })).toHaveCount(0)
  expect((await run.locator('.dial').boundingBox())!.width).toBeGreaterThan(90)
  await expect(run.locator('.dial')).not.toHaveClass(/ready/)
  await expect(run.locator('.seal')).toHaveCount(0)
  await api.advance(300)
  await expect(run).toContainText('Ready')
  // A ready one has the Ready seal where the time left was, and the green dial with its tick.
  await expect(run.locator('.seal')).toHaveText('Ready')
  await expect(run.locator('.dial')).toHaveClass(/ready/)
  await expect(run.locator('.dial-tick')).toBeVisible()
  await run.getByRole('button', { name: 'Dismiss Quick timer · 5 min' }).click()
  await expect(run).toHaveCount(0)
  await expect(widget.getByRole('button', { name: '5 min' })).toBeVisible() // the presets are back
  expect((await api.get<QuickTimersModel>('/api/quick-timers')).quick_timers).toEqual([])
})

test('a running quick timer shows the time passed in its dial', async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'quick-1', type: 'quick-timer', w: 3, h: 2, settings: {} }])
  const widget = widgetById(page, 'quick-1')
  await widget.getByRole('button', { name: '10 min' }).click()
  const run = widget.locator('.qt-run')
  await expect(run).toContainText(/10:00|9:5\d/)
  await api.advance(300) // half of the ten minutes
  const passed = async () => Math.round((await dashesOf(run.locator('.d-fill')))[0])
  await expect.poll(passed).toBeGreaterThanOrEqual(50)
  expect(await passed()).toBeLessThanOrEqual(53) // the page's clock is a few seconds on
  expect(await dashesOf(run.locator('.d-fill'))).toHaveLength(2) // of a circle that is a hundred long
  // Cancel stops it, and the presets are back.
  await run.getByRole('button', { name: 'Cancel Quick timer · 10 min' }).click()
  await expect(widget.getByRole('button', { name: '10 min' })).toBeVisible()
  expect((await api.get<QuickTimersModel>('/api/quick-timers')).quick_timers).toEqual([])
})

test('the presets are one row of buttons of one size', async ({ page, api }) => {
  await setBoard(api, page, [
    { id: 'quick-s', type: 'quick-timer', w: 2, h: 2, settings: {} },
    { id: 'quick-l', type: 'quick-timer', w: 4, h: 4, settings: {} },
  ])
  for (const id of ['quick-s', 'quick-l']) {
    const presets = widgetById(page, id).locator('[data-centre]').getByRole('button')
    await expect(presets).toHaveText(['1 min', '5 min', '10 min', '30 min', '1 h'])
    const boxes = await presets.evaluateAll((all) =>
      all.map((one) => {
        const box = one.getBoundingClientRect()
        return { top: Math.round(box.top), size: `${Math.round(box.width)} × ${Math.round(box.height)}` }
      }),
    )
    expect(new Set(boxes.map((box) => box.size)).size, id).toBe(1) // one size
    expect(new Set(boxes.map((box) => box.top)).size, id).toBe(1) // in one row
  }
})

test('the quick timer at 2 × 2 opens the time of your own on demand', async ({ page, api }) => {
  await setBoard(api, page, [
    { id: 'quick-s', type: 'quick-timer', w: 2, h: 2, settings: {} },
    { id: 'quick-m', type: 'quick-timer', w: 3, h: 2, settings: {} },
    { id: 'quick-l', type: 'quick-timer', w: 3, h: 3, settings: {} },
  ])
  const [small, medium, large] = ['quick-s', 'quick-m', 'quick-l'].map((id) => widgetById(page, id))
  const own = (widget: Locator) => widget.getByRole('form', { name: 'Quick timer of your own' })
  // Below 3 × 3 the presets stand alone, and the fields of the player's own time are behind a button.
  for (const widget of [small, medium]) {
    await expect(own(widget)).toBeHidden()
    await expect(widget.getByRole('button', { name: 'Your own time' })).toHaveAttribute('aria-expanded', 'false')
  }
  const open = small.getByRole('button', { name: 'Your own time' })
  await open.click()
  await expect(open).toHaveAttribute('aria-expanded', 'true')
  await expect(own(small)).toBeVisible()
  await expect(own(medium)).toBeHidden() // each widget opens its own
  for (const part of ['Hours', 'Minutes', 'Seconds']) await expect(own(small).getByRole('spinbutton', { name: part })).toBeVisible()
  await own(small).getByRole('spinbutton', { name: 'Minutes' }).fill('2')
  await own(small).getByRole('button', { name: 'Start' }).click()
  await expect(small.locator('.qt-run')).toContainText('2 min')
  await small.getByRole('button', { name: 'Cancel Quick timer · 2 min' }).click()
  await open.click() // and the button closes them again
  await expect(open).toHaveAttribute('aria-expanded', 'false')
  await expect(own(small)).toBeHidden()
  // From 3 × 3 the fields are always there and there is no button.
  await expect(own(large)).toBeVisible()
  await expect(large.getByRole('button', { name: 'Your own time' })).toHaveCount(0)
})

test('a quick timer of its own time takes hours, minutes and seconds, up to 12 hours', async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'quick-1', type: 'quick-timer', w: 3, h: 3, settings: {} }])
  const widget = widgetById(page, 'quick-1')
  const own = widget.getByRole('form', { name: 'Quick timer of your own' })
  await own.getByRole('spinbutton', { name: 'Hours' }).fill('13')
  await own.getByRole('button', { name: 'Start' }).click()
  await expect(widget.getByRole('alert')).toHaveText('A quick timer runs from 1 second to 12 hours.')
  await own.getByRole('spinbutton', { name: 'Hours' }).fill('1')
  await own.getByRole('spinbutton', { name: 'Minutes' }).fill('30')
  await own.getByRole('button', { name: 'Start' }).click()
  await expect(widget.locator('.qt-run')).toContainText('1 h 30 min')
  await expect(widget.locator('.qt-run')).toContainText(/1:(30:00|29:5\d)/)
})

test("the stopwatch runs on the core's clock, laps and stops, and keeps its time after a reload", async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'watch-1', type: 'stopwatch', w: 2, h: 2, settings: {} }])
  const watch = widgetById(page, 'watch-1')
  const time = watch.locator('[data-centre] .fig')
  const seal = watch.locator('[data-centre] .seal')
  await expect(seal).toHaveText('Stopped')
  await expect(seal).toHaveClass(/quiet/) // a seal that is not the ready green
  await watch.getByRole('button', { name: 'Start' }).click()
  await expect(seal).toHaveText('Running')
  await expect(seal).not.toHaveClass(/quiet/)
  await api.advance(65)
  await expect(time).toHaveText(/^1:0[5-8]$/) // seconds while it runs
  await watch.getByRole('button', { name: 'Lap' }).click()
  await expect(watch.locator('.lap-t')).toHaveText([/^1:0[5-8]\.\d$/])
  await watch.getByRole('button', { name: 'Stop' }).click()
  await expect(time).toHaveText(/^1:0[5-8]\.\d$/) // and tenths once it stops
  await expect(seal).toHaveText('Stopped')
  const stopped = (await time.textContent())!
  await page.reload()
  await expect(time).toHaveText(stopped)
  await expect(watch.getByRole('listitem')).toHaveCount(1)
  await watch.getByRole('button', { name: 'Reset' }).click()
  await expect(time).toHaveText('0:00.0')
  await expect(watch.getByRole('listitem')).toHaveCount(0)
})

test("the stopwatch's laps show as bars, the fastest marked", async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'watch-1', type: 'stopwatch', w: 2, h: 2, settings: {} }])
  await api.put('/api/widgets/watch-1/data', { data: { running_since: null, elapsed_ms: 170_000, laps: [65_000, 125_000, 170_000] } })
  await page.reload()
  const watch = widgetById(page, 'watch-1')
  // A row for each lap, the newest first, with the time since the lap before it: 65, 60 and 45 seconds.
  await expect(watch.getByRole('listitem')).toHaveCount(3)
  await expect(watch.locator('.lap-n')).toHaveText(['Lap 3', 'Lap 2', 'Lap 1'])
  await expect(watch.locator('.lap-t')).toHaveText(['0:45.0', '1:00.0', '1:05.0'])
  // Each lap's bar is its share of the longest, the first lap's 65 seconds, and its time is the text beside it.
  const shares = await watch.locator('.lap .bar-fill').evaluateAll((all) => all.map((one) => parseFloat((one as HTMLElement).style.width)))
  expect(shares.map(Math.round)).toEqual([69, 92, 100])
  // The fastest lap, the third, says so, and no other.
  await expect(watch.getByText('fastest')).toHaveCount(1)
  await expect(watch.getByRole('listitem').filter({ hasText: 'fastest' })).toContainText('Lap 3')
  // A single lap is not the fastest of anything.
  await api.put('/api/widgets/watch-1/data', { data: { running_since: null, elapsed_ms: 31_200, laps: [31_200] } })
  await page.reload()
  await expect(watch.locator('.lap-t')).toHaveText(['0:31.2'])
  await expect(watch.getByText('fastest')).toHaveCount(0)
})

test('Start or Stop, Lap and Reset are one size', async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'watch-1', type: 'stopwatch', w: 2, h: 2, settings: {} }])
  const watch = widgetById(page, 'watch-1')
  const sizes = async () =>
    watch.getByRole('button').evaluateAll((all) =>
      all.map((one) => {
        const box = one.getBoundingClientRect()
        return `${Math.round(box.width)} × ${Math.round(box.height)}`
      }),
    )
  const seen = new Set<string>()
  await expect(watch.getByRole('button')).toHaveText(['Start']) // at zero
  for (const size of await sizes()) seen.add(size)
  await watch.getByRole('button', { name: 'Start' }).click()
  await expect(watch.getByRole('button')).toHaveText(['Stop', 'Lap']) // running
  for (const size of await sizes()) seen.add(size)
  await watch.getByRole('button', { name: 'Stop' }).click()
  await expect(watch.getByRole('button')).toHaveText(['Start', 'Reset']) // stopped with a time
  for (const size of await sizes()) seen.add(size)
  expect([...seen]).toHaveLength(1)
})

test('a note that could not be read is read again once the core answers', async ({ page, api }) => {
  await api.put('/api/widgets/start-notes/data', { data: { text: 'Kept' } })
  let failing = true
  await page.route('**/api/widgets/start-notes/data', async (route) => {
    if (failing && route.request().method() === 'GET') await route.abort()
    else await route.continue()
  })
  await page.reload()
  const notes = widgetById(page, 'start-notes')
  await expect(notes.getByRole('alert')).toHaveText('Guild Board is not answering. It may have been closed.')
  failing = false
  await api.advance(1) // the core's next event: the widget reads its data again
  await expect(notes.getByRole('textbox', { name: 'Notes' })).toHaveValue('Kept')
  await expect(notes.getByRole('alert')).toHaveCount(0)
})

type Watch = { data: { running_since: string | null; elapsed_ms: number } }

test('notes are saved as the window hides, before the half second after typing', async ({ page, api }) => {
  const notes = widgetById(page, 'start-notes').getByRole('textbox', { name: 'Notes' })
  await expect(notes).toBeEditable()
  await notes.fill('Sweet Flowers for Kirara')
  // Closing the window hides the page a moment before it goes (dashboard.py): the note leaves at once.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect
    .poll(() => api.get('/api/widgets/start-notes/data'), { timeout: 300, intervals: [50] })
    .toEqual({ data: { text: 'Sweet Flowers for Kirara' } })
})

test('the stopwatch keeps the time of the press, not of its last second', async ({ page, api }) => {
  await page.clock.install()
  await setBoard(api, page, [{ id: 'watch-1', type: 'stopwatch', w: 2, h: 2, settings: {} }])
  await page.clock.pauseAt(Date.now() + 2_000) // from here the page's time moves only when the test says
  const watch = widgetById(page, 'watch-1')
  await watch.getByRole('button', { name: 'Start' }).click()
  await page.clock.runFor(600) // the stopwatch ticks next a second after the pause
  await watch.getByRole('button', { name: 'Stop' }).click()
  await expect(watch.getByRole('button', { name: 'Start' })).toBeVisible()
  await expect.poll(async () => (await api.get<Watch>('/api/widgets/watch-1/data')).data.elapsed_ms).toBe(600)
})

test('a double press on Stop stops the stopwatch once', async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'watch-1', type: 'stopwatch', w: 2, h: 2, settings: {} }])
  const watch = widgetById(page, 'watch-1')
  await watch.getByRole('button', { name: 'Start' }).click()
  await page.waitForTimeout(400)
  await watch.getByRole('button', { name: 'Stop' }).dblclick()
  await expect(watch.getByRole('button', { name: 'Start' })).toBeVisible()
  await page.waitForTimeout(400) // a second start would have gone by now
  expect((await api.get<Watch>('/api/widgets/watch-1/data')).data.running_since).toBeNull()
})

test('a double-click on a preset, or on Start, starts one quick timer', async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'quick-1', type: 'quick-timer', w: 3, h: 3, settings: {} }])
  const widget = widgetById(page, 'quick-1')
  const names = async () => (await api.get<QuickTimersModel>('/api/quick-timers')).quick_timers.map((quick) => quick.name)
  await widget.getByRole('button', { name: '5 min' }).dblclick()
  await expect(widget.locator('.qt-run')).toHaveCount(1)
  await page.waitForTimeout(300) // a second would have gone by now
  expect(await names()).toEqual(['Quick timer · 5 min'])
  await widget.getByRole('button', { name: 'Cancel Quick timer · 5 min' }).click()
  const own = widget.getByRole('form', { name: 'Quick timer of your own' })
  await own.getByRole('spinbutton', { name: 'Minutes' }).fill('2')
  await own.getByRole('button', { name: 'Start' }).dblclick()
  await expect(widget.locator('.qt-run')).toHaveCount(1)
  await page.waitForTimeout(300)
  expect(await names()).toEqual(['Quick timer · 2 min'])
})

test('a second click as quick as a double-click does not cancel the quick timer that takes the place of the first', async ({
  page,
  api,
}) => {
  await api.post('/api/quick-timers', { seconds: 60 })
  await api.post('/api/quick-timers', { seconds: 300 })
  await setBoard(api, page, [{ id: 'quick-1', type: 'quick-timer', w: 3, h: 3, settings: {} }])
  const widget = widgetById(page, 'quick-1')
  await expect(widget.locator('.qt-more')).toHaveText('One more after it')
  const first = widget.getByRole('button', { name: 'Cancel Quick timer · 1 min' })
  const box = (await first.boundingBox())!
  await first.click()
  await expect(widget.getByRole('button', { name: 'Cancel Quick timer · 5 min' })).toBeVisible()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(400) // a second cancel would have gone by now
  const left = (await api.get<QuickTimersModel>('/api/quick-timers')).quick_timers
  expect(left.map((quick) => quick.name)).toEqual(['Quick timer · 5 min'])
})

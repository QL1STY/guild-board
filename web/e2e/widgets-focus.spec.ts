import type { Locator, Page } from '@playwright/test'
import { setBoard, widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'

/*
 * Keyboard focus on a widget that scrolls (look pass spec 8.1, WCAG 2.4.7). A scroll container that really scrolls and
 * holds nothing focusable takes keyboard focus in Chromium 130 and later: the body of a widget whose view is taller than
 * its size, or a list inside it that scrolls. The app's ring is an outline 2 pixels outside the element's own box, where
 * the body's clip, the fade's mask and the frame's own clip hide it. So the frame shows the focus, in the ring colour
 * the widgets have (--w-focus), and a control keeps its own ring.
 */

/** The ring's colour on parchment, --w-focus. */
const RING = [68, 112, 180]

/** Presses Tab, as a keyboard does, until `target` has the focus: :focus-visible then matches it. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  const element = await target.elementHandle()
  if (element === null) throw new Error('The element to tab to is not there.')
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Tab')
    if (await element.evaluate((one) => one === document.activeElement)) return
  }
  throw new Error('Tab did not reach the element in 40 presses.')
}

/**
 * How many pixels of the ring's colour there are around a frame, in the 6 pixels outside its box: the ring is the 2
 * pixels that begin 2 pixels out. This looks at what is drawn, as a computed style would not tell a ring that is hidden
 * from one that is seen. The page reads the picture, as the browser decodes it.
 */
async function ringAround(page: Page, frame: Locator): Promise<number> {
  const box = await frame.boundingBox()
  if (box === null) throw new Error('The frame is not on the screen.')
  const margin = 6
  const picture = await page.screenshot({
    clip: { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin },
  })
  return page.evaluate(
    async ({ base64, margin, ring }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      const { data, width, height } = context.getImageData(0, 0, bitmap.width, bitmap.height)
      let count = 0
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (x >= margin && x < width - margin && y >= margin && y < height - margin) continue // the frame itself
          const at = (y * width + x) * 4
          if (ring.every((value, channel) => Math.abs(data[at + channel] - value) <= 12)) count += 1
        }
      }
      return count
    },
    { base64: picture.toString('base64'), margin, ring: RING },
  )
}

/** A frame with no ring has none of the colour around it; one with the ring has about 1,700 pixels of it at 2 × 1. */
const NO_RING = 40
const RING_SEEN = 1_200

test('keyboard focus on a widget whose body scrolls shows on its frame, where the ring can be seen', async ({ page, api }) => {
  // A view taller than its size with nothing in it to focus. The types rebuilt on the frame fit their sizes, so this
  // puts such a view in one: Resets at its smallest size and, in its body, a block 160 pixels high, which the body of 68
  // cannot hold and so scrolls (the list tests below put a scrolling list in the body in the same way).
  await setBoard(api, page, [{ id: 'resets-1', type: 'resets', w: 2, h: 1, settings: {} }])
  const frame = widgetById(page, 'resets-1')
  const body = frame.locator('.w-body')
  await expect(frame).toContainText('Daily reset')
  await body.evaluate((one) => {
    const tall = document.createElement('div')
    tall.style.cssText = 'flex: none; height: 160px;'
    tall.textContent = 'A view taller than its widget'
    one.append(tall)
  })
  expect(
    await body.evaluate((one) => ({
      scrolls: one.scrollHeight > one.clientHeight + 1,
      focusable: one.querySelectorAll('a[href], button, input, select, textarea, [tabindex]').length,
    })),
    'the case this test is about',
  ).toEqual({ scrolls: true, focusable: 0 })
  expect(await ringAround(page, frame), 'before the focus').toBeLessThan(NO_RING)
  await tabTo(page, body)
  expect(await body.evaluate((one) => one.matches(':focus-visible'))).toBe(true)
  expect(await ringAround(page, frame), 'with the focus').toBeGreaterThan(RING_SEEN)
  await expect(frame).toHaveCSS('outline-style', 'solid')
  await expect(frame).toHaveCSS('outline-width', '2px')
  await expect(frame).toHaveCSS('outline-offset', '2px')
  await expect(frame).toHaveCSS('outline-color', `rgb(${RING.join(', ')})`)
})

/**
 * The two ways a list that scrolls comes to take keyboard focus: the browser makes it a tab stop, or the view gives it
 * tabindex 0, as the app's other scrollers (a chart's table, Settings' log) have it.
 */
const LISTS = [
  { how: 'by the browser', tabindex: null },
  { how: 'by tabindex 0', tabindex: '0' },
] as const

for (const { how, tabindex } of LISTS) {
  test(`a list that scrolls inside a widget shows its keyboard focus on the frame too, taken ${how}, and the ring goes with the focus`, async ({
    page,
    api,
  }) => {
    await setBoard(api, page, [{ id: 'resets-1', type: 'resets', w: 2, h: 2, settings: {} }])
    const frame = widgetById(page, 'resets-1')
    await expect(frame).toContainText('Daily reset')
    // What a view puts in its body when a list can outgrow it (spec 8.1): a box that scrolls, with nothing in it to focus.
    await frame.locator('.w-body').evaluate((body, tabindex) => {
      const list = document.createElement('div')
      list.dataset.probe = ''
      list.style.cssText = 'flex: none; height: 24px; overflow-y: auto;'
      if (tabindex !== null) list.setAttribute('tabindex', tabindex)
      const content = document.createElement('div')
      content.style.height = '120px'
      content.textContent = 'A list taller than its box'
      list.append(content)
      body.append(list)
    }, tabindex)
    const list = frame.locator('[data-probe]')
    expect(await frame.locator('.w-body').evaluate((one) => one.scrollHeight > one.clientHeight + 1), 'only the list scrolls').toBe(false)
    expect(await ringAround(page, frame), 'before the focus').toBeLessThan(NO_RING)
    await tabTo(page, list)
    expect(await list.evaluate((one) => one.matches(':focus-visible'))).toBe(true)
    expect(await ringAround(page, frame), 'with the focus').toBeGreaterThan(RING_SEEN)
    await expect(frame).toHaveCSS('outline-style', 'solid')
    await page.keyboard.press('Tab') // on to the next thing
    await expect(frame).toHaveCSS('outline-style', 'none')
    expect(await ringAround(page, frame), 'after the focus left').toBeLessThan(NO_RING)
  })
}

test('a control in a widget keeps its own ring, and the frame shows none', async ({ page }) => {
  const frame = widgetById(page, 'start-timers')
  const control = frame.getByRole('button').first()
  await tabTo(page, control)
  await expect(control).toHaveCSS('outline-style', 'solid')
  await expect(frame).toHaveCSS('outline-style', 'none')
  expect(await ringAround(page, frame), 'around the frame').toBeLessThan(NO_RING)
})

test('every box that scrolls in a widget is one with the same fade at its bottom edge and no scrollbar', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await api.post('/api/quick-timers', { seconds: 60 }) // so that the quick timer has its list
  await setBoard(api, page, [
    { id: 'timers-1', type: 'timers', w: 4, h: 3, settings: {} },
    { id: 'pinned-1', type: 'pinned', w: 4, h: 3, settings: {} },
    { id: 'commissions-1', type: 'commissions', w: 2, h: 3, settings: {} },
    { id: 'quick-1', type: 'quick-timer', w: 3, h: 3, settings: {} },
    { id: 'watch-1', type: 'stopwatch', w: 2, h: 2, settings: {} },
  ])
  await api.put('/api/widgets/watch-1/data', { data: { running_since: null, elapsed_ms: 62_800, laps: [31_200, 62_800] } })
  await page.reload()
  // The body of every widget, and the lists inside the bodies of those that have one: the shared w-scroll class.
  for (const [id, selector] of [
    ['timers-1', '.w-body'],
    ['timers-1', '.tm-list'],
    ['pinned-1', '.pn-list'],
    ['commissions-1', '.look-list'],
    ['watch-1', '.watch-laps'],
  ] as const) {
    const scroller = widgetById(page, id).locator(selector)
    await expect(scroller, `${id} ${selector}`).toHaveClass(/\bw-scroll\b/)
    expect(
      await scroller.evaluate((one) => {
        const style = getComputedStyle(one)
        return { overflowY: style.overflowY, scrollbar: style.scrollbarWidth, fades: style.maskImage.startsWith('linear-gradient') }
      }),
      `${id} ${selector}`,
    ).toEqual({ overflowY: 'auto', scrollbar: 'none', fades: true })
  }
})

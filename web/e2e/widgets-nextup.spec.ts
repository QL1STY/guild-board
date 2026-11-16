import type { Page } from '@playwright/test'
import type { NextUpModel, Widget } from '../src/types.ts'
import { changeAnswer } from './answers.ts'
import { layoutOf, setBoard, widgetById } from './board.ts'
import { expectCentred } from './centred.ts'
import { expect, test } from './fixtures.ts'

/*
 * The Next up widget (the five widgets plan, Task 7; the widgets polish, 2026-11-15) on the Board and on the overlay, on the demo's
 * day, Tuesday 13 October 2026, 08:00 on the core's clock: two timers and three expeditions ready, two expeditions out, the realm
 * currency filling, and the rest to come. It has three styles (the rail, the gauges and the cards), chosen in its settings, the
 * rail when none is saved. Its sizes, in each style, are held to the plan's table by widgets-sizes.spec.ts.
 */

const widget = (w: number, h: number, settings: Record<string, unknown> = {}, id = 'next'): Widget => ({
  id, type: 'next-up', w, h, x: 0, y: 0, settings,
})

test('a Next up saved with no style is the rail: what is ready as chips on top, the rest on a rail under a day mark', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 3)])
  const frame = widgetById(page, 'next')
  await expect(frame.locator('.nu')).toHaveAttribute('data-style', 'rail')
  // Two timers and 3 expeditions back: 5 things ready, and the expeditions back are one chip.
  await expect(frame.locator('.w-meta')).toHaveText('5 ready')
  await expect(frame.locator('.nu-chip')).toHaveCount(3)
  await expect(frame.locator('.nu-chip[data-kind="expedition"]')).toContainText('3 expeditions are back')
  // The rail holds what is still to come, never a ready row.
  await expect(frame.locator('.nu-r[data-ready]')).toHaveCount(0)
  await expect(frame.locator('.nu-g').first()).toHaveText(/^(Today|Tomorrow)$/)
  await expect(frame.locator('.nu-r[data-kind="daily"] .nu-n b')).toHaveText('Daily reset')
  await expect(frame.locator('.nu-r .nu-t').first()).toHaveText(/^in /)
  // At three cells tall each row says when and what kind it is under its name.
  await expect(frame.locator('.nu-r[data-kind="daily"] .nu-sub')).toBeVisible()
  await expect(frame.locator('.nu-r[data-kind="daily"] .nu-sub')).toHaveText(/^\d{2}:\d{2} · Reset$/)
  // Each kind draws in a colour of its own.
  const colours = await frame.locator('.nu-node').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color))
  expect(new Set(colours).size).toBeGreaterThan(2)
})

test('at 2 × 2 the rail is a line a row, with its chips and its day marks', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 2)])
  const frame = widgetById(page, 'next')
  await expect(frame.locator('.nu-r').first()).toBeVisible()
  await expect(frame.locator('.nu-chip').first()).toBeVisible()
  await expect(frame.locator('.nu-g').first()).toBeVisible()
  await expect(frame.locator('.nu-sub').first()).toBeHidden()
  await expect(frame.locator('.w-meta')).toHaveText('5 ready')
})

test('a kind that is switched off goes, and with the last one off the widget says nothing is coming up', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 3, { timers: false, resets: false })])
  const frame = widgetById(page, 'next')
  await expect(frame.locator('.nu-chip[data-kind="expedition"]')).toHaveCount(1) // the 3 that are back
  await expect(frame.locator('.nu-r[data-kind="expedition"]')).toHaveCount(2) // and the 2 still out
  await expect(frame.locator('[data-kind="timer"]')).toHaveCount(0)
  await expect(frame.locator('.nu-r[data-kind="daily"], .nu-r[data-kind="weekly"]')).toHaveCount(0)
  await expect(frame.locator('.w-meta')).toHaveText('3 ready')
  const off = Object.fromEntries(
    ['timers', 'resin', 'expeditions', 'realm', 'transformer', 'resets', 'banners', 'endgame', 'events'].map((kind) => [kind, false]),
  )
  await setBoard(api, page, [widget(2, 3, off)])
  await expect(widgetById(page, 'next')).toContainText('Nothing is coming up.')
  await expect(widgetById(page, 'next').locator('.w-meta')).toHaveCount(0)
})

test('the clock moved on turns a row that was coming Ready', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 3)])
  const frame = widgetById(page, 'next')
  const realm = frame.locator('.nu-r[data-kind="realm"]')
  await expect(realm).toContainText('Realm currency full')
  await expect(frame.locator('.w-meta')).toHaveText('5 ready')
  await api.advance(11 * 3600) // the widget reads the core's answer again at the next event, as a reload is
  await page.reload()
  await expect(realm).toHaveCount(0) // it left the rail...
  await expect(frame.locator('.w-meta')).toHaveText(/^([6-9]|\d\d) ready$/) // ...for what is ready
  await expect(frame.locator('.nu-chip-more')).toBeVisible() // the chips show four, and the rest as +N
  await setBoard(api, page, [widget(2, 3, { style: 'gauges' })])
  await expect(widgetById(page, 'next').locator('.nu-tile[data-kind="realm"]')).toHaveAttribute('data-ready', 'true')
})

test('the gauges: a ring for each thing, part filled where it has a start, a green disc with a tick for what is ready', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 3, { style: 'gauges' })])
  const frame = widgetById(page, 'next')
  await expect(frame.locator('.nu')).toHaveAttribute('data-style', 'gauges')
  await expect(frame.locator('.w-meta')).toHaveText('5 ready')
  await expect(frame.locator('.nu-tile').first()).toHaveAttribute('data-ready', 'true') // ready first
  await expect(frame.locator('.nu-tile[data-ready]')).toHaveCount(3)
  await expect(frame.locator('.nu-tile[data-ready] .nu-full')).toHaveCount(3)
  await expect(frame.locator('.nu-tile[data-ready] .nu-bt').first()).toHaveText('Ready')
  // The daily reset has a start (a day before it), so its ring is part filled; an expedition's start is not known: a track alone.
  await expect(frame.locator('.nu-tile[data-kind="daily"] .nu-arc')).toHaveCount(1)
  await expect(frame.locator('.nu-tile[data-kind="expedition"]:not([data-ready]) .nu-track').first()).toBeVisible()
  await expect(frame.locator('.nu-tile[data-kind="expedition"]:not([data-ready]) .nu-arc')).toHaveCount(0)
  await expect(frame.locator('.nu-tile[data-kind="daily"]')).toHaveAttribute('title', 'Daily reset') // the full name is on the tile
})

test('the cards: what is ready in one green card, then a card for each thing under its day, with its count', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 3, { style: 'cards' })])
  const frame = widgetById(page, 'next')
  await expect(frame.locator('.nu')).toHaveAttribute('data-style', 'cards')
  await expect(frame.locator('.nu-g-now')).toContainText('Now')
  await expect(frame.locator('.nu-g-now u')).toHaveText('3')
  await expect(frame.locator('.nu-now-lines li')).toHaveCount(3)
  await expect(frame.locator('.nu-now-lines li').first()).toBeVisible()
  await expect(frame.locator('.nu-now-one')).toBeHidden()
  await expect(frame.locator('.nu-card[data-kind="daily"] .nu-at')).toBeVisible() // the clock time beside the time left, from three cells down
  // The card's left edge is in its kind's colour: the daily reset's and an expedition's differ.
  const edge = (kind: string) =>
    frame.locator(`.nu-card[data-kind="${kind}"]`).first().evaluate((card) => getComputedStyle(card).borderLeftColor)
  expect(await edge('daily')).not.toBe(await edge('expedition'))
  // At 2 × 2 what is ready is one line, and a card has no clock time.
  await setBoard(api, page, [widget(2, 2, { style: 'cards' })])
  const small = widgetById(page, 'next')
  await expect(small.locator('.nu-now-one')).toBeVisible()
  await expect(small.locator('.nu-now-lines')).toBeHidden()
  await expect(small.locator('.nu-at').first()).toBeHidden()
})

test('the picker in Edit changes the style, and the widget keeps it', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 3)])
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await widgetById(page, 'next').getByRole('button', { name: 'Settings of Next up' }).click()
  const sheet = page.getByRole('region', { name: 'Settings of Next up' })
  const pick = (name: string) => sheet.getByRole('radio', { name })
  const styleOf = () => widgetById(page, 'next').locator('.nu')
  await expect(pick('Rail')).toHaveAttribute('aria-checked', 'true') // no style saved: the rail
  await expect(pick('Gauges')).toHaveAttribute('aria-checked', 'false')
  await pick('Gauges').click()
  await expect(pick('Gauges')).toHaveAttribute('aria-checked', 'true')
  await expect(pick('Rail')).toHaveAttribute('aria-checked', 'false')
  await expect(styleOf()).toHaveAttribute('data-style', 'gauges')
  await pick('Cards').click()
  await expect(styleOf()).toHaveAttribute('data-style', 'cards')
  // A switch keeps the style.
  await sheet.getByRole('button', { name: 'Timers', exact: true }).click()
  await expect(styleOf()).toHaveAttribute('data-style', 'cards')
  await expect(widgetById(page, 'next').locator('[data-kind="timer"]')).toHaveCount(0)
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect.poll(async () => (await layoutOf(api)).widgets[0].settings).toMatchObject({ style: 'cards', timers: false, resin: true })
})

test('an answer with nothing to list says so', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await changeAnswer<NextUpModel>(page, '/api/next-up', (data) => Object.assign(data, { items: [], ready: 0 }))
  await setBoard(api, page, [widget(2, 2)])
  await expect(widgetById(page, 'next')).toContainText('Nothing is coming up.')
})

test('it asks the core for its own model alone', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const asked: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (/^\/api\/(next-up|calendar|endgame-resets)/.test(pathname)) asked.push(pathname)
  })
  await setBoard(api, page, [widget(2, 3)])
  await expect(widgetById(page, 'next').locator('.nu-r').first()).toBeVisible()
  expect([...new Set(asked)]).toEqual(['/api/next-up'])
})

test("on the overlay's list it is the rail at its small size, in the dark panel", async ({ page, core, api }) => {
  const { revision } = await api.get<{ revision: number }>('/api/layouts/overlay')
  const next: Widget = { ...widget(2, 2, {}, 'over-next'), pinned: true }
  await api.put('/api/layouts/overlay', { revision, widgets: [next] })
  await page.goto(`${core.origin}/#/overlay/open`)
  const frame = widgetById(page, 'over-next')
  await expect(frame.locator('.nu-r').first()).toBeVisible()
  await expect(frame.locator('.nu-chip').first()).toBeVisible()
  await expect(frame.locator('.nu-sub').first()).toBeHidden()
  await expect(frame.locator('.w-meta')).toHaveText('5 ready')
  expect(await frame.evaluate((section) => section.closest('.on-dark') !== null)).toBe(true)
})

// The endgame rows carry their mode's own icon, the Stats card's, in place of the drawn sign, in each style.

const ICON_STAND_IN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect x="6" y="6" width="84" height="84" rx="14" fill="#2f6fd0"/><circle cx="48" cy="48" r="26" fill="#bfe0ff"/></svg>'

/** What the core answers once the art cache has each endgame mode's icon: an address on each endgame row. */
async function withModeIcons(page: Page, failing = false): Promise<void> {
  await changeAnswer<NextUpModel>(page, '/api/next-up', (data) => {
    for (const item of data.items) if (item.kind === 'endgame' && item.mode !== null) item.icon = `/api/art/icon-${item.mode}`
  })
  await page.route('**/api/art/icon-*', (route) =>
    failing ? route.fulfill({ status: 404, body: 'not here' }) : route.fulfill({ contentType: 'image/svg+xml', body: ICON_STAND_IN }),
  )
}

for (const [style, row, size] of [
  ['rail', '.nu-r[data-kind="endgame"]', 18], ['gauges', '.nu-tile[data-kind="endgame"]', 24], ['cards', '.nu-card[data-kind="endgame"]', 18],
] as const) {
  test(`${style}: an endgame row draws its mode's own icon in place of its sign, and only an endgame row does`, async ({ page, api }) => {
    await page.setViewportSize({ width: 2560, height: 1440 })
    await withModeIcons(page)
    await setBoard(api, page, [widget(3, 6, { style })])
    const frame = widgetById(page, 'next')
    const rows = frame.locator(row)
    await expect(rows).toHaveCount(3)
    const icons = frame.locator('.nu-mi img')
    await expect(icons).toHaveCount(3)
    const ratio = await page.evaluate(() => window.devicePixelRatio)
    for (const image of await icons.all()) {
      await expect(image).toBeVisible()
      expect(await image.evaluate((one) => (one as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      expect(Math.round((await image.boundingBox())!.width)).toBe(size)
      // Crisp at 2x: it was asked for at least as many pixels as it is drawn with.
      const asked = Number(/size=(\d+)/.exec((await image.getAttribute('src')) ?? '')?.[1] ?? 0)
      expect(asked).toBeGreaterThanOrEqual(size * ratio)
    }
    for (const one of await rows.all()) await expect(one.locator('.nu-mi img')).toHaveCount(1)
    await expect(frame.locator('[data-kind="daily"] .nu-mi, [data-kind="timer"] .nu-mi, [data-kind="banner"] .nu-mi')).toHaveCount(0)
  })
}

test('without an icon, as in the demo, an endgame row keeps its drawn sign and asks the art cache for nothing', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/art/')) asked.push(request.url())
  })
  for (const [style, mark] of [
    ['rail', '.nu-r[data-kind="endgame"] .sign'], ['gauges', '.nu-tile[data-kind="endgame"] .sign'], ['cards', '.nu-card[data-kind="endgame"] .sign'],
  ] as const) {
    await setBoard(api, page, [widget(3, 6, { style })])
    const frame = widgetById(page, 'next')
    await expect(frame.locator(mark)).toHaveCount(3)
    await expect(frame.locator('.nu-mi')).toHaveCount(0)
  }
  expect(asked).toEqual([])
})

test("an icon that fails to load leaves the mode's drawn sign, never a broken image", async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await withModeIcons(page, true)
  await setBoard(api, page, [widget(3, 6, { style: 'rail' })])
  const frame = widgetById(page, 'next')
  await expect(frame.locator('.nu-mi img[hidden]')).toHaveCount(3)
  await expect(frame.locator('.nu-mi .sign').first()).toBeVisible()
})

test("on the overlay's dark panel the endgame icons draw as they do on the Board", async ({ page, core, api }) => {
  await withModeIcons(page)
  const { revision } = await api.get<{ revision: number }>('/api/layouts/overlay')
  const next: Widget = { ...widget(3, 6, { style: 'rail' }, 'over-next'), pinned: true }
  await api.put('/api/layouts/overlay', { revision, widgets: [next] })
  await page.goto(`${core.origin}/#/overlay/open`)
  const frame = widgetById(page, 'over-next')
  expect(await frame.evaluate((section) => section.closest('.on-dark') !== null)).toBe(true)
  await expect(frame.locator('.nu-mi img').first()).toBeVisible()
})

// An icon in a ring or a disc is centred in it, on the Board and on the overlay, at 1x and at 2x.

for (const scale of [1, 2]) {
  test.describe(`at ${scale}x`, () => {
    test.use({ deviceScaleFactor: scale })

    test("each endgame icon is centred in the ring or disc that holds it: the rail's node and chip, the gauges' ring", async ({ page, api }) => {
      await page.setViewportSize({ width: 2560, height: 1440 })
      await withModeIcons(page)
      await setBoard(api, page, [widget(3, 6, { style: 'rail' })])
      const rail = widgetById(page, 'next')
      await expectCentred(rail.locator('.nu-r[data-kind="endgame"] .nu-node'), '.nu-mi img')
      await setBoard(api, page, [widget(3, 6, { style: 'gauges' })])
      await expectCentred(widgetById(page, 'next').locator('.nu-tile[data-kind="endgame"] .nu-ring'), '.nu-mi img')
    })

    test('an icon in a ready chip is centred in the chip\'s disc', async ({ page, api }) => {
      await page.setViewportSize({ width: 2560, height: 1440 })
      await changeAnswer<NextUpModel>(page, '/api/next-up', (data) => {
        for (const item of data.items) if (item.kind === 'endgame' && item.mode !== null) item.icon = `/api/art/icon-${item.mode}`
        for (const item of data.items) if (item.kind === 'endgame') item.ready = true
      })
      await page.route('**/api/art/icon-*', (route) => route.fulfill({ contentType: 'image/svg+xml', body: ICON_STAND_IN }))
      await setBoard(api, page, [widget(2, 3)])
      const chips = widgetById(page, 'next').locator('.nu-chip[data-kind="endgame"] .nu-chip-i')
      await expectCentred(chips, '.nu-mi img')
    })
  })
}

test("an icon's layout box is its ring's own, scaled about the centre: rail node, chip disc and gauges ring", async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await changeAnswer<NextUpModel>(page, '/api/next-up', (data) => {
    for (const item of data.items) if (item.kind === 'endgame' && item.mode !== null) item.icon = `/api/art/icon-${item.mode}`
    for (const item of data.items) if (item.kind === 'endgame') item.ready = true
  })
  await page.route('**/api/art/icon-*', (route) => route.fulfill({ contentType: 'image/svg+xml', body: ICON_STAND_IN }))
  for (const [style, ring] of [['rail', '.nu-chip-i'], ['gauges', '.nu-ring']] as const) {
    await setBoard(api, page, [widget(style === 'rail' ? 2 : 3, style === 'rail' ? 3 : 6, { style })])
    const rings = widgetById(page, 'next').locator(ring)
    await expect(rings.first()).toBeVisible()
    for (const one of await rings.all()) {
      const picture = one.locator('.nu-mi')
      if ((await picture.count()) === 0) continue // a ring that holds a tick or another sign
      expect(await picture.evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(await one.evaluate((el) => (el as HTMLElement).offsetWidth))
      expect(await picture.evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(await one.evaluate((el) => (el as HTMLElement).offsetHeight))
    }
  }
})

import type { CalendarEvent, CalendarModel, Widget } from '../src/types.ts'
import { changeAnswer } from './answers.ts'
import { setBoard, widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'

/*
 * The Calendar widget (the five widgets plan, Task 8) on the Board and on the overlay, on the demo's day, Tuesday 13 October
 * 2026: the demo's banners (the running phase and the next), four events (one finished, one not yet started, two announced with no
 * dates in these tests) and the three endgame modes. Its sizes are held to the plan's table by widgets-sizes.spec.ts.
 */

const widget = (w: number, h: number, id = 'cal'): Widget => ({ id, type: 'calendar', w, h, x: 0, y: 0, settings: {} })

const soon = (name: string): CalendarEvent => ({
  id: null, name, starts: null, ends: null, finished: false, primogems: null, explored: null, double: null, soon: true, status: 1,
  source: 'hoyolab',
})

test('at 6 × 4 on the Board it is the two-week grid: today tinted, the three lanes, a flat end and a finished event faded', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(6, 4)])
  const frame = widgetById(page, 'cal')
  await expect(frame.locator('.cal-day')).toHaveCount(14)
  await expect(frame.locator('.cal-day[data-today]')).toContainText('Today')
  await expect(frame.locator('.cal-today')).toBeVisible()
  await expect(frame.locator('.cal-lane')).toHaveText(['Wishes', 'Events', 'Endgame'])
  // The wish bars carry faces (the demo gives them no picture, so each shows its sign), 5-stars first.
  const wish = frame.locator('.cal-bar[data-lane="wish"]').first()
  await expect(wish.locator('.cal-face').first()).toBeVisible()
  await expect(wish.locator('.cal-face:not(.s4)').first()).toBeVisible()
  // An event with its reward, and one the player finished, faded and saying Done.
  await expect(frame.locator('.cal-bar[data-lane="event"]', { hasText: 'Moonlit Trials' })).toContainText('1,000 · not finished')
  const done = frame.locator('.cal-bar[data-lane="event"][data-done]')
  await expect(done).toContainText('Lantern Rite Rehearsal')
  await expect(done).toContainText('Done')
  expect(await done.evaluate((bar) => getComputedStyle(bar).opacity)).toBe('0.62')
  // A bar that runs past the window ends flat, one that began before it starts flat.
  await expect(frame.locator('.cal-bar[data-to]').first()).toBeVisible()
  await expect(frame.locator('.cal-bar[data-from]').first()).toBeVisible()
  await expect(frame.locator('.cal-bar[data-mode]')).toHaveCount(3)
  await expect(frame.locator('.w-meta')).toHaveText(/^1 event left to finish · read at \d\d:\d\d$/)
})

test('at 8 × 5 it is the same grid, wider and taller', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(8, 5)])
  const frame = widgetById(page, 'cal')
  await expect(frame.locator('.cal-day')).toHaveCount(14)
  await expect(frame.locator('.cal-lane')).toHaveCount(3)
  await expect(frame.locator('.cal-bar', { hasText: 'Stygian Onslaught' })).toBeVisible()
  await expect(frame.locator('.cl-r')).toHaveCount(0)
})

test('at 3 × 3 it is a list, running things ending soonest first and a finished event still on it, faded', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(3, 3)])
  const frame = widgetById(page, 'cal')
  await expect(frame.locator('.cal-day')).toHaveCount(0)
  await expect(frame.locator('.cl-r').first()).toBeVisible()
  const names = await frame.locator('.cl-r .cl-n b').allTextContents()
  expect(names).toContain('Lantern Rite Rehearsal')
  expect(names.indexOf('Lantern Rite Rehearsal')).toBeLessThan(names.indexOf('Moonlit Trials'))
  await expect(frame.locator('.cl-r[data-done]')).toContainText('Done')
  await expect(frame.locator('.cl-r[data-lane="wish"] .cl-n span').first()).toHaveText(/wishes$/)
  await expect(frame.locator('.cl-r[data-mode="abyss"]')).toBeVisible()
})

test('a wide frame in the 5 × 3 corner is still the grid, and one cell less across is the list', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(5, 3)])
  await expect(widgetById(page, 'cal').locator('.cal-day')).toHaveCount(14)
  await setBoard(api, page, [widget(4, 3)])
  await expect(widgetById(page, 'cal').locator('.cl-r').first()).toBeVisible()
  await setBoard(api, page, [widget(5, 2)])
  await expect(widgetById(page, 'cal').locator('.cl-r').first()).toBeVisible()
})

test("on the overlay it is always a list, and lists only what is not finished", async ({ page, core, api }) => {
  const { revision } = await api.get<{ revision: number }>('/api/layouts/overlay')
  await api.put('/api/layouts/overlay', { revision, widgets: [{ ...widget(2, 2, 'over-cal'), pinned: true }] })
  await page.goto(`${core.origin}/#/overlay/open`)
  const frame = widgetById(page, 'over-cal')
  await expect(frame.locator('.cl-r').first()).toBeVisible()
  await expect(frame.locator('.cal-bar')).toHaveCount(0)
  await expect(frame.locator('.cl-r', { hasText: 'Lantern Rite Rehearsal' })).toHaveCount(0)
  await expect(frame.locator('.cl-r', { hasText: 'Moonlit Trials' })).toHaveCount(1)
  await expect(frame.locator('.w-meta')).toHaveText('1 left to finish')
  expect(await frame.evaluate((section) => section.closest('.on-dark') !== null)).toBe(true)
})

test('before a read it says so, and the answer with no board is not drawn as empty lanes', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await changeAnswer<CalendarModel>(page, '/api/calendar', (data) => {
    Object.assign(data, { read: false, read_at: null, banners: [], events: [], left: 0 })
  })
  await setBoard(api, page, [widget(6, 4)])
  const frame = widgetById(page, 'cal')
  await expect(frame.locator('.w-meta')).toHaveText('Not read yet')
  await expect(frame).toContainText('The calendar is read with the next HoYoLAB sync.')
  await expect(frame.locator('.cal-lane')).toHaveCount(0)
})

test('an event with no dates is Coming soon: under the lanes with no bar, and last in the list', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await changeAnswer<CalendarModel>(page, '/api/calendar', (data) => {
    data.events.push(soon('Stress Block'))
  })
  await setBoard(api, page, [widget(6, 4), { ...widget(3, 3, 'cal-list'), x: 0, y: 4 }])
  const wide = widgetById(page, 'cal')
  await expect(wide.locator('.cal-soon')).toContainText('Coming soon')
  await expect(wide.locator('.cal-soon')).toContainText('Stress Block')
  await expect(wide.locator('.cal-bar', { hasText: 'Stress Block' })).toHaveCount(0)
  const list = widgetById(page, 'cal-list')
  const rows = list.locator('.cl-r')
  await expect(rows.last().locator('.cl-n b')).toHaveText('Stress Block')
  await expect(rows.last().locator('.cl-e b')).toHaveText('Coming soon')
  await expect(rows.last().locator('.cl-n span')).toHaveCount(0)
})

test("an event with the wiki's dates is drawn like the others and the foot names the wiki", async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await changeAnswer<CalendarModel>(page, '/api/calendar', (data) => {
    const { starts, ends } = data.events[2]!
    data.events.push({ ...soon('Ley Line Overflow'), soon: false, source: 'fandom', starts, ends })
    data.upcoming_from = 'Genshin Impact Wiki (Fandom)'
  })
  await setBoard(api, page, [widget(6, 4)])
  const frame = widgetById(page, 'cal')
  await expect(frame.locator('.cal-bar[data-source="fandom"]')).toContainText('Ley Line Overflow')
  await expect(frame.locator('.cal-foot')).toHaveText('Upcoming dates: Genshin Impact Wiki (Fandom)')
})

test('it asks the core for its own model alone, and the faces only through the icon cache', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const asked: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (/^\/api\/(next-up|calendar|endgame-resets|pulls)/.test(pathname)) asked.push(pathname)
  })
  await setBoard(api, page, [widget(6, 4)])
  await expect(widgetById(page, 'cal').locator('.cal-bar').first()).toBeVisible()
  expect([...new Set(asked)]).toEqual(['/api/calendar'])
})

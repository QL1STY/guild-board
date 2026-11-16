import type { Locator } from '@playwright/test'
import type { PrimogemsModel, Widget } from '../src/types.ts'
import { changeAnswer } from './answers.ts'
import { layoutOf, setBoard, widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'

/*
 * The Primogems widget, the Savings widget with parts (the five widgets plan, Task 6), on the Board and on the overlay's list,
 * on the demo's Ledger. Its sizes are held to the plan's table by widgets-sizes.spec.ts.
 */

const num = (value: number): string => Math.round(value).toLocaleString('en-US')
const PARTS = { savings: true, pulls: true, earned: false, sources: false }

const widget = (w: number, h: number, settings: Record<string, unknown> = {}, id = 'primogems'): Widget => ({
  id, type: 'savings', w, h, x: 0, y: 0, settings,
})

/** Whether the body keeps everything inside its frame, without scrolling. */
function fits(frame: Locator): Promise<string[]> {
  return frame.evaluate((section) => {
    const body = section.querySelector('.w-body')!
    const found: string[] = []
    if (body.scrollHeight > body.clientHeight + 1) found.push(`.w-body scrolls: ${body.scrollHeight} high in ${body.clientHeight}`)
    const outer = body.getBoundingClientRect()
    for (const part of section.querySelectorAll('.pmw > *')) {
      const box = part.getBoundingClientRect()
      if (box.width > 0 && (box.top < outer.top - 0.5 || box.bottom > outer.bottom + 0.5)) found.push(`${part.className} lies outside the body`)
    }
    return found
  })
}

test('a widget saved with no settings has Savings and Pulls and says Savings, and reads nothing of the Ledger', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const asked: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (/^\/api\/(pulls|primogems)/.test(pathname)) asked.push(pathname)
  })
  await setBoard(api, page, [widget(2, 2)])
  const frame = widgetById(page, 'primogems')
  await expect(frame.locator('.w-name')).toHaveText('Savings')
  await expect(frame).toHaveAttribute('aria-label', 'Primogems')
  await expect(frame.locator('.w-meta')).toHaveText('set today')
  await expect(frame.locator('.pm-top')).toBeVisible()
  await expect(frame.locator('.pm-cell')).toHaveCount(2)
  await expect(frame.locator('.pm-part')).toHaveCount(0)
  expect([...new Set(asked)]).toEqual(['/api/pulls'])
  expect((await layoutOf(api)).widgets[0]).toMatchObject({ id: 'primogems', type: 'savings', w: 2, h: 2, settings: {} })
})

test('each part is drawn when its switch is on and left out when it is off', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const model = await api.get<PrimogemsModel>('/api/primogems')
  expect(model.imported).toBe(true)
  await setBoard(api, page, [
    widget(3, 3, { ...PARTS, earned: true, sources: true }, 'all'),
    widget(2, 2, { savings: false, pulls: true, earned: true, sources: false }, 'two'),
  ])
  // Everything on: the heading says Primogems, and the meta the Ledger's read time.
  const all = widgetById(page, 'all')
  await expect(all.locator('.w-name')).toHaveText('Primogems')
  await expect(all.locator('.w-meta')).toHaveText(/^ledger read /)
  await expect(all.locator('.pm-top')).toBeVisible()
  await expect(all.locator('.pm-cell')).toHaveCount(2)
  await expect(all.locator('.pm-v b').nth(0)).toHaveText(`+${num(model.today!)}`)
  await expect(all.locator('.pm-v b').nth(1)).toHaveText(`+${num(model.week!)}`)
  await expect(all.locator('.pm-days i')).toHaveCount(7)
  await expect(all.locator('.pm-days i[data-now]')).toHaveCount(1)
  await expect(all.locator('.pm-days i').last()).toHaveAttribute('data-now', 'true')
  await expect(all.locator('.pm-h').nth(1)).toHaveText(`${model.month!.name} by source · ${num(model.month!.total)}`)
  await expect(all.locator('.pm-seg i')).toHaveCount(model.month!.sources.length)
  await expect(all.locator('.pm-leg li')).toHaveCount(model.month!.sources.length)
  // A segment's colour is the widget role of its source, from the stylesheet and not from the view.
  expect(await all.locator('.pm-seg i').first().getAttribute('style')).not.toContain('background')
  expect(await all.locator('.pm-seg i').first().evaluate((seg) => getComputedStyle(seg).backgroundColor)).toMatch(/^rgb\(/)
  expect(await fits(all)).toEqual([])
  // Savings off, Pulls and Earned on: no big balance, the two cells and the week.
  const two = widgetById(page, 'two')
  await expect(two.locator('.pm-top')).toHaveCount(0)
  await expect(two.locator('.pm-cell')).toHaveCount(2)
  await expect(two.locator('.pm-days i')).toHaveCount(7)
  await expect(two.locator('.pm-seg')).toHaveCount(0)
  expect(await fits(two)).toEqual([])
})

test('at 2 × 2 with three or four parts on, the month by source gives way and nothing spills', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const three = [
    { savings: true, pulls: true, earned: true, sources: false },
    { savings: true, pulls: true, earned: false, sources: true },
    { savings: true, pulls: false, earned: true, sources: true },
    { savings: false, pulls: true, earned: true, sources: true },
    { savings: true, pulls: true, earned: true, sources: true },
  ]
  for (const settings of three) {
    await setBoard(api, page, [widget(2, 2, settings)])
    const frame = widgetById(page, 'primogems')
    await expect(frame.locator('.w-meta')).toHaveText(/^ledger read /)
    await expect(frame.locator('.pm-part')).not.toHaveCount(0)
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    expect(await fits(frame), JSON.stringify(settings)).toEqual([])
  }
})

test('with Earned or By source on and nothing imported, each says so in one line and shows no zeros', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await changeAnswer<PrimogemsModel>(page, '/api/primogems', (data) => {
    Object.assign(data, { imported: false, read_at: null, today: null, week: null, days: null, month: null })
  })
  await setBoard(api, page, [widget(2, 2, { ...PARTS, earned: true, sources: true })])
  const frame = widgetById(page, 'primogems')
  await expect(frame).toContainText('Import the Ledger to see what you earned.')
  await expect(frame).not.toContainText('+0')
  await expect(frame.locator('.pm-days, .pm-seg')).toHaveCount(0)
  await expect(frame.locator('.pm-top')).toBeVisible() // Savings is still Pulls' own
  await expect(frame.locator('.w-meta')).toHaveText('set today')
})

test('with no balance set, the savings say where to set it, and the Ledger parts still show', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await changeAnswer<{ savings: Record<string, unknown> }>(page, '/api/pulls', (data) => {
    Object.assign(data.savings, { set: null, pulls: null, estimated: null, by_next_end: null })
  })
  await setBoard(api, page, [widget(2, 3, { ...PARTS, earned: true })])
  const frame = widgetById(page, 'primogems')
  await expect(frame).toContainText('Set the balance on the Pulls page.')
  await expect(frame.locator('.pm-days i')).toHaveCount(7)
  await expect(frame.locator('.pm-top, .pm-cell')).toHaveCount(0)
})

test('the switches in Edit turn the parts on and off, and the last one on cannot go off', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 2)])
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await widgetById(page, 'primogems').getByRole('button', { name: 'Settings of Primogems' }).click()
  const sheet = page.getByRole('region', { name: 'Settings of Primogems' })
  const switchOf = (name: string) => sheet.getByRole('button', { name, exact: true })
  for (const name of ['Savings', 'Pulls']) await expect(switchOf(name)).toHaveAttribute('aria-pressed', 'true')
  for (const name of ['Earned', 'By source']) await expect(switchOf(name)).toHaveAttribute('aria-pressed', 'false')
  await expect(switchOf('Savings')).not.toHaveAttribute('aria-disabled', 'true') // two are on: none is the last
  // Earned on: the heading turns Primogems.
  await switchOf('Earned').click()
  await expect(switchOf('Earned')).toHaveAttribute('aria-pressed', 'true')
  await expect(widgetById(page, 'primogems').locator('.w-name')).toHaveText('Primogems')
  await expect(widgetById(page, 'primogems').locator('.pm-days i')).toHaveCount(7)
  // Everything off but one: the last one on is locked, says why and stays on.
  await switchOf('Pulls').click()
  await switchOf('Earned').click()
  await expect(switchOf('Savings')).toHaveAttribute('aria-pressed', 'true')
  await expect(switchOf('Savings')).toHaveAttribute('aria-disabled', 'true')
  await expect(switchOf('Savings')).toHaveAttribute('title', 'At least one part stays on.')
  await switchOf('Savings').click({ force: true }) // aria-disabled: Playwright waits for a button it calls disabled
  await expect(switchOf('Savings')).toHaveAttribute('aria-pressed', 'true')
  await expect(widgetById(page, 'primogems').locator('.w-name')).toHaveText('Savings') // Earned and By source are off again
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  expect((await layoutOf(api)).widgets[0].settings).toEqual({ savings: true, pulls: false, earned: false, sources: false })
})

test("on the overlay's list it draws in the dark panel's roles", async ({ page, core, api }) => {
  const { revision } = await api.get<{ revision: number }>('/api/layouts/overlay')
  const primogems: Widget = { ...widget(2, 3, { ...PARTS, earned: true, sources: true }, 'over-primogems'), pinned: true }
  await api.put('/api/layouts/overlay', { revision, widgets: [primogems] })
  await page.goto(`${core.origin}/#/overlay/open`)
  const frame = widgetById(page, 'over-primogems')
  await expect(frame.locator('.pm-days i')).toHaveCount(7)
  expect(await frame.evaluate((section) => section.closest('.on-dark') !== null)).toBe(true)
  // The big number is the dark panel's ink, and a segment is its dark source role.
  expect(await frame.locator('.pm-big').evaluate((big) => getComputedStyle(big).color)).toBe('rgb(241, 234, 219)')
  const dark = await frame.locator('.pm-seg i').evaluateAll((segments) => segments.map((one) => getComputedStyle(one).backgroundColor))
  expect(new Set(dark).size).toBe(dark.length)
})

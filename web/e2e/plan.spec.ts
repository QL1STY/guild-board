import { widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'
import type { PlanModel, Profile, Widget } from '../src/types.ts'

/*
 * The Plan page and the Today widget against the demo core (the Plan design, section 4). The core starts on Wednesday 11
 * November 2026 at 09:00 server time with Sandrone, Odette, Alyosha and Jahoda planned. The demo's wiki keeps one entry of the
 * days, as the wiki gave it: Sandrone's talent book (Vagrancy: Wednesday, Saturday and Sunday), so that is open today. It keeps
 * none for her weapon's material or for the others' books, and those rows say so: no day is made up for them.
 */
test.use({ viewport: { width: 1640, height: 1100 }, demoNow: '2026-11-11T08:00:00+00:00' })

const grid = (page: import('@playwright/test').Page) => page.getByTestId('plan-grid')
const rowOf = (page: import('@playwright/test').Page, key: string) => grid(page).locator(`.pln-tr[data-key="${key}"]`)

test('the Plan page shows today, the week and the weekly bosses', async ({ page, core, api }) => {
  const plan = await api.get<PlanModel>('/api/plan')
  expect(plan).toMatchObject({ weekday: 2, date: '2026-11-11', count: 4 })
  await page.goto(`${core.origin}/#/plan`)
  await expect(page.getByRole('heading', { name: 'Wednesday', level: 2 })).toBeVisible()
  await expect(page.getByText('11 November · 4 characters in the plan')).toBeVisible()
  await expect(page.getByText(/Domains change at 04:00 server time, in \d+ h \d{2} min/)).toBeVisible()

  // Three cards: the books open today, the weapon materials open today, and who has nothing open.
  const today = page.getByTestId('plan-today')
  await expect(today.locator('.pln-t')).toHaveCount(3)
  const books = today.getByRole('region', { name: 'Talent books open today' })
  await expect(books).toContainText('Teachings of Vagrancy')
  await expect(books).toContainText('Sandrone')
  await expect(today.getByRole('region', { name: 'Weapon materials open today' })).toContainText("No planned weapon's material is open today.")
  // Characters that are not read from the wiki are not claimed to have nothing open: the card says how many are not read.
  const idle = today.getByRole('region', { name: 'Nothing open today' })
  await expect(idle).toContainText('3 planned characters are not read from the wiki yet.')
  await expect(idle.locator('.pln-row')).toHaveCount(0)

  // The week: a row for each planned character, the seven days, and today's column tinted.
  await expect(grid(page).locator('.pln-tr[data-key]')).toHaveCount(4)
  await expect(grid(page).locator('.pln-head .pln-h-day')).toHaveText(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  await expect(grid(page).locator('.pln-h-day.now')).toHaveText('Wed')
  await expect(grid(page).locator('.pln-c.now')).toHaveCount(4)
  const sandrone = rowOf(page, 'sandrone')
  const cells = sandrone.locator('.pln-c')
  await expect(cells.nth(2)).toContainText('Vagrancy') // Wednesday, today
  await expect(cells.nth(2)).toHaveClass(/now/)
  await expect(cells.nth(5)).toContainText('Vagrancy') // Saturday
  await expect(cells.nth(6)).toContainText('Vagrancy') // Sunday
  await expect(cells.nth(3)).toHaveText('')
  await expect(cells.nth(1)).toHaveText('')
  await expect(sandrone).toContainText('Weapon material not read from the wiki yet')
  // An entry that is not read says so, and no day is guessed for it.
  await expect(rowOf(page, 'odette')).toContainText('Not read from the wiki yet')
  await expect(rowOf(page, 'odette').locator('.pln-tag')).toHaveCount(0)

  // The weekly bosses, and the discounted runs left.
  const bosses = page.getByTestId('plan-bosses')
  await expect(bosses).toContainText("Madman's Restraint")
  await expect(bosses).toContainText('Sandrone')
  await expect(bosses).toContainText('Reset on Monday at 04:00 · 3 of 3 discounted runs left')
})

test('adding and removing a character', async ({ page, core, api }) => {
  await page.goto(`${core.origin}/#/plan`)
  await expect(grid(page).locator('.pln-tr[data-key]')).toHaveCount(4)
  const aino = (await api.get<PlanModel>('/api/plan')).addable.find((one) => one.key === 'aino')!
  await page.getByRole('button', { name: 'Add a character' }).click()
  await page.getByTestId('plan-sheet').getByRole('button', { name: aino.name }).click()
  await expect(rowOf(page, 'aino')).toBeVisible()
  await expect(grid(page).locator('.pln-tr[data-key]')).toHaveCount(5)
  await expect(page.getByText('11 November · 5 characters in the plan')).toBeVisible()
  // She is added after the others, and is no longer on the sheet.
  await expect(grid(page).locator('.pln-tr[data-key]').last()).toHaveAttribute('data-key', 'aino')
  await expect(page.getByTestId('plan-sheet').getByRole('button', { name: aino.name })).toHaveCount(0)
  // The change is the core's: it is still there after a reload.
  await page.reload()
  await expect(rowOf(page, 'aino')).toBeVisible()
  expect((await api.get<PlanModel>('/api/plan')).rows.map((row) => row.key)).toEqual(['sandrone', 'odette', 'alyosha', 'jahoda', 'aino'])
  // The × takes her off again.
  await rowOf(page, 'aino').getByRole('button', { name: `Take ${aino.name} off the plan` }).click()
  await expect(rowOf(page, 'aino')).toHaveCount(0)
  await expect(grid(page).locator('.pln-tr[data-key]')).toHaveCount(4)
  await page.reload()
  await expect(grid(page).locator('.pln-tr[data-key]')).toHaveCount(4)
  await expect(rowOf(page, 'aino')).toHaveCount(0)
})

test('a press on a character opens her planner', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/plan`)
  await rowOf(page, 'sandrone').getByRole('link', { name: /Sandrone/ }).click()
  await expect(page).toHaveURL(/#\/characters\/sandrone\/plan$/)
  await expect(page.locator('.pp-chip.hero')).toBeVisible()
})

test('with nobody planned the page says so, and still lets a character be added', async ({ page, core, api }) => {
  await api.put('/api/plan/characters', { characters: [] })
  await page.goto(`${core.origin}/#/plan`)
  await expect(page.getByText('Nobody is in the plan yet.', { exact: false })).toBeVisible()
  await expect(page.getByText('11 November · nobody in the plan yet')).toBeVisible()
  await expect(grid(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Add a character' }).click()
  await page.getByTestId('plan-sheet').getByRole('button', { name: 'Sandrone' }).click()
  await expect(rowOf(page, 'sandrone')).toBeVisible()
})

test('the roster has no focus buttons, and its cards are links alone', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/characters`)
  await expect(page.locator('.cr-card[data-key="sandrone"]')).toBeVisible()
  await expect(page.locator('.cr-card button')).toHaveCount(0)
  await expect(page.getByTestId('focus-strip')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /focus/i })).toHaveCount(0)
})

test("the Profile shows each piece's Crit Value in its tier", async ({ page, core, api }) => {
  const profile = await api.get<Profile>('/api/characters/sandrone')
  await page.goto(`${core.origin}/#/characters/sandrone`)
  await page.getByRole('button', { name: 'Artifacts', exact: true }).click()
  const pills = page.locator('.pf-cvrow .pp-cv')
  await expect(pills).toHaveCount(profile.pieces.length)
  const COLOURS = ['rgb(154, 160, 174)', 'rgb(111, 168, 255)', 'rgb(185, 140, 255)', 'rgb(255, 166, 92)', 'rgb(255, 216, 77)', 'rgb(94, 240, 240)']
  for (const piece of profile.pieces) {
    const row = page.locator('.pf-cvrow', { hasText: { flower: 'Flower', plume: 'Plume', sands: 'Sands', goblet: 'Goblet', circlet: 'Circlet' }[piece.slot] })
    const pill = row.locator('.pp-cv')
    await expect(pill).toHaveClass(new RegExp(`\\bt${piece.cv_tier}\\b`))
    await expect(pill).toContainText(`${piece.crit_value.toFixed(1)} CV`)
    if (piece.cv_tier < 6) await expect(pill).toHaveCSS('background-color', COLOURS[piece.cv_tier])
    else await expect(pill).toHaveCSS('background-image', /linear-gradient/)
  }
})

test("the Today widget shows today's open talent book, and points to the Plan page when nobody is planned", async ({ page, core, api }) => {
  const { revision } = await api.get<{ revision: number }>('/api/layouts/board')
  const today: Widget = { id: 'td1', type: 'today', w: 3, h: 3, settings: {} }
  await api.put('/api/layouts/board', { revision, widgets: [today] })
  await page.goto(`${core.origin}/#/board`)
  const widget = widgetById(page, 'td1')
  await expect(widget).toContainText('Teachings of Vagrancy')
  await expect(widget).toContainText('Sandrone')
  await expect(widget).not.toContainText('resin')
  await api.put('/api/plan/characters', { characters: [] })
  await page.reload()
  await expect(widgetById(page, 'td1')).toContainText('Nobody is planned yet. Add characters on the Plan page.')
})

test('the Plan page keeps the content width the other pages have on a wide window', async ({ page, core }) => {
  await page.setViewportSize({ width: 2560, height: 1400 })
  await page.goto(`${core.origin}/#/plan`)
  await expect(grid(page)).toBeVisible()
  const width = await page.locator('.gb-page.pln').evaluate((element) => element.getBoundingClientRect().width)
  expect(width).toBeLessThanOrEqual(1440)
})

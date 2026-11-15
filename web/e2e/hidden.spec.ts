import { widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'
import type { Widget } from '../src/types.ts'

/*
 * Endgame hidden, as a shipped build has it (`characters.ENDGAME` off): no tab, and its route 404s. The Plan page, the Today
 * widget and the rest of the Characters pages stay. Endgame's own tests run with the switch on (fixtures.ts).
 */
test.use({ viewport: { width: 1640, height: 1100 }, demoNow: '2026-10-25T08:00:00+00:00', endgame: false })

test('the rail has the Plan page, the roster no Endgame tab, and the roster still works', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/characters`)
  await expect(page.locator('.cr-card[data-key="sandrone"]')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Plan', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Your week' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Characters', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Characters pages' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Endgame' })).toHaveCount(0)
  const card = page.locator('.cr-card[data-key="sandrone"]')
  await expect(card.getByRole('button')).toHaveCount(0)
  // The whole card opens the character's page, its corner too, once the page's entrance has put it in its place.
  await page.waitForFunction(() => document.getAnimations().every((one) => one.playState !== 'running' || one.effect?.getTiming().iterations === Infinity))
  const box = await card.boundingBox()
  await page.mouse.click(box!.x + box!.width - 6, box!.y + box!.height - 6)
  await expect(page.getByRole('heading', { name: 'Sandrone' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /focus/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Planner' })).toBeVisible()
})

test('the address of Endgame opens the roster, the address of Your week opens the Plan page, and a profile and a planner still open', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/characters/endgame`)
  await expect(page.locator('.cr-card[data-key="sandrone"]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/characters')
  await page.goto(`${core.origin}/#/week`)
  await expect(page.getByRole('heading', { name: 'The week' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/plan')
  await page.goto(`${core.origin}/#/characters/sandrone`)
  await expect(page.getByRole('heading', { name: 'Sandrone' }).first()).toBeVisible()
  await page.goto(`${core.origin}/#/characters/sandrone/plan`)
  await expect(page.locator('.pp-chip.hero')).toBeVisible()
  await expect(page.getByRole('region', { name: 'What the plan takes' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /focus/i })).toHaveCount(0)
  await expect(page.locator('.pp-cols .pp-col')).toHaveCount(3)
})

test("Endgame's route answers 404, the old week's too, and the status says Endgame is off", async ({ page, core, api }) => {
  await page.goto(`${core.origin}/`)
  for (const route of ['/api/week', '/api/endgame']) {
    expect((await page.context().request.get(core.origin + route)).status(), route).toBe(404)
  }
  expect((await api.get<{ endgame: boolean }>('/api/status')).endgame).toBe(false)
})

test('Add a widget offers Today, and a Today widget on the Board shows what is open today', async ({ page, core, api }) => {
  const { revision } = await api.get<{ revision: number }>('/api/layouts/board')
  const today: Widget = { id: 'td1', type: 'today', w: 3, h: 3, settings: {} }
  const clock: Widget = { id: 'ck1', type: 'clock', w: 2, h: 1, settings: {} }
  await api.put('/api/layouts/board', { revision, widgets: [clock, today] })
  await page.goto(`${core.origin}/#/board`)
  await expect(widgetById(page, 'ck1')).toBeVisible()
  await expect(widgetById(page, 'td1')).toBeVisible()
  await expect(widgetById(page, 'td1')).not.toContainText('Reading your plan')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Add a widget' }).click()
  await expect(page.getByRole('button', { name: 'Add Clock' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Today' })).toBeVisible()
})

test("Settings has no switches for the week's three notices", async ({ page, core }) => {
  await page.goto(`${core.origin}/#/settings`)
  await expect(page.getByText('Notifications', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Characters: weekly bosses')).toHaveCount(0)
  await expect(page.getByText('Characters: domains')).toHaveCount(0)
  await expect(page.getByText('Characters: level-ups')).toHaveCount(0)
})

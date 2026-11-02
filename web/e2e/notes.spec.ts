import type { Page } from '@playwright/test'
import { widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'

/*
 * The Notes widget's saves that the core does not keep (M16), on the demo's Board: what the core refused goes again at the
 * next chance, and is not lost when the widget or the page goes.
 */

/** Refuses the first save of the demo's Notes widget with a 500, as the core does while SQLite is locked, and records each save's body. */
async function refuseFirstSave(page: Page): Promise<string[]> {
  const saves: string[] = []
  await page.route('**/api/widgets/start-notes/data', async (route) => {
    const request = route.request()
    if (request.method() !== 'PUT') return route.continue()
    saves.push(request.postData() ?? '')
    if (saves.length === 1) return route.fulfill({ status: 500, json: { error: 'The database is busy.' } })
    return route.continue()
  })
  return saves
}

test('a note whose save failed is sent again when the page changes', async ({ page, api }) => {
  const notes = widgetById(page, 'start-notes')
  const field = notes.getByRole('textbox', { name: 'Notes' })
  await expect(field).toBeEditable()
  const saves = await refuseFirstSave(page)
  await field.fill('Mint for Kirara')
  await page.waitForTimeout(600) // the save half a second after typing stops, which the core refuses
  await expect(notes.getByRole('alert')).toHaveText('The database is busy.')
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Achievements' }).click()
  await expect.poll(() => saves.length).toBe(2)
  expect(JSON.parse(saves[1])).toEqual({ data: { text: 'Mint for Kirara' } })
  await expect.poll(() => api.get('/api/widgets/start-notes/data')).toEqual({ data: { text: 'Mint for Kirara' } })
})

test("a note whose save failed is sent again at the core's next event, and the problem goes", async ({ page, api }) => {
  const notes = widgetById(page, 'start-notes')
  const field = notes.getByRole('textbox', { name: 'Notes' })
  await expect(field).toBeEditable()
  const saves = await refuseFirstSave(page)
  await field.fill('Sweet Flowers')
  await page.waitForTimeout(600)
  await expect(notes.getByRole('alert')).toBeVisible()
  await api.advance(1) // an event of the core, as when Guild Board answers again after a restart
  await expect.poll(() => api.get('/api/widgets/start-notes/data')).toEqual({ data: { text: 'Sweet Flowers' } })
  expect(saves).toHaveLength(2)
  await expect(notes.getByRole('alert')).toHaveCount(0)
  await expect(field).toHaveValue('Sweet Flowers')
})

test('a note kept as the page hides ends the problem, and a later read comes in', async ({ page, api }) => {
  const notes = widgetById(page, 'start-notes')
  const field = notes.getByRole('textbox', { name: 'Notes' })
  await expect(field).toBeEditable()
  const saves = await refuseFirstSave(page)
  await field.fill('Mora for talents')
  await page.waitForTimeout(600)
  await expect(notes.getByRole('alert')).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))) // as the window hides, and the page stays
  await expect.poll(() => api.get('/api/widgets/start-notes/data')).toEqual({ data: { text: 'Mora for talents' } })
  await expect(notes.getByRole('alert')).toHaveCount(0)
  expect(saves).toHaveLength(2)
  await api.put('/api/widgets/start-notes/data', { data: { text: 'From the other PC' } })
  await api.advance(1) // the event of the pull that brought it: no read is held back
  await expect(field).toHaveValue('From the other PC')
})

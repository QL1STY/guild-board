import type { Page } from '@playwright/test'
import { ARTIFACT_HISTORY_FIXTURE, HISTORY_FIXTURE, LEDGER_FIXTURE, type Ledger, type LedgerHistory } from '../src/ledgertypes.ts'
import { expect, test } from './fixtures.ts'

/**
 * The Ledger page (the ledger plan, Task 8). Most tests answer the page's two reads with the fixtures the page was built
 * against, so they hold whatever the demo's history holds; the first reads the demo core's own answer, and needs the
 * core's Ledger API (Part A).
 */

/** Answers GET /api/ledger with `model` and the history's pages with `pages`, by kind and by `before`. */
async function answer(page: Page, model: Ledger, pages: (kind: string, before: string | null) => LedgerHistory) {
  await page.route('**/api/ledger?*', (route) => route.fulfill({ json: model }))
  await page.route('**/api/ledger', (route) => route.fulfill({ json: model }))
  await page.route('**/api/ledger/history?*', (route) => {
    const query = new URL(route.request().url()).searchParams
    return route.fulfill({ json: pages(query.get('kind') ?? '', query.get('before')) })
  })
}

const older: LedgerHistory = {
  entries: [
    { id: '1761400000000000000', time: '2026-10-25 18:20:00', reason: 'Spiral Abyss reward', name: '', rarity: 0, amount: 600 },
  ],
  more: false,
}

const fixturePages = (kind: string, before: string | null): LedgerHistory =>
  kind === 'artifact' ? ARTIFACT_HISTORY_FIXTURE : before === null ? HISTORY_FIXTURE : older

test('ledger page in the demo shows spending, history and artifacts', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/ledger`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ledger')
  await expect(page.getByTestId('ledger-spent')).toContainText('Spent on Genshin')
  await expect(page.getByTestId('ledger-spent')).toContainText('about')
  await expect(page.getByTestId('ledger-month')).toContainText('earned')
  await expect(page.getByTestId('ledger-packs').getByRole('listitem').first()).toBeVisible()
  await expect(page.getByTestId('ledger-rows').getByRole('listitem').first()).toBeVisible()
  await expect(page.getByTestId('ledger-artifacts')).toContainText('From domains')
})

test('the page shows the tiles, spending, history and artifacts of the answer', async ({ page, core }) => {
  await answer(page, LEDGER_FIXTURE, fixturePages)
  await page.goto(`${core.origin}/#/ledger`)
  const rail = page.getByRole('navigation', { name: 'Pages' })
  await expect(rail.getByRole('link', { name: 'Ledger' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('ledger-spent')).toContainText('about 1,240 zł')
  await expect(page.getByTestId('ledger-spent')).toContainText('since 4 Jun 2025 · 10 Welkins, 6 crystal packs, 1 Gnostic Hymn')
  await expect(page.getByTestId('ledger-month')).toContainText('+5,880 earned · −4,960 out')
  await expect(page.getByTestId('ledger-month')).toContainText('+1,090 from crystals · Intertwined Fates −4,800 · Resin −160')
  await expect(page.getByTestId('ledger-fives')).toContainText('41 · 36 from 32 domain runs, 5 elsewhere')
  const packs = page.getByTestId('ledger-packs').getByRole('listitem')
  await expect(packs).toHaveCount(5)
  await expect(packs.last()).toHaveText(/Gnostic Hymn\s*×1\s*about 43 zł/)
  await expect(page.getByRole('link', { name: 'Change currency or prices' })).toHaveAttribute('href', '#/settings')
  const rows = page.getByTestId('ledger-rows').getByRole('listitem')
  await expect(rows).toHaveCount(6)
  await expect(rows.first()).toHaveText(/27 Oct 05:12\s*Daily Commission reward\s*\+60/)
  await expect(rows.nth(2).locator('.ld-a')).toHaveClass(/minus/)
  await expect(rows.nth(2).locator('.ld-a')).toHaveText('−1,600')
  const artifacts = page.getByTestId('ledger-artifacts')
  await expect(artifacts).toContainText('Most from Sanctum of Rainbow Spirits')
  await expect(artifacts).toContainText('and 212 four-star')
  await expect(artifacts).toContainText('27 of them five-star')
  await expect(artifacts).toContainText('Luck: 1.13 five-stars per domain run · a typical run gives about 1.07')
  // The artifact log names each artifact with its stars.
  await page.getByRole('radio', { name: 'Artifacts' }).click()
  await expect(rows).toHaveCount(2)
  await expect(rows.first().getByRole('img', { name: '5 stars' })).toBeVisible()
  await expect(rows.first()).toContainText('Sanctum of Rainbow Spirits (Domain)')
})

test('show more loads older entries', async ({ page, core }) => {
  await answer(page, LEDGER_FIXTURE, fixturePages)
  await page.goto(`${core.origin}/#/ledger`)
  const rows = page.getByTestId('ledger-rows').getByRole('listitem')
  await expect(rows).toHaveCount(6)
  const asked = page.waitForRequest((request) => request.url().includes(`before=${HISTORY_FIXTURE.entries[5].id}`))
  await page.getByRole('button', { name: 'Show more' }).click()
  await asked
  await expect(rows).toHaveCount(7)
  await expect(rows.last()).toHaveText(/25 Oct 18:20\s*Spiral Abyss reward\s*\+600/)
  await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0)
})

test('the luck line is left out when the runs cannot be told', async ({ page, core }) => {
  const model = structuredClone(LEDGER_FIXTURE)
  model.artifacts.per_run = null
  await answer(page, model, fixturePages)
  await page.goto(`${core.origin}/#/ledger`)
  await expect(page.getByTestId('ledger-artifacts')).not.toContainText('Luck')
  await expect(page.getByTestId('ledger-fives')).toContainText('36 from domains, 5 from elsewhere')
})

test('empty ledger shows the import explanation', async ({ page, core }) => {
  const model = structuredClone(LEDGER_FIXTURE)
  model.empty = true
  model.last_import = null
  await answer(page, model, () => ({ entries: [], more: false }))
  await page.goto(`${core.origin}/#/ledger`)
  const empty = page.getByTestId('ledger-empty')
  await expect(empty).toContainText('open Feedback from the Paimon menu in the game once, then press Import from the game')
  await expect(empty).toContainText('only reads')
  await expect(page.getByRole('button', { name: 'Import from the game' })).toBeVisible()
})

test('with the HoYoLAB login the empty ledger says it is reading the history now', async ({ page, core }) => {
  const model = structuredClone(LEDGER_FIXTURE)
  model.empty = true
  model.last_import = null
  model.import.login = 'on'
  await answer(page, model, () => ({ entries: [], more: false }))
  await page.goto(`${core.origin}/#/ledger`)
  const empty = page.getByTestId('ledger-empty')
  await expect(empty).toContainText('Guild Board is reading them now with your HoYoLAB login.')
  await expect(empty).not.toContainText('open Feedback')
  await expect(page.getByTestId('ledger-import')).toHaveText('Updates automatically with your HoYoLAB login')
  // Import from the game stays, for a reading of the game's own link.
  await expect(page.getByRole('button', { name: 'Import from the game' })).toBeVisible()
})

test("Import from the game starts the Pulls page's import and shows the ledger's progress", async ({ page, core }) => {
  const model = structuredClone(LEDGER_FIXTURE)
  let pressed = false
  await page.route('**/api/pulls/import', (route) => {
    pressed = true
    return route.fulfill({ status: 202, json: {} })
  })
  await page.route('**/api/ledger', (route) => {
    if (pressed) model.import.ledger = { ...model.import.ledger, state: 'running', kind: 'primogem', found: 340 }
    return route.fulfill({ json: model })
  })
  await page.route('**/api/ledger/history?*', (route) => route.fulfill({ json: HISTORY_FIXTURE }))
  await page.goto(`${core.origin}/#/ledger`)
  const line = page.getByTestId('ledger-import')
  await expect(line).toHaveText(/^History from the game up to /)
  await page.getByRole('button', { name: 'Import from the game' }).click()
  await expect(line).toHaveText('Reading primogem history… 340 entries')
  await expect(page.getByRole('button', { name: 'Importing…' })).toHaveAttribute('aria-disabled', 'true')
})

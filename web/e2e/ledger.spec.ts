import type { Locator, Page } from '@playwright/test'
import { ARTIFACT_HISTORY_FIXTURE, HISTORY_FIXTURE, LEDGER_FIXTURE, type Ledger, type LedgerEntry, type LedgerHistory } from '../src/ledgertypes.ts'
import { expect, test } from './fixtures.ts'
import { ring } from './ring.ts'

/**
 * The Ledger page (the Ledger revamp design, sections 3 to 5 and 7). Most tests answer the page's two reads with the
 * fixtures the page was built against, so they hold whatever the demo's history holds; the first reads the demo core's own
 * answer. The fixture's today is its last day, Saturday 31 October 2026.
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
    {
      id: '1761400000000000000', time: '2026-10-25 18:20:00', reason: 'Spiral Abyss reward', name: '', rarity: 0, amount: 600,
      title: 'Spiral Abyss', source: 'endgame', detail: '',
    },
  ],
  more: false,
}

const fixturePages = (kind: string, before: string | null): LedgerHistory =>
  kind === 'artifact' ? ARTIFACT_HISTORY_FIXTURE : before === null ? HISTORY_FIXTURE : older

/** A box of an element, which the page has drawn. */
async function box(locator: Locator) {
  const found = await locator.boundingBox()
  expect(found, 'the element is drawn').not.toBeNull()
  return found!
}

/** The left inset of the cover's clip-path, as a percentage: "inset(0px 0px 0px 43.2%)" is 43.2, and "inset(0px)" is 0. */
async function peeled(cover: Locator): Promise<number> {
  const clip = await cover.evaluate((element) => getComputedStyle(element).clipPath)
  const inside = /^inset\((.*)\)$/.exec(clip)
  expect(inside, `an inset clip-path: ${clip}`).not.toBeNull()
  const sides = inside![1].trim().split(/\s+/)
  // CSS reads one to four values: the left one is the second when two are given, else the fourth.
  const left = sides.length === 1 ? sides[0] : sides.length === 2 || sides.length === 3 ? sides[1] : sides[3]
  const percent = /^([\d.]+)%$/.exec(left)
  if (percent !== null) return Number(percent[1])
  expect(Number.parseFloat(left), `a left inset of nothing or a percentage: ${clip}`).toBe(0)
  return 0
}

test('ledger page in the demo draws the chart, the days, the sources and the cards', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/ledger`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ledger')
  await expect(page.getByTestId('ledger-chart')).toBeVisible()
  await expect(page.getByTestId('ledger-tx').getByRole('listitem').first()).toBeVisible()
  await expect(page.getByTestId('ledger-sources')).toContainText('Where they came from')
  await expect(page.getByTestId('ledger-compare')).toBeVisible()
  await expect(page.getByTestId('ledger-commissions')).toBeVisible()
  await expect(page.getByTestId('ledger-wishes')).toBeVisible()
  await expect(page.getByTestId('ledger-spent')).toContainText('Spent on Genshin')
  await expect(page.getByTestId('ledger-spent')).toContainText('about')
})

test('the page shows the balance, the days, the sources and the cards of the answer', async ({ page, core }) => {
  await answer(page, LEDGER_FIXTURE, fixturePages)
  await page.goto(`${core.origin}/#/ledger`)
  const rail = page.getByRole('navigation', { name: 'Pages' })
  await expect(rail.getByRole('link', { name: 'Ledger' })).toHaveAttribute('aria-current', 'page')
  // The balance and what came in and went out this month.
  const chart = page.getByTestId('ledger-chart')
  await expect(chart.getByTestId('ledger-chart-label')).toHaveText('Primogems held')
  await expect(chart.getByTestId('ledger-chart-amount')).toContainText('10,255')
  await expect(chart.getByTestId('ledger-chart-amount')).toContainText('64 wishes')
  await expect(chart.getByTestId('ledger-chart-line')).toHaveText('+7,815 earned and −1,760 spent in October')
  // Spent on Genshin.
  const spent = page.getByTestId('ledger-spent')
  await expect(spent).toContainText('about 1,240 zł')
  await expect(spent).toContainText('since 4 June 2025 · this month about 23 zł, one Welkin')
  await expect(spent.getByRole('listitem')).toHaveCount(5)
  await expect(spent.getByRole('listitem').last()).toHaveText(/Gnostic Hymn\s*×1\s*about 43 zł/)
  await expect(page.getByRole('link', { name: 'Change currency or prices' })).toHaveAttribute('href', '#/settings')
  // Where they came from: longest first, with shares, and the Fates under a line.
  const sources = page.getByTestId('ledger-sources')
  await expect(sources).toContainText('Earned in October')
  await expect(sources.getByRole('listitem')).toHaveCount(5)
  await expect(sources.getByRole('listitem').first()).toHaveText(/Welkin Moon\s*2,790\s*36%/)
  await expect(sources).toContainText('Spent on 11 Fates')
  await expect(sources).toContainText('−1,760')
  // Compared with last month.
  const compare = page.getByTestId('ledger-compare')
  await expect(compare).toContainText('Compared with September')
  await expect(compare).toContainText('You earned 8% more this month.')
  await expect(compare).toContainText('Events▲ +620')
  await expect(compare).toContainText('Most of it from events.')
  // The calendar: a cell a day, two missed, and the numbers beside it.
  const commissions = page.getByTestId('ledger-commissions')
  await expect(commissions).toContainText('Done on 29 of 31 days.')
  await expect(commissions.locator('.ld-cal i:not(.pad)')).toHaveCount(31)
  await expect(commissions.locator('.ld-cal i.l2')).toHaveCount(29)
  await expect(commissions.locator('.ld-cal i.today')).toHaveCount(1)
  await expect(commissions.getByTestId('ledger-streak')).toContainText('6')
  await expect(commissions.getByTestId('ledger-longest')).toContainText('15')
  // Wishes: Pulls' own count in hand, and how far it carries the character banner's pity.
  const wishes = page.getByTestId('ledger-wishes')
  await expect(wishes).toContainText('+48')
  await expect(wishes).toContainText('earned this month')
  await expect(wishes).toContainText('−11')
  await expect(wishes).toContainText('made this month')
  await expect(wishes).toContainText('37')
  await expect(wishes).toContainText('in hand now')
  await expect(wishes).toContainText('Enough to carry your character pity from 41 past soft pity.')
  // The days: Tuesday's two rows, Monday's four.
  const tx = page.getByTestId('ledger-tx')
  const days = tx.locator('.ld-day')
  await expect(days).toHaveCount(2)
  await expect(days.first()).toContainText('Tuesday, 27 October')
  await expect(days.first()).toContainText('+150')
  await expect(tx.getByRole('listitem')).toHaveCount(6)
  const rows = tx.getByRole('listitem')
  await expect(rows.first()).toContainText('Daily commissions')
  await expect(rows.first()).toContainText('Commissions · 05:12')
  await expect(rows.first()).toContainText('+60')
  // Ten Fates: spending in plain ink with the wishes it made, drawn with the shop's bag.
  await expect(rows.nth(2)).toContainText('−1,600')
  await expect(rows.nth(2)).toContainText('10 wishes')
  await expect(rows.nth(2).locator('.ld-amt')).not.toHaveClass(/\bin\b/)
  await expect(rows.nth(2).locator('.ld-av')).toHaveAttribute('data-icon', 'shop')
  await expect(rows.first().locator('.ld-av')).toHaveAttribute('data-icon', 'commissions')
})

test('show earlier days loads older entries', async ({ page, core }) => {
  await answer(page, LEDGER_FIXTURE, fixturePages)
  await page.goto(`${core.origin}/#/ledger`)
  const rows = page.getByTestId('ledger-tx').getByRole('listitem')
  await expect(rows).toHaveCount(6)
  const asked = page.waitForRequest((request) => request.url().includes(`before=${HISTORY_FIXTURE.entries[5].id}`))
  await page.getByRole('button', { name: 'Show earlier days' }).click()
  await asked
  await expect(rows).toHaveCount(7)
  await expect(rows.last()).toContainText('Spiral Abyss')
  await expect(rows.last()).toContainText('+600')
  await expect(page.getByTestId('ledger-tx').locator('.ld-day').last()).toContainText('Sunday, 25 October')
  await expect(page.getByRole('button', { name: 'Show earlier days' })).toHaveCount(0)
})

test('a day with several treasure chests folds them into one row that opens on a click', async ({ page, core }) => {
  const chest = (id: string, time: string, amount: number) => ({
    id, time, reason: 'Treasure chest', name: '', rarity: 0, amount, title: 'Treasure chest', source: 'other' as const, detail: '',
  })
  const pages: LedgerHistory = {
    entries: [
      chest('1761534720000000003', '2026-10-27 14:20:00', 10),
      chest('1761534720000000002', '2026-10-27 14:08:00', 5),
      chest('1761534720000000001', '2026-10-27 14:02:00', 20),
    ],
    more: false,
  }
  await answer(page, LEDGER_FIXTURE, () => pages)
  await page.goto(`${core.origin}/#/ledger`)
  const tx = page.getByTestId('ledger-tx')
  const folded = tx.getByRole('button', { name: /3 treasure chests/ })
  await expect(folded).toContainText('14:02–14:20')
  await expect(folded).toContainText('+35')
  await expect(folded).toHaveAttribute('aria-expanded', 'false')
  await folded.click()
  await expect(folded).toHaveAttribute('aria-expanded', 'true')
  await expect(tx.locator('.ld-folded li')).toHaveCount(3)
})

test('the pointer on the chart shows that day', async ({ page, core }) => {
  await answer(page, LEDGER_FIXTURE, fixturePages)
  await page.goto(`${core.origin}/#/ledger`)
  const chart = page.getByTestId('ledger-chart')
  const svg = chart.locator('svg.ld-svg')
  await expect(svg).toHaveAttribute('data-points', '31')
  const where = await box(svg)
  // 22 October is the 22nd of 31 points, in a 760-wide drawing with 2 of margin at each side.
  const x = where.x + ((2 + (21 / 30) * (760 - 4)) / 760) * where.width
  await page.mouse.move(x, where.y + where.height / 2)
  await expect(chart.getByTestId('ledger-chart-label')).toHaveText('Thursday, 22 October')
  await expect(chart.getByTestId('ledger-chart-line')).toContainText('−1,600 spent')
  await expect(chart.getByTestId('ledger-chart-line')).toContainText('Shop purchase −1,600')
  await expect(chart.locator('.ld-dot')).toHaveCSS('opacity', '1')
  // Leaving the chart puts the number back.
  await page.mouse.move(where.x + where.width / 2, where.y - 120)
  await expect(chart.getByTestId('ledger-chart-label')).toHaveText('Primogems held')
})

test("the pointer across a chart never changes its card's height, on any of the four views", async ({ page, core }) => {
  // The demo core's own history: real days, long lines of moments, a note under the number on the other views.
  await page.setViewportSize({ width: 1640, height: 1100 })
  await page.goto(`${core.origin}/#/ledger`)
  for (const view of ['Primogems', 'Crystals', 'Resin', 'Artifacts']) {
    await page.getByRole('radio', { name: view }).click()
    const chart = page.getByTestId('ledger-chart')
    const svg = chart.locator('svg').first()
    await expect(svg).toBeVisible()
    const resting = (await box(chart)).height
    const where = await box(svg)
    for (let step = 0; step <= 40; step++) {
      await page.mouse.move(where.x + (step / 40) * (where.width - 1), where.y + where.height / 2)
      expect((await box(chart)).height, `${view}, the pointer at ${step}/40`).toBe(resting)
    }
    await page.mouse.move(where.x + where.width / 2, where.y - 200)
  }
})

test('the range pills change only the chart', async ({ page, core }) => {
  await answer(page, LEDGER_FIXTURE, fixturePages)
  await page.goto(`${core.origin}/#/ledger`)
  const chart = page.getByTestId('ledger-chart')
  await expect(chart.locator('svg.ld-svg')).toHaveAttribute('data-points', '31')
  await chart.getByRole('radio', { name: 'Week' }).click()
  await expect(chart.locator('svg.ld-svg')).toHaveAttribute('data-points', '7')
  await expect(chart.getByTestId('ledger-chart-line')).toContainText('in the last 7 days')
  await expect(page.getByTestId('ledger-sources')).toContainText('Earned in October')
  await expect(page.getByTestId('ledger-compare')).toContainText('Compared with September')
  await chart.getByRole('radio', { name: '3 months' }).click()
  await expect(chart.getByTestId('ledger-chart-line')).toContainText('in the last 3 months')
})

test('without a balance the page says how to set one', async ({ page, core }) => {
  const model = structuredClone(LEDGER_FIXTURE)
  for (const day of model.days) day.held = null
  model.wishes.in_hand = null
  await answer(page, model, fixturePages)
  await page.goto(`${core.origin}/#/ledger`)
  const chart = page.getByTestId('ledger-chart')
  await expect(chart.getByTestId('ledger-chart-label')).toHaveText('Net in October')
  await expect(chart.getByRole('link', { name: 'Set your balance in Pulls' })).toHaveAttribute('href', '#/pulls')
  const wishes = page.getByTestId('ledger-wishes')
  await expect(wishes).not.toContainText('in hand now')
  await expect(wishes.getByRole('link', { name: 'Set your balance in Pulls' })).toHaveAttribute('href', '#/pulls')
})

test.describe('hiding what was spent', () => {
  test.beforeEach(async ({ page, core }) => {
    await answer(page, LEDGER_FIXTURE, fixturePages)
    await page.goto(`${core.origin}/#/ledger`)
  })

  test('hidden spending stays hidden after a reload', async ({ page, api }) => {
    const spent = page.getByTestId('ledger-spent')
    const figures = page.getByTestId('ledger-spent-figures')
    const cover = page.getByTestId('ledger-spent-cover')
    await expect(figures).toHaveAttribute('aria-hidden', 'false')
    await spent.getByRole('button', { name: 'Hide', exact: true }).click()
    await expect(figures).toHaveAttribute('aria-hidden', 'true')
    await expect.poll(() => figures.evaluate((element) => getComputedStyle(element).filter)).toContain('blur(7px)')
    await expect.poll(() => peeled(cover)).toBe(0)
    await expect(cover).toContainText('Hidden')
    await expect(cover).toContainText('Click to show')
    // The core remembers it.
    await expect.poll(() => api.get('/api/settings')).toMatchObject({ ledger_spent_hidden: true })
    await page.reload()
    await expect(page.getByTestId('ledger-spent-figures')).toHaveAttribute('aria-hidden', 'true')
    await expect.poll(() => peeled(page.getByTestId('ledger-spent-cover'))).toBe(0)
    // Show: the cover's clip ends at 100% and the total reads the model's figure.
    await page.getByTestId('ledger-spent').getByRole('button', { name: 'Show', exact: true }).click()
    await expect.poll(() => peeled(page.getByTestId('ledger-spent-cover'))).toBe(100)
    await expect(page.getByTestId('ledger-spent-figures')).toHaveAttribute('aria-hidden', 'false')
    await expect(page.getByTestId('ledger-spent-total')).toHaveText('about 1,240 zł')
  })

  test('a click on the cover shows the figures too', async ({ page }) => {
    await page.getByTestId('ledger-spent').getByRole('button', { name: 'Hide', exact: true }).click()
    await expect.poll(() => peeled(page.getByTestId('ledger-spent-cover'))).toBe(0)
    await page.getByTestId('ledger-spent-cover').click()
    await expect.poll(() => peeled(page.getByTestId('ledger-spent-cover'))).toBe(100)
    await expect(page.getByTestId('ledger-spent').getByRole('button', { name: 'Hide', exact: true })).toBeVisible()
  })

  test('the cover peels left to right', async ({ page }) => {
    await page.getByTestId('ledger-spent').getByRole('button', { name: 'Hide', exact: true }).click()
    const cover = page.getByTestId('ledger-spent-cover')
    await expect.poll(() => peeled(cover)).toBe(0)
    await page.getByTestId('ledger-spent').getByRole('button', { name: 'Show', exact: true }).click()
    await page.waitForTimeout(350)
    const middle = await peeled(cover)
    expect(middle).toBeGreaterThan(20)
    expect(middle).toBeLessThan(80)
    await expect.poll(() => peeled(cover)).toBe(100)
  })

  test('with reduced motion the cover changes at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const cover = page.getByTestId('ledger-spent-cover')
    await page.getByTestId('ledger-spent').getByRole('button', { name: 'Hide', exact: true }).click()
    await page.waitForTimeout(60)
    expect(await peeled(cover)).toBe(0)
    await page.getByTestId('ledger-spent').getByRole('button', { name: 'Show', exact: true }).click()
    await page.waitForTimeout(60)
    expect(await peeled(cover)).toBe(100)
    await expect(page.getByTestId('ledger-spent-total')).toHaveText('about 1,240 zł')
  })
})

test.describe('the usual window', () => {
  test.use({ viewport: { width: 1640, height: 1100 } })

  test('the page fills the frame: two columns, the right one 360 wide', async ({ page, core }) => {
    await answer(page, LEDGER_FIXTURE, fixturePages)
    await page.goto(`${core.origin}/#/ledger`)
    await expect(page.getByTestId('ledger-compare')).toBeVisible()
    const layout = await box(page.locator('.ld-layout'))
    const chart = await box(page.getByTestId('ledger-chart'))
    const tx = await box(page.getByTestId('ledger-tx'))
    const spent = await box(page.getByTestId('ledger-spent'))
    const wishes = await box(page.getByTestId('ledger-wishes'))
    expect(spent.width).toBeCloseTo(360, 0)
    expect(wishes.width).toBeCloseTo(360, 0)
    expect(chart.x + chart.width + 18).toBeCloseTo(spent.x, 0)
    expect(chart.width + 18 + spent.width).toBeCloseTo(layout.width, 0)
    // The transactions stand under the chart, in the left column.
    expect(tx.x).toBeCloseTo(chart.x, 0)
    expect(tx.width).toBeCloseTo(chart.width, 0)
    expect(tx.y).toBeGreaterThan(chart.y + chart.height)
    // The page uses the main area up to the frame's cap, not the 1,440 of the narrower pages.
    expect(layout.width).toBeGreaterThan(1440 - 1)
  })
  /** The transactions card and the right column end on one line: the feed is bounded, and scrolls inside. */
  async function expectColumnsEndTogether(page: Page) {
    await expect(page.getByTestId('ledger-compare')).toBeVisible()
    await expect(page.getByTestId('ledger-tx').getByRole('listitem').first()).toBeVisible()
    const tx = await box(page.getByTestId('ledger-tx'))
    const ends = await Promise.all(
      ['ledger-sources', 'ledger-wishes'].map(async (id) => {
        const found = await box(page.getByTestId(id))
        return found.y + found.height
      }),
    )
    expect(Math.abs(tx.y + tx.height - Math.max(...ends))).toBeLessThanOrEqual(2)
    // The "Show earlier days" button stays inside the card, at its foot.
    const more = page.getByTestId('ledger-tx').getByRole('button', { name: 'Show earlier days' })
    if ((await more.count()) > 0) {
      const foot = await box(more)
      expect(foot.y + foot.height).toBeLessThanOrEqual(tx.y + tx.height)
      expect(tx.y + tx.height - (foot.y + foot.height)).toBeLessThan(40)
    }
  }

  test("both columns end on one line with the demo core's own history", async ({ page, core }) => {
    await page.goto(`${core.origin}/#/ledger`)
    await expectColumnsEndTogether(page)
  })

  test('both columns end on one line with a short history too', async ({ page, core }) => {
    await answer(page, LEDGER_FIXTURE, fixturePages)
    await page.goto(`${core.origin}/#/ledger`)
    await expectColumnsEndTogether(page)
  })
})

test.describe('full screen', () => {
  test.use({ viewport: { width: 2560, height: 1400 } })

  test('the page fills the frame: the transactions a feed of 500 down the right, as tall as the left side', async ({ page, core }) => {
    await answer(page, LEDGER_FIXTURE, fixturePages)
    await page.goto(`${core.origin}/#/ledger`)
    await expect(page.getByTestId('ledger-compare')).toBeVisible()
    const tx = await box(page.getByTestId('ledger-tx'))
    const chart = await box(page.getByTestId('ledger-chart'))
    expect(tx.width).toBeCloseTo(500, 0)
    expect(chart.x + chart.width + 18).toBeCloseTo(tx.x, 0)
    const bottoms = await Promise.all(
      ['ledger-compare', 'ledger-commissions', 'ledger-wishes'].map(async (id) => {
        const found = await box(page.getByTestId(id))
        return found.y + found.height
      }),
    )
    expect(Math.abs(tx.y + tx.height - Math.max(...bottoms))).toBeLessThanOrEqual(2)
    expect(Math.abs(tx.y - chart.y)).toBeLessThanOrEqual(1)
  })

  /** Spent and Sources are one height, so are the three insights, and every gap between cards is the same. */
  async function expectEven(page: Page) {
    await expect(page.getByTestId('ledger-compare')).toBeVisible()
    const rect = async (id: string) => box(page.getByTestId(id))
    const [chart, tx, spent, sources, compare, commissions, wishes] = await Promise.all(
      ['ledger-chart', 'ledger-tx', 'ledger-spent', 'ledger-sources', 'ledger-compare', 'ledger-commissions', 'ledger-wishes'].map(rect),
    )
    expect(Math.abs(spent.height - sources.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(compare.height - commissions.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(compare.height - wishes.height)).toBeLessThanOrEqual(1)
    const gaps = [
      tx.x - (chart.x + chart.width),
      sources.x - (spent.x + spent.width),
      commissions.x - (compare.x + compare.width),
      wishes.x - (commissions.x + commissions.width),
      spent.y - (chart.y + chart.height),
      compare.y - (spent.y + spent.height),
    ]
    for (const gap of gaps) expect(Math.abs(gap - 18), `gaps ${gaps.join(', ')}`).toBeLessThanOrEqual(1)
  }

  test('the rows are even', async ({ page, core }) => {
    await answer(page, LEDGER_FIXTURE, fixturePages)
    await page.goto(`${core.origin}/#/ledger`)
    await expectEven(page)
  })

  test('the rows are even with the commissions in a six-week month', async ({ page, core }) => {
    // The demo's clock cannot be moved, so the answer is the fixture's with a month that starts on a Sunday: March 2026.
    const model = structuredClone(LEDGER_FIXTURE)
    model.commissions.month = '2026-03'
    model.commissions.days = Array.from({ length: 31 }, (_, index) => ({
      day: `2026-03-${String(index + 1).padStart(2, '0')}`,
      state: index % 7 === 3 ? ('missed' as const) : ('done' as const),
    }))
    await answer(page, model, fixturePages)
    await page.goto(`${core.origin}/#/ledger`)
    await expect(page.getByTestId('ledger-commissions').locator('.ld-cal i')).toHaveCount(6 + 31)
    await expectEven(page)
  })
})

/** The crystals' and the resin's logs for the feed: what the game wrote, with the sources the core names. */
const entry = (id: string, time: string, amount: number, title: string, source: LedgerEntry['source'], more: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id, time, reason: title, name: '', rarity: 0, amount, title, source, detail: '', ...more,
})
const crystalPage: LedgerHistory = {
  entries: [
    entry('1761534720000000004', '2026-10-27 19:48:00', -1090, 'Genesis Crystals exchanged', 'exchange'),
    entry('1761534720000000003', '2026-10-27 19:42:00', 1090, 'Obtained via purchase', 'bought', { detail: '980 + 110 Genesis Crystals' }),
    entry('1761534720000000002', '2026-10-26 21:05:00', -60, 'Shop purchase', 'shop'),
    entry('1761534720000000001', '2026-10-26 04:10:00', 300, 'Purchased Blessing of the Welkin Moon', 'bought'),
  ],
  more: false,
}
const resinPage: LedgerHistory = {
  entries: [
    entry('1761534720000000013', '2026-10-27 19:40:00', -20, 'Ley Line Blossom challenge reward', 'ley'),
    entry('1761534720000000012', '2026-10-27 19:31:00', -20, 'Valley of Remembrance', 'domain'),
    entry('1761534720000000011', '2026-10-27 19:15:00', -20, 'Valley of Remembrance', 'domain'),
    entry('1761534720000000010', '2026-10-27 19:02:00', -20, 'Valley of Remembrance', 'domain'),
    entry('1761534720000000009', '2026-10-27 18:30:00', -30, 'Stormterror (Weekly Boss)', 'weekly'),
  ],
  more: false,
}
const viewPages = (kind: string, before: string | null): LedgerHistory =>
  kind === 'crystal' ? crystalPage : kind === 'resin' ? resinPage : fixturePages(kind, before)

const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0)
const october = <T extends { day: string }>(days: T[]) => days.filter((day) => day.day.startsWith('2026-10'))
const grouped = (value: number) => value.toLocaleString('en-US')

/** The cards beside a chart, by the row they stand in: equal heights in a row, 18 between all of them, and the feed ending with them. */
async function expectViewEven(page: Page) {
  await expect(page.getByTestId('ledger-tx').getByRole('listitem').first()).toBeVisible()
  const cards = page.locator('.ld-side > .ld-col > .ld-card')
  const count = await cards.count()
  const rects = await Promise.all(Array.from({ length: count }, (_, index) => box(cards.nth(index))))
  const chart = await box(page.getByTestId('ledger-chart'))
  const tx = await box(page.getByTestId('ledger-tx'))
  const rows: (typeof rects)[] = []
  for (const rect of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((candidate) => Math.abs(candidate[0].y - rect.y) <= 2)
    if (row === undefined) rows.push([rect])
    else row.push(rect)
  }
  for (const row of rows) {
    for (const rect of row) expect(Math.abs(rect.height - row[0].height), 'cards of a row are one height').toBeLessThanOrEqual(1)
    for (let at = 1; at < row.length; at += 1) expect(Math.abs(row[at].x - (row[at - 1].x + row[at - 1].width) - 18)).toBeLessThanOrEqual(1)
  }
  for (let at = 1; at < rows.length; at += 1) {
    expect(Math.abs(rows[at][0].y - (rows[at - 1][0].y + rows[at - 1][0].height) - 18), 'rows are 18 apart').toBeLessThanOrEqual(1)
  }
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  expect(Math.abs(tx.y + tx.height - bottom), 'the feed ends with the cards').toBeLessThanOrEqual(2)
  // Full screen: the cards stand under the chart; in the usual window they stand beside it.
  if (rows[0][0].y > chart.y + 5) expect(Math.abs(rows[0][0].y - (chart.y + chart.height) - 18)).toBeLessThanOrEqual(1)
  else expect(Math.abs(rows[0][0].y - chart.y)).toBeLessThanOrEqual(1)
  // No card, row or label leaves its card.
  for (const id of ['ledger-chart', 'ledger-tx']) {
    const overflow = await page.getByTestId(id).evaluate((element) => element.scrollWidth - element.clientWidth)
    expect(overflow, id).toBeLessThanOrEqual(1)
  }
}

test.describe('the other views', () => {
  test.beforeEach(async ({ page, core }) => {
    await answer(page, LEDGER_FIXTURE, viewPages)
    await page.goto(`${core.origin}/#/ledger`)
  })

  test('Crystals: what was bought and where it went, with no balance, and Spent on Genshin in the cards', async ({ page }) => {
    await page.getByRole('radio', { name: 'Crystals' }).click()
    const days = october(LEDGER_FIXTURE.crystal_days)
    const bought = total(days.map((day) => day.bought))
    const spent = total(days.map((day) => day.spent))
    const chart = page.getByTestId('ledger-chart')
    await expect(chart.getByTestId('ledger-chart-label')).toHaveText('Genesis Crystals bought')
    await expect(chart.getByTestId('ledger-chart-amount')).toHaveText(`${grouped(bought)}crystals`)
    await expect(chart.getByTestId('ledger-chart-line')).toHaveText(`+${grouped(bought)} bought and −${grouped(spent)} spent in October`)
    await expect(chart.getByTestId('ledger-chart-note')).toContainText('No crystal balance is kept')
    await expect(chart.locator('.ld-bar').first()).toBeVisible()
    await expect(chart.locator('.ld-keyline')).toContainText('Exchanged for primogems')
    await expect(page.getByTestId('ledger-spent')).toContainText('about')
    const where = page.getByTestId('ledger-card-where')
    await expect(where).toContainText('Where they went')
    await expect(where).toContainText('Exchanged for primogems')
    await expect(where).toContainText('Bought in October')
    await expect(where).toContainText(`+${grouped(bought)}`)
    await expect(page.getByTestId('ledger-card-compare')).toContainText('Compared with September')
    await expect(page.getByTestId('ledger-card-compare')).toContainText('One 980 + 110 pack, on 9 October.')
    await expect(page.getByTestId('ledger-card-welkin')).toContainText('Day 27 of 30.')
    // The feed: a pack beside the shop, an exchange with its wishes, the day as what came and went.
    const tx = page.getByTestId('ledger-tx')
    await expect(tx).toContainText('Shop · 980 + 110 Genesis Crystals · 19:42')
    await expect(tx).toContainText('Exchange · 19:48')
    await expect(tx).toContainText('6 wishes')
    await expect(tx.locator('.ld-day').first()).toContainText('+1,090 · −1,090')
    await expect(tx.locator('.ld-av[data-icon="swap"]')).toHaveCount(1)
  })

  test('the pointer on a bar shows that day, and the range pills change only the chart', async ({ page }) => {
    await page.getByRole('radio', { name: 'Crystals' }).click()
    const chart = page.getByTestId('ledger-chart')
    const svg = chart.locator('svg.ld-svg')
    const found = await box(svg)
    // 9 October is the 9th of 31 slots between the chart's 2-unit margins, in a drawing 760 units wide.
    const x = found.x + ((2 + (8.5 / 31) * 756) / 760) * found.width
    await page.mouse.move(x, found.y + found.height / 2)
    await expect(chart.getByTestId('ledger-chart-label')).toHaveText('Friday, 9 October')
    await expect(chart.getByTestId('ledger-chart-amount')).toHaveText('1,090bought')
    await expect(chart.getByTestId('ledger-chart-line')).toHaveText('+1,090 bought · −1,090 exchanged for primogems')
    await page.mouse.move(found.x + found.width / 2, found.y + found.height + 30) // onto the key under the chart
    await expect(chart.getByTestId('ledger-chart-label')).toHaveText('Genesis Crystals bought')
    await chart.getByRole('radio', { name: 'Week' }).click()
    await expect(chart.getByTestId('ledger-chart-line')).toContainText('in the last 7 days')
    await expect(chart.locator('svg.ld-svg')).toHaveAttribute('data-points', '7')
    await expect(page.getByTestId('ledger-card-where')).toContainText('Spent in October')
  })

  test('Resin: the resin spent each day against the 180 that regrows, and where it went', async ({ page }) => {
    await page.getByRole('radio', { name: 'Resin' }).click()
    const days = october(LEDGER_FIXTURE.resin_days)
    const spent = total(days.map((day) => day.spent))
    const chart = page.getByTestId('ledger-chart')
    await expect(chart.getByTestId('ledger-chart-label')).toHaveText('Resin spent')
    await expect(chart.getByTestId('ledger-chart-amount')).toHaveText(`${grouped(spent)}resin`)
    await expect(chart.getByTestId('ledger-chart-line')).toHaveText(`−${grouped(spent)} over 31 days of October, about ${Math.round(spent / 31)} a day`)
    await expect(chart.getByTestId('ledger-chart-note')).toContainText('No resin balance is kept')
    await expect(chart.locator('.ld-ref')).toHaveCount(1)
    await expect(chart.locator('.ld-keyline')).toContainText('180, what a full refill regrows in a day')
    const where = page.getByTestId('ledger-card-where')
    await expect(where).toContainText('Where it went')
    await expect(where).toContainText('Domains')
    await expect(where).toContainText('Condensed Resin')
    await expect(page.getByTestId('ledger-card-most')).toContainText('Valley of Remembrance, 32 runs.')
    await expect(page.getByTestId('ledger-card-most')).toContainText('71 of them were artifact domains.')
    await expect(page.getByTestId('ledger-card-against')).toContainText('of what regrew.')
    const bosses = page.getByTestId('ledger-card-bosses')
    await expect(bosses.locator('.ld-lead')).toHaveText('10 boss runs, 390 resin.')
    await expect(bosses).toContainText('Bosses, 40 resin each')
    await expect(bosses).toContainText('6 runs · 240 resin')
    await expect(bosses).toContainText('Weekly bosses, 30 or 60')
    await expect(bosses).toContainText('3 of the weekly runs cost 30 instead of 60')
    // A run of one domain is one row, which opens on a click.
    const tx = page.getByTestId('ledger-tx')
    await expect(tx).toContainText('Valley of Remembrance ×3')
    await expect(tx).toContainText('Domains · 19:02–19:31')
    await tx.getByRole('button', { name: /Valley of Remembrance ×3/ }).click()
    await expect(tx.locator('.ld-folded li')).toHaveCount(3)
    await page.mouse.move(0, 0)
    const pointer = await box(chart.locator('svg.ld-svg'))
    await page.mouse.move(pointer.x + ((2 + (4.5 / 31) * 756) / 760) * pointer.width, pointer.y + pointer.height / 2)
    await expect(chart.getByTestId('ledger-chart-label')).toHaveText('Monday, 5 October')
    await expect(chart.getByTestId('ledger-chart-line')).toContainText('spent that day ·')
  })

  test('Artifacts: the five-stars each day, what became of them, and the luck of the domain', async ({ page }) => {
    const asked: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/ledger/history')) asked.push(request.url())
    })
    await page.getByRole('radio', { name: 'Artifacts' }).click()
    const days = october(LEDGER_FIXTURE.artifact_days)
    const got = total(days.map((day) => day.five_domain + day.five_other))
    const used = total(days.map((day) => day.fed + day.salvaged))
    const chart = page.getByTestId('ledger-chart')
    await expect(chart.getByTestId('ledger-chart-label')).toHaveText('Five-star artifacts')
    await expect(chart.getByTestId('ledger-chart-amount')).toHaveText(`${got}five-stars`)
    await expect(chart.getByTestId('ledger-chart-line')).toContainText(`−${used} fed or salvaged in October`)
    await expect(chart.getByTestId('ledger-chart-luck')).toHaveText('0.23 five-stars per domain run this month · a typical run gives about 1.07')
    await expect(page.getByTestId('ledger-card-where')).toContainText('Where they came from')
    await expect(page.getByTestId('ledger-card-where')).toContainText('Valley of Remembrance')
    await expect(page.getByTestId('ledger-card-became')).toContainText(`The ${got} five-stars of October`)
    await expect(page.getByTestId('ledger-card-top')).toContainText('Valley of Remembrance, 8 five-stars.')
    await expect(page.getByTestId('ledger-card-luck')).toContainText('0.23 five-stars per run.')
    await expect(page.getByTestId('ledger-card-cost')).toContainText('resin for each.')
    // The feed asks for the five-stars alone.
    const tx = page.getByTestId('ledger-tx')
    await expect(tx).toContainText('Five-stars, newest first')
    await expect(tx).toContainText("Vermillion Hereafter's Thunder Clouds")
    await expect(tx).toContainText('5★ · Sanctum of Rainbow Spirits · 03:58')
    expect(asked.some((url) => url.includes('kind=artifact') && url.includes('rank=5'))).toBe(true)
  })

  test('a long domain name wraps inside its row and its card', async ({ page, core }) => {
    const name = 'The Domain of the Never-Ending Names, Third Court of Many Names'.slice(0, 60)
    const model = structuredClone(LEDGER_FIXTURE)
    model.resin_month.domains[0].name = name
    model.artifact_month.domains[0].name = name
    await answer(page, model, (kind, before) => {
      const pages = viewPages(kind, before)
      return {
        ...pages,
        entries: pages.entries.map((one) => (one.title === 'Valley of Remembrance' ? { ...one, title: name } : one)),
      }
    })
    await page.goto(`${core.origin}/#/ledger`)
    for (const [tab, id] of [['Resin', 'ledger-card-most'], ['Artifacts', 'ledger-card-top']] as const) {
      await page.getByRole('radio', { name: tab }).click()
      const card = await box(page.getByTestId(id))
      const rows = page.getByTestId(id).locator('.ld-rank > div')
      const count = await rows.count()
      expect(count).toBeGreaterThan(0)
      for (let index = 0; index < count; index += 1) {
        const row = await box(rows.nth(index))
        expect(row.x).toBeGreaterThanOrEqual(card.x)
        expect(row.x + row.width).toBeLessThanOrEqual(card.x + card.width)
      }
      await expect(page.getByTestId(id)).toContainText(name)
    }
    await page.getByRole('radio', { name: 'Resin' }).click()
    const where = await box(page.getByTestId('ledger-tx'))
    const titles = page.getByTestId('ledger-tx').locator('.ld-t', { hasText: name.slice(0, 20) })
    expect(await titles.count()).toBeGreaterThan(0)
    const title = await box(titles.first())
    expect(title.x + title.width).toBeLessThanOrEqual(where.x + where.width)
  })

  test('the Bosses card is never an empty panel: with no boss run its sentence leads under the heading and its rows say 0', async ({ page, core }) => {
    const model = structuredClone(LEDGER_FIXTURE)
    model.resin_days = model.resin_days.map((day) => {
      const { boss, weekly, ...rest } = day.by_use
      const { boss: bossRuns, weekly: weeklyRuns, ...runs } = day.runs
      void boss, weekly, bossRuns, weeklyRuns
      return { ...day, by_use: rest, runs, spent: Object.values(rest).reduce((sum, value) => sum + value, 0) }
    })
    model.resin_month.weekly = { cheap: 0, full: 0, other: 0 }
    await answer(page, model, viewPages)
    await page.goto(`${core.origin}/#/ledger`)
    await page.getByRole('radio', { name: 'Resin' }).click()
    const card = page.getByTestId('ledger-card-bosses')
    await expect(card.locator('.ld-lead')).toHaveText('No boss run this month yet.')
    await expect(card.locator('.ld-chg > div')).toHaveCount(2)
    const heading = await box(card.getByRole('heading', { level: 2 }))
    const lead = await box(card.locator('.ld-lead'))
    expect(lead.y - (heading.y + heading.height)).toBeLessThan(30) // right under the heading, not at the foot
  })

  test('a crystal balance, when one is sent, switches the view from bars to the balance', async ({ page, core }) => {
    const model = structuredClone(LEDGER_FIXTURE)
    let held = 3_000
    for (const day of model.crystal_days.slice().reverse()) {
      day.held = held
      held -= day.bought - day.spent
    }
    await answer(page, model, viewPages)
    await page.goto(`${core.origin}/#/ledger`)
    await page.getByRole('radio', { name: 'Crystals' }).click()
    const chart = page.getByTestId('ledger-chart')
    await expect(chart.getByTestId('ledger-chart-label')).toHaveText('Genesis Crystals held')
    await expect(chart.getByTestId('ledger-chart-amount')).toHaveText('3,000crystals')
    await expect(chart.getByTestId('ledger-chart-line')).toContainText('bought')
    await expect(chart.locator('.ld-line')).toHaveCount(1)
    await expect(chart.locator('.ld-bar')).toHaveCount(0)
    // Without one (the answer today) it is the bars again.
    await answer(page, LEDGER_FIXTURE, viewPages)
    await page.reload()
    await page.getByRole('radio', { name: 'Crystals' }).click()
    await expect(page.getByTestId('ledger-chart-label')).toHaveText('Genesis Crystals bought')
    await expect(page.getByTestId('ledger-chart').locator('.ld-bar').first()).toBeVisible()
  })

  test('a Welkin bought while one runs follows it on the card', async ({ page, core }) => {
    const model = structuredClone(LEDGER_FIXTURE)
    model.crystal_month.welkin = { start: '2026-10-01', end: '2026-11-29', days: 60 }
    await answer(page, model, viewPages)
    await page.goto(`${core.origin}/#/ledger`)
    await page.getByRole('radio', { name: 'Crystals' }).click()
    const card = page.getByTestId('ledger-card-welkin')
    await expect(card.locator('.ld-lead')).toHaveText('Day 1 of 30.') // 31 October is the 31st day: the second Welkin's first
    await expect(card).toContainText('Running since 1 October: 90 primogems every day until 29 November.')
  })

  test('the tab bar is one list: the four views, one at a time', async ({ page }) => {
    await expect(page.getByRole('radiogroup', { name: 'Ledger view' }).getByRole('radio')).toHaveCount(4)
    for (const [tab, label] of [['Crystals', 'Genesis Crystals bought'], ['Resin', 'Resin spent'], ['Artifacts', 'Five-star artifacts'], ['Primogems', 'Primogems held']] as const) {
      await page.getByRole('radio', { name: tab }).click()
      await expect(page.getByTestId('ledger-chart-label')).toHaveText(label)
    }
  })

  test('without any entry of a kind its view says nothing is known instead of drawing zeros as facts', async ({ page, core }) => {
    const model = structuredClone(LEDGER_FIXTURE)
    model.resin_days = model.resin_days.map((day) => ({ ...day, known: false, spent: 0, by_use: {}, runs: {} }))
    await answer(page, model, () => ({ entries: [], more: false }))
    await page.goto(`${core.origin}/#/ledger`)
    await page.getByRole('radio', { name: 'Resin' }).click()
    await expect(page.getByTestId('ledger-chart-amount')).toHaveText('—')
    await expect(page.getByTestId('ledger-chart-line')).toHaveText('No record of these days')
    // The pointer on a day the log does not cover is unknown too, not a day of nothing.
    const svg = await box(page.getByTestId('ledger-chart').locator('svg.ld-svg'))
    await page.mouse.move(svg.x + svg.width / 2, svg.y + svg.height / 2)
    await expect(page.getByTestId('ledger-chart-amount')).toHaveText('—')
    await expect(page.getByTestId('ledger-chart-line')).toHaveText('No record of this day')
    await expect(page.getByTestId('ledger-tx')).toContainText('Nothing in this history yet.')
    await expect(page.getByTestId('ledger-card-against')).toContainText('Nothing recorded this month yet.')
  })
})

test.describe('the other views, in both windows', () => {
  for (const [name, size] of [['the usual window', { width: 1640, height: 1100 }], ['full screen', { width: 2560, height: 1400 }]] as const) {
    test.describe(name, () => {
      test.use({ viewport: size })
      for (const tab of ['Crystals', 'Resin', 'Artifacts']) {
        test(`${tab}: even rows, equal gaps, the feed ending with the cards`, async ({ page, core }) => {
          await answer(page, LEDGER_FIXTURE, viewPages)
          await page.goto(`${core.origin}/#/ledger`)
          await page.getByRole('radio', { name: tab }).click()
          await expect(page.locator('.ld-side > .ld-col > .ld-card').first()).toBeVisible()
          await expectViewEven(page)
        })
      }

      test(`the demo core's own history draws all three`, async ({ page, core }) => {
        await page.goto(`${core.origin}/#/ledger`)
        await expect(page.getByTestId('ledger-chart')).toBeVisible()
        for (const [tab, label] of [['Crystals', 'Genesis Crystals bought'], ['Resin', 'Resin spent'], ['Artifacts', 'Five-star artifacts']] as const) {
          await page.getByRole('radio', { name: tab }).click()
          await expect(page.getByTestId('ledger-chart-label')).toHaveText(label)
          await page.getByTestId('ledger-chart').getByRole('radio', { name: '6 months' }).click()
          await expect(page.getByTestId('ledger-chart').locator('.ld-bar').first()).toBeVisible()
          await expect(page.getByTestId('ledger-tx').getByRole('listitem').first()).toBeVisible()
          await expect(page.getByTestId('ledger-card-where')).toBeVisible()
          await expectViewEven(page)
        }
      })
    })
  }
})

test('empty ledger shows the import explanation', async ({ page, core }) => {
  const model = structuredClone(LEDGER_FIXTURE)
  model.empty = true
  model.last_import = null
  await answer(page, model, () => ({ entries: [], more: false }))
  await page.goto(`${core.origin}/#/ledger`)
  const empty = page.getByTestId('ledger-empty')
  await expect(empty).toContainText('open Feedback from the Paimon menu in the game once, then press Import.')
  await expect(empty).toContainText('only reads')
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible()
})

test('with the HoYoLAB login the empty ledger says it is reading the history now', async ({ page, core }) => {
  const model = structuredClone(LEDGER_FIXTURE)
  model.empty = true
  model.last_import = null
  model.import.login = 'on'
  model.import.every_minutes = 30 // what the core sends where the login updates the history by itself
  await answer(page, model, () => ({ entries: [], more: false }))
  await page.goto(`${core.origin}/#/ledger`)
  const empty = page.getByTestId('ledger-empty')
  await expect(empty).toContainText('Guild Board is reading them now with your HoYoLAB login.')
  await expect(empty).not.toContainText('open Feedback')
  // The ring's sentence, which is its accessible name, says it; the few words beside it say that nothing was read yet.
  await expect(ring(page, 'ledger-import').mark).toHaveAttribute(
    'aria-label',
    'Updates automatically with your HoYoLAB login',
  )
  await expect(ring(page, 'ledger-import').label).toHaveText('Not read yet')
  // Import stays, for a reading of the game's own link.
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible()
})

test("Import starts the Pulls page's import and shows the ledger's progress", async ({ page, core }) => {
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
  const { label, mark } = ring(page, 'ledger-import')
  await expect(mark).toHaveAttribute('aria-label', /^History from the game up to /)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(mark).toHaveAttribute('aria-label', 'Reading primogem history… 340 entries')
  await expect(label).toHaveText('340 entries')
  await expect(page.getByRole('button', { name: 'Importing…' })).toHaveAttribute('aria-disabled', 'true')
})

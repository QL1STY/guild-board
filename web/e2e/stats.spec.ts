import type { Locator, Page } from '@playwright/test'
import type { Stats } from '../src/types.ts'
import { changeAnswer, holding } from './answers.ts'
import { counted } from './board.ts'
import { expect, test } from './fixtures.ts'

test.beforeEach(async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats`)
})

/** The calendar chip beside the title (freshness design, section 2): the range is its label, its tip is its accessible name. */
const chipOf = (page: Page): Locator => page.locator('.gb-chip', { has: page.getByTestId('period') }).locator('[aria-label]')

test('the tiles show the last 30 days', async ({ page }) => {
  await expect(page.getByRole('radio', { name: '30 days' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('period')).toHaveText('14 Sep – 13 Oct')
  const chests = page.getByTestId('tile-chests')
  await expect(chests).toContainText('Chests opened')
  await expect(chests).toContainText('211')
  await expect(chests).toContainText('▲ 28 vs previous 30 days')
  await expect(page.getByTestId('tile-achievements')).toContainText('no change vs previous 30 days')
  await expect(page.getByTestId('tile-playtime')).toContainText('38 h 15 min')
  await expect(page.getByTestId('tile-playtime')).toContainText('▲ 7 h 55 min vs previous 30 days')
  await expect(page.getByTestId('tile-days')).toContainText('27 of 30')
  await expect(page.getByTestId('tile-days')).toContainText('Longest run 9 days')
  await expect(page.getByTestId('tile-primogems')).toContainText('7,700')
})

test('the period switch scopes the tiles', async ({ page }) => {
  await page.getByRole('radio', { name: '7 days' }).click()
  await expect(page.getByTestId('period')).toHaveText('7 Oct – 13 Oct')
  await expect(page.getByTestId('tile-chests')).toContainText('▼ 8 vs previous 7 days')
  await page.getByRole('radio', { name: 'All' }).click()
  await expect(page.getByTestId('period')).toHaveText('15 Jul – 13 Oct')
  await expect(page.getByTestId('tile-chests')).toContainText('579')
  await expect(page.getByTestId('tile-chests')).toContainText('Since 15 Jul')
  await expect(page.getByText('vs previous')).toHaveCount(0)
})

test('a trend line tells its range on hover and on keyboard focus', async ({ page }) => {
  const trend = page.getByTestId('tile-chests').getByRole('img')
  const tip = () => trend.evaluate((element) => getComputedStyle(element, '::after').content)
  await expect(trend).toHaveAttribute('aria-label', 'Trend over the period. Lowest 6, highest 27')
  expect(await tip()).toBe('none')
  await trend.hover()
  expect(await tip()).toBe('"Lowest 6, highest 27"')
  await page.mouse.move(0, 0)
  expect(await tip()).toBe('none')
  await trend.focus()
  await page.keyboard.press('Shift') // any key: from here on the focus counts as keyboard focus
  expect(await tip()).toBe('"Lowest 6, highest 27"')
})

test('partial coverage is said and comparisons are hidden', async ({ page }) => {
  await changeAnswer<Stats>(page, '/api/stats', (data) => {
    data.coverage = { tracking_since: '2026-10-01', tracked_days: 13, full: false, partial: true, compare: false }
    for (const tile of data.tiles) {
      if ('delta' in tile) tile.delta = null
      if ('delta_minutes' in tile) tile.delta_minutes = null
    }
  })
  await page.reload()
  await expect(page.getByTestId('period')).toHaveText('14 Sep – 13 Oct')
  // The chip's tip, which is also its accessible name, adds where the history begins.
  await expect(chipOf(page)).toHaveAttribute('aria-label', '14 Sep – 13 Oct. Tracking since 1 Oct.')
  await expect(page.getByTestId('tile-chests')).toContainText('No earlier period to compare')
  await expect(page.getByTestId('tile-playtime')).toContainText('No earlier period to compare')
  await expect(page.getByText('vs previous')).toHaveCount(0)
})

test('the page says how playtime is measured until start with Windows is on', async ({ page, api }) => {
  const note = page.getByText('Playtime is measured only while Guild Board is running.')
  await expect(note).toBeVisible()
  await api.put('/api/settings', { start_with_windows: true })
  await page.reload()
  await expect(page.getByTestId('tile-playtime')).toBeVisible()
  await expect(note).toHaveCount(0)
})

test.describe('before the first sync', () => {
  test.use({ mode: 'live' })

  test('the statistics say that there is nothing yet', async ({ page }) => {
    await expect(page.getByText('Nothing to show yet. Statistics build up from the first sync.')).toBeVisible()
    await expect(chipOf(page)).toHaveAttribute('aria-label', /\. No history yet\.$/)
    await expect(page.getByTestId('tile-chests')).toHaveCount(0)
  })
})

test('exploration gained shows where each region started', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Exploration gained' })
  await expect(card).toContainText('Regions that changed in the last 30 days · 7 others unchanged')
  await expect(card.getByText('30 days ago')).toBeVisible() // the legend
  const rows = card.getByRole('img')
  await expect(rows).toHaveCount(6)
  await expect(rows.first()).toHaveAttribute('aria-label', 'Snezhnaya: 19.1% to 36.7%')
  await expect(card.locator('.db-row').first()).toHaveText(/Snezhnaya\s*36\.7%/)
})

test('the chests chart labels only its highest column', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Chests opened per day' })
  await expect(card).toContainText('Last 30 days · 211 in total')
  await expect(card.getByRole('img')).toHaveCount(30)
  await expect(card.locator('.col-bars b')).toHaveText(['17'])
  await expect(card.locator('.col-y span')).toHaveText(['0', '5', '10', '15', '20'])
  await expect(card.locator('.col-x span').filter({ hasText: /\S/ })).toHaveText([
    '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct',
  ])
})

test('days without a sync are marked', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Chests opened per day' })
  await expect(card.getByRole('img', { name: 'Sat 19 Sep: no sync' })).toBeVisible()
  await expect(card.getByRole('img', { name: 'Sun 20 Sep: 11, includes days without a sync' })).toBeVisible()
  // The legend under the chart names both marks.
  await expect(card.locator('.col-lg')).toHaveText(/No sync\s*Includes days without a sync/)
})

test('a longer period counts chests per week', async ({ page }) => {
  await page.getByRole('radio', { name: '90 days' }).click()
  const card = page.getByRole('region', { name: 'Chests opened per week' })
  await expect(card).toContainText('Last 90 days · 579 in total')
  await expect(card.getByRole('img')).toHaveCount(14)
  await expect(card.getByRole('img', { name: 'Week of 21 Sep: 73' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Exploration gained' }).getByText('90 days ago')).toBeVisible()
})

test('a chart shows exact values on hover and on keyboard focus', async ({ page }) => {
  const marks = page.getByRole('region', { name: 'Chests opened per day' }).getByRole('img')
  const tip = (index: number) => marks.nth(index).evaluate((mark) => getComputedStyle(mark, '::after').content)
  expect(await tip(12)).toBe('none')
  await marks.nth(12).hover()
  expect(await tip(12)).toBe('"Sat 26 Sep: 17"')
  // One tab stop for the whole chart; the arrow keys walk the columns.
  await marks.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect(marks.nth(1)).toBeFocused()
  expect(await tip(1)).toBe('"Tue 15 Sep: 8"')
  await page.keyboard.press('End')
  await expect(marks.nth(29)).toBeFocused()
  await expect(marks.nth(29)).toHaveAttribute('tabindex', '0')
  await expect(marks.nth(0)).toHaveAttribute('tabindex', '-1')
})

test('a chart can be read as a table', async ({ page }) => {
  const gained = page.getByRole('region', { name: 'Exploration gained' })
  await gained.getByRole('button', { name: 'Show as table' }).click()
  await expect(gained.getByRole('columnheader')).toHaveText(['Region', '30 days ago', 'Now', 'Gained'])
  await expect(gained.getByRole('row').nth(1)).toHaveText(/Snezhnaya\s*19\.1%\s*36\.7%\s*▲ 17\.6%/)
  await expect(gained.getByRole('img')).toHaveCount(0)
  await gained.getByRole('button', { name: 'Show the chart' }).click()
  await expect(gained.getByRole('img')).toHaveCount(6)
  const chests = page.getByRole('region', { name: 'Chests opened per day' })
  await chests.getByRole('button', { name: 'Show as table' }).click()
  await expect(chests.getByRole('row')).toHaveCount(31)
  await expect(chests.getByRole('row').nth(6)).toHaveText(/Sat 19 Sep\s*–\s*No sync/)
  await expect(chests.getByRole('row').nth(7)).toHaveText(/Sun 20 Sep\s*11\s*Includes days without a sync/)
})

test('a long region name does not push the chart apart', async ({ page }) => {
  const long = 'Achromatic-Hinterlands-Of-The-Unnamed-Northern-Reaches'
  await changeAnswer<Stats>(page, '/api/stats', (data) => {
    data.exploration.rows[0].name = long
  })
  await page.reload()
  const name = page.getByRole('region', { name: 'Exploration gained' }).getByTitle(long)
  await expect(name).toHaveCSS('text-overflow', 'ellipsis')
  expect((await name.boundingBox())!.width).toBeLessThanOrEqual(124)
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }))
  expect(widths.page).toBeLessThanOrEqual(widths.window)
})

test('the playtime calendar covers twelve weeks', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Playtime calendar' })
  await expect(card).toContainText('Time in game per day, last 12 weeks')
  await expect(card.getByRole('img')).toHaveCount(79) // 84 days, of which 5 have not come yet
  await expect(card.getByRole('img', { name: 'Mon 12 Oct: 1 h 33 min' })).toHaveClass(/l3/)
  await expect(card.getByRole('img', { name: 'Tue 13 Oct: none recorded' })).toBeVisible()
  await expect(card.locator('.hm-m span').filter({ hasText: /\S/ })).toHaveText(['Aug', 'Sep', 'Oct'])
  await expect(card.locator('.hm-d span').filter({ hasText: /\S/ })).toHaveText(['Mon', 'Wed', 'Fri', 'Sun'])
})

test('the arrow keys walk the calendar by day and by week', async ({ page }) => {
  const cells = page.getByRole('region', { name: 'Playtime calendar' }).getByRole('img')
  await cells.nth(0).focus()
  await page.keyboard.press('ArrowDown')
  await expect(cells.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(cells.nth(8)).toBeFocused()
  await expect(cells.nth(8)).toHaveAttribute('aria-label', 'Tue 4 Aug: 2 h 01 min')
  await page.keyboard.press('End')
  await expect(cells.nth(78)).toBeFocused()
})

test('primogems are shown per month and by source', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Primogems by month' })
  const months = card.locator('.pm-cols').getByRole('img')
  await expect(months).toHaveCount(6)
  await expect(months.nth(4)).toHaveAttribute('aria-label', 'Sep: 7,529')
  await expect(months.last()).toHaveAttribute('aria-label', 'Oct so far: 3,851')
  await expect(months.last().locator('i')).toHaveClass('now')
  await expect(card.locator('.pm-x span').last()).toHaveText('Oct so far')
  // October is the demo's own game history, so its sources are that history's groups, and add up to the month's 3,851.
  const sources = card.locator('.pm-sources').getByRole('img')
  await expect(sources).toHaveCount(5)
  await expect(sources.first()).toHaveAttribute('aria-label', 'Spiral Abyss and Theater: 1,250')
  await expect(sources.first()).toHaveAttribute('data-tip', '32% of this month')
  await card.getByRole('button', { name: 'Show as table' }).click()
  await expect(card.getByRole('table')).toHaveCount(2)
  await expect(card.getByRole('row', { name: /Sep/ })).toContainText('7,529')
  await expect(card.getByRole('row', { name: /Events/ })).toContainText('580')
})

test('endgame lists the latest and the best result per mode', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Endgame' })
  await expect(card.getByRole('columnheader')).toHaveText(['Mode', 'Latest result', 'Period', 'Best so far'])
  await expect(card.getByRole('row')).toHaveCount(4)
  await expect(card.getByRole('row').nth(1)).toHaveText(/Spiral Abyss\s*34 of 36 stars\s*16 Sep to 15 Oct\s*36 stars/)
  await expect(card.getByRole('button', { name: 'Show as table' })).toHaveCount(0) // it is a table already
})

test('the cards with a fixed scope do not follow the period switch', async ({ page }) => {
  await page.getByRole('radio', { name: '7 days' }).click()
  await expect(page.getByRole('region', { name: 'Chests opened per day' }).getByRole('img')).toHaveCount(7)
  await expect(page.getByRole('region', { name: 'Playtime calendar' }).getByRole('img')).toHaveCount(79)
  await expect(page.getByRole('region', { name: 'Primogems by month' }).locator('.pm-cols').getByRole('img')).toHaveCount(6)
  await expect(page.getByRole('region', { name: 'Endgame' }).getByRole('row')).toHaveCount(4)
})

test('exploration that has not been read is not called unchanged', async ({ page }) => {
  await changeAnswer<Stats>(page, '/api/stats', (data) => {
    data.exploration = { rows: [], unchanged: 0 }
  })
  await page.reload()
  const card = page.getByRole('region', { name: 'Exploration gained' })
  await expect(card).toContainText('Exploration has not been read yet.')
  await expect(card).not.toContainText('No region changed')
})

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const hh = (hour: number) => String(hour).padStart(2, '0')

/**
 * The busiest hour of the week as the core gives it. Hours follow the PC's clock, so which hour that is depends on the
 * PC the test runs on: the test reads it from the core instead of knowing it. The cells go column by column, an hour at
 * a time from Monday to Sunday.
 */
function busiest(play: Stats['play_hours']) {
  let best = { index: 0, weekday: 0, hour: 0, minutes: -1, level: 0 }
  play.cells.forEach((row, weekday) =>
    row.forEach((minutes, hour) => {
      if (minutes !== null && minutes > best.minutes) {
        best = { index: hour * 7 + weekday, weekday, hour, minutes, level: play.levels[weekday][hour] }
      }
    }),
  )
  return best
}

/** What a cell of When you play says of an hour. */
function hourSaid(top: ReturnType<typeof busiest>): string {
  return `${WEEKDAY_NAMES[top.weekday]}s, ${hh(top.hour)}:00 to ${hh(top.hour + 1)}:00: ${Math.round(top.minutes)} min on average`
}

test('Primogems earned per day shows a column per day and its table', async ({ page }) => {
  // The demo's days come from its own game history (the ledger design, section 0): exact, and split by source.
  const card = page.getByRole('region', { name: 'Primogems earned per day' })
  await expect(card).toContainText("Last 30 days · 7,700 earned · from the game's own primogem history")
  await expect(card.getByRole('img')).toHaveCount(30)
  await expect(card.locator('.col-bars b')).toHaveText(['1,320'])
  await expect(card.locator('.col-y span')).toHaveText(['0', '500', '1,000', '1,500'])
  await expect(
    card.getByRole('img', {
      name: 'Wed 16 Sep · 1,320 primogems, Blessing of the Welkin Moon 90, Events 420, Spiral Abyss and Theater 800, Other 10',
    }),
  ).toBeVisible()
  await card.getByRole('button', { name: 'Show as table' }).click()
  await expect(card.getByRole('columnheader')).toHaveText([
    'Day', 'Primogems', 'Daily commissions', 'Blessing of the Welkin Moon', 'Events', 'Spiral Abyss and Theater', 'Other',
    'Note',
  ])
  await expect(card.getByRole('row')).toHaveCount(31)
  await expect(card.getByRole('row').nth(1)).toHaveText(/Mon 14 Sep\s*234\s*60\s*90\s*60\s*0\s*24/)
  await expect(card.getByRole('row').nth(3)).toHaveText(/Wed 16 Sep\s*1,320\s*0\s*90\s*420\s*800\s*10/)
  await expect(card.getByRole('img')).toHaveCount(0)
})

test('a longer period counts primogems per week', async ({ page }) => {
  await page.getByRole('radio', { name: '90 days' }).click()
  const card = page.getByRole('region', { name: 'Primogems earned per week' })
  await expect(card).toContainText("Last 90 days · 23,362 earned · from the game's own primogem history")
  await expect(card.getByRole('img')).toHaveCount(14)
  await expect(
    card.getByRole('img', {
      name: 'Week of 21 Sep · 1,141 primogems, Daily commissions 300, Blessing of the Welkin Moon 630, Events 40, Other 171',
    }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Primogems earned per day' })).toHaveCount(0)
})

test('When you play shows the week by the hour, and its table', async ({ page, api }) => {
  const card = page.getByRole('region', { name: 'When you play' })
  await expect(card).toContainText('Minutes on an average day, by the hour on this PC')
  const cells = card.getByRole('img')
  await expect(cells).toHaveCount(168) // seven weekdays of 24 hours
  // The cells go column by column: the first is a Monday's first hour, the last a Sunday's last.
  await expect(cells.first()).toHaveAttribute('aria-label', /^Mondays, 00:00 to 01:00: /)
  await expect(cells.last()).toHaveAttribute('aria-label', /^Sundays, 23:00 to 24:00: /)
  await expect(card.locator('.wy-h span').filter({ hasText: /\S/ })).toHaveText(['00', '03', '06', '09', '12', '15', '18', '21'])
  await expect(card.locator('.wy-d span')).toHaveText(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  await expect(card.locator('.wy-lg')).toHaveText(/None\s*Under 15 min\s*Under 30 min\s*Under 45 min\s*45 min or more/)
  // The busiest hour says its minutes and is drawn in its level of the gold.
  const { play_hours: play } = await api.get<Stats>('/api/stats?range=30')
  expect(play.days).toEqual([5, 5, 4, 4, 4, 4, 4])
  const top = busiest(play)
  expect(top.level).toBeGreaterThanOrEqual(3)
  const cell = cells.nth(top.index)
  await expect(cell).toHaveAttribute('aria-label', hourSaid(top))
  await expect(cell).toHaveClass(new RegExp(`\\bl${top.level}\\b`))
  // An hour in which nothing was played is the first step of the ramp (None), not a missing one.
  await expect(cells.first()).not.toHaveClass(/\bnt\b/)
  await card.getByRole('button', { name: 'Show as table' }).click()
  await expect(cells).toHaveCount(0)
  await expect(card.getByRole('columnheader')).toHaveCount(25)
  await expect(card.getByRole('columnheader').nth(1)).toHaveText('00')
  await expect(card.getByRole('columnheader').last()).toHaveText('23')
  await expect(card.getByRole('row')).toHaveCount(8) // the headings, and a row for each weekday
  // Each row is headed by its weekday, which a screen reader then says with each hour's minutes.
  await expect(card.getByRole('rowheader')).toHaveText(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
  await expect(card.getByRole('row').nth(1).getByRole('rowheader')).toHaveText('Monday')
  await expect(card.getByRole('row').nth(top.weekday + 1).getByRole('cell').nth(top.hour)).toHaveText(
    String(Math.round(top.minutes)),
  )
  await card.getByRole('button', { name: 'Show the chart' }).click()
  await expect(cells).toHaveCount(168)
})

test("a table's row headers look as the row's other cells do", async ({ page }) => {
  const card = page.getByRole('region', { name: 'Endgame' }) // a table from the start
  await expect(card.getByRole('rowheader')).toHaveText(['Spiral Abyss', 'Imaginarium Theater', 'Stygian Onslaught'])
  const look = (cell: Locator) =>
    cell.evaluate((one) => {
      const style = getComputedStyle(one)
      return {
        font: [style.fontSize, style.fontWeight, style.textTransform, style.letterSpacing, style.color].join(' '),
        box: [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderTopColor].join(' '),
        align: style.textAlign,
      }
    })
  const header = card.getByRole('row').nth(1).getByRole('rowheader')
  const cell = card.getByRole('row').nth(1).getByRole('cell').first() // the latest result, a text column
  expect(await look(header)).toEqual(await look(cell))
})

test('the arrow keys move between the hours and the weekdays of When you play', async ({ page }) => {
  const cells = page.getByRole('region', { name: 'When you play' }).getByRole('img')
  await cells.nth(0).focus()
  await page.keyboard.press('ArrowDown') // the next weekday, in the same hour
  await expect(cells.nth(1)).toBeFocused()
  await expect(cells.nth(1)).toHaveAttribute('aria-label', /^Tuesdays, 00:00 to 01:00: /)
  await page.keyboard.press('ArrowRight') // the next hour, on the same weekday
  await expect(cells.nth(8)).toBeFocused()
  await expect(cells.nth(8)).toHaveAttribute('aria-label', /^Tuesdays, 01:00 to 02:00: /)
  await page.keyboard.press('ArrowLeft')
  await expect(cells.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(cells.nth(0)).toBeFocused()
  await page.keyboard.press('End')
  await expect(cells.nth(167)).toBeFocused()
  await expect(cells.nth(167)).toHaveAttribute('aria-label', /^Sundays, 23:00 to 24:00: /)
  // One tab stop for the whole grid, as the calendar has.
  await expect(cells.nth(167)).toHaveAttribute('tabindex', '0')
  await expect(cells.nth(0)).toHaveAttribute('tabindex', '-1')
  await page.keyboard.press('Home')
  await expect(cells.nth(0)).toBeFocused()
})

test('a cell of When you play tells its hour on hover and on keyboard focus', async ({ page, api }) => {
  const cells = page.getByRole('region', { name: 'When you play' }).getByRole('img')
  const { play_hours: play } = await api.get<Stats>('/api/stats?range=30')
  const top = busiest(play)
  const shown = () => cells.nth(top.index).evaluate((cell) => getComputedStyle(cell, '::after').content)
  expect(await shown()).toBe('none')
  await cells.nth(top.index).hover()
  expect(await shown()).toBe(`"${hourSaid(top)}"`)
  await page.mouse.move(0, 0)
  expect(await shown()).toBe('none')
  await cells.nth(top.index).focus()
  await page.keyboard.press('Shift') // any key: from here on the focus counts as keyboard focus
  expect(await shown()).toBe(`"${hourSaid(top)}"`)
})

test('When you play and Primogems earned per day follow the period switch', async ({ page, api }) => {
  await page.getByRole('radio', { name: '7 days' }).click()
  const primogems = page.getByRole('region', { name: 'Primogems earned per day' })
  await expect(primogems.getByRole('img')).toHaveCount(7)
  await expect(primogems).toContainText('Last 7 days · 1,747 earned')
  const { play_hours: play } = await api.get<Stats>('/api/stats?range=7')
  expect(play.days).toEqual([1, 1, 1, 1, 1, 1, 1])
  const top = busiest(play)
  await expect(page.getByRole('region', { name: 'When you play' }).getByRole('img').nth(top.index)).toHaveAttribute(
    'aria-label',
    hourSaid(top),
  )
})

test('When you play says so when the period holds no session', async ({ page }) => {
  await changeAnswer<Stats>(page, '/api/stats', (data) => {
    data.play_hours.empty = true
    data.play_hours.cells = data.play_hours.cells.map((row) => row.map(() => 0))
    data.play_hours.levels = data.play_hours.levels.map((row) => row.map(() => 0))
  })
  await page.reload()
  const card = page.getByRole('region', { name: 'When you play' })
  await expect(card).toContainText('No session was recorded in the last 30 days.')
  await expect(card.getByRole('img')).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Show as table' })).toHaveCount(0)
})

test('a weekday Guild Board was not tracking is not tracked, which is not none', async ({ page }) => {
  await changeAnswer<Stats>(page, '/api/stats', (data) => {
    data.play_hours.days[0] = 0
    data.play_hours.cells[0] = data.play_hours.cells[0].map(() => null)
    data.play_hours.levels[0] = data.play_hours.levels[0].map(() => 0)
  })
  await page.reload()
  const card = page.getByRole('region', { name: 'When you play' })
  const monday = card.getByRole('img', { name: 'Mondays, 20:00 to 21:00: not tracked' })
  await expect(monday).toHaveClass(/\bnt\b/)
  await expect(card.getByRole('img', { name: 'Tuesdays, 00:00 to 01:00: none recorded' })).not.toHaveClass(/\bnt\b/)
  await expect(card.locator('.wy-lg')).toContainText('Not tracked')
  await card.getByRole('button', { name: 'Show as table' }).click()
  await expect(card.getByRole('row').nth(1).getByRole('cell').nth(20)).toHaveText('') // Monday's 20:00
})

test('the cells of When you play are 14 pixels, shrink in a narrow window and stay inside their card', async ({ page }) => {
  const card = page.getByRole('region', { name: 'When you play' })
  const cells = card.getByRole('img')
  const box = async (locator: typeof cells) => (await locator.boundingBox())!
  const first = await box(cells.first())
  expect([first.width, first.height]).toEqual([14, 14])
  // An hour's label is over the column of its cell: hour 3 is the fourth column, from the 22nd cell on.
  expect(Math.abs((await box(card.locator('.wy-h span').nth(3))).x - (await box(cells.nth(21))).x)).toBeLessThan(1)
  const inside = async () => {
    const last = await box(cells.last())
    const frame = await box(card)
    expect(last.x + last.width).toBeLessThanOrEqual(frame.x + frame.width)
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }))
    expect(widths.page).toBeLessThanOrEqual(widths.window)
  }
  await inside()
  await page.setViewportSize({ width: 1040, height: 900 }) // the narrowest window
  await expect.poll(async () => (await box(cells.first())).width).toBeLessThan(14)
  expect((await box(cells.first())).width).toBeGreaterThanOrEqual(8)
  await inside()
})

test('the cards come in the order of the spec', async ({ page }) => {
  await expect(page.locator('.ch h2')).toHaveText([
    'Exploration gained',
    'Playtime calendar',
    'When you play',
    'Chests opened per day',
    'Primogems earned per day',
    'Primogems by month',
    'Endgame',
  ])
})

/** The figure of a tile as it is on the screen now (the copy for screen readers sits beside it, out of sight). */
const figureOf = (page: Page, tile: string) => counted(page.getByTestId(`tile-${tile}`).locator('.v'))

/** The number a tile's figure shows, whatever its commas. */
async function figureNumber(page: Page, tile: string): Promise<number> {
  return Number((await figureOf(page, tile).textContent())!.replace(/,/g, ''))
}

test('the tiles count up to their values', async ({ page, api }) => {
  // The statistics are held back until the page's clock has stopped, so that the count begins at a moment the test knows.
  const { held, release } = holding()
  await page.route('**/api/stats*', async (route) => {
    await held
    await route.continue()
  })
  await page.clock.install()
  await page.reload()
  await page.clock.pauseAt(Date.now() + 1_000)
  release()
  await expect(figureOf(page, 'chests')).toHaveText('0') // it begins at 0
  await expect(page.getByTestId('tile-chests').locator('.v .sr-only')).toHaveText('211') // screen readers have the final figure
  await page.clock.runFor(100)
  const partway = await figureNumber(page, 'chests')
  expect(partway).toBeGreaterThan(0)
  expect(partway).toBeLessThan(211)
  await page.clock.runFor(1_000) // --t-count is 800 ms
  await expect(figureOf(page, 'chests')).toHaveText('211')
  await expect(figureOf(page, 'playtime')).toHaveText('38 h 15 min') // the minutes, counted as hours and minutes
  await expect(figureOf(page, 'days')).toHaveText('27 of 30')
  await expect(figureOf(page, 'primogems')).toHaveText('7,700')
  // A change of period counts from the number on the screen to the new one, not from 0.
  const week = (await api.get<Stats>('/api/stats?range=7')).tiles[0]
  const value = 'value' in week ? week.value : -1
  expect(value).toBeLessThan(211)
  await page.getByRole('radio', { name: '7 days' }).click()
  await expect(page.getByTestId('period')).toHaveText('7 Oct – 13 Oct')
  await page.clock.runFor(100)
  const down = await figureNumber(page, 'chests')
  expect(down).toBeLessThan(211)
  expect(down).toBeGreaterThan(value)
  // Days played counts its period's length with it, from 30 to 7: never more days played than days on the way.
  const [played, days] = (await figureOf(page, 'days').textContent())!.split(' of ').map(Number)
  expect(days).toBeLessThan(30)
  expect(days).toBeGreaterThan(7)
  expect(played).toBeLessThanOrEqual(days)
  await page.clock.runFor(1_000)
  await expect(figureOf(page, 'chests')).toHaveText(String(value))
  await expect(figureOf(page, 'days')).toHaveText(/ of 7$/)
})

test('with reduced motion the tiles show their values at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(page.getByTestId('tile-chests')).toBeVisible()
  expect(await figureNumber(page, 'chests')).toBe(211) // read at once, without waiting for a count
  expect(await figureOf(page, 'playtime').textContent()).toBe('38 h 15 min')
})

/** What each animation that starts on the page is, and where: "sweep in tile-chests", "grow-h in Chests opened per day". */
async function recordMotion(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { motion: string[] }).motion = seen
    document.addEventListener(
      'animationstart',
      (event) => {
        const { animationName, target } = event as AnimationEvent
        const where = (target as Element).closest('section[aria-label], [data-testid^="tile-"]')
        seen.push(`${animationName} in ${where?.getAttribute('data-testid') ?? where?.getAttribute('aria-label') ?? 'the page'}`)
      },
      true,
    )
  })
  return () => page.evaluate(() => (window as unknown as { motion: string[] }).motion)
}

test('the page opens with its lines drawing, its meter and columns growing, its dots moving out and its cells appearing', async ({
  page,
}) => {
  const seen = await recordMotion(page)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Endgame' })).toBeVisible()
  const unique = async () => [...new Set(await seen())]
  await expect
    .poll(unique)
    .toEqual(
      expect.arrayContaining([
        'sweep in tile-chests',
        'sweep in tile-achievements',
        'sweep in tile-playtime',
        'sweep in tile-primogems',
        'grow-w in tile-days',
        'slide-out in Exploration gained',
        'grow-w in Exploration gained',
        'fade-in in Playtime calendar',
        'fade-in in When you play',
        'grow-h in Chests opened per day',
        'grow-h in Primogems earned per day',
        'grow-h in Primogems by month',
        'grow-w in Primogems by month',
      ]),
    )
  // The Endgame table is still, and everything that began ends: nothing loops.
  expect((await seen()).filter((name) => name.endsWith('in Endgame'))).toEqual([])
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0)
  // Each runs once: the cells of a card come in one after another (the calendar's 79 days, the week's 168 hours), and
  // the dots of the six regions slide out once each.
  const all = await seen()
  expect(all.filter((name) => name === 'fade-in in Playtime calendar')).toHaveLength(79)
  expect(all.filter((name) => name === 'fade-in in When you play')).toHaveLength(168)
  expect(all.filter((name) => name === 'slide-out in Exploration gained')).toHaveLength(6)
  expect(all.filter((name) => name === 'sweep in tile-chests')).toHaveLength(1)
})

test('the cells of the calendar and of When you play appear column by column, oldest first', async ({ page }) => {
  const delayOf = async (card: string, index: number) =>
    page
      .getByRole('region', { name: card })
      .getByRole('img')
      .nth(index)
      .evaluate((cell) => parseFloat(getComputedStyle(cell).animationDelay) * 1000)
  // The calendar: seven days a column. The first column has no delay, and each column after it one --stagger (30 ms) more.
  expect(await delayOf('Playtime calendar', 0)).toBe(0)
  expect(await delayOf('Playtime calendar', 6)).toBe(0) // the same column
  expect(await delayOf('Playtime calendar', 7)).toBe(30)
  expect(await delayOf('Playtime calendar', 14)).toBe(60)
  // The week by the hour: 24 columns, which come two at a time so that the wave has 12 steps at most.
  expect(await delayOf('When you play', 0)).toBe(0)
  expect(await delayOf('When you play', 13)).toBe(0)
  expect(await delayOf('When you play', 14)).toBe(30)
  expect(await delayOf('When you play', 167)).toBe(330)
})

test('a change of period moves the columns to their new heights', async ({ page, api }) => {
  const card = page.getByRole('region', { name: 'Chests opened per day' })
  // The highest column of the last 7 days is also one of the last 30: the 7 are the 30's last, so its place is 23 later.
  const week = (await api.get<Stats>('/api/stats?range=7')).chests
  const top = week.max_index!
  const column = card.locator('.col-item').nth(23 + top)
  const bar = column.locator('i')
  const height = () => bar.evaluate((element) => element.getBoundingClientRect().height)
  await expect.poll(() => card.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0) // grown
  const before = await height()
  await column.evaluate((element) => element.setAttribute('data-was', 'here')) // to see that the element is not replaced
  await page.evaluate(() => {
    const runs: string[] = []
    ;(window as unknown as { runs: string[] }).runs = runs
    document.addEventListener('transitionrun', (event) => {
      const { propertyName, target } = event as TransitionEvent
      runs.push(`${propertyName} ${(target as Element).tagName.toLowerCase()}`)
    })
  })
  await page.getByRole('radio', { name: '7 days' }).click()
  await expect(card.getByRole('img')).toHaveCount(7)
  // The same element, now the one at its place among 7, moves: a transition of its height is run, and ends at the height
  // that the new axis gives it.
  const same = card.locator('.col-item').nth(top)
  await expect(same).toHaveAttribute('data-was', 'here')
  await expect.poll(() => page.evaluate(() => (window as unknown as { runs: string[] }).runs)).toContain('height i')
  const axisTop = Number(await card.locator('.col-y span').last().textContent())
  const plot = await card.locator('.col-bars').evaluate((element) => element.getBoundingClientRect().height)
  const expected = (week.columns[top].value / axisTop) * plot
  await expect.poll(() => same.locator('i').evaluate((element) => element.getBoundingClientRect().height)).toBeCloseTo(expected, 0)
  expect(Math.abs(expected - before)).toBeGreaterThan(1) // the period changed what it measures against
})

// The ledger plan, Task 7. A core with the ledger splits the days the game's history reaches by source; the days before
// are the diary's estimates. The answer is shaped here as such a core gives it, so the test does not hang on the demo's
// history: a Welkin day of 150 and diary days before it.
test('stats shows a stacked primogem day of 150, and the days before as estimates', async ({ page }) => {
  await changeAnswer<Stats>(page, '/api/stats', (data) => {
    const days = data.primogem_days
    const empty = { commissions: 0, welkin: 0, events: 0, endgame: 0, other: 0 }
    days.groups_order = ['commissions', 'welkin', 'events', 'endgame', 'other']
    days.columns.forEach((column, index) => {
      if (column.no_data) return
      if (index < 10) {
        delete column.groups // a day of the old diary total, as the core sends it: no split, an estimate
        column.estimate = true
      } else column.groups = { ...empty, commissions: Math.min(60, column.value), other: Math.max(0, column.value - 60) }
    })
    const last = days.columns[days.columns.length - 1]
    last.value = 150
    last.no_data = false
    last.groups = { ...empty, commissions: 60, welkin: 90 }
    days.total = days.columns.reduce((sum, column) => sum + column.value, 0)
  })
  await page.reload()
  const card = page.getByRole('region', { name: 'Primogems earned per day' })
  await expect(card).toContainText("earned · from the game's own primogem history")
  await expect(card.locator('.col-groups')).toHaveText(
    /Daily commissions\s*Blessing of the Welkin Moon\s*Events\s*Spiral Abyss and Theater\s*Other/,
  )
  const day = card.getByRole('img', {
    name: 'Tue 13 Oct · 150 primogems, Daily commissions 60, Blessing of the Welkin Moon 90',
  })
  await expect(day).toBeVisible()
  await expect(day.locator('span[data-group]')).toHaveCount(2)
  await expect(card.locator('.col-bars i.est').first()).toBeVisible()
  await expect(card.locator('.col-lg')).toContainText('From the HoYoLAB diary, an estimate')
  await expect(card).toContainText('Spent primogems are not taken off here. They are on the Ledger page.')
  await card.getByRole('button', { name: 'Show as table' }).click()
  await expect(card.getByRole('columnheader')).toHaveText([
    'Day', 'Primogems', 'Daily commissions', 'Blessing of the Welkin Moon', 'Events', 'Spiral Abyss and Theater', 'Other',
    'Note',
  ])
  await expect(card.getByRole('row').last()).toHaveText(/Tue 13 Oct\s*150\s*60\s*90\s*0\s*0\s*0/)
})

import type { Locator, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { EndgameCardModel, Stats, YearAnswer } from '../src/types.ts'
import { changeAnswer, holding } from './answers.ts'
import { counted } from './board.ts'
import { expect, test } from './fixtures.ts'

/** The images of a card that are shown and have not loaded: the browser would draw its broken-image mark for them. */
const shownBroken = (card: Locator): Promise<string[]> =>
  card
    .locator('img:not([hidden])')
    .evaluateAll((all) => (all as HTMLImageElement[]).filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.src))

/** The demo's card as a live app would give it once the art is kept: every picture an address of the art cache. */
function pictured(data: EndgameCardModel): void {
  let at = 0
  const art = () => `/api/art/${String((at += 1)).padStart(32, '0')}`
  for (const mode of data.modes) {
    mode.header = { icon: art(), picture: art(), crop: mode.mode === 'stygian' ? [0, 0, 0.48, 0.84] : null }
    if ('ranks' in mode) for (const rank of mode.ranks ?? []) rank.face = art()
    if (mode.mode === 'abyss') for (const group of mode.foes) for (const foe of group.foes) foe.icon = art()
    if (mode.mode === 'stygian') {
      mode.medal = art()
      for (const boss of mode.bosses) boss.icon = art()
    }
  }
}

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
  await expect(page.getByTestId('period')).toHaveText('2 Mar – 13 Oct')
  await expect(page.getByTestId('tile-chests')).toContainText('1,421')
  await expect(page.getByTestId('tile-chests')).toContainText('Since 2 Mar')
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

/** The number of weeks the calendar's subtitle names. */
const weeksShown = async (card: Locator): Promise<number> =>
  Number(/last (\d+) weeks/.exec((await card.locator('.cs').textContent()) ?? '')?.[1])

test('the playtime calendar shows the weeks that fit, the newest at the right', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Playtime calendar' })
  await expect(card).toContainText(/Time in game per day, last \d+ weeks/)
  const weeks = await weeksShown(card)
  expect(weeks).toBeGreaterThan(12)
  await expect(card.getByRole('img')).toHaveCount(weeks * 7 - 5) // 5 days of the last week have not come yet
  await expect(card.getByRole('img', { name: 'Mon 12 Oct: 1 h 33 min' })).toHaveClass(/l3/)
  await expect(card.getByRole('img', { name: 'Tue 13 Oct: none recorded' })).toBeVisible()
  expect(await card.locator('.hm-m span').filter({ hasText: /\S/ }).allTextContents()).toContain('Oct')
  await expect(card.locator('.hm-d span').filter({ hasText: /\S/ })).toHaveText(['Mon', 'Wed', 'Fri', 'Sun'])
  await expect(card.locator('.hm-run')).toHaveText(/^(●\d+ days? in a row · )?Best \d+ days?$/)
})

test("the calendar and the hour grid reach their cards' right edge at 1640 and 2560", async ({ page }) => {
  for (const [width, height] of [[1640, 1100], [2560, 1400]]) {
    await page.setViewportSize({ width, height })
    for (const [name, box, cell] of [['Playtime calendar', '.hm-box', '.hm-g i'], ['When you play', '.wy-box', '.wy-g i']]) {
      const card = page.getByRole('region', { name })
      await expect(card.locator(cell).first()).toBeVisible()
      // The newest cell is within one column step of the box's right edge, and no cell lies beyond it.
      await expect.poll(async () => {
        const frame = (await card.locator(box).boundingBox())!
        const first = (await card.locator(cell).first().boundingBox())!
        const right = frame.x + frame.width
        const rights = await card.locator(cell).evaluateAll((cells) => cells.map((one) => one.getBoundingClientRect().right))
        return { gap: right - Math.max(...rights) < first.width + 3 + 0.5, beyond: Math.max(...rights) > right + 0.5 }
      }, { message: `${name} at ${width}` }).toEqual({ gap: true, beyond: false })
    }
  }
})

test('the calendar refits when the window is resized', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Playtime calendar' })
  await page.setViewportSize({ width: 1640, height: 1100 })
  await expect(card).toContainText(/last \d+ weeks/)
  const wide = await weeksShown(card)
  await page.setViewportSize({ width: 1200, height: 1100 })
  await expect.poll(() => weeksShown(card)).toBeLessThan(wide)
  const frame = (await card.locator('.hm-box').boundingBox())!
  const rights = await card.locator('.hm-g i').evaluateAll((cells) => cells.map((one) => one.getBoundingClientRect().right))
  expect(Math.max(...rights)).toBeLessThanOrEqual(frame.x + frame.width + 0.5)
  await expect(card.getByRole('img')).toHaveCount((await weeksShown(card)) * 7 - 5)
})

test('the arrow keys walk the calendar by day and by week', async ({ page }) => {
  const cells = page.getByRole('region', { name: 'Playtime calendar' }).getByRole('img')
  await expect(cells.first()).toBeVisible()
  const count = await cells.count()
  await cells.nth(0).focus()
  await page.keyboard.press('ArrowDown')
  await expect(cells.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(cells.nth(8)).toBeFocused()
  await expect(cells.nth(8)).toHaveAttribute('aria-label', /^Tue \d+ \w+: /) // a week on, the same weekday as the first cell's Monday plus one
  await page.keyboard.press('End')
  await expect(cells.nth(count - 1)).toBeFocused()
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

test('endgame shows the three modes, each under its header, with the table behind a switch', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Endgame' })
  await expect(card.getByTestId('ec-abyss')).toContainText('Spiral Abyss')
  await expect(card.getByTestId('ec-theater')).toContainText('Imaginarium Theater')
  await expect(card.getByTestId('ec-stygian')).toContainText('Stygian Onslaught')
  await expect(card.getByText('This cycle in each mode, with the best so far')).toBeVisible()
  await expect(card.getByTestId('ec-abyss')).toContainText('16 Sep to 15 Oct')
  await expect(card.getByTestId('ec-abyss')).toContainText('Best 36 stars')
  await expect(card.getByTestId('ec-theater')).toContainText('Act 10')
  await expect(card.getByTestId('ec-stygian')).toContainText('Difficulty 5')
  await card.getByRole('button', { name: 'Show as table' }).click()
  await expect(card.getByRole('columnheader')).toHaveText(['Mode', 'Latest result', 'Period', 'Best so far'])
  await expect(card.getByRole('row')).toHaveCount(4)
  await expect(card.getByRole('row').nth(1)).toHaveText(/Spiral Abyss\s*33 of 36 stars\s*16 Sep to 15 Oct\s*36 stars/)
  await card.getByRole('button', { name: 'Show the chart' }).click()
  await expect(card.getByTestId('ec-abyss')).toBeVisible()
})

test('the three modes stand level: equal columns whose bodies end at the same height', async ({ page }) => {
  for (const [width, height] of [
    [1640, 1100],
    [2560, 1400],
  ]) {
    await page.setViewportSize({ width, height })
    const boxes = await Promise.all(
      ['abyss', 'theater', 'stygian'].map(async (mode) => {
        const column = page.getByTestId(`ec-${mode}`)
        await column.scrollIntoViewIfNeeded()
        return {
          column: (await column.boundingBox())!,
          band: (await column.locator('.ec-band').boundingBox())!,
          body: (await column.locator('.ec-body').boundingBox())!,
        }
      }),
    )
    for (const one of boxes) {
      expect(Math.abs(one.column.width - boxes[0].column.width), `width at ${width}`).toBeLessThan(1.5)
      expect(Math.abs(one.band.height - boxes[0].band.height), `header at ${width}`).toBeLessThan(1)
      const bottom = (box: { y: number; height: number }) => box.y + box.height
      expect(Math.abs(bottom(one.body) - bottom(boxes[0].body)), `bottom at ${width}`).toBeLessThan(1.5)
    }
  }
})

test('an art address that answers 404 leaves parchment and signs, never a broken image', async ({ page }) => {
  await changeAnswer<EndgameCardModel>(page, '/api/stats/endgame', pictured)
  await page.route('**/api/art/**', (route) => route.fulfill({ status: 404, body: 'not here' }))
  await page.reload()
  const card = page.getByRole('region', { name: 'Endgame' })
  await expect(card.getByTestId('ec-stygian')).toContainText('Difficulty 5')
  // The headers: a picture that fails is a background that draws nothing, with the veil and the parchment under it.
  await expect(card.locator('.ec-bg')).toHaveCount(3)
  await expect.poll(() => shownBroken(card), { message: 'every image that is shown has loaded' }).toEqual([])
  await expect(card.locator('.ec-medal')).toHaveCount(0) // the medal failed, so the drawn badge is there
  await expect(card.locator('.ec-badge')).toHaveCount(1)
  await expect(card.locator('.ec-ico .sign:visible')).toHaveCount(3)
  await expect(card.locator('.ec-pic .sign:visible').first()).toBeVisible()
})

test('a mode never played keeps its header, one with no tries this cycle keeps its best; none read at all says so', async ({ page }) => {
  await changeAnswer<EndgameCardModel>(page, '/api/stats/endgame', (data) => {
    // The Theater never played; the Abyss on the 16th, a new cycle with no battle in it yet.
    Object.assign(data.modes[1], { played: false, best: '', ranks: [], medals: [], medal_count: 0, act: 0, flowers: 0, seconds: 0 })
    Object.assign(data.modes[0], { played: false })
  })
  await page.reload()
  const card = page.getByRole('region', { name: 'Endgame' })
  await expect(card.getByTestId('ec-theater').locator('.ec-band')).toContainText('Imaginarium Theater')
  await expect(card.getByTestId('ec-theater').locator('.ec-body')).toHaveText('Not played yet')
  const abyss = card.getByTestId('ec-abyss').locator('.ec-body')
  await expect(abyss.locator('.ec-none')).toHaveText('No tries this cycle yet')
  await expect(abyss.locator('.ec-best')).toHaveText(/^Best \d+ stars$/)
  await expect(card.getByTestId('ec-stygian')).not.toContainText(/Not played yet|No tries/)
  await page.unroute('**/api/stats/endgame*')
  await changeAnswer<EndgameCardModel>(page, '/api/stats/endgame', (data) => {
    data.modes = []
  })
  await page.reload()
  await expect(card.getByText('No endgame results have been read yet.')).toBeVisible()
})

test('a boss row tells the whole name on hover and on keyboard focus, and nothing clips the tip', async ({ page }) => {
  const row = page.getByTestId('ec-stygian').locator('.ec-boss').first()
  await expect(row).toHaveAttribute('aria-label', /^Guardian Blade of Drifting Snow, \d+:\d\d$/)
  const tip = () => row.evaluate((element) => getComputedStyle(element, '::after').content)
  expect(await tip()).toBe('none')
  await row.hover()
  expect(await tip()).toBe('"Guardian Blade of Drifting Snow"')
  // The tip sits in its row, so no box between the row and the card may cut it.
  const clipped = await row.evaluate((element) => {
    const cut: string[] = []
    for (let one = element as HTMLElement | null; one !== null && !one.classList.contains('ec-mode'); one = one.parentElement) {
      if (getComputedStyle(one).overflow !== 'visible') cut.push(one.className)
    }
    return cut
  })
  expect(clipped).toEqual([])
  await page.mouse.move(0, 0)
  await row.focus()
  await page.keyboard.press('Shift')
  expect(await tip()).toBe('"Guardian Blade of Drifting Snow"')
})

test('the Stygian bosses are rows with no framed box, and the acts follow the season length', async ({ page }) => {
  const rows = page.getByTestId('ec-stygian').locator('.ec-boss')
  await expect(rows).toHaveCount(3)
  const looks = await rows.evaluateAll((all) => all.map((one) => getComputedStyle(one).borderLeftWidth + getComputedStyle(one).borderRadius))
  expect(looks).toEqual(['0px0px', '0px0px', '0px0px'])
  await changeAnswer<EndgameCardModel>(page, '/api/stats/endgame', (data) => {
    const theater = data.modes[1]
    if (theater.mode === 'theater') theater.medals = (theater.medals ?? []).slice(0, 8)
  })
  await page.reload()
  await expect(page.getByTestId('ec-theater').locator('.ec-act')).toHaveCount(8)
  const columns = await page.getByTestId('ec-theater').locator('.ec-acts').evaluate((one) => getComputedStyle(one).gridTemplateColumns.split(' ').length)
  expect(columns).toBe(8)
})

test('the star grid shares one column of labels', async ({ page }) => {
  const lefts = await page.getByTestId('ec-abyss').locator('.ec-stars').evaluateAll((all) => all.slice(0, 12).map((one) => Math.round(one.getBoundingClientRect().left)))
  for (let at = 0; at < 3; at += 1) expect(new Set([0, 1, 2, 3].map((floor) => lefts[floor * 3 + at])).size).toBe(1)
})

test('a season that has not started yet is dimmed with a note, and the note says when it is on', async ({ page }) => {
  await changeAnswer<EndgameCardModel>(page, '/api/stats/endgame', (data) => {
    const stygian = data.modes[2]
    if (stygian.mode !== 'stygian') return
    Object.assign(stygian, { dimmed: true, next: { name: 'Battle Amid the Great Waves', starts: '11 Nov' }, next_started: false })
  })
  await page.reload()
  const column = page.getByTestId('ec-stygian')
  await expect(column.locator('.ec-next')).toHaveText(
    'Next season Battle Amid the Great Waves opens 11 Nov. Its bosses show here after your first try.',
  )
  await expect(column.locator('.ec-bosses')).toHaveClass(/dimmed/)
  expect(await column.locator('.ec-bosses').evaluate((one) => getComputedStyle(one).opacity)).toBe('0.6')
  await page.unroute('**/api/stats/endgame*')
  await changeAnswer<EndgameCardModel>(page, '/api/stats/endgame', (data) => {
    const stygian = data.modes[2]
    if (stygian.mode !== 'stygian') return
    Object.assign(stygian, { dimmed: true, next: { name: 'Battle Amid the Great Waves', starts: '11 Nov' }, next_started: true })
  })
  await page.reload()
  await expect(column.locator('.ec-next')).toHaveText('Season Battle Amid the Great Waves is on now. Its bosses show here after your first try.')
})

test('the card plays its motion and comes to rest', async ({ page }) => {
  const card = page.getByRole('region', { name: 'Endgame' })
  await expect(card.getByTestId('ec-abyss')).toBeVisible()
  await expect.poll(() => card.evaluate((element) => element.getAnimations({ subtree: true }).length), { timeout: 8000 }).toBe(0)
})

test('under reduced motion nothing of the card moves', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  const card = page.getByRole('region', { name: 'Endgame' })
  await expect(card.getByTestId('ec-stygian')).toContainText('Difficulty 5')
  expect(await card.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
  // And everything is there at once: none of it is held at its first frame.
  const hidden = await card
    .locator('.ec-star:not(.off), .ec-act, .ec-ic, .ec-badge')
    .evaluateAll((all) => all.filter((element) => getComputedStyle(element).opacity !== '1').length)
  expect(hidden).toBe(0)
})

test('the pictures of the card show where the core has them: headers, the Stygian crop, faces and enemies', async ({ page }) => {
  await changeAnswer<EndgameCardModel>(page, '/api/stats/endgame', pictured)
  await page.route('**/api/art/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#6d8fb5"/><circle cx="90" cy="100" r="60" fill="#e9c46a"/></svg>',
    }),
  )
  await page.reload()
  const card = page.getByRole('region', { name: 'Endgame' })
  await expect(card.locator('.ec-bg')).toHaveCount(3)
  const asked = await card.locator('.ec-bg').evaluateAll((all) => all.map((one) => getComputedStyle(one).backgroundImage))
  expect(asked[1]).toContain('size=1536') // the Theater's 4K picture is asked for at 1,536 pixels
  const size = await card.locator('.ec-bg').nth(2).evaluate((one) => getComputedStyle(one).backgroundSize)
  expect(parseFloat(size)).toBeGreaterThan(190) // the Stygian banner shows its left part: about 100 / 0.48 per cent wide
  await expect(card.locator('.ec-face img:not([hidden])').first()).toBeVisible()
  const first = card.getByTestId('ec-abyss').locator('.ec-ic').first()
  await expect(first).toHaveAttribute('data-tip', /Lv\. \d+/)
  await expect.poll(() => card.evaluate((element) => element.getAnimations({ subtree: true }).length), { timeout: 8000 }).toBe(0)
  // The card as the player sees it, in the usual window and full screen on the big one (the pictures to compare by eye).
  for (const [width, height] of [
    [1640, 1100],
    [2560, 1400],
  ]) {
    await page.setViewportSize({ width, height })
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath(`endgame-page-${width}.png`) })
    await card.screenshot({ path: test.info().outputPath(`endgame-card-${width}.png`) })
  }
  await first.hover()
  await card.screenshot({ path: test.info().outputPath('endgame-card-tip.png') })
  expect(await shownBroken(card)).toEqual([])
})

test('the cards with a fixed scope do not follow the period switch', async ({ page }) => {
  await page.getByRole('radio', { name: '7 days' }).click()
  await expect(page.getByRole('region', { name: 'Chests opened per day' }).getByRole('img')).toHaveCount(7)
  const weeks = await weeksShown(page.getByRole('region', { name: 'Playtime calendar' }))
  await expect(page.getByRole('region', { name: 'Playtime calendar' }).getByRole('img')).toHaveCount(weeks * 7 - 5)
  await expect(page.getByRole('region', { name: 'Primogems by month' }).locator('.pm-cols').getByRole('img')).toHaveCount(6)
  await expect(page.getByRole('region', { name: 'Endgame' }).getByTestId('ec-abyss')).toContainText('16 Sep to 15 Oct')
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
  const card = page.getByRole('region', { name: 'Endgame' })
  await card.getByRole('button', { name: 'Show as table' }).click()
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

test("the cells of When you play reach the card's edge, are never taller than one and a half widths, shrink in a narrow window and stay inside their card", async ({ page }) => {
  const card = page.getByRole('region', { name: 'When you play' })
  const cells = card.getByRole('img')
  const box = async (locator: typeof cells) => (await locator.boundingBox())!
  await expect(cells.first()).toBeVisible()
  const first = await box(cells.first())
  expect(first.width).toBeGreaterThan(14)
  expect(first.height).toBeGreaterThanOrEqual(8)
  expect(first.height).toBeLessThanOrEqual(1.5 * first.width + 0.5)
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
  await expect.poll(async () => (await box(cells.first())).width).toBeLessThan(first.width)
  expect((await box(cells.first())).width).toBeGreaterThanOrEqual(8)
  await inside()
})

test('the hour grid fills the height its card is given, at 1640 and 1300', async ({ page }) => {
  for (const [width, height] of [[1640, 1100], [1300, 1000]]) {
    await page.setViewportSize({ width, height })
    const card = page.getByRole('region', { name: 'When you play' })
    await expect(card.locator('.wy-g i').first()).toBeVisible()
    // The grid's bottom is within one row step of the box's bottom: no blank band under it.
    await expect
      .poll(
        async () => {
          const frame = (await card.locator('.wy-box').boundingBox())!
          const cells = (await card.locator('.wy-g i').first().boundingBox())!
          const rows = await card.locator('.wy-g i').evaluateAll((all) => all.map((one) => one.getBoundingClientRect().bottom))
          return frame.y + frame.height - Math.max(...rows) < cells.height + 3 + 0.5
        },
        { message: `at ${width}` },
      )
      .toBe(true)
  }
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
  // The Endgame card lights its stars, rises its enemies, stamps its badge and glints its headers, once each.
  await expect
    .poll(async () => [...new Set((await seen()).filter((name) => name.endsWith('in Endgame')))].sort())
    .toEqual(['ec-glint in Endgame', 'ec-pop in Endgame', 'ec-rise in Endgame', 'ec-stamp in Endgame'])
  expect((await seen()).filter((name) => name === 'ec-glint in Endgame')).toHaveLength(3)
  // Everything that began ends: nothing loops.
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0)
  // Each runs once: the cells of a card come in one after another (the calendar's days, the week's 168 hours), and
  // the dots of the six regions slide out once each.
  const all = await seen()
  const days = await page.getByRole('region', { name: 'Playtime calendar' }).getByRole('img').count()
  expect(all.filter((name) => name === 'fade-in in Playtime calendar')).toHaveLength(days)
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
// have no record and are empty, never estimated. The answer is shaped here as such a core gives it, so the test does not
// hang on the demo's history: a Welkin day of 150 and days without a record before it.
test('stats shows a stacked primogem day of 150, and the days before without a record', async ({ page }) => {
  await changeAnswer<Stats>(page, '/api/stats', (data) => {
    const days = data.primogem_days
    const empty = { commissions: 0, welkin: 0, events: 0, endgame: 0, other: 0 }
    days.groups_order = ['commissions', 'welkin', 'events', 'endgame', 'other']
    days.columns.forEach((column, index) => {
      if (index < 10) {
        delete column.groups // a day of neither the game's log nor the diary's detail, as the core sends it: empty
        column.value = 0
        column.no_data = true
        column.after_gap = false
      } else if (!column.no_data) column.groups = { ...empty, commissions: Math.min(60, column.value), other: Math.max(0, column.value - 60) }
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
  await expect(card.locator('.col-bars i.nd').first()).toBeVisible()
  await expect(card.locator('.col-lg')).toContainText('No record')
  await expect(card.locator('.col-lg')).not.toContainText('estimate')
  await expect(card).toContainText('Spent primogems are not taken off here. They are on the Ledger page.')
  await card.getByRole('button', { name: 'Show as table' }).click()
  await expect(card.getByRole('columnheader')).toHaveText([
    'Day', 'Primogems', 'Daily commissions', 'Blessing of the Welkin Moon', 'Events', 'Spiral Abyss and Theater', 'Other',
    'Note',
  ])
  await expect(card.getByRole('row').last()).toHaveText(/Tue 13 Oct\s*150\s*60\s*90\s*0\s*0\s*0/)
})

test('the tabs open Months and Year, and the period switch and chip show on Overview alone', async ({ page, core }) => {
  const tabs = page.getByRole('navigation', { name: 'Stats pages' })
  await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('radio', { name: '30 days' })).toBeVisible()
  await expect(page.getByTestId('period')).toBeVisible()
  await tabs.getByRole('link', { name: 'Months' }).click()
  await expect(page).toHaveURL(`${core.origin}/#/stats/months`)
  await expect(tabs.getByRole('link', { name: 'Months' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('radio', { name: '30 days' })).toHaveCount(0)
  await expect(page.getByTestId('period')).toHaveCount(0)
  await tabs.getByRole('link', { name: 'Year' }).click()
  await expect(page).toHaveURL(`${core.origin}/#/stats/year`)
  await expect(tabs.getByRole('link', { name: 'Year' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('radio', { name: '30 days' })).toHaveCount(0)
  await tabs.getByRole('link', { name: 'Overview' }).click()
  await expect(page.getByRole('radio', { name: '30 days' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('period')).toBeVisible()
})

// ---------- The Months tab (the Months and Wrapped design, section 5) ----------

/**
 * The month's parts as the page lays them out: each part's top and bottom, the bottom of the row it sits in (the lowest
 * bottom among the parts whose tops are alike), its left and right edges and width, whether it is alone in its row, and
 * the grid's edges.
 */
type PartBox = {
  part: string
  top: number
  bottom: number
  left: number
  right: number
  width: number
  alone: boolean
  rowBottom: number
  gridLeft: number
  gridRight: number
}
async function rowsOf(page: Page): Promise<PartBox[]> {
  return page.locator('.mo-grid').evaluate((grid) => {
    const box = grid.getBoundingClientRect()
    const parts = [...grid.querySelectorAll<HTMLElement>('.mo-row > .mo-part')].map((part) => {
      const at = part.getBoundingClientRect()
      const alone = part.parentElement!.children.length === 1
      return { part: part.dataset.part ?? '', top: Math.round(at.top), bottom: at.bottom, left: at.left, right: at.right, width: at.width, alone }
    })
    return parts.map((part) => ({
      ...part,
      rowBottom: Math.max(...parts.filter((other) => Math.abs(other.top - part.top) < 4).map((other) => other.bottom)),
      gridLeft: box.left,
      gridRight: box.right,
    }))
  })
}

/** The width of two of three columns of the grid with the gap between them: the most a part alone in its row may take. */
function twoColumns(row: PartBox): number {
  return ((row.gridRight - row.gridLeft - 24) * 2) / 3 + 12
}

/** Each day cell of the month's calendar as its height over its width. */
async function cellRatios(page: Page): Promise<number[]> {
  return page.locator('.mo-cal i:not(.pad)').evaluateAll((cells) =>
    cells.map((cell) => {
      const box = cell.getBoundingClientRect()
      return box.height / box.width
    }),
  )
}

test('the Months tab shows a month: five tiles, records, the calendar and where the primogems came from', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats/months/2026-10`)
  for (const id of ['time', 'days', 'primogems', 'wishes', 'achievements']) await expect(page.getByTestId(`month-tile-${id}`)).toBeVisible()
  await expect(page.locator('[data-testid^="month-tile-"]')).toHaveCount(5)
  await expect(page.getByTestId('month-tile-time')).toContainText('14 h 44 min')
  await expect(page.getByTestId('month-tile-time')).toContainText('▲ 1 h 44 min vs 1–13 Sep')
  await expect(page.getByTestId('month-tile-days')).toContainText('11 of 13')
  await expect(page.getByTestId('month-tile-days')).toContainText('No change vs 1–13 Sep')
  await expect(page.getByTestId('month-tile-primogems')).toContainText('▲ 171 vs 1–13 Sep')
  await expect(page.getByTestId('month-records')).toContainText('Longest session')
  await expect(page.getByTestId('record-best_primogem_day')).toContainText('960 · 2 Oct')
  await expect(page.getByTestId('month-calendar').locator('[role="img"]')).toHaveCount(13)
  await expect(page.getByTestId('month-flow')).toContainText('Spiral Abyss and Theater')
  await expect(page.getByTestId('month-flow')).toContainText('Revitalized Petrified Tree (Domain)')
  const strip = page.getByTestId('month-strip')
  await expect(strip.getByRole('link', { name: 'Oct 2026 so far' })).toHaveAttribute('aria-current', 'page')
  await expect(strip.getByRole('link', { name: 'Feb 2026, little data' })).toBeVisible()
})

test('choosing a month in the strip opens it at its own address', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats/months`)
  await expect(page.getByTestId('month-strip').getByRole('link', { name: 'Oct 2026 so far' })).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('month-strip').getByRole('link', { name: 'Aug 2026' }).click()
  await expect(page).toHaveURL(`${core.origin}/#/stats/months/2026-08`)
  await expect(page.getByTestId('month-strip').getByRole('link', { name: 'Aug 2026' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('month-tile-days')).toContainText('28 of 31')
  await expect(page.getByTestId('month-endgame')).toContainText('34 of 36 stars')
  await expect(page.getByTestId('month-pulls')).toContainText('Wolf')
  await expect(page.getByTestId('record-luckiest')).toContainText('76 pulls · 15 Aug')
  await expect(page.getByText('Endgame cycles count in the month they end. The first one kept ran from 16 Jul to 15 Aug 2026.')).toBeVisible()
})

/**
 * What is blank inside the month's cards and tiles, in words, one for each fault. A card's own box stretches to the row it
 * sits in, so the gap is measured inside it: from the bottom of its last row (a record, a bar, a 5-star, the calendar's
 * legend) to the bottom of the card without its padding, and, for a card of bar lists, from the right edge of its last
 * list to the card's. No row grows past a size at which it would read as a gap between rows. A tile's last line is
 * measured the same way.
 */
async function blanksOf(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const faults: string[] = []
    const inner = (element: Element) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        bottom: box.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth),
        right: box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth),
      }
    }
    const lowest = (elements: Element[]) => Math.max(...elements.map((element) => element.getBoundingClientRect().bottom))
    for (const card of document.querySelectorAll<HTMLElement>('.mo-part > *')) {
      const name = card.closest<HTMLElement>('.mo-part')!.dataset.part
      const edge = inner(card)
      const rows = [...card.querySelectorAll('.mo-rec, .hb, .mo-five, .hm-lg, .mo-cal')]
      const under = edge.bottom - lowest(rows)
      if (under > 12) faults.push(`${name}: ${Math.round(under)} px blank under its last row`)
      for (const list of card.querySelectorAll('.mo-list')) {
        // A list with another under it (one column) is not the card's last: only the lists that end the card are measured.
        const own = [...list.querySelectorAll('.hb, .mo-five')]
        const gap = edge.bottom - lowest(own)
        if (list.getBoundingClientRect().bottom >= edge.bottom - 2 && gap > 12) faults.push(`${name}: a list has ${Math.round(gap)} px blank under it`)
        // Its longest bar reaches the end of its row (the number after it takes up to 56 px of the end).
        const rowsOfBars = [...list.querySelectorAll('.hb')]
        if (rowsOfBars.length > 0) {
          const short = Math.min(...rowsOfBars.map((row) => row.getBoundingClientRect().right - row.querySelector('.b b')!.getBoundingClientRect().right))
          if (short > 60) faults.push(`${name}: the bars stop ${Math.round(short)} px short of the right edge`)
        }
      }
      // The rows themselves, not the boxes that hold them, reach the card's right edge: a list of three bars in a wide card
      // spreads over the card instead of standing in its left part.
      const listed = [...card.querySelectorAll('.hb, .mo-five, .mo-rec')]
      if (listed.length > 0) {
        const short = edge.right - Math.max(...listed.map((row) => row.getBoundingClientRect().right))
        if (short > 12) faults.push(`${name}: its rows end ${Math.round(short)} px short of the card's right edge`)
      }
      const lists = [...card.querySelectorAll('.mo-list')]
      if (lists.length > 0) {
        const side = edge.right - Math.max(...lists.map((list) => list.getBoundingClientRect().right))
        if (side > 12) faults.push(`${name}: ${Math.round(side)} px blank at the right of its lists`)
      }
      for (const row of card.querySelectorAll<HTMLElement>('.mo-rec, .mo-five')) {
        if (row.getBoundingClientRect().height > 76) faults.push(`${name}: a row is ${Math.round(row.getBoundingClientRect().height)} px tall`)
      }
      for (const row of card.querySelectorAll<HTMLElement>('.hb')) {
        if (row.getBoundingClientRect().height > 48) faults.push(`${name}: a bar row is ${Math.round(row.getBoundingClientRect().height)} px tall`)
      }
    }
    for (const tile of document.querySelectorAll<HTMLElement>('.mo-tiles > .st')) {
      const last = [...tile.children].at(-1)!
      const under = inner(tile).bottom - last.getBoundingClientRect().bottom
      if (under > 12) faults.push(`${tile.dataset.testid}: ${Math.round(under)} px blank under its last line`)
    }
    return faults
  })
}

/** Every month of the demo: two thin ones before tracking (January with its wishes alone, February with one 5★), then full ones. */
const DEMO_MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']

for (const [width, height] of [[1640, 1100], [2560, 1400]] as const) {
  for (const ym of DEMO_MONTHS) {
    test(`the parts of ${ym} leave no gap at ${width} wide`, async ({ page, core }) => {
      await page.setViewportSize({ width, height })
      await page.goto(`${core.origin}/#/stats/months/${ym}`)
      await expect(page.getByTestId('month-strip').locator('[aria-current="page"]')).toBeVisible()
      await expect(page.locator('.mo-part').first()).toBeVisible()
      await page.waitForTimeout(600) // the bars and cells have appeared
      const rows = await rowsOf(page)
      expect(rows.length).toBeGreaterThan(0)
      // No part ends more than 12 pixels above the bottom of its row, and every row of two parts or more reaches the right
      // edge of the grid.
      for (const row of rows) expect(row.rowBottom - row.bottom, `${row.part} bottom`).toBeLessThanOrEqual(12)
      const reach = new Map<number, number>()
      for (const row of rows.filter((one) => !one.alone)) reach.set(row.top, Math.max(reach.get(row.top) ?? 0, row.right))
      for (const right of reach.values()) expect(rows[0].gridRight - right).toBeLessThanOrEqual(2)
      // A part alone in its row (or in its month) stands at the left at a card's width, two columns of three at most: never
      // across the whole page.
      for (const row of rows.filter((one) => one.alone)) {
        expect(Math.abs(row.left - row.gridLeft), `${row.part} left`).toBeLessThanOrEqual(1)
        expect(row.width, `${row.part} width`).toBeLessThanOrEqual(twoColumns(row) + 1)
      }
      // The calendar keeps real cells: each day as tall as wide, within a quarter or a third either way.
      const ratios = await cellRatios(page)
      if (ym >= '2026-03') expect(ratios.length).toBeGreaterThan(0)
      for (const ratio of ratios) {
        expect(ratio, 'a day cell, height over width').toBeGreaterThanOrEqual(0.75)
        expect(ratio, 'a day cell, height over width').toBeLessThanOrEqual(1.33)
      }
      // Nothing is blank inside a card or a tile, and nothing is cut off: no card's content runs past its card.
      expect(await blanksOf(page)).toEqual([])
      const cut = await page.locator('.mo-part > *').evaluateAll(
        (cards) => cards.filter((card) => card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1).length,
      )
      expect(cut).toBe(0)
    })
  }
}

test('a thin month has fewer parts than a full one, and the rest close up', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats/months/2026-08`)
  await expect(page.locator('.mo-part')).toHaveCount(5)
  // February is known by its primogems and its wishes alone (the diary reaches back three months, an earlier import kept the
  // wishes), with one 5★: two tiles, its one record beside the Pulls, notes.
  await page.goto(`${core.origin}/#/stats/months/2026-02`)
  await expect(page.getByTestId('month-tile-primogems')).toBeVisible()
  await expect(page.locator('[data-testid^="month-tile-"]')).toHaveCount(2)
  await expect(page.getByTestId('month-pulls')).toContainText('Jean')
  await expect(page.getByTestId('record-luckiest')).toContainText('Jean · 58 pulls · 12 Feb')
  await expect(page.locator('.mo-part')).toHaveCount(2)
  await expect(page.locator('.mo-row')).toHaveCount(1)
  await expect(page.getByTestId('month-flow')).toHaveCount(0)
  await expect(page.getByTestId('month-calendar')).toHaveCount(0)
})

for (const [width, height] of [[1640, 1100], [2560, 1400]] as const) {
  test(`a part alone in its month keeps a card's width at ${width} wide`, async ({ page, core }) => {
    // January has its wishes alone: the Pulls card, at the left, one column of three wide as it is in a full month.
    await page.setViewportSize({ width, height })
    await page.goto(`${core.origin}/#/stats/months/2026-01`)
    await expect(page.getByTestId('month-pulls')).toBeVisible()
    const [pulls] = await rowsOf(page)
    expect(pulls.alone).toBe(true)
    expect(Math.abs(pulls.left - pulls.gridLeft)).toBeLessThanOrEqual(1)
    expect(pulls.width).toBeLessThanOrEqual((pulls.gridRight - pulls.gridLeft - 24) / 3 + 1)
    const bar = await page.getByTestId('month-pulls').locator('.hb .b').first().evaluate((one) => one.getBoundingClientRect().width)
    expect(bar).toBeLessThan(500)
  })
}

test('the strip opens scrolled to the chosen month when there are more months than it can show', async ({ page, core }) => {
  await changeAnswer<{ months: { ym: string; label: string; year: number; thin: boolean; current: boolean }[] }>(
    page,
    '/api/stats/month',
    (data) => {
      const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      data.months = []
      for (let at = 0; at < 60; at += 1) {
        const total = 2021 * 12 + 10 + at // from Nov 2021 to Oct 2026
        const year = Math.floor(total / 12)
        const month = total % 12
        const ym = `${year}-${String(month + 1).padStart(2, '0')}`
        data.months.push({ ym, label: names[month], year, thin: at < 40, current: at === 59 })
      }
    },
  )
  await page.setViewportSize({ width: 1200, height: 900 })
  await page.goto(`${core.origin}/#/stats/months/2026-10`)
  const strip = page.getByTestId('month-strip')
  await expect(strip.locator('[aria-current="page"]')).toBeVisible()
  expect(await strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(300)
  const inside = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="month-strip"]')!.getBoundingClientRect()
    const on = document.querySelector('[data-testid="month-strip"] [aria-current="page"]')!.getBoundingClientRect()
    return on.left >= box.left - 1 && on.right <= box.right + 1
  })
  expect(inside).toBe(true)
})

// ---------- The Year tab (the Months and Wrapped design, section 6) ----------

type YearAnswerOf = {
  years: number[]
  current_year: number
  year: {
    year: number
    so_far: boolean
    hero: { character: { name: string; picture: string | null } | null }
    cards: { faces: string[]; kind: string }[]
    poster: { character: { name: string; picture: string | null } | null }
  } | null
}

test('the Year tab shows the hero, the cards and the two Save buttons', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats/year`)
  await expect(page.getByTestId('year-hero')).toBeVisible()
  await expect(page.getByTestId('year-hero').getByRole('heading')).toHaveText(/^2026\s*so far$/)
  await expect(page.getByTestId('year-line')).not.toHaveText('')
  await expect(page.getByTestId('year-counter')).toHaveCount(3)
  expect(await page.getByTestId('year-card').count()).toBeGreaterThanOrEqual(3)
  await expect(page.getByTestId('year-save-story')).toHaveText('Save as picture · Story')
  await expect(page.getByTestId('year-save-wide')).toHaveText('Save as picture · Wide')
  // One year only: no switch.
  await expect(page.getByTestId('year-switch')).toHaveCount(0)
})

test('the year switch shows for more than one year and its choice is in the address', async ({ page, core }) => {
  await changeAnswer<YearAnswerOf>(page, '/api/stats/year', (data) => {
    data.years = [2025, 2026]
  })
  await page.goto(`${core.origin}/#/stats/year`)
  const switchBox = page.getByTestId('year-switch')
  await expect(switchBox.getByRole('link')).toHaveText(['2025', '2026 so far'])
  await expect(switchBox.getByRole('link', { name: '2026 so far' })).toHaveAttribute('aria-current', 'page')
  await switchBox.getByRole('link', { name: '2025' }).click()
  await expect(page).toHaveURL(`${core.origin}/#/stats/year/2025`)
})

test('a chosen year is asked for, from the address and from the switch, and its hero shows', async ({ page, core }) => {
  const asked: string[] = []
  await page.route('**/api/stats/year*', async (route) => {
    const response = await route.fetch()
    const data = (await response.json()) as YearAnswerOf & { year: { hero: { line: string } } }
    const year = new URL(route.request().url()).searchParams.get('year')
    asked.push(year ?? '')
    data.years = [2025, 2026]
    if (year !== null) {
      data.year.year = Number(year)
      data.year.so_far = Number(year) === data.current_year
      data.year.hero.line = `The line of ${year}.`
    }
    await route.fulfill({ response, json: data })
  })
  await page.goto(`${core.origin}/#/stats/year/2025`)
  await expect(page.getByTestId('year-line')).toHaveText('The line of 2025.')
  await expect(page.getByTestId('year-hero').getByRole('heading')).toHaveText('2025')
  expect(asked).toContain('2025')
  const switchBox = page.getByTestId('year-switch')
  await expect(switchBox.getByRole('link', { name: '2025' })).toHaveAttribute('aria-current', 'page')
  await switchBox.getByRole('link', { name: '2026 so far' }).click()
  await expect(page).toHaveURL(`${core.origin}/#/stats/year/2026`)
  await expect(page.getByTestId('year-line')).toHaveText('The line of 2026.')
  await expect(page.getByTestId('year-hero').getByRole('heading')).toHaveText(/^2026\s*so far$/)
  expect(asked).toContain('2026')
})

test('a read that changes a counter counts on from the number shown, never from nothing again', async ({ page, core, api }) => {
  let more = 0
  await page.route('**/api/stats/year*', async (route) => {
    const response = await route.fetch()
    const data = (await response.json()) as YearAnswer
    for (const counter of data.year?.hero.counters ?? []) counter.value += more
    await route.fulfill({ response, json: data })
  })
  await page.goto(`${core.origin}/#/stats/year`)
  const shown = page.getByTestId('year-counter').first().locator('b')
  const value = page.getByTestId('year-counter').first().locator('.sr-only')
  await expect.poll(async () => (await shown.textContent()) === (await value.textContent())?.trim(), { timeout: 8000 }).toBe(true)
  const before = Number((await shown.textContent())?.replace(/,/g, ''))
  expect(before).toBeGreaterThan(0)
  // Every number the counter shows from now on is kept.
  await shown.evaluate((element) => {
    const seen: string[] = ((window as unknown as { seen: string[] }).seen = [])
    new MutationObserver(() => seen.push(element.textContent ?? '')).observe(element, { childList: true, characterData: true, subtree: true })
  })
  more = 97
  await api.put('/api/settings', { risk_acknowledged: true }) // the core tells the pages of a change, and they read again
  const after = (before + 97).toLocaleString('en-US')
  await expect(value).toHaveText(after) // read again
  await expect(shown).toHaveText(after, { timeout: 8000 })
  const seen = (await page.evaluate(() => (window as unknown as { seen: string[] }).seen)).map((text) => Number(text.replace(/,/g, '')))
  expect(seen.length).toBeGreaterThan(0)
  expect(Math.min(...seen), `the numbers shown: ${seen.join(', ')}`).toBeGreaterThanOrEqual(before)
})

test('a picture that cannot be had leaves a sign, never a broken image', async ({ page, core }) => {
  await changeAnswer<YearAnswerOf>(page, '/api/stats/year', (data) => {
    const at = `/api/art/${'0'.repeat(32)}`
    data.year!.hero.character = { name: data.year!.hero.character?.name ?? 'Sandrone', picture: at }
    for (const card of data.year!.cards) card.faces = [at, '/api/icon/nothing-here.png']
  })
  await page.goto(`${core.origin}/#/stats/year`)
  await expect(page.getByTestId('year-card').first()).toBeVisible()
  await page.waitForTimeout(800) // the pictures have been asked for and have failed
  expect(await shownBroken(page.getByTestId('year-stage'))).toEqual([])
  await expect(page.getByTestId('year-portrait').locator('.sign')).toBeVisible()
  await expect(page.getByTestId('year-card').first().locator('.yr-face .sign').first()).toBeVisible()
})

test('the dust and the animations run while the tab is open and stop when the document is hidden', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats/year`)
  const dust = page.getByTestId('year-dust')
  await expect(dust).toHaveAttribute('data-running', 'true')
  const running = () =>
    page.getByTestId('year-stage').evaluate((stage) => stage.getAnimations({ subtree: true }).filter((one) => one.playState === 'running').length)
  expect(await running()).toBeGreaterThan(3)
  const hide = (hidden: boolean) =>
    page.evaluate((value) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => value })
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (value ? 'hidden' : 'visible') })
      document.dispatchEvent(new Event('visibilitychange'))
    }, hidden)
  await hide(true)
  await expect(dust).toHaveAttribute('data-running', 'false')
  await expect(page.getByTestId('year-stage')).toHaveAttribute('data-paused', '')
  expect(await running()).toBe(0)
  await hide(false)
  await expect(dust).toHaveAttribute('data-running', 'true')
  await expect(page.getByTestId('year-stage')).not.toHaveAttribute('data-paused', '')
  expect(await running()).toBeGreaterThan(3)
  // Leaving the tab ends the dust for good.
  await page.getByRole('navigation', { name: 'Stats pages' }).getByRole('link', { name: 'Overview' }).click()
  await expect(page.getByTestId('year-stage')).toHaveCount(0)
})

test('with reduce motion on nothing moves and everything shows at once', async ({ page, core }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${core.origin}/#/stats/year`)
  const stage = page.getByTestId('year-stage')
  await expect(stage).toBeVisible()
  await page.waitForTimeout(400) // the page's own fade-in has ended
  expect(await stage.evaluate((element) => element.getAnimations({ subtree: true }).filter((one) => one.playState === 'running').length)).toBe(0)
  await expect(page.getByTestId('year-dust')).toHaveAttribute('data-running', 'false')
  // Every card shows, even those below the fold, and the counters hold their numbers.
  const dim = await page.getByTestId('year-card').evaluateAll((cards) => cards.filter((card) => getComputedStyle(card).opacity !== '1').length)
  expect(dim).toBe(0)
  const counters = await page.getByTestId('year-counter').locator('b').allTextContents()
  expect(counters.every((text) => text !== '0')).toBe(true)
})

// ---------- The Wrapped picture (the Months and Wrapped design, 6.4)

/** A PNG's width and height, as its header gives them; null for bytes that are no PNG. */
function pngSize(bytes: Buffer): [number, number] | null {
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}

test('with no window, each Save button downloads the poster as a PNG of its size, named for the year', async ({ page, core }) => {
  // The browser tests' core has no window (--no-shell): it answers 409, and the page downloads the picture itself.
  await page.goto(`${core.origin}/#/stats/year`)
  for (const [button, name, size] of [
    ['year-save-story', 'Guild Board Wrapped 2026 Story.png', [1080, 1920]],
    ['year-save-wide', 'Guild Board Wrapped 2026 Wide.png', [2560, 1440]],
  ] as const) {
    const coming = page.waitForEvent('download')
    await page.getByTestId(button).click()
    const download = await coming
    expect(download.suggestedFilename()).toBe(name)
    expect(pngSize(readFileSync(await download.path()))).toEqual(size)
  }
  await expect(page.getByTestId('year-save-note')).toHaveText('')
})

test('with a window, the PNG goes to the core under its name and the page says where to choose the place', async ({ page, core }) => {
  const sent: { type: string | null; name: string | null; size: [number, number] | null }[] = []
  await page.route('**/api/stats/year/picture*', async (route) => {
    const request = route.request()
    sent.push({
      type: await request.headerValue('content-type'),
      name: new URL(request.url()).searchParams.get('name'),
      size: pngSize(request.postDataBuffer() ?? Buffer.alloc(0)),
    })
    await route.fulfill({ json: { opened: true } })
  })
  let downloads = 0
  page.on('download', () => {
    downloads += 1
  })
  await page.goto(`${core.origin}/#/stats/year`)
  await page.getByTestId('year-save-wide').click()
  await expect(page.getByTestId('year-save-note')).toHaveText('Choose where to save the picture in the Guild Board window.')
  expect(sent).toEqual([{ type: 'image/png', name: 'Guild Board Wrapped 2026 Wide.png', size: [2560, 1440] }])
  expect(downloads).toBe(0)
})

test('a picture the core refuses says why, and nothing downloads', async ({ page, core }) => {
  await page.route('**/api/stats/year/picture*', (route) => route.fulfill({ status: 413, json: { error: 'This picture is too large to save.' } }))
  let downloads = 0
  page.on('download', () => {
    downloads += 1
  })
  await page.goto(`${core.origin}/#/stats/year`)
  await page.getByTestId('year-save-story').click()
  await expect(page.getByTestId('year-save-note')).toHaveText('This picture is too large to save.')
  expect(downloads).toBe(0)
})

test('the poster draws the character of the year from the art cache, and the sign where the picture cannot be had', async ({ page, core }) => {
  const art = `/api/art/${'0'.repeat(32)}`
  await changeAnswer<YearAnswerOf>(page, '/api/stats/year', (data) => {
    data.year!.poster.character = { name: 'Sandrone', picture: art }
  })
  const asked: string[] = []
  let shown = true
  const tall = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAIAAAAW4yFwAAAAEElEQVR4nGP4z8DAwMAAAAQAAf/qPnqGAAAAAElFTkSuQmCC'
  await page.route('**/api/art/**', (route) => {
    asked.push(new URL(route.request().url()).pathname)
    return shown
      ? route.fulfill({ contentType: 'image/png', body: Buffer.from(tall, 'base64') })
      : route.fulfill({ status: 404, body: 'not here' })
  })
  await page.goto(`${core.origin}/#/stats/year`)
  const saved = async (): Promise<Buffer> => {
    const coming = page.waitForEvent('download')
    await page.getByTestId('year-save-story').click()
    return readFileSync(await (await coming).path())
  }
  // Drawn from the core's own address, so the canvas is not tainted and the PNG is made.
  const withPicture = await saved()
  expect(pngSize(withPicture)).toEqual([1080, 1920])
  expect(asked).toEqual([art])
  shown = false
  await page.reload() // a page keeps a picture it has had: a new one asks again
  const withSign = await saved()
  expect(asked).toEqual([art, art])
  expect(pngSize(withSign)).toEqual([1080, 1920])
  expect(withSign.equals(withPicture)).toBe(false)
  await expect(page.getByTestId('year-save-note')).toHaveText('')
})

test('the numbers count up as they come into view and end on their value', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats/year`)
  const first = page.getByTestId('year-counter').first()
  const value = (await first.locator('.sr-only').textContent())!.trim()
  await expect(first.locator('b')).toHaveText(value, { timeout: 4000 })
})

for (const [width, height] of [[1640, 1100], [2560, 1400]] as const) {
  test(`the cards of the Year tab leave no gap at ${width} wide`, async ({ page, core }) => {
    await page.setViewportSize({ width, height })
    await page.goto(`${core.origin}/#/stats/year`)
    await expect(page.getByTestId('year-card').first()).toBeVisible()
    await page.waitForTimeout(1500)
    const faults = await page.getByTestId('year-cards').evaluate((grid) => {
      const faults: string[] = []
      const box = grid.getBoundingClientRect()
      const cards = [...grid.children] as HTMLElement[]
      const rows = new Map<number, HTMLElement[]>()
      for (const card of cards) {
        const top = Math.round(card.getBoundingClientRect().top)
        const key = [...rows.keys()].find((other) => Math.abs(other - top) < 4) ?? top
        rows.set(key, [...(rows.get(key) ?? []), card])
      }
      for (const [, row] of rows) {
        const right = Math.max(...row.map((card) => card.getBoundingClientRect().right))
        if (box.right - right > 2) faults.push(`a row stops ${Math.round(box.right - right)} px short of the right edge of the grid`)
        const left = Math.min(...row.map((card) => card.getBoundingClientRect().left))
        if (left - box.left > 2) faults.push('a row starts after the left edge of the grid')
        const placed = row.slice().sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
        for (let at = 1; at < placed.length; at += 1) {
          const between = placed[at].getBoundingClientRect().left - placed[at - 1].getBoundingClientRect().right
          if (between > 14) faults.push(`${Math.round(between)} px between two cards of a row`)
        }
        if (row.length === 1 && cards.length > 1) faults.push(`the card ${row[0].dataset.kind} stands alone in its row`)
      }
      // Nothing is blank at the foot of a card or around its words, and nothing runs past its card.
      for (const card of cards) {
        const style = getComputedStyle(card)
        const inner = card.getBoundingClientRect().bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth)
        const lowest = Math.max(...[...card.children].map((child) => child.getBoundingClientRect().bottom))
        if (inner - lowest > 14) faults.push(`${card.dataset.kind}: ${Math.round(inner - lowest)} px blank at its foot`)
        const main = card.querySelector('.yr-main')!.getBoundingClientRect()
        const text = [...card.querySelectorAll('.yr-big, .yr-say')].map((one) => one.getBoundingClientRect())
        const free = main.height - (Math.max(...text.map((rect) => rect.bottom)) - Math.min(...text.map((rect) => rect.top)))
        if (free > 40) faults.push(`${card.dataset.kind}: ${Math.round(free)} px blank around its words`)
        if (card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1) faults.push(`${card.dataset.kind}: its content runs past it`)
      }
      return faults
    })
    expect(faults).toEqual([])
    // Nothing in the tab can be scrolled but the page: the night does not slide off its cards when one is brought into view.
    const scrolled = await page.getByTestId('year-stage').evaluate((stage) => {
      for (const card of stage.querySelectorAll('.yr-card')) card.scrollIntoView()
      stage.querySelector('.yr-save')!.scrollIntoView()
      return [stage.scrollTop, ...[...stage.querySelectorAll<HTMLElement>('.yr-hero, .yr-card')].map((one) => one.scrollTop)].filter((top) => top !== 0)
    })
    expect(scrolled).toEqual([])
  })
}

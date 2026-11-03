import type { Locator, Page } from '@playwright/test'
import type { CompareModel, YourProfile } from '../src/onlinetypes.ts'
import { changeAnswer } from './answers.ts'
import { expect, test } from './fixtures.ts'

/*
 * Compare (the online plan, Task B8; the online design, section 9, mockup 3). The demo's player and Riley#7687 share Primogems,
 * Play time, Achievements, Endgame and Account: the player leads in eight rows, Riley in three, and two are tied. Wishes and
 * Spending are not Riley's to show, and Kira#0412 shares only Achievements and Play time.
 */

const RILEY = '00000000-0000-4000-8000-000000007687'
const KIRA = '00000000-0000-4000-8000-000000000412'
const MILO = '00000000-0000-4000-8000-000000003391'

const group = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true })
const rowOf = (page: Page, id: string) => page.getByTestId(`row-${id}`)
const chart = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true })

async function verdicts(page: Page, ids: string[]): Promise<(string | null)[]> {
  return Promise.all(ids.map((id) => rowOf(page, id).locator('.cmp-who').textContent()))
}

test.describe('with Riley', () => {
  test.beforeEach(async ({ page, core }) => {
    await page.goto(`${core.origin}/#/friends/${RILEY}/compare`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('You and Riley')
    await expect(page.getByTestId('compare-score')).toBeVisible()
  })

  test('has the two of you at the head with the score between, and a link back', async ({ page }) => {
    await expect(page.getByTestId('compare-me-status')).toHaveText('Not in game')
    await expect(page.getByTestId('compare-friend-status')).toHaveText(/^In game for 4\d min$/)
    await expect(page.getByTestId('compare-score')).toContainText('8 – 3')
    await expect(page.getByTestId('compare-score')).toContainText('stats where each of you leads, 2 tied')
    await expect(page.getByRole('link', { name: 'Back to Friends' })).toHaveAttribute('href', '#/friends')
    await expect(page.getByRole('link', { name: 'Friends', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText('AR 58', { exact: true })).toBeVisible()
  })

  test('has a panel for each group both of you share, with its rows', async ({ page }) => {
    const titles = await page.locator('.cmp-groups > section').evaluateAll((panels) => panels.map((panel) => panel.getAttribute('aria-label')))
    expect(titles).toEqual(['Primogems', 'Play time', 'Endgame', 'Account', 'Achievements'])
    await expect(group(page, 'Primogems').getByRole('row')).toHaveCount(4) // the heads and three rows
    await expect(rowOf(page, 'primogems.now')).toContainText('Now')
    await expect(rowOf(page, 'primogems.this-month')).toContainText('Earned in October')
    await expect(rowOf(page, 'primogems.last-month')).toContainText('Earned in September')
    await expect(rowOf(page, 'endgame.theater')).toContainText('Imaginarium Theater')
    await expect(rowOf(page, 'account.chests')).toContainText('Chests opened')
  })

  test('says in each row who leads and by how much', async ({ page }) => {
    expect(
      await verdicts(page, [
        'primogems.now', 'primogems.this-month', 'primogems.last-month', 'playtime.week', 'playtime.days30', 'playtime.run',
        'endgame.abyss', 'endgame.theater', 'endgame.stygian', 'account.days', 'account.characters', 'account.chests', 'achievements.ticked',
      ]),
    ).toEqual([
      'You +1,720', 'You +1,720', 'Riley +500', 'Riley +3 h', 'You +3.5 h', 'You +3',
      'Tied', 'You +2 acts', 'Riley +1', 'You +22', 'You +6', 'You +71', 'Tied',
    ])
  })

  test('shows both values, the leader\'s in bold, and the player\'s on the left', async ({ page }) => {
    const now = rowOf(page, 'primogems.now')
    await expect(now.locator('.cmp-a')).toHaveText('16,040')
    await expect(now.locator('.cmp-b')).toHaveText('14,320')
    const weight = (cell: Locator) => cell.evaluate((element) => Number(getComputedStyle(element).fontWeight))
    expect(await weight(now.locator('.cmp-a'))).toBeGreaterThanOrEqual(700)
    expect(await weight(now.locator('.cmp-b'))).toBeLessThan(700)
    const week = rowOf(page, 'playtime.week')
    await expect(week.locator('.cmp-a')).toHaveText('18 h')
    expect(await weight(week.locator('.cmp-b'))).toBeGreaterThanOrEqual(700)
    await expect(rowOf(page, 'endgame.theater').locator('.cmp-a')).toHaveText('Act 10')
    // A tie has no bold side.
    const tied = rowOf(page, 'endgame.abyss')
    expect(await weight(tied.locator('.cmp-a'))).toBeLessThan(700)
    expect(await weight(tied.locator('.cmp-b'))).toBeLessThan(700)
  })

  test('the heads stand over their columns: You over the player\'s figures, and the friend over theirs', async ({ page }) => {
    const panel = group(page, 'Primogems')
    const [you, them] = await Promise.all([panel.locator('.cmp-row.head .cmp-a').boundingBox(), panel.locator('.cmp-row.head .cmp-b').boundingBox()])
    const row = rowOf(page, 'primogems.now')
    const [mine, theirs] = await Promise.all([row.locator('.cmp-a').boundingBox(), row.locator('.cmp-b').boundingBox()])
    expect(you?.x).toBe(mine?.x)
    expect(you?.width).toBe(mine?.width)
    expect(them?.x).toBe(theirs?.x)
  })

  test('splits one bar in proportion, in the player\'s gold and the friend\'s blue, with a mark at the middle', async ({ page }) => {
    const parts = async (id: string) =>
      rowOf(page, id).locator('.cmp-split').evaluate((split) => {
        const [mine, theirs] = [...split.querySelectorAll('i')].map((part) => (part as HTMLElement).style.width)
        const colours = [...split.querySelectorAll('i')].map((part) => getComputedStyle(part).backgroundColor)
        return { mine, theirs, colours, mark: getComputedStyle(split, '::after').content }
      })
    const now = await parts('primogems.now')
    expect(parseFloat(now.mine)).toBeCloseTo(52.8, 1)
    expect(parseFloat(now.theirs)).toBeCloseTo(47.2, 1)
    expect(now.colours[0]).not.toBe(now.colours[1])
    expect(now.mark).not.toBe('none')
    const tied = await parts('endgame.abyss')
    expect(parseFloat(tied.mine)).toBe(50)
    expect(parseFloat(tied.theirs)).toBe(50)
  })

  test('has the two charts, each with grouped columns, an axis with numbers, and a legend', async ({ page }) => {
    const weeks = chart(page, 'Play time each week')
    await expect(weeks).toContainText('Hours in game, last 6 weeks')
    await expect(weeks.locator('.cmp-col')).toHaveCount(6)
    await expect(weeks.locator('.cmp-col').first().locator('i')).toHaveCount(2)
    await expect(weeks.locator('.cmp-legend')).toHaveText('YouRiley')
    await expect(weeks.locator('.cmp-y span').first()).toHaveText('0')
    expect(await weeks.locator('.cmp-y span').count()).toBeGreaterThanOrEqual(3)
    await expect(weeks.locator('.cmp-x')).toHaveText('7 Sep14 Sep21 Sep28 Sep5 Oct12 Oct')
    const months = chart(page, 'Primogems earned each month')
    await expect(months.locator('.cmp-col')).toHaveCount(5)
    await expect(months.locator('.cmp-x')).toHaveText('JunJulAugSepOct')
  })

  test('a week\'s tooltip names the week and says each side\'s hours', async ({ page }) => {
    const weeks = chart(page, 'Play time each week')
    const last = weeks.locator('.cmp-col').last()
    const tip = last.locator('.cmp-tip')
    await expect(tip).toBeHidden()
    await last.hover()
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('Week of 12 Oct')
    await expect(tip).toContainText('You18 h')
    await expect(tip).toContainText('Riley21 h')
  })

  test('a column can be reached with the keyboard, and shows its tooltip there too', async ({ page }) => {
    const months = chart(page, 'Primogems earned each month')
    const first = months.locator('.cmp-col').first()
    await first.focus()
    await expect(first.locator('.cmp-tip')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(months.locator('.cmp-col').nth(1)).toBeFocused()
    await expect(months.locator('.cmp-col').nth(1).locator('.cmp-tip')).toContainText('July 2026')
  })

  test('Show as table gives the same data in a table, and Show the chart brings the columns back', async ({ page }) => {
    const weeks = chart(page, 'Play time each week')
    await weeks.getByRole('button', { name: 'Show as table' }).click()
    const table = weeks.getByRole('table')
    await expect(table.getByRole('columnheader')).toHaveText(['Week', 'You', 'Riley'])
    await expect(table.getByRole('row')).toHaveCount(7)
    await expect(table.getByRole('row').last()).toContainText('Week of 12 Oct')
    await expect(table.getByRole('row').last()).toContainText('18 h')
    await expect(table.getByRole('row').last()).toContainText('21 h')
    await expect(weeks.locator('.cmp-col')).toHaveCount(0)
    await weeks.getByRole('button', { name: 'Show the chart' }).click()
    await expect(weeks.locator('.cmp-col')).toHaveCount(6)
    const months = chart(page, 'Primogems earned each month')
    await months.getByRole('button', { name: 'Show as table' }).click()
    await expect(months.getByRole('table').getByRole('row').last()).toContainText('October 2026')
    await expect(months.getByRole('table').getByRole('row').last()).toContainText('9,880')
  })

  test('ends with the line that says only shared stats show, and links to Your profile', async ({ page }) => {
    const note = page.getByTestId('compare-note')
    await expect(note).toHaveText('You see only the stats you both share. To see more, share more on Your profile.')
    await note.getByRole('link', { name: 'Your profile' }).click()
    await expect(page).toHaveURL(/#\/friends\/me$/)
  })

  test('a stat that only one of you shares is not here', async ({ page, api }) => {
    await expect(group(page, 'Wishes')).toHaveCount(0)
    const profile = (await api.get('/api/profile')) as YourProfile
    await api.put('/api/profile/sharing', { keys: [...profile.sharing, 'wishes', 'spending'] })
    await page.reload()
    await expect(page.getByTestId('compare-score')).toBeVisible()
    await expect(group(page, 'Wishes')).toHaveCount(0) // Riley does not share Wishes
    await expect(group(page, 'Spending')).toHaveCount(0)
    await api.put('/api/profile/sharing', { keys: profile.sharing.filter((key) => key !== 'endgame') })
    await page.reload()
    await expect(page.getByTestId('compare-score')).toBeVisible()
    await expect(group(page, 'Endgame')).toHaveCount(0) // the player does not share Endgame any more
    await expect(group(page, 'Primogems')).toBeVisible()
  })

  test('the groups sit two side by side, and the page is capped', async ({ page }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    const [one, two] = [await group(page, 'Primogems').boundingBox(), await group(page, 'Play time').boundingBox()]
    expect(one && two && two.x > one.x + one.width - 1).toBe(true)
    expect(one && two && Math.abs(two.y - one.y) < 2).toBe(true)
    expect((one?.width ?? 0) + (two?.width ?? 0)).toBeLessThanOrEqual(1440)
  })

  test('signed out, the page says to sign in', async ({ page, api }) => {
    await api.post('/api/demo/online', { state: 'signed_out' })
    await expect(page.getByTestId('friends-signin')).toContainText('Sign in with Discord to add friends')
    await expect(page.getByTestId('compare-score')).toHaveCount(0)
  })

  test('what could not be updated stays, marked old', async ({ page, api }) => {
    await expect(page.getByTestId('friends-stale')).toHaveCount(0)
    await api.post('/api/demo/online', { state: 'offline' })
    await expect(page.getByTestId('friends-stale')).toContainText('Friends could not be updated.')
    await expect(page.getByTestId('compare-score')).toContainText('8 – 3')
  })

  test('after a lost session the last known state stays, marked old, with the way to Settings', async ({ page, api }) => {
    await api.post('/api/demo/online', { state: 'sign_in_again' })
    const mark = page.getByTestId('friends-stale')
    await expect(mark).toContainText('Your online session has ended.')
    await expect(page.getByTestId('compare-score')).toContainText('8 – 3')
    await expect(mark.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '#/settings')
  })
})

test.describe('with a friend whose Guild Board last uploaded two weeks ago', () => {
  test.beforeEach(async ({ page, core }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    // What the core gives for him (cloud/models.py): Riley's weeks moved along to end with this one, the two since not known,
    // and nothing for this week or the last 30 days. The demo's Riley has the weeks 10, 12.5, 9, 13.5, 15 and 21.
    await changeAnswer<CompareModel>(page, `/api/friends/${RILEY}/compare`, (data) => {
      data.friend.stats.playtime = {
        week_hours: null, days30_hours: null, weeks: [9, 13.5, 15, 21, null, null], week_start: data.week_start, longest_run: 11,
      }
    })
    await page.goto(`${core.origin}/#/friends/${RILEY}/compare`)
    await expect(page.getByTestId('compare-score')).toBeVisible()
  })

  test('has no row for this week or the last 30 days, and still the longest run', async ({ page }) => {
    await expect(rowOf(page, 'playtime.week')).toHaveCount(0)
    await expect(rowOf(page, 'playtime.days30')).toHaveCount(0)
    await expect(rowOf(page, 'playtime.run')).toBeVisible()
  })

  test('has his weeks under their dates, and no column for the two since', async ({ page }) => {
    const weeks = chart(page, 'Play time each week')
    await expect(weeks.locator('.cmp-x')).toHaveText('7 Sep14 Sep21 Sep28 Sep5 Oct12 Oct')
    const columns = weeks.locator('.cmp-col')
    await columns.nth(3).hover()
    await expect(columns.nth(3).locator('.cmp-tip')).toContainText('Week of 28 Sep')
    await expect(columns.nth(3).locator('.cmp-tip')).toContainText('Riley21 h')
    await columns.last().hover()
    await expect(columns.last().locator('.cmp-tip')).toContainText('Week of 12 Oct')
    await expect(columns.last().locator('.cmp-tip')).toContainText('You18 h')
    await expect(columns.last().locator('.cmp-tip')).toContainText('Rileyno data')
    await weeks.getByRole('button', { name: 'Show as table' }).click()
    await expect(weeks.getByRole('table').getByRole('row').last()).toContainText('Week of 12 Oct')
    await expect(weeks.getByRole('table').getByRole('row').last()).toContainText('18 h–')
  })
})

test.describe('with all seven stats shared', () => {
  test.beforeEach(async ({ page, core }) => {
    await page.setViewportSize({ width: 1640, height: 1100 })
    await changeAnswer<CompareModel>(page, `/api/friends/${RILEY}/compare`, (data) => {
      data.keys = ['primogems', 'playtime', 'achievements', 'endgame', 'account', 'wishes', 'spending']
      data.mine.wishes = { pity: 62, five_stars_90d: 3 }
      data.mine.spending = { month_total: 412, month: '2026-10', currency: 'PLN' }
      data.friend.stats.wishes = { pity: 41, five_stars_90d: 5 }
      data.friend.stats.spending = { month_total: 120, month: '2026-10', currency: 'PLN' }
    })
    await page.goto(`${core.origin}/#/friends/${RILEY}/compare`)
    await expect(page.getByTestId('compare-score')).toBeVisible()
  })

  test('Achievements, Wishes and Spending have panels of their own, and pity and money have no leader', async ({ page }) => {
    const titles = await page.locator('.cmp-groups > section').evaluateAll((panels) => panels.map((panel) => panel.getAttribute('aria-label')))
    expect(titles).toEqual(['Primogems', 'Play time', 'Endgame', 'Account', 'Achievements', 'Wishes', 'Spending'])
    await expect(rowOf(page, 'wishes.five-stars').locator('.cmp-who')).toHaveText('Riley +2')
    await expect(rowOf(page, 'wishes.pity').locator('.cmp-who')).toHaveText('')
    await expect(rowOf(page, 'wishes.pity').locator('.cmp-split')).toHaveCount(0)
    await expect(rowOf(page, 'spending.month').locator('.cmp-a')).toHaveText('412 zł')
    await expect(rowOf(page, 'spending.month').locator('.cmp-who')).toHaveText('')
  })

  test('panels side by side are one height, with no blank space under the shorter', async ({ page }) => {
    const [short, tall] = [await group(page, 'Achievements').boundingBox(), await group(page, 'Wishes').boundingBox()]
    expect(short?.y).toBe(tall?.y)
    expect(short?.height).toBe(tall?.height)
  })
})

test("an event of this PC's asks nothing of Compare, and news of the online account reads it again", async ({ page, core, api }) => {
  // Each read of Compare asks the online server what the two of you share (audit L24): it is read when the page opens,
  // each minute, and when the online account changes, and not at each tick, sync or timer of this PC.
  const compares: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === `/api/friends/${RILEY}/compare`) compares.push(request.url())
  })
  await page.goto(`${core.origin}/#/friends/${RILEY}/compare`)
  await expect(page.getByTestId('compare-score')).toBeVisible()
  // It is read as it opens, and again at the event stream's hello, which can come after the page was drawn.
  await page.evaluate(() => new Promise((done) => setTimeout(done, 500)))
  const opened = compares.length
  expect(opened).toBeGreaterThan(0)
  // An event of this PC: the page reads the status for it, and Compare is not read again.
  const status = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/status')
  await api.advance(1)
  await status
  await page.evaluate(() => new Promise((done) => setTimeout(done, 500)))
  expect(compares).toHaveLength(opened)
  // News of the online account: Compare is read again.
  await api.post('/api/demo/online', { state: 'offline' })
  await expect.poll(() => compares.length).toBeGreaterThan(opened)
})

test('what another PC sends breaks nothing: Compare shows what it can', async ({ page, core }) => {
  const broken: string[] = []
  page.on('pageerror', (error) => broken.push(error.message))
  await changeAnswer<CompareModel>(page, `/api/friends/${RILEY}/compare`, (data) => {
    const odd = data.friend as unknown as Record<string, unknown>
    Object.assign(odd, { since: 'infinity', ar: -3 })
    odd.stats = {
      primogems: { now: 'lots', months: [null, 3, { month: 5 }, { month: '2026-13', earned: 1 }] },
      playtime: { week_hours: {}, days30_hours: null, weeks: 'no', longest_run: -3 },
      achievements: 7,
      endgame: { abyss_stars: '36', theater_act: 1.5, stygian: null },
      account: { days_active: 1e308, characters: 90, chests: NaN },
    }
  })
  await page.goto(`${core.origin}/#/friends/${RILEY}/compare`)
  await expect(page.getByTestId('compare-score')).toBeVisible()
  await expect(page.getByTestId('compare-friend-status')).toHaveText('In game')
  const titles = await page.locator('.cmp-groups > section').evaluateAll((panels) => panels.map((panel) => panel.getAttribute('aria-label')))
  expect(titles).toEqual(['Endgame', 'Account']) // the rest held no figure
  await expect(rowOf(page, 'account.characters').locator('.cmp-b')).toHaveText('90')
  // The player's own weeks stay, with the friend's as gaps.
  await expect(chart(page, 'Play time each week').getByRole('img', { name: 'Week of 12 Oct: You 18 h, Riley no data' })).toBeVisible()
  expect(broken).toEqual([])
})

test('a long name stays on one line over its column, and is cut in the verdict', async ({ page, core }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await changeAnswer<CompareModel>(page, `/api/friends/${RILEY}/compare`, (data) => {
    data.friend.name = 'Aleksandra Kowalska1'
  })
  await page.goto(`${core.origin}/#/friends/${RILEY}/compare`)
  await expect(page.getByTestId('compare-score')).toBeVisible()
  const panel = group(page, 'Primogems')
  const [you, them] = await Promise.all([panel.locator('.cmp-row.head .cmp-a').boundingBox(), panel.locator('.cmp-row.head .cmp-b').boundingBox()])
  expect(them?.height).toBe(you?.height)
  const row = rowOf(page, 'primogems.last-month')
  await expect(row.locator('.cmp-who')).toHaveAttribute('title', 'Aleksandra Kowalska1 +500')
  expect(await row.evaluate((one) => one.scrollWidth <= one.clientWidth)).toBe(true)
})

test('a figure too large for its cell stays in it', async ({ page, core }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  await changeAnswer<CompareModel>(page, `/api/friends/${RILEY}/compare`, (data) => {
    data.friend.stats.account = { days_active: 1e9, characters: 88, chests: 2950 }
    data.friend.stats.endgame = { abyss_stars: 36, theater_act: 999_999_999, stygian: 6 }
  })
  await page.goto(`${core.origin}/#/friends/${RILEY}/compare`)
  await expect(page.getByTestId('compare-score')).toBeVisible()
  const cell = rowOf(page, 'account.days').locator('.cmp-b')
  await expect(cell).toHaveAttribute('title', '1,000,000,000')
  const [figure, verdict] = [await cell.boundingBox(), await rowOf(page, 'account.days').locator('.cmp-who').boundingBox()]
  expect((figure?.x ?? 0) + (figure?.width ?? 0)).toBeLessThanOrEqual(verdict?.x ?? 0)
  // It stays on one line, so the row keeps its height.
  const [act, days] = [await rowOf(page, 'endgame.theater').boundingBox(), await rowOf(page, 'account.characters').boundingBox()]
  expect(act?.height).toBe(days?.height)
})

test('with Kira, only what both of you share is here, and one chart', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/friends/${KIRA}/compare`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You and Kira')
  await expect(page.getByTestId('compare-score')).toContainText('4 – 0')
  const titles = await page.locator('.cmp-groups > section').evaluateAll((panels) => panels.map((panel) => panel.getAttribute('aria-label')))
  expect(titles).toEqual(['Play time', 'Achievements'])
  await expect(rowOf(page, 'achievements.ticked').locator('.cmp-who')).toHaveText('You +114')
  await expect(chart(page, 'Play time each week')).toBeVisible()
  await expect(chart(page, 'Primogems earned each month')).toHaveCount(0)
})

test('with a friend who shares nothing, it says so and shows no group', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/friends/${MILO}/compare`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You and Milo')
  await expect(page.getByTestId('compare-none')).toHaveText('You and Milo share no stat yet. To compare, share more on Your profile.')
  await expect(page.locator('.cmp-groups')).toHaveCount(0)
  await expect(page.getByTestId('compare-score')).toHaveCount(0)
})

test('a player who is not on the list says so, and the way back', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/friends/00000000-0000-4000-8000-0000000000ff/compare`)
  await expect(page.getByTestId('compare-missing')).toContainText('This player is not on your friends list.')
  await expect(page.getByRole('link', { name: 'Back to Friends' })).toHaveAttribute('href', '#/friends')
})

test('Compare opens from a row of Friends and from a friend\'s profile', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/friends`)
  await page.getByRole('list', { name: 'Friends' }).getByRole('listitem').filter({ hasText: 'Riley' }).getByRole('button', { name: 'Compare' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You and Riley')
  await page.goto(`${core.origin}/#/friends/${RILEY}`)
  await page.getByRole('button', { name: 'Compare' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You and Riley')
})

import type { Page } from '@playwright/test'
import type { Api, Core } from './fixtures.ts'
import type { Settings, Status } from '../src/types.ts'
import { changeAnswer, holding } from './answers.ts'
import { expect, test } from './fixtures.ts'

test('until the player has seen it, a hint says that closing the window keeps Guild Board in the tray', async ({
  page,
  api,
}) => {
  await page.route('**/api/events', (route) => route.abort()) // only the edited status reaches the page
  await changeAnswer<Status>(page, '/api/status', (data) => {
    data.has_tray = true // as in Guild Board's own window
  })
  await page.reload()
  const hint = page.getByTestId('tray-hint')
  await expect(hint).toContainText(
    "Closing this window keeps Guild Board running in the tray. To end it, choose Quit in the tray icon's menu.",
  )
  await hint.getByRole('button', { name: 'Got it' }).click()
  await expect(hint).toHaveCount(0)
  expect((await api.get<Settings>('/api/settings')).tray_hint_shown).toBe(true)
})

test('at 2,560 pixels the top bar, the plate, the tray hint and every page keep one width', async ({ page, core, api }) => {
  await api.fault('verification_needed')
  expect(await api.sync()).toBe('verification_needed') // the plate turns amber on every page
  await page.route('**/api/events', (route) => route.abort()) // only the edited status reaches the page
  await changeAnswer<Status>(page, '/api/status', (data) => {
    data.has_tray = true // as in Guild Board's own window, so that the tray hint shows
  })
  await page.setViewportSize({ width: 2560, height: 1440 })
  await page.reload() // the edited status from the start: the pages below differ only in the address's #
  // The Achievements page's 300 + 12 + 1,600 pixels. Backlog's and Stats' rows and tables are made for the 1,250 pixels
  // a window 1,440 pixels wide gives, so they keep 1,440 at most, as Settings does.
  const pages = [
    { path: '/#/backlog', content: 1440, ready: () => expect(page.getByTestId('region')).toHaveCount(6) },
    // The Board's widgets keep their sizes and fill the whole width (spec 13.2); its top bar keeps the frame's.
    { path: '/#/board', content: Number.POSITIVE_INFINITY, ready: () => expect(page.getByTestId('board')).toBeVisible() },
    { path: '/#/stats', content: 1440, ready: () => expect(page.getByRole('region', { name: 'Endgame' })).toBeVisible() },
    { path: '/#/settings', content: 1440, ready: () => expect(page.getByTestId('list-panel')).toBeVisible() },
    { path: '/#/achievements', content: 1912, ready: () => expect(page.getByTestId('ach-group').nth(1)).toBeVisible() },
    // Pulls keeps .gb-page's 1,440 pixels, with no zoom of its own (the Pulls plan).
    { path: '/#/pulls', content: 1440, ready: () => expect(page.getByTestId('history-row')).toHaveCount(100) },
  ]
  for (const { path, content, ready } of pages) {
    await page.goto(core.origin + path)
    await ready()
    await expect(page.getByTestId('sync')).toContainText('Check needed')
    await expect(page.getByTestId('tray-hint')).toBeVisible()
    // Where the main area's content starts, right of the rail and its padding.
    const start = await page.getByRole('main').evaluate((main) =>
      main.getBoundingClientRect().left + parseFloat(getComputedStyle(main).paddingLeft),
    )
    const parts = [
      { part: page.locator('main > header'), leftAligned: true },
      { part: page.getByTestId('plate'), leftAligned: false }, // the right end of the header
      { part: page.getByTestId('tray-hint'), leftAligned: true },
    ]
    for (const { part, leftAligned } of parts) {
      const { left, right } = await part.evaluate((element) => element.getBoundingClientRect().toJSON() as DOMRect)
      if (leftAligned) expect(Math.abs(left - start), path).toBeLessThan(1) // left-aligned, as the pages are
      expect(right - start, path).toBeLessThanOrEqual(1912)
    }
    const rights = await page.locator('main .gb-panel').evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().right),
    )
    expect(rights.length, path).toBeGreaterThan(0)
    expect(Math.max(...rights) - start, path).toBeLessThanOrEqual(content)
  }
})

test('without a tray there is no tray hint', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Board')
  await expect(page.getByTestId('tray-hint')).toHaveCount(0)
})

test('the core serves the interface', async ({ page }) => {
  await expect(page).toHaveTitle('Guild Board')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Board')
})

test('the address chooses the page', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/stats`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stats')
})

test('the profile card and the plate show the demo account', async ({ page }) => {
  await expect(page.getByText('Demo data')).toBeVisible()
  // The card: the demo downloads no picture, so the drawn person shows in the ring.
  const card = page.getByTestId('profile')
  await expect(card).toContainText('Traveler')
  await expect(card).toContainText('AR 60')
  await expect(card).toContainText('UID 700000001 · Europe')
  await expect(card.locator('svg.sign')).toBeVisible()
  await expect(card.locator('img')).toBeHidden()
  // The plate: Resin, the primogems and the sync.
  const plate = page.getByTestId('plate')
  await expect(plate).toContainText(/\d+ \/ 200/)
  await expect(plate).toContainText(/full in /)
  await expect(plate).toContainText(/[\d,]+\s*\d+ pulls saved/)
  await expect(plate).toContainText(/Synced\s*(just now|\d+ min ago|again in \d:\d\d)/)
  await expect(page.getByTestId('game')).toContainText(/Game not running|Game running/)
  // The primogem part opens the Pulls page.
  await expect(plate.getByRole('link', { name: /pulls saved/ })).toHaveAttribute('href', '#/pulls')
})

/** The plate's box, which must not move while the page counts or the state changes. */
async function plateBox(page: Page) {
  const box = await page.getByTestId('plate').boundingBox()
  expect(box).not.toBeNull()
  return { x: box!.x, width: box!.width }
}

test('the plate stays still while the wait counts down', async ({ page, api }) => {
  await api.advance(360)
  const sync = page.getByRole('button', { name: /^Sync now/ })
  await expect(sync).toBeEnabled()
  await sync.click()
  await expect(page.getByTestId('sync')).toContainText('again in')
  const xs = new Set<number>()
  const widths = new Set<number>()
  const words = new Set<string>()
  for (let reading = 0; reading < 20; reading += 1) {
    const { x, width } = await plateBox(page)
    xs.add(x)
    widths.add(width)
    words.add((await page.getByTestId('sync').locator('.gb-sync-text small').textContent()) ?? '')
    await page.waitForTimeout(500)
  }
  expect(words.size).toBeGreaterThan(1) // it did count
  expect([...xs]).toHaveLength(1)
  expect([...widths]).toHaveLength(1)
})

/** What shows of the sync part: whether any of its words or its button is cut off or reaches past the plate's edge. */
async function syncFit(page: Page) {
  return page.getByTestId('plate').evaluate((plate) => {
    const cell = plate.querySelector('[data-testid=sync]')!
    const cut = (element: Element) => element.scrollWidth > element.clientWidth
    const words = [cell.querySelector('.gb-sync-text')!, ...cell.querySelectorAll('.gb-sync-text > *')]
    const last = [...cell.querySelectorAll('button')].pop()!
    // The ring is the Sync button's visible end; an action has no ring.
    const end = (cell.querySelector('.gb-sbtn-ring') ?? last).getBoundingClientRect()
    const edge = plate.getBoundingClientRect().right
    return { cut: words.some(cut) || cut(cell), gap: Math.round(edge - end.right) }
  })
}

test.describe('the plate keeps its place in every sync state', () => {
  /** A fault of the demo account, and a sync that meets it. */
  const faulty = (kind: string) => async (api: Api) => {
    await api.fault(kind)
    await api.sync()
  }
  type State = [name: string, drive: (api: Api, page: Page, core: Core) => Promise<void>]
  /** A state that only the status's numbers decide: the page reads the status again with `change` made to it. */
  const stated = (change: (sync: Status['sync']) => void) => async (_api: Api, page: Page) => {
    await page.route('**/api/events', (route) => route.abort()) // only the edited status reaches the page
    await changeAnswer<Status>(page, '/api/status', (data) => change(data.sync))
    await page.reload()
  }
  // The everyday states keep the plate's left edge where it was; it moves only when a warning appears.
  const everyday: State[] = [
    ['offline', faulty('offline')],
    [
      'syncing',
      async (api, page) => {
        await api.fault('slow')
        await api.advance(360)
        const button = page.getByRole('button', { name: /^Sync now/ })
        await expect(button).toHaveAccessibleName('Sync now')
        await button.click()
        await expect(page.getByTestId('sync')).toContainText('Syncing…')
      },
    ],
    ['daily limit reached', stated((sync) => { sync.runs_today = sync.daily_cap })],
    ['Not synced yet', stated((sync) => { sync.last_ok_at = null })],
    [
      'Not connected',
      async (_api, page, core) => {
        core.stop() // last: it ends the core
        await expect(page.locator('main > .gb-banner[role="alert"]')).toContainText('Guild Board is not answering.', {
          timeout: 15_000,
        })
        await expect(page.getByTestId('sync')).toContainText('Not connected')
      },
    ],
  ]
  const warnings: State[] = [
    ['verification_needed', faulty('verification_needed')],
    ['login_needed', faulty('login_needed')],
    ['switch_off', faulty('switch_off')],
    ['error', faulty('error')],
    [
      'paused',
      async (api) => {
        await api.post('/api/sync/pause')
      },
    ],
  ]
  for (const [state, drive] of everyday) {
    test(state, async ({ page, api, core }) => {
      await expect(page.getByTestId('sync')).toContainText('Synced')
      const before = await plateBox(page)
      await drive(api, page, core)
      await expect(page.getByTestId('sync')).not.toContainText(/Synced\s*(just now|\d+ min ago|again in)/)
      await page.waitForTimeout(300) // the state has been drawn
      expect(await plateBox(page)).toEqual(before)
      expect((await syncFit(page)).cut).toBe(false)
    })
  }
  for (const [state, drive] of warnings) {
    test(`${state}: its words and its action are whole, at the plate's right edge`, async ({ page, api, core }) => {
      await expect(page.getByTestId('sync')).toContainText('Synced')
      const before = await plateBox(page)
      await drive(api, page, core)
      await expect(page.getByTestId('sync')).not.toContainText(/Synced\s*(just now|\d+ min ago|again in)/)
      await page.waitForTimeout(300)
      const after = await plateBox(page)
      // The plate's right end stays; its left edge goes left to make room, never right.
      expect(after.x + after.width).toBeCloseTo(before.x + before.width, 1)
      expect(after.x).toBeLessThanOrEqual(before.x)
      const fit = await syncFit(page)
      expect(fit.cut).toBe(false) // nothing is truncated
      expect(fit.gap).toBeLessThanOrEqual(12) // and no blank room at the plate's edge
    })
  }
})

test("at the narrowest window the plate is on the title's row or wholly below it, never split", async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 900 })
  await expect(page.getByTestId('plate')).toBeVisible()
  const { title, parts, main } = await page.evaluate(() => {
    const box = (element: Element) => element.getBoundingClientRect().toJSON() as DOMRect
    return {
      title: box(document.querySelector('.gb-title')!),
      parts: [...document.querySelectorAll('[data-testid=plate] > .gb-plate-cell')].map(box),
      main: box(document.querySelector('main')!),
    }
  })
  expect(parts).toHaveLength(3) // Resin, the primogems and the sync
  const top = parts[0].top
  for (const part of parts) expect(Math.abs(part.top - top)).toBeLessThanOrEqual(1) // one line, not wrapped inside
  const right = Math.max(...parts.map((part) => part.right))
  expect(right).toBeLessThanOrEqual(main.right)
  const below = top >= title.bottom - 1
  const beside = top < title.bottom && parts[0].left >= title.right - 1
  expect(below || beside, `plate top ${top}, title bottom ${title.bottom}`).toBe(true)
})

test('the sync part is narrow when all is well: the room left of its text is small', async ({ page }) => {
  // "Synced · 1 h ago" and "Synced · again in 4:26" sit close to the divider: the fixed width fits the longest everyday
  // state, "Not synced yet" or "Not connected", and not a warning's sentence.
  const room = await page.getByTestId('sync').evaluate((cell) => {
    const text = cell.querySelector('.gb-sync-text')!.getBoundingClientRect()
    return { spare: Math.round(text.left - cell.getBoundingClientRect().left), width: cell.getBoundingClientRect().width }
  })
  expect(room.width).toBeLessThanOrEqual(180)
  expect(room.spare).toBeLessThanOrEqual(80)
  expect((await syncFit(page)).gap).toBeLessThanOrEqual(12)
})

test('How to fix opens the sync panel, a second press shuts it, and so does a press on the text', async ({ page, api }) => {
  await api.fault('switch_off')
  await api.sync()
  const how = page.getByTestId('sync').getByRole('button', { name: 'How to fix', exact: true })
  const panel = page.getByTestId('sync-panel')
  await expect(how).toHaveAttribute('aria-expanded', 'false')
  await how.click()
  await expect(panel).toBeVisible()
  await expect(how).toHaveAttribute('aria-expanded', 'true')
  await how.click()
  await expect(panel).toHaveCount(0)
  await expect(how).toHaveAttribute('aria-expanded', 'false')
  // Opened from the text, How to fix shuts it too.
  await page.getByTestId('sync').locator('.gb-sync-text').click()
  await expect(panel).toBeVisible()
  await how.click()
  await expect(panel).toHaveCount(0)
  await expect(how).toBeFocused()
})

test('the sync panel shuts when the warning that offered it clears, and the focus is not lost', async ({ page, api }) => {
  await api.fault('switch_off')
  await api.sync()
  const how = page.getByTestId('sync').getByRole('button', { name: 'How to fix', exact: true })
  await how.click()
  await expect(page.getByTestId('sync-panel')).toBeVisible()
  await api.fault('none')
  await api.post('/api/demo/clock', { advance_seconds: 360 })
  await api.post('/api/sync')
  await expect(page.getByTestId('sync')).toContainText('Synced')
  await expect(page.getByTestId('sync-panel')).toHaveCount(0)
  await expect(page.getByTestId('sync').locator('.gb-sync-text')).toBeFocused()
})

test('with the core gone the sync panel shuts, and does not open', async ({ page, core }) => {
  const text = page.getByTestId('sync').locator('.gb-sync-text')
  await text.click()
  await expect(page.getByTestId('sync-panel')).toBeVisible()
  core.stop()
  await expect(page.locator('main > .gb-banner[role="alert"]')).toContainText('Guild Board is not answering.', {
    timeout: 15_000,
  })
  await expect(page.getByTestId('sync-panel')).toHaveCount(0)
  await expect(page.getByTestId('sync')).toContainText('Not connected')
  await text.click()
  await expect(page.getByTestId('sync-panel')).toHaveCount(0)
  await expect(text).not.toHaveAttribute('aria-expanded') // nothing is offered that cannot open
  await expect(text).not.toHaveAttribute('aria-haspopup')
})

test('a panel shuts when the page changes, by the keyboard too', async ({ page }) => {
  await page.getByTestId('profile').click()
  await expect(page.getByTestId('profile-panel')).toBeVisible()
  await page.evaluate(() => {
    window.location.hash = '#/board/'
  })
  await expect(page.getByTestId('profile-panel')).toHaveCount(0)
  await page.getByTestId('sync').locator('.gb-sync-text').click()
  await expect(page.getByTestId('sync-panel')).toBeVisible()
  // The primogem part is a link to the Pulls page: Enter on it changes the page.
  await page.getByTestId('plate').getByRole('link', { name: /pulls saved/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/pulls$/)
  await expect(page.getByTestId('sync-panel')).toHaveCount(0)
})

test('an account that goes while its panel is open takes the panel with it, and the next account does not reopen it', async ({ page, api }) => {
  let gone = false
  await changeAnswer<Status>(page, '/api/status', (data) => {
    if (gone) data.account = null
  })
  await page.reload()
  await page.getByTestId('profile').click()
  await expect(page.getByTestId('profile-panel')).toBeVisible()
  gone = true
  await api.post('/api/sync/pause') // the core says so, and the page reads the status again
  await expect(page.getByTestId('profile')).toContainText('Not logged in')
  await expect(page.getByTestId('profile-panel')).toHaveCount(0)
  gone = false
  await api.post('/api/sync/resume')
  await expect(page.getByTestId('profile')).toContainText('Traveler')
  await expect(page.getByTestId('profile-panel')).toHaveCount(0)
})

test('the profile card opens its panel, and Esc closes it', async ({ page }) => {
  const card = page.getByTestId('profile')
  await expect(card).toHaveAttribute('aria-expanded', 'false')
  await card.click()
  const panel = page.getByTestId('profile-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('role', 'dialog')
  await expect(page.getByRole('dialog', { name: 'Profile' })).toBeVisible()
  await expect(card).toHaveAttribute('aria-expanded', 'true')
  await expect(panel).toContainText('Traveler')
  await expect(panel).toContainText('Adventure Rank 60')
  const row = (name: string) => panel.getByText(name, { exact: true }).locator('xpath=..')
  await expect(row('UID')).toContainText('700000001')
  await expect(row('Server')).toContainText('Europe')
  await expect(row('Days active')).toContainText(/1,8\d\d/)
  await expect(row('Tracking since')).toContainText(/^Tracking since\s*\d{1,2} [A-Z][a-z]{2} 20\d\d$/)
  // Esc closes it and the focus goes back to the card.
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(card).toBeFocused()
  // A second press on the card closes it, and an outside click does too.
  await card.click()
  await expect(panel).toBeVisible()
  await card.click()
  await expect(panel).toHaveCount(0)
  await card.click()
  await expect(panel).toBeVisible()
  await page.getByRole('heading', { level: 1 }).click()
  await expect(panel).toHaveCount(0)
  // Account settings opens Settings.
  await card.click()
  await panel.getByRole('button', { name: 'Account settings' }).click()
  await expect(page).toHaveURL(/#\/settings$/)
  await expect(panel).toHaveCount(0)
})

test('the sync panel counts how many syncs the day has had, and Esc closes it', async ({ page }) => {
  const text = page.getByTestId('sync').locator('.gb-sync-text')
  await text.click()
  const panel = page.getByTestId('sync-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Sync' })).toBeVisible()
  await expect(panel.getByText(/^\d+ of 24 syncs$/)).toBeVisible()
  for (const name of ['Last sync', 'Next sync', 'Today', 'While playing']) {
    await expect(panel.getByText(name, { exact: true })).toBeVisible()
  }
  await expect(panel.getByText('While playing', { exact: true }).locator('xpath=..')).toContainText(/off|every \d+ min/)
  await expect(panel.getByRole('button', { name: 'See the sync log' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Pause syncing' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(text).toBeFocused()
  // Its Pause syncing sends what Settings sends, and the plate follows.
  await text.click()
  await panel.getByRole('button', { name: 'Pause syncing' }).click()
  await expect(page.getByTestId('sync')).toContainText('Syncing paused')
  await expect(panel.getByRole('button', { name: 'Resume syncing' })).toBeVisible()
  await panel.getByRole('button', { name: 'Resume syncing' }).click()
  await expect(page.getByTestId('sync')).not.toContainText('Syncing paused')
  await panel.getByRole('button', { name: 'See the sync log' }).click()
  await expect(page).toHaveURL(/#\/settings$/)
  await expect(panel).toHaveCount(0)
})

test('Esc closes an open panel and leaves the note for the next press', async ({ page, api }) => {
  await api.fault('verification_needed')
  await api.sync()
  await page.getByTestId('sync').getByRole('button', { name: 'Verify', exact: true }).click()
  const note = page.getByTestId('note')
  await expect(note).toBeVisible() // a refusal stays until it is closed
  await page.getByTestId('profile').click()
  await expect(page.getByTestId('profile-panel')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('profile-panel')).toHaveCount(0)
  await expect(note).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(note).toHaveCount(0)
})

test('with no account the card says so, and a press opens Settings', async ({ page }) => {
  await page.route('**/api/events', (route) => route.abort())
  await changeAnswer<Status>(page, '/api/status', (data) => {
    data.account = null
  })
  await page.reload()
  const card = page.getByTestId('profile')
  await expect(card).toContainText('Not logged in')
  await expect(card).not.toContainText('AR')
  await expect(card.locator('svg.sign')).toBeVisible()
  await expect(page.getByTestId('plate')).not.toContainText('/ 200') // no Resin without an account
  await card.click()
  await expect(page).toHaveURL(/#\/settings$/)
  await expect(page.getByTestId('profile-panel')).toHaveCount(0)
})

test('a server name too long for the card puts the UID and the server on a line each', async ({ page }) => {
  await page.route('**/api/events', (route) => route.abort())
  await changeAnswer<Status>(page, '/api/status', (data) => {
    data.account!.server = 'os_cht'
  })
  await page.reload()
  const line = page.getByTestId('profile').locator('.gb-who-line')
  await expect(line).toHaveClass(/split/)
  await expect(line.locator('span')).toHaveText(['UID 700000001', 'TW, HK, MO'])
  const fits = await line.evaluate((element) => element.scrollWidth <= element.clientWidth)
  expect(fits).toBe(true)
})

test('a UID line measured before the fonts are in goes back to one line once they are', async ({ page }) => {
  // The fallback font is wider than the web font, so a line measured while the fonts are held can look too long for the
  // card. The fonts are let go after the first measure: the line is then measured again, with the font it will keep.
  const fonts = holding()
  await page.route(/\.woff2?(\?.*)?$/, async (route) => {
    await fonts.held
    await route.continue()
  })
  await page.reload()
  const line = page.getByTestId('profile').locator('.gb-who-line')
  await expect(line).toBeVisible()
  await page.waitForTimeout(500) // the first measure has been made, with the fallback font
  fonts.release()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  await expect(line).toHaveText('UID 700000001 · Europe')
  await expect(line).not.toHaveClass(/split/)
  const oneLine = await line.evaluate(
    (element) => element.getBoundingClientRect().height < 2 * parseFloat(getComputedStyle(element).lineHeight),
  )
  expect(oneLine).toBe(true)
})

test('a picture that cannot be loaded leaves the drawn sign in the ring', async ({ page }) => {
  await page.route('**/api/events', (route) => route.abort())
  await changeAnswer<Status>(page, '/api/status', (data) => {
    data.account!.picture_url = '/api/icon/account.picture?v=missing'
  })
  await page.reload()
  const card = page.getByTestId('profile')
  await expect(card.locator('img')).toBeHidden()
  await expect(card.locator('svg.sign')).toBeVisible()
})

test('the rail leads to the other pages', async ({ page }) => {
  const rail = page.getByRole('navigation', { name: 'Pages' })
  await rail.getByRole('link', { name: 'Stats' }).click()
  await expect(page).toHaveURL(/#\/stats$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stats')
  await expect(rail.getByRole('link', { name: 'Stats' })).toHaveAttribute('aria-current', 'page')
  await rail.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings')
  await expect(rail.getByRole('link').first()).toHaveText('Board') // the page Guild Board opens on
  await expect(rail.getByRole('link', { name: 'Board' })).toHaveAttribute('href', '#/board')
  await expect(rail.getByRole('link', { name: 'Achievements' })).toHaveAttribute('href', '#/achievements')
  // Pulls is a page of its own (the Pulls plan, calls item 18).
  await expect(rail.getByRole('link', { name: 'Pulls' })).toHaveAttribute('href', '#/pulls')
  await rail.getByRole('link', { name: 'Pulls' }).click()
  await expect(page).toHaveURL(/#\/pulls$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pulls')
  await expect(rail.getByRole('link', { name: 'Pulls' })).toHaveAttribute('aria-current', 'page')
})

/** The rail's muted text (--rail-muted) and the gold of the current page (--gold). */
const RAIL_MUTED = 'rgb(169, 176, 192)'
const GOLD = 'rgb(211, 188, 142)'

/** How each item of the rail draws its sign: how many it has, in what colour, and whether it fits in the item. */
async function railSigns(page: Page) {
  return page.getByRole('navigation', { name: 'Pages' }).locator('.gb-nav').evaluateAll((items) =>
    items.map((item) => {
      const signs = [...item.querySelectorAll('svg.sign')]
      const sign = signs[0]
      const label = [...item.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)
      const range = document.createRange()
      if (label !== undefined) range.selectNodeContents(label)
      return {
        name: label?.textContent ?? '',
        signs: signs.length,
        look: sign?.innerHTML ?? '',
        color: sign === undefined ? '' : getComputedStyle(sign).color,
        current: item.getAttribute('aria-current') === 'page',
        // The sign stands left of the name, and both are inside the item, which does not scroll sideways.
        before: sign === undefined || label === undefined ? false : sign.getBoundingClientRect().right <= range.getBoundingClientRect().left + 0.5,
        fits: item.scrollWidth <= item.clientWidth && range.getBoundingClientRect().right <= item.getBoundingClientRect().right,
      }
    }),
  )
}

test('each rail link shows its sign, in the rail’s muted colour and in gold on the current page', async ({ page }) => {
  const rail = page.getByRole('navigation', { name: 'Pages' })
  const names = ['Board', 'Achievements', 'Characters', 'Your week', 'Backlog', 'Map', 'Stats', 'Pulls', 'Ledger', 'Friends', 'Settings']
  await expect(rail.locator('.gb-nav')).toHaveText(names)
  const signs = await railSigns(page)
  expect(signs.map((one) => one.signs)).toEqual(names.map(() => 1))
  expect(new Set(signs.map((one) => one.look)).size).toBe(names.length) // all different drawings
  expect(signs.map((one) => [one.name, one.before, one.fits])).toEqual(
    names.map((name) => [name, true, true]),
  )
  // The Board is the current page: its sign is gold, the others are muted.
  expect(signs.map((one) => [one.name, one.color])).toEqual([
    ['Board', GOLD],
    ['Achievements', RAIL_MUTED],
    ['Characters', RAIL_MUTED],
    ['Your week', RAIL_MUTED],
    ['Backlog', RAIL_MUTED],
    ['Map', RAIL_MUTED],
    ['Stats', RAIL_MUTED],
    ['Pulls', RAIL_MUTED],
    ['Ledger', RAIL_MUTED],
    ['Friends', RAIL_MUTED],
    ['Settings', RAIL_MUTED],
  ])
  // The signs are not read: the links keep their names.
  await expect(rail.getByRole('link', { name: 'Achievements', exact: true })).toBeVisible()
  // Gold follows the page.
  await rail.getByRole('link', { name: 'Stats', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stats')
  const moved = await railSigns(page)
  expect(moved.filter((one) => one.color === GOLD).map((one) => one.name)).toEqual(['Stats'])
  expect(moved.find((one) => one.current)?.name).toBe('Stats')
  // The widest name, in the bold of the current page, still fits beside its sign.
  await rail.getByRole('link', { name: 'Achievements', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Achievements')
  const widest = await railSigns(page)
  expect(widest.filter((one) => one.color === GOLD).map((one) => one.name)).toEqual(['Achievements'])
  expect(widest.map((one) => [one.name, one.before, one.fits])).toEqual(names.map((name) => [name, true, true]))
})

test('a page opens with a short fade of its content while the rail and the top bar stay still', async ({ page }) => {
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { fades: string[] }).fades = seen
    for (const type of ['animationstart', 'animationend'] as const) {
      document.addEventListener(type, (event) => {
        const { animationName, elapsedTime, target } = event as AnimationEvent
        const element = target as Element
        const where = element.closest('.gb-rail')
          ? 'rail'
          : element.closest('.gb-top')
            ? 'top bar'
            : element.parentElement?.matches('main')
              ? 'content'
              : 'inside'
        seen.push(`${type.replace('animation', '')} ${animationName} ${where} ${Math.round(elapsedTime * 1000)}`)
      })
    }
  })
  const fades = () => page.evaluate(() => (window as unknown as { fades: string[] }).fades)
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Stats', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stats')
  // The content fades in once, over 160 ms: it starts at 0 and ends at 160.
  await expect.poll(fades).toContain('end fade-in content 160')
  const seen = await fades()
  expect(seen).toContain('start fade-in content 0')
  // Nothing in the rail or the top bar animates. (The page's own opening motions are inside the content.)
  expect(seen.filter((one) => /\b(rail|top bar)\b/.test(one))).toEqual([])
  // And the fade is the one motion of the content's own frame: every fade of the content is that long.
  expect(seen.filter((one) => one.startsWith('end fade-in content') && !one.endsWith(' 160'))).toEqual([])
})

test('a button darkens on hover and shrinks a little while it is pressed, and one that cannot be used does not', async ({ page }) => {
  const edit = page.getByRole('button', { name: 'Edit', exact: true }) // outlined: it takes the tint of a plate
  await expect(edit).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(edit).toHaveCSS('filter', 'none')
  await edit.hover()
  await expect(edit).toHaveCSS('filter', 'brightness(0.9)')
  await expect(edit).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(edit).toHaveCSS('transform', 'none')
  await page.mouse.down()
  await expect(edit).toHaveCSS('transform', 'matrix(0.97, 0, 0, 0.97, 0, 0)') // 97%
  await page.mouse.move(700, 700) // let go away from the button: nothing is clicked
  await page.mouse.up()
  await expect(edit).toHaveCSS('transform', 'none')
  await expect(edit).toHaveCSS('filter', 'none')
  // A solid button darkens too: Done, in Edit.
  await edit.click()
  const done = page.getByRole('button', { name: 'Done', exact: true })
  await expect(done).toHaveCSS('filter', 'none')
  await done.hover()
  await expect(done).toHaveCSS('filter', 'brightness(0.9)')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  // The Sync button waits out its five minutes after the sync that starts the core: it keeps its look.
  const sync = page.getByRole('button', { name: /^Sync now/ })
  await expect(sync).toBeDisabled()
  await sync.hover()
  await page.mouse.down()
  await page.waitForTimeout(300) // longer than the press and the hover take
  await expect(sync).toHaveCSS('filter', 'none')
  await expect(sync).toHaveCSS('transform', 'none')
  await page.mouse.up()
})

test('the fonts are bundled and nothing is loaded from the internet', async ({ page, core }) => {
  const elsewhere: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (!url.startsWith(core.origin) && !url.startsWith('data:')) elsewhere.push(url)
  })
  await page.reload()
  await expect(page.getByTestId('profile')).toContainText('AR 60')
  const hasFont = await page.evaluate(async () => {
    await document.fonts.ready
    return document.fonts.check("700 16px 'Alegreya Sans'")
  })
  expect(hasFont).toBe(true)
  expect(elsewhere).toEqual([])
})

test('every page runs within its content security policy', async ({ page, core }) => {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { cspViolations: string[] }).cspViolations = seen
    document.addEventListener('securitypolicyviolation', (event) => seen.push(`${event.violatedDirective} ${event.blockedURI}`))
  })
  await page.reload()
  await expect(page.getByTestId('board')).toBeVisible()
  await page.goto(`${core.origin}/#/backlog`)
  await expect(page.getByTestId('region').first()).toBeVisible()
  await page.goto(`${core.origin}/#/stats`)
  await expect(page.getByRole('region', { name: 'Endgame' })).toBeVisible()
  await page.goto(`${core.origin}/#/settings`)
  await expect(page.getByTestId('list-panel')).toBeVisible()
  await page.goto(`${core.origin}/#/achievements`)
  await expect(page.getByTestId('ach-group').first()).toBeVisible()
  await page.goto(`${core.origin}/#/pulls`)
  await expect(page.getByTestId('history-row').first()).toBeVisible()
  const violations = await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations)
  expect(violations).toEqual([])
})

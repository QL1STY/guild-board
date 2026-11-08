import type { Page } from '@playwright/test'
import { localTime } from '../src/format.ts'
import type { Ledger } from '../src/ledgertypes.ts'
import type { OnlineView } from '../src/onlinetypes.ts'
import { money } from '../src/pages/ledgerview.ts'
import type { OverlayStatus, Settings, Status } from '../src/types.ts'
import { changeAnswer, holding } from './answers.ts'
import { type Api, expect, test } from './fixtures.ts'

test.beforeEach(async ({ page, core }) => {
  await page.goto(`${core.origin}/#/settings`)
})

/** The page's groups, in their order (the ledger, gallery and settings design, section 8). */
const group = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
const online = (page: Page) => group(page, 'Online')
const syncGroup = (page: Page) => group(page, 'Sync')
const guildBoard = (page: Page) => group(page, 'Guild Board')
const extras = (page: Page) => group(page, 'Extras')
const achievements = (page: Page) => group(page, 'Achievements and commissions')
const yourData = (page: Page) => group(page, 'Your data')
const about = (page: Page) => group(page, 'About')

/** Opens the overlay's settings under its row, as its Change does, and answers them. */
async function openOverlay(page: Page) {
  const change = guildBoard(page).getByRole('button', { name: 'Change', exact: true })
  await expect(change).toHaveAttribute('aria-expanded', 'false')
  await change.click()
  await expect(change).toHaveAttribute('aria-expanded', 'true')
  return guildBoard(page).getByRole('group', { name: 'Overlay', exact: true })
}

/** Opens the sync log under the Sync group's link, and answers it. */
async function openSyncLog(page: Page) {
  await syncGroup(page).getByRole('button', { name: 'Show the sync log' }).click()
  return page.getByRole('region', { name: 'Sync log' })
}

test('the groups come in one column, in the order of the design', async ({ page }) => {
  // The groups are drawn once the page's answers are in; reading them sooner finds none, or some, under load.
  await expect(page.locator('main .set > section')).toHaveCount(8)
  const names = await page.locator('main .set > section').evaluateAll((sections) =>
    sections.map((section) => section.getAttribute('aria-label') ?? section.querySelector('h2')?.textContent),
  )
  expect(names).toEqual(['Account', 'Online', 'Sync', 'Guild Board', 'Extras', 'Achievements and commissions', 'Your data', 'About'])
  const lefts = await page.locator('main .set > section').evaluateAll((sections) =>
    sections.map((section) => Math.round(section.getBoundingClientRect().left)),
  )
  expect(new Set(lefts).size).toBe(1) // one column
})

test('About, the last group, gives the version, says Guild Board is fan-made and links to its source and privacy notice', async ({ page, api }) => {
  const box = about(page)
  const { version } = await api.get<Status>('/api/status')
  await expect(box).toContainText(version)
  await expect(box).toContainText('Unofficial and fan-made. Not affiliated with or endorsed by HoYoverse or COGNOSPHERE.')
  await expect(box).toContainText('MIT licence')
  const source = box.getByRole('link', { name: 'Open on GitHub' })
  await expect(source).toHaveAttribute('href', 'https://github.com/QL1STY/guild-board/')
  await expect(source).toHaveAttribute('target', '_blank')
  await expect(box.getByRole('link', { name: 'Read the notice' })).toHaveAttribute(
    'href',
    'https://github.com/QL1STY/guild-board/blob/main/PRIVACY.md',
  )
  expect(await page.locator('main .set > section').last().getAttribute('aria-labelledby')).toBe(
    await box.locator('h2').getAttribute('id'),
  ) // it is the last group
})

test('Open-source licences shows the notices in a dialog and gives the focus back', async ({ page }) => {
  const button = about(page).getByRole('button', { name: 'Open-source licences' })
  await button.click()
  const dialog = page.getByRole('dialog', { name: 'Open-source licences' })
  await expect(dialog).toBeVisible()
  const text = dialog.getByLabel('Licences of the software inside Guild Board')
  await expect(text).toContainText('THIRD-PARTY NOTICES')
  await expect(text).toContainText('== react ')
  await expect(text).toContainText('== Electron (with Chromium and Node.js) ')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(button).toBeFocused()
})

test('Open-source licences says so when the core has no notices to give', async ({ page }) => {
  await page.route('**/api/notices', (route) =>
    route.fulfill({ status: 404, json: { error: 'The list of open-source licences is not next to the program.' } }),
  )
  await about(page).getByRole('button', { name: 'Open-source licences' }).click()
  await expect(page.getByRole('dialog', { name: 'Open-source licences' })).toContainText(
    'The list of open-source licences is not next to the program.',
  )
})

test('every setting from before is still reachable', async ({ page }) => {
  // Sync: the interval, the pause and the sync log.
  await expect(syncGroup(page).getByRole('combobox', { name: 'Sync while you play' })).toBeVisible()
  await expect(syncGroup(page).getByRole('button', { name: 'Pause syncing' })).toHaveAttribute('aria-pressed', 'false')
  await expect((await openSyncLog(page)).getByRole('row').first()).toBeVisible()
  // Guild Board: start with Windows, the notifications and their test, and every overlay setting.
  await expect(guildBoard(page).getByRole('button', { name: 'Start with Windows' })).toHaveAttribute('aria-pressed', 'false')
  await expect(guildBoard(page).getByRole('button', { name: 'Notifications' })).toHaveAttribute('aria-pressed', 'true')
  await expect(guildBoard(page).getByRole('button', { name: 'Send a test notification' })).toBeVisible()
  const overlay = await openOverlay(page)
  await expect(overlay.getByRole('textbox', { name: 'Hotkey' })).toBeVisible()
  await expect(overlay.getByRole('button', { name: 'Save hotkey' })).toBeVisible()
  await expect(overlay.getByRole('group', { name: 'Display' })).toBeVisible()
  await expect(overlay.getByRole('radiogroup', { name: 'Size' })).toBeVisible()
  await expect(overlay.getByRole('slider', { name: "Pinned widgets' opacity" })).toBeVisible()
  await expect(overlay.getByRole('button', { name: 'Show pinned widgets over the game' })).toHaveAttribute('aria-pressed', 'true')
  await expect(overlay.getByRole('button', { name: 'Lines over the game' })).toHaveAttribute('aria-pressed', 'true')
  // Off by default: the open overlay takes the keyboard, as a game in a window or borderless allows.
  const fullScreen = overlay.getByRole('button', { name: 'The game runs in full screen' })
  await expect(fullScreen).toHaveAttribute('aria-pressed', 'false')
  await fullScreen.click()
  await expect(fullScreen).toHaveAttribute('aria-pressed', 'true')
  // Extras: the gallery, new.
  await expect(extras(page).getByRole('button', { name: 'Screenshot gallery' })).toHaveAttribute('aria-pressed', 'false')
  // Achievements and commissions: the region, the fishing rule and the list's check.
  await expect(achievements(page).getByRole('combobox', { name: 'Commission region' })).toBeVisible()
  await expect(achievements(page).getByRole('radiogroup', { name: 'Fishing spots come back' })).toBeVisible()
  await expect(achievements(page).getByRole('button', { name: 'Check for new achievements' })).toBeVisible()
  // Your data: backups, the data folder, the export, the restore and the import.
  await expect(yourData(page).getByRole('button', { name: 'Back up now' })).toBeVisible()
  await expect(yourData(page).getByRole('button', { name: 'Open folder' })).toBeVisible()
  await expect(yourData(page).getByRole('button', { name: 'Export backup…' })).toBeVisible()
  await yourData(page).getByRole('button', { name: 'Restore a backup' }).click()
  await expect(yourData(page).getByRole('list', { name: 'Backups you can restore' })).toBeAttached()
  await expect(yourData(page).getByRole('button', { name: 'Choose a file…' })).toBeVisible()
  await expect(yourData(page).getByTestId('import-panel').getByLabel('Choose a file')).toBeAttached()
  // The footer: the version, what's new, and what Guild Board never does with the risk.
  const footer = page.getByTestId('settings-foot')
  await expect(footer).toContainText(/Guild Board \d+\.\d+\.\d+/)
  await expect(footer.getByRole('button', { name: "What's new" })).toBeVisible()
  await expect(footer.getByRole('button', { name: 'What Guild Board never does' })).toBeVisible()
})

test('Online says who is signed in, and that the demo account is made up', async ({ page }) => {
  const box = online(page)
  await expect(box).toContainText('Signed in with Discord as Traveler#2048')
  await expect(box).toContainText('This account is made up, and nothing goes online in the demo.')
  await expect(box.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(box.getByRole('button', { name: 'Sign in with Discord' })).toHaveCount(0)
})

test('Delete my online data asks first, and Cancel keeps the account', async ({ page, api }) => {
  const box = online(page)
  await box.getByRole('button', { name: 'Delete my online data' }).click()
  const asking = box.getByRole('alertdialog', { name: 'Confirm deleting your online data' })
  await expect(asking).toContainText('Delete your online account and everything stored with it?')
  await expect(asking).toContainText('What is on this PC stays.')
  await expect((await api.get<Status>('/api/status')).online.state).toBe('signed_in') // asking has sent nothing

  await asking.getByRole('button', { name: 'Cancel' }).click()
  await expect(asking).toHaveCount(0)
  await expect(box).toContainText('Signed in with Discord as Traveler#2048')

  await box.getByRole('button', { name: 'Delete my online data' }).click()
  await asking.getByRole('button', { name: 'Delete my online data' }).click()
  await expect(box).toContainText('Sign in to add friends and copy your data to your account.')
  await expect(asking).toHaveCount(0)
  await expect(box.getByRole('button', { name: 'Delete my online data' })).toHaveCount(0)
})

test('signed out, Online says what going online does and offers to sign in', async ({ page }) => {
  const box = online(page)
  await box.getByRole('button', { name: 'Sign out' }).click()
  await expect(box).toContainText('Discord tells Guild Board your name, and is not asked for your e-mail address.')
  await expect(box.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
  await box.getByRole('button', { name: 'Sign in with Discord' }).click()
  await expect(box).toContainText('Signed in with Discord as Traveler#2048') // the demo has no browser to go to
})

test('signed out, Online links to the privacy notice beside the sign-in', async ({ page }) => {
  const box = online(page)
  await box.getByRole('button', { name: 'Sign out' }).click()
  await expect(box.getByRole('button', { name: 'Sign in with Discord' })).toBeVisible()
  await expect(box).toContainText("Signing in puts your profile and the stats and data you switch on on Guild Board's online server;")
  await expect(box.getByRole('link', { name: 'privacy notice' })).toHaveAttribute(
    'href',
    'https://github.com/QL1STY/guild-board/blob/main/PRIVACY.md',
  )
})

test('the account says that this is the demo', async ({ page }) => {
  const account = page.getByRole('region', { name: 'Account' })
  await expect(account).toContainText('Traveler')
  await expect(account).toContainText('Europe · UID 700000001 · the demo account')
  await expect(account).toContainText('This is the demo account.')
  await expect(account.getByRole('button')).toHaveCount(0)
})

test('the sync interval is saved', async ({ page, api }) => {
  const interval = syncGroup(page).getByRole('combobox', { name: 'Sync while you play' })
  await expect(interval).toHaveValue('0')
  await expect(interval.getByRole('option')).toHaveText(['Off', 'Every 60 min', 'Every 30 min'])
  await interval.selectOption({ label: 'Every 30 min' })
  await expect(interval).toHaveValue('30')
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).in_session_interval_min).toBe(30)
  await page.reload()
  await expect(interval).toHaveValue('30')
})

test('the interval ends on the latest choice, also when an earlier save is slow to land', async ({ page, api }) => {
  const interval = syncGroup(page).getByRole('combobox', { name: 'Sync while you play' })
  await expect(interval).toHaveValue('0') // the saved interval
  // From here on, the value the control shows each time it changes. A select's choice is no attribute that an observer
  // would see, so it is looked at every few milliseconds.
  await interval.evaluate((select: HTMLSelectElement) => {
    const shown: string[] = []
    Object.assign(window, { shown })
    let last = select.value
    window.setInterval(() => {
      if (select.value !== last) shown.push((last = select.value))
    }, 1)
  })
  // The first save is held on its way to the core, so Off is picked again before the page has read Every 60 min back.
  const { held, release } = holding()
  const saves: unknown[] = []
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback()
    if (saves.push(route.request().postDataJSON()) === 1) await held
    await route.fallback()
  })
  await interval.selectOption('60')
  await expect(interval).toHaveValue('60') // at once, while its save is held
  await interval.selectOption('0')
  await expect(interval).toHaveValue('0')
  const landed = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.request().postDataJSON()?.in_session_interval_min === 60,
  )
  const readBack = page.waitForResponse(
    async (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith('/api/settings') &&
      ((await response.json()) as Settings).in_session_interval_min === 60,
  )
  release()
  await landed // Every 60 min has reached the core
  await readBack // and the page has read it back
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).in_session_interval_min).toBe(0)
  expect(saves).toEqual([{ in_session_interval_min: 60 }, { in_session_interval_min: 0 }])
  await expect(interval).toHaveValue('0')
  // The control did not go back to Every 60 min when the page read it back.
  expect(await page.evaluate(() => (window as unknown as { shown: string[] }).shown)).toEqual(['60', '0'])
})

test('syncing can be paused here and resumed from the plate', async ({ page }) => {
  const pause = syncGroup(page).getByRole('button', { name: 'Pause syncing' })
  await expect(pause).toHaveAttribute('aria-pressed', 'false')
  await pause.click()
  await expect(page.getByTestId('sync')).toContainText('Syncing paused')
  await expect(pause).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('sync').getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(page.getByTestId('sync')).not.toContainText('Syncing paused')
  await expect(pause).toHaveAttribute('aria-pressed', 'false')
})

test('the sync log opens under its link, lists the last runs, newest first, and closes', async ({ page, api }) => {
  await expect(page.getByRole('region', { name: 'Sync log' })).toHaveCount(0)
  const log = await openSyncLog(page)
  await expect(syncGroup(page)).toContainText('It never syncs more than once in 5 minutes or more than 24 times a day.')
  await expect(log.getByRole('row')).toHaveCount(51) // the heading row and 50 runs
  await expect(log.getByRole('row').nth(1)).toHaveText(/Start-up\s*OK/)
  await api.fault('error')
  expect(await api.sync()).toBe('error')
  await expect(log.getByRole('row').nth(1)).toHaveText(/Sync now\s*Failed\s*The sync failed unexpectedly\. See the log file\./)
  await syncGroup(page).getByRole('button', { name: 'Hide the sync log' }).click()
  await expect(log).toHaveCount(0)
})

test('start with windows is a saved choice', async ({ page, api }) => {
  const box = guildBoard(page).getByRole('button', { name: 'Start with Windows' })
  await expect(box).toHaveAttribute('aria-pressed', 'false')
  await box.click()
  await expect(box).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).start_with_windows).toBe(true)
  await expect(guildBoard(page)).toContainText('This takes effect when Guild Board runs in its own window.')
})

/** The commission region and the fishing rule as the core holds them. */
async function regionAndFishing(api: Api): Promise<[string, string]> {
  const settings = await api.get<Settings>('/api/settings')
  return [settings.commission_region, settings.fishing_rule]
}

test('the commission region and the fishing rule are saved and reread', async ({ page, api }) => {
  const section = achievements(page)
  const region = section.getByRole('combobox', { name: 'Commission region' })
  const fishing = section.getByRole('radiogroup', { name: 'Fishing spots come back' })
  const nextReset = fishing.getByRole('radio', { name: 'At the next daily reset' })
  await expect(region).toHaveValue('liyue')
  await expect(region.getByRole('option')).toHaveText(['Mondstadt', 'Liyue', 'Inazuma', 'Sumeru', 'Fontaine', 'Natlan'])
  await expect(section).toContainText('HoYoLAB does not say which region you chose in the game.')
  await expect(fishing.getByRole('radio')).toHaveText(['After 3 days', 'At the next daily reset'])
  await expect(fishing.getByRole('radio', { name: 'After 3 days' })).toHaveAttribute('aria-checked', 'true')
  await expect(section).toContainText('Guides disagree. Pick what you see in the game; every fishing spot follows it.')
  await region.selectOption({ label: 'Natlan' })
  await nextReset.click()
  await expect(region).toHaveValue('natlan')
  await expect(nextReset).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => regionAndFishing(api)).toEqual(['natlan', 'next_reset'])
  await page.reload()
  await expect(region).toHaveValue('natlan')
  await expect(nextReset).toHaveAttribute('aria-checked', 'true')
})

test('the Achievements page follows a new commission region and fishing rule without a reload', async ({ page, api }) => {
  const section = achievements(page)
  await section.getByRole('combobox', { name: 'Commission region' }).selectOption({ label: 'Mondstadt' })
  await section.getByRole('radiogroup', { name: 'Fishing spots come back' })
    .getByRole('radio', { name: 'At the next daily reset' }).click()
  await expect.poll(() => regionAndFishing(api)).toEqual(['mondstadt', 'next_reset'])
  // Through the rail, as the player goes there.
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Achievements' }).click()
  const categories = page.getByRole('navigation', { name: 'Categories' })
  // Four are left in Mondstadt, three in Liyue, where Settings starts.
  await expect(categories.getByRole('button', { name: 'Daily commissions' })).toHaveText('Daily commissions 4')
  await categories.getByRole('button', { name: 'Timers' }).click()
  // The demo emptied Cider Lake (1) 24 hours ago: a daily reset has come since, but not 3 days. The rule is in the
  // timer's panel, which its card's More opens.
  const cider = 'Fishing spot · Cider Lake (1), Mondstadt'
  await page.getByRole('region', { name: 'Ready now', exact: true })
    .getByRole('article', { name: cider, exact: true }).getByRole('button', { name: 'More', exact: true }).click()
  await expect(page.getByRole('region', { name: cider, exact: true })).toContainText(
    'Fish come back at the next daily reset. Guides disagree, so Settings → Achievements can change this for every fishing spot.',
  )
  await categories.getByRole('button', { name: 'Daily commissions' }).click()
  await expect(page.getByRole('radiogroup', { name: 'Region' }).getByRole('radio', { name: 'Mondstadt 4', exact: true }))
    .toHaveAttribute('aria-checked', 'true')
})

test('notifications can be turned off and on', async ({ page, api }) => {
  const box = guildBoard(page).getByRole('button', { name: 'Notifications' })
  await expect(guildBoard(page)).toContainText('A Windows notification when a timer is ready')
  await expect(box).toHaveAttribute('aria-pressed', 'true')
  await box.click()
  await expect(box).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).notifications).toBe(false)
  await page.reload()
  await expect(box).toHaveAttribute('aria-pressed', 'false')
  await box.click()
  await expect(box).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).notifications).toBe(true)
})

test('a test notification on the demo core says the tray is not running here', async ({ page }) => {
  // The browser tests' cores run without Guild Board's window and tray, so no notification can show.
  await guildBoard(page).getByRole('button', { name: 'Send a test notification' }).click()
  await expect(guildBoard(page).getByRole('status')).toHaveText(
    "Notifications come from Guild Board's tray icon, which is not running here.",
  )
})

test('a test notification that was sent says where it shows', async ({ page }) => {
  // The core's answer is made up here, so the request never reaches a core, and Windows shows nothing.
  await page.route('**/api/notifications/test', (route) => route.fulfill({ json: { sent: true } }))
  await guildBoard(page).getByRole('button', { name: 'Send a test notification' }).click()
  await expect(guildBoard(page).getByRole('status')).toHaveText(
    'Sent. It shows in the corner of the screen, or in the notification centre while Do not disturb is on.',
  )
})

test("the overlay's row names its hotkey, and its Change opens every overlay setting in place", async ({ page }) => {
  await expect(guildBoard(page)).toContainText('A small panel over the game · Ctrl+Alt+G')
  await expect(guildBoard(page).getByRole('group', { name: 'Overlay', exact: true })).toHaveCount(0)
  const overlay = await openOverlay(page)
  // Under the Overlay row, in its group.
  const row = await guildBoard(page).getByText('A small panel over the game').boundingBox()
  expect((await overlay.boundingBox())!.y).toBeGreaterThan(row!.y)
  await guildBoard(page).getByRole('button', { name: 'Change', exact: true }).click()
  await expect(overlay).toHaveCount(0)
})

test('lines over the game can be turned off with the overlay', async ({ page, api }) => {
  const overlay = await openOverlay(page)
  const box = overlay.getByRole('button', { name: 'Lines over the game' })
  await expect(overlay).toContainText('While the game runs, a line at the top of the overlay says when a timer is ready.')
  await expect(box).toHaveAttribute('aria-pressed', 'true')
  await box.click()
  await expect(box).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).overlay_lines).toBe(false)
  await page.reload()
  await expect(await openOverlay(page)).toBeVisible()
  await expect(box).toHaveAttribute('aria-pressed', 'false')
  // Windows notifications are a setting of their own.
  await expect(guildBoard(page).getByRole('button', { name: 'Notifications' })).toHaveAttribute('aria-pressed', 'true')
})

test('the overlay settings save, and a hotkey that types a letter is refused with the reason', async ({ page, api }) => {
  const overlay = await openOverlay(page)
  // The browser tests' cores run without Guild Board's window, which makes the overlay. The settings still save.
  await expect(overlay).toContainText('The overlay shows over the game when Guild Board runs with its window.')
  await expect(overlay).not.toContainText('opens and closes the overlay')
  const hotkey = overlay.getByRole('textbox', { name: 'Hotkey' })
  const save = overlay.getByRole('button', { name: 'Save hotkey' })
  const refusal = overlay.getByRole('status')
  await expect(hotkey).toHaveValue('Ctrl+Alt+G')
  // AltGr+E on the player's Polish keyboard: Windows reports AltGr as Ctrl+Alt, and the key types "ę".
  await hotkey.dispatchEvent('keydown', { key: 'ę', code: 'KeyE', ctrlKey: true, altKey: true })
  await expect(hotkey).toHaveValue('Ctrl+Alt+E')
  await save.click()
  await expect(refusal).toHaveText('Ctrl+Alt+E types a letter on your keyboard. Choose another key.')
  expect((await api.get<Settings>('/api/settings')).overlay_hotkey).toBe('Ctrl+Alt+G')
  await hotkey.press('Control') // a modifier alone records nothing yet
  await hotkey.press('Shift+Slash') // nor does a key outside A to Z, 0 to 9 and F1 to F12
  await expect(hotkey).toHaveValue('Ctrl+Alt+E')
  await expect(refusal).toBeVisible() // so the refusal is still about the keys shown
  await hotkey.press('Control+Shift+Digit7') // the key's place on the keyboard, not what it types ("&")
  await expect(hotkey).toHaveValue('Ctrl+Shift+7')
  await expect(refusal).toHaveCount(0) // it was about other keys
  await hotkey.press('Control+Alt+Shift+Meta+F12') // Meta is the Windows key
  await expect(hotkey).toHaveValue('Ctrl+Alt+Shift+Win+F12')
  await hotkey.press('Control+Shift+F9')
  await expect(hotkey).toHaveValue('Ctrl+Shift+F9')
  await save.click()
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).overlay_hotkey).toBe('Ctrl+Shift+F9')
  await expect(refusal).toHaveCount(0)
  // The row names the new hotkey.
  await expect(guildBoard(page)).toContainText('A small panel over the game · Ctrl+Shift+F9')
  // Without the window, no display is listed: the overlay covers the main display.
  const display = overlay.getByRole('group', { name: 'Display' })
  await expect(display.getByRole('radio')).toHaveCount(1)
  await expect(display.getByRole('radio', { name: 'The main display' })).toBeChecked()
  const pinned = overlay.getByRole('button', { name: 'Show pinned widgets over the game' })
  await expect(pinned).toHaveAttribute('aria-pressed', 'true')
  await pinned.click()
  await expect(pinned).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).overlay_pinned).toBe(false)
  await page.reload()
  await openOverlay(page)
  await expect(hotkey).toHaveValue('Ctrl+Shift+F9')
  await expect(pinned).toHaveAttribute('aria-pressed', 'false')
})

test('the opacity slider saves its value', async ({ page, api }) => {
  const overlay = await openOverlay(page)
  const slider = overlay.getByRole('slider', { name: "Pinned widgets' opacity" })
  // The value shown beside the slider (the Size choice above has percents of its own).
  const shown = slider.locator('xpath=following-sibling::span[1]')
  await expect(slider).toHaveValue('100')
  await expect(shown).toHaveText('100%')
  await expect(overlay).toContainText('Lower lets more of the game show through them.')
  // The Display choice above the slider shows once the overlay's status is read, and moves the slider down: the drag
  // below is aimed at where the slider is after that.
  await expect(overlay.getByRole('radio', { name: 'The main display' })).toBeVisible()
  const saves: unknown[] = []
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/api/settings')) saves.push(request.postDataJSON())
  })
  // A drag: the value beside the slider follows it, and the setting is saved once, when the slider is let go. The
  // slider is brought into the window first: it can lie below the window's bottom.
  await slider.scrollIntoViewIfNeeded()
  const box = (await slider.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2, { steps: 4 })
  const held = Number(await slider.inputValue())
  expect(held).toBeLessThan(100)
  await expect(shown).toHaveText(`${held}%`)
  await page.mouse.up()
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).overlay_opacity).toBe(held)
  expect(saves).toEqual([{ overlay_opacity: held }])
  // A key moves it one step of 5, and that step is saved.
  await slider.press('ArrowRight')
  await expect(shown).toHaveText(`${held + 5}%`)
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).overlay_opacity).toBe(held + 5)
  await page.reload()
  await openOverlay(page)
  await expect(slider).toHaveValue(String(held + 5))
})

test("the overlay's size is a size in percent, 100% unless another is chosen, and is saved", async ({ page, api }) => {
  const overlay = await openOverlay(page)
  const size = overlay.getByRole('radiogroup', { name: 'Size' })
  await expect(size.getByRole('radio')).toHaveText(['100%', '125%', '150%', '175%', '200%'])
  await expect(size.getByRole('radio', { name: '100%' })).toHaveAttribute('aria-checked', 'true')
  await expect(overlay).not.toContainText('Automatic')
  // It follows Display, which shows once the overlay's status is read.
  await expect(overlay.getByRole('radio', { name: 'The main display' })).toBeVisible()
  const parts = await overlay.evaluate((section) =>
    [...section.querySelectorAll('legend, [role="radiogroup"]')].map((part) => part.getAttribute('aria-label') ?? part.textContent),
  )
  expect(parts).toEqual(['Display', 'Size'])
  await size.getByRole('radio', { name: '150%' }).click()
  await expect(size.getByRole('radio', { name: '150%' })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).overlay_size).toBe(150)
  await page.reload()
  await openOverlay(page)
  await expect(size.getByRole('radio', { name: '150%' })).toHaveAttribute('aria-checked', 'true')
  await size.getByRole('radio', { name: '100%' }).click()
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).overlay_size).toBe(100)
})

test("with Guild Board's window, a display can be chosen and the hotkey's state is said", async ({ page, api }) => {
  // The browser tests' cores run without the window, so what its shell reports is made up here.
  let hotkeyState: OverlayStatus['hotkey_state'] = 'held'
  let mainListed = true // whether the shell names one of the displays the main one
  await changeAnswer<OverlayStatus>(page, '/api/overlay', (data) => {
    data.available = true
    data.hotkey_state = hotkeyState
    data.displays = [
      { name: '\\\\.\\DISPLAY1', label: 'Display 1, 2560 × 1440', primary: mainListed },
      { name: '\\\\.\\DISPLAY2', label: 'Display 2, 1920 × 1080', primary: false },
    ]
  })
  // The answer is held at first: the displays show once the shell's list is read, and the main display does not show
  // alone before it.
  const { held, release } = holding()
  await page.route('**/api/overlay*', async (route) => {
    await held
    await route.fallback()
  })
  await page.reload()
  const overlay = await openOverlay(page)
  await expect(overlay.getByRole('textbox', { name: 'Hotkey' })).toBeVisible()
  await expect(overlay.getByRole('group', { name: 'Display' })).toHaveCount(0)
  release()
  await expect(overlay).toContainText('Ctrl+Alt+G opens and closes the overlay.')
  await expect(overlay).not.toContainText('when Guild Board runs with its window')
  const display = overlay.getByRole('group', { name: 'Display' })
  const first = display.getByRole('radio', { name: 'Display 1, 2560 × 1440' })
  const second = display.getByRole('radio', { name: 'Display 2, 1920 × 1080' })
  await expect(display.getByRole('radio')).toHaveCount(2)
  await expect(first).toBeChecked() // the main display, while none is chosen
  await second.click()
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).overlay_display).toBe('\\\\.\\DISPLAY2')
  hotkeyState = 'taken'
  await page.reload()
  await openOverlay(page)
  await expect(overlay).toContainText('Another program uses Ctrl+Alt+G. Choose another.')
  await expect(overlay).not.toContainText('opens and closes the overlay')
  await expect(second).toBeChecked()
  // The display chosen is not listed any more, unplugged say: the overlay covers the main display.
  await api.put('/api/settings', { overlay_display: '\\\\.\\DISPLAY9' })
  await page.reload()
  await openOverlay(page)
  await expect(first).toBeChecked()
  // And the first listed, should the shell name none of them the main display.
  mainListed = false
  await page.reload()
  await openOverlay(page)
  await expect(first).toBeChecked()
})

test('the picture quality is a plain choice of three, High until chosen, and it is saved', async ({ page, api }) => {
  const row = guildBoard(page).locator('.set-row', { hasText: 'Picture quality' })
  await expect(row).toContainText('High keeps the big pictures as they are. Medium and Low make them smaller, which saves memory.')
  const choice = row.getByRole('radiogroup', { name: 'Picture quality' })
  await expect(choice.getByRole('radio')).toHaveText(['High', 'Medium', 'Low'])
  await expect(choice.getByRole('radio', { name: 'High' })).toHaveAttribute('aria-checked', 'true')
  const widths = await choice.getByRole('radio').evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().width)))
  expect(new Set(widths).size, 'the three buttons are the same size').toBe(1)
  await choice.getByRole('radio', { name: 'Low' }).click()
  await expect(choice.getByRole('radio', { name: 'Low' })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).picture_quality).toBe('low')
  await page.reload()
  await expect(choice.getByRole('radio', { name: 'Low' })).toHaveAttribute('aria-checked', 'true')
  await choice.getByRole('radio', { name: 'High' }).click()
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).picture_quality).toBe('high')
})

test('Settings has no Smooth animations row any more: the window draws at the monitor rate', async ({ page, api }) => {
  await expect(guildBoard(page).locator('.set-row', { hasText: 'Picture quality' })).toBeVisible() // the page has drawn
  await expect(guildBoard(page).locator('.set-row', { hasText: 'Smooth animations' })).toHaveCount(0)
  expect(await api.get<Settings>('/api/settings')).not.toHaveProperty('smooth_animations')
})

test('the gallery switch saves gallery_enabled, and the gallery is not asked while it is off', async ({ page, api }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/gallery')) asked.push(request.url())
  })
  const gallery = extras(page).getByRole('button', { name: 'Screenshot gallery' })
  await expect(extras(page)).toContainText(
    'Shows the photos you take in the game. Guild Board only looks at them, never moves or deletes one.',
  )
  await expect(gallery).toHaveAttribute('aria-pressed', 'false')
  expect(asked).toEqual([])
  await gallery.click()
  await expect(gallery).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).gallery_enabled).toBe(true)
  await page.reload()
  await expect(gallery).toHaveAttribute('aria-pressed', 'true')
  // A gallery that cannot be read, as before it is built, asks for no folder.
  await expect(extras(page).getByRole('textbox')).toHaveCount(0)
  await gallery.click()
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).gallery_enabled).toBe(false)
})

test("when the gallery cannot find the game's screenshot folder, a pasted path is saved", async ({ page, api }) => {
  let missing = true
  await page.route('**/api/gallery', (route) => route.fulfill({ json: { folder_missing: missing } }))
  await api.put('/api/settings', { gallery_enabled: true })
  await page.reload()
  const field = extras(page).getByRole('textbox', {
    name: "Guild Board could not find the game's screenshot folder. Paste its path:",
  })
  await expect(field).toBeVisible()
  await field.fill('D:\\Games\\Genshin Impact Game\\ScreenShot')
  missing = false
  await extras(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).gallery_folder)
    .toBe('D:\\Games\\Genshin Impact Game\\ScreenShot')
  // The gallery is asked again, and finds it.
  await expect(field).toHaveCount(0)
  // While the gallery is off, nothing is asked for.
  missing = true
  await api.put('/api/settings', { gallery_enabled: false })
  await page.reload()
  await expect(extras(page).getByRole('button', { name: 'Screenshot gallery' })).toHaveAttribute('aria-pressed', 'false')
  await expect(field).toHaveCount(0)
})

test('currency and a corrected price save, and change the Ledger\'s "Spent" figure', async ({ page, api }) => {
  const currency = extras(page).getByRole('combobox', { name: 'Spending in' })
  await expect(currency).toHaveValue('USD')
  await currency.selectOption({ label: 'Euro' })
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).spending_currency).toBe('EUR')
  const before = (await api.get<Ledger>('/api/ledger')).spent
  const welkin = before.rows.find((row) => row.id === 'welkin')
  expect(before.currency).toBe('EUR')
  expect(welkin?.count).toBeGreaterThan(0)

  const edit = extras(page).getByRole('button', { name: 'Edit prices' })
  await edit.click()
  await expect(edit).toHaveAttribute('aria-expanded', 'true')
  const prices = extras(page).getByRole('group', { name: 'Prices' })
  const field = prices.getByRole('spinbutton', { name: 'Blessing of the Welkin Moon' })
  await expect(field).toHaveValue('') // empty: the official price
  await expect(prices.getByRole('row', { name: /Blessing of the Welkin Moon/ })).toContainText(welkin!.each.toFixed(2))
  await expect(prices.getByRole('spinbutton')).toHaveCount(8)
  await field.fill('100')
  await field.press('Enter')
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).spending_prices).toEqual({ EUR: { welkin: 100 } })
  const after = (await api.get<Ledger>('/api/ledger')).spent
  expect(after.total).toBeCloseTo(before.total + welkin!.count * (100 - welkin!.each), 2)

  await page.goto(`${new URL(page.url()).origin}/#/ledger`)
  await expect(page.getByTestId('ledger-spent')).toContainText(money(after.total, 'EUR'))

  // Emptied, the price goes back to the official one.
  await page.goto(`${new URL(page.url()).origin}/#/settings`)
  await extras(page).getByRole('button', { name: 'Edit prices' }).click()
  const again = extras(page).getByRole('group', { name: 'Prices' }).getByRole('spinbutton', { name: 'Blessing of the Welkin Moon' })
  await expect(again).toHaveValue('100')
  await again.fill('')
  await again.press('Enter')
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).spending_prices).toEqual({ EUR: {} })
  expect((await api.get<Ledger>('/api/ledger')).spent.total).toBeCloseTo(before.total, 2)
})

test('the export says in one sentence what a backup file holds, and that the login never goes in it', async ({ page }) => {
  // A file passed on shows what it holds to whoever opens it (audit DB-10).
  const line = yourData(page).getByTestId('backup-holds')
  await expect(line).toHaveText(
    'A backup file holds all your data, including your ledger with what you spent on top-ups, your wishes, play sessions and ' +
      "settings, what HoYoLAB sent, and your online account's ID, but never your HoYoLAB login or your online session.",
  )
  const [button, said] = [await yourData(page).getByRole('button', { name: 'Export backup…' }).boundingBox(), await line.boundingBox()]
  expect(button && said && said.y > button.y && said.y - button.y < 60).toBe(true) // under the export
})

test('a backup can be made from the page, and the last one is named', async ({ page }) => {
  const data = yourData(page)
  await expect(data).toContainText('a copy is kept each day for 14 days')
  await data.getByRole('button', { name: 'Back up now' }).click()
  await expect(data.getByRole('status')).toHaveText(/^Saved guildboard-manual-\d{8}-\d{6}\.db in the backups folder\.$/)
  await expect(data).toContainText(/Last backup .+ · a copy is kept each day for 14 days/)
})

test('the restore lists the copies and asks before a restore', async ({ page }) => {
  const data = yourData(page)
  await data.getByRole('button', { name: 'Back up now' }).click()
  await expect(data.getByRole('status')).toContainText('Saved guildboard-manual-')
  const restore = data.getByRole('button', { name: 'Restore a backup' })
  await expect(restore).toHaveAttribute('aria-expanded', 'false')
  await restore.click()
  await expect(restore).toHaveAttribute('aria-expanded', 'true')
  const list = data.getByRole('list', { name: 'Backups you can restore' })
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(list.getByRole('listitem').first()).toContainText('Made by you')
  await list.getByRole('button', { name: 'Restore' }).click()
  await expect(data.getByRole('alertdialog')).toContainText('Guild Board restarts.')
  await data.getByRole('button', { name: 'Cancel' }).click()
  await expect(data.getByRole('alertdialog')).toHaveCount(0)
})

test('a backup file goes to the core as it is, and a refusal is shown', async ({ page }) => {
  // The page's request is checked here, and the core's answer is made up: the core's side of the raw restore is its own
  // (tests/test_backups.py). The file is the body as it is, its name in the address (audit L27).
  const sent: { type: string | undefined; name: string | null; body: string }[] = []
  await page.route('**/api/backup/restore*', async (route) => {
    const request = route.request()
    sent.push({
      type: request.headers()['content-type'],
      name: new URL(request.url()).searchParams.get('file_name'),
      body: request.postDataBuffer()?.toString('utf8') ?? '',
    })
    await route.fulfill({ status: 422, json: { error: 'This file is not a Guild Board backup.' } })
  })
  const data = yourData(page)
  await data.getByRole('button', { name: 'Restore a backup' }).click()
  await data.getByLabel('Backup file').setInputFiles({
    name: 'not a #backup.gbbackup', mimeType: 'application/octet-stream', buffer: Buffer.from('hello'),
  })
  await data.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click()
  await expect(data.getByRole('status')).toHaveText('This file is not a Guild Board backup.')
  expect(sent).toEqual([{ type: 'application/octet-stream', name: 'not a #backup.gbbackup', body: 'hello' }])
})

test('opening the folder needs the window', async ({ page }) => {
  await yourData(page).getByRole('button', { name: 'Open folder' }).click()
  await expect(yourData(page).getByRole('status')).toHaveText('This needs the Guild Board window.')
})

test('no raw path is printed', async ({ page, api }) => {
  const status = await api.get<Status>('/api/status')
  await expect(yourData(page).getByTestId('import-panel')).toBeVisible()
  await expect(page.getByRole('main')).not.toContainText(status.data_dir)
  await expect(page.getByRole('main')).not.toContainText(/[A-Z]:\\/)
})

test('what Guild Board never does opens in a dialog with the risk, and names the ledgers and the gallery', async ({ page }) => {
  await page.getByTestId('settings-foot').getByRole('button', { name: 'What Guild Board never does' }).click()
  const dialog = page.getByRole('dialog', { name: 'What Guild Board never does' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('listitem')).toHaveCount(9)
  await expect(dialog).toContainText(
    "It reads your wish history and your game's own history pages (primogems, crystals, resin, artifacts) with a " +
      'read-only key HoYoverse gives your HoYoLAB login, kept in memory only (or, without a login, the link the game ' +
      'writes when you open Feedback), and only reads.',
  )
  await expect(dialog).toContainText(
    "With the gallery on, it looks at the pictures in the game's ScreenShot folder and never moves, changes or deletes one.",
  )
  await expect(dialog).toContainText('The risk')
  await expect(dialog).toContainText('low-risk, but not zero-risk')
  const link = page.getByTestId('settings-foot').getByRole('button', { name: 'What Guild Board never does' })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(link).toBeFocused() // the focus goes back to the link that opened it
  await link.click()
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(link).toBeFocused()
  // A click on the dim around it closes it too.
  await link.click()
  await expect(dialog).toBeVisible()
  await page.mouse.click(5, 5)
  await expect(dialog).toHaveCount(0)
  await expect(link).toBeFocused()
})

test('the gallery is asked when its switch turns on, and not again after each sync', async ({ page, api }) => {
  const asked: string[] = []
  await page.route('**/api/gallery', (route) => {
    asked.push(route.request().url())
    return route.fulfill({ json: { folder_missing: false } })
  })
  await extras(page).getByRole('button', { name: 'Screenshot gallery' }).click()
  await expect.poll(() => asked.length).toBe(1)
  // The sync's news makes the page read its models again: the backups' list is read again, and the gallery is not.
  const readAgain = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/backups')
  await api.sync()
  await readAgain
  await page.waitForTimeout(300)
  expect(asked).toHaveLength(1)
})

test("what's new opens the notes of this version", async ({ page, api }) => {
  const status = await api.get<Status>('/api/status')
  await page.getByTestId('settings-foot').getByRole('button', { name: "What's new" }).click()
  const modal = page.getByTestId('changes-modal')
  await expect(modal).toContainText(`Guild Board ${status.version}`)
  await modal.getByRole('button', { name: 'Got it' }).click()
  await expect(modal).toHaveCount(0)
})

test('the column keeps 760 pixels at most and stands in the middle, at 1,640 and 2,560 pixels', async ({ page }) => {
  for (const width of [1640, 2560]) {
    await page.setViewportSize({ width, height: 1200 })
    const column = (await page.locator('main .set').boundingBox())!
    expect(column.width).toBeLessThanOrEqual(760)
    // In the middle of the main area, right of the rail and its padding.
    const [start, end] = await page.getByRole('main').evaluate((main) => {
      const box = main.getBoundingClientRect()
      const style = getComputedStyle(main)
      return [box.left + parseFloat(style.paddingLeft), box.right - parseFloat(style.paddingRight)]
    })
    expect(Math.abs(column.x - start - (end - column.x - column.width))).toBeLessThan(2)
  }
})

test('the text is 13 pixels or larger', async ({ page }) => {
  await openSyncLog(page)
  await openOverlay(page)
  const small = await page.locator('main .set').evaluate((column) =>
    [...column.querySelectorAll('*')]
      .filter((element) => [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent!.trim() !== ''))
      .filter((element) => parseFloat(getComputedStyle(element).fontSize) < 13)
      .map((element) => `${element.tagName} ${element.className}: ${element.textContent}`),
  )
  expect(small).toEqual([])
})

test.describe('with a real account', () => {
  test.use({ mode: 'live' })

  test('before the login, the account section offers it', async ({ page }) => {
    const account = page.getByRole('region', { name: 'Account' })
    await expect(account).toContainText('Not logged in')
    await account.getByRole('button', { name: 'Log in to HoYoLAB' }).click()
    await expect(account.getByRole('status')).toHaveText('This needs the Guild Board window.')
    await expect(await openSyncLog(page)).toContainText('A HoYoLAB login is needed.')
  })

  test('logging out asks first', async ({ page }) => {
    // This core has no login, so the page is shown one: the status answer is edited, and the live
    // events are cut so that only the edited answer reaches the page.
    await page.route('**/api/events', (route) => route.abort())
    await changeAnswer<Status>(page, '/api/status', (data) => {
      data.account = {
        nickname: 'Lumine', server: 'os_euro', uid: 712345678, adventure_rank: 58, days_active: 900, resin: 120, resin_max: 200,
        resin_read_at: '2026-10-13T07:50:00+00:00',
        resin_full_at: null, picture_url: null,
      }
    })
    await page.reload()
    const account = page.getByRole('region', { name: 'Account' })
    await expect(account).toContainText('Europe · UID 712345678 · logged in to HoYoLAB')
    await account.getByRole('button', { name: 'Log out' }).click()
    await expect(account).toContainText('Logging out deletes the saved login from this PC. Your history stays.')
    await account.getByRole('button', { name: 'Cancel' }).click()
    await expect(account).not.toContainText('Logging out deletes')
    await account.getByRole('button', { name: 'Log out' }).click()
    const sent = page.waitForRequest((request) => request.url().endsWith('/api/auth/logout') && request.method() === 'POST')
    await account.getByRole('button', { name: 'Log out' }).click()
    await sent
  })
})


/*
 * Sync my data and the first sync (the online plan, Task C5). The demo has no account to sync with, so its online view says
 * `sync: null`: these tests give the page the view of a core that has one, and cut the live events so that only that view reaches
 * it. What the buttons send is seen on the wire; the demo's core answers the routes with its own view and moves nothing.
 */
test.describe('Sync my data', () => {
  async function withSync(page: Page, sync: OnlineView['sync'], usage: OnlineView['usage'] = null) {
    await page.route('**/api/events', (route) => route.abort())
    await changeAnswer<Status>(page, '/api/status', (data) => {
      data.online.sync = sync
      data.online.usage = usage
    })
    await page.reload()
  }

  const ON = { on: true, last_at: null, needs_choice: false }
  const SIXTH = { rows_held: 1_911, rows_limit: 20_000, bytes_held: 739_328, bytes_limit: 4_194_304, has_place: true, seats_full: false }

  test('shows the room the copy takes, in plain units, once the core has read it', async ({ page }) => {
    await withSync(page, ON, SIXTH)
    const space = online(page).getByTestId('cloud-space')
    await expect(space).toContainText('Cloud space: 722 KB of 4 MB used')
    await expect(space).toContainText('1,911 of 20,000 items')
    await expect(space).not.toContainText('Sync will stop')
    // The meter grows once as it appears: it is measured when it has stopped.
    await expect
      .poll(async () => {
        const [track, fill] = await Promise.all([space.locator('.bar').boundingBox(), space.locator('.bar-fill').boundingBox()])
        return Math.round((fill!.width / track!.width) * 100)
      })
      .toBe(18) // 739,328 of 4,194,304 bytes
  })

  test('says that sync will stop, from 90 percent of the room', async ({ page }) => {
    await withSync(page, ON, { ...SIXTH, bytes_held: 3_900_000 })
    await expect(online(page).getByTestId('cloud-space')).toContainText(
      'Sync will stop taking new changes when this space is full. They stay on this PC.',
    )
  })

  test('says only that no place is free to an account that holds none', async ({ page }) => {
    await withSync(page, ON, { ...SIXTH, rows_held: 0, bytes_held: 0, has_place: false, seats_full: true })
    const space = online(page).getByTestId('cloud-space')
    await expect(space).toContainText(
      'All the places for syncing are taken right now. Your data stays on this PC, and friends and stats still work.',
    )
    await expect(space.locator('.bar')).toHaveCount(0)
  })

  test('shows nothing of the room while the core has not read it, with the switch off, or while the question waits', async ({ page, api }) => {
    await withSync(page, ON, null)
    await expect(online(page)).toContainText('Your data is copied to your account')
    await expect(online(page)).not.toContainText('Cloud space')
    await withSync(page, { ...ON, needs_choice: true }, SIXTH)
    await expect(online(page)).toContainText('Waiting for your choice below')
    await expect(online(page)).not.toContainText('Cloud space')
    await api.put('/api/settings', { sync_my_data: false })
    await withSync(page, ON, SIXTH)
    await expect(online(page)).toContainText('Your data stays on this PC')
    await expect(online(page)).not.toContainText('Cloud space')
  })

  test('the page below does not move when the room arrives, nor when the warning does', async ({ page }) => {
    const below = async () => (await syncGroup(page).boundingBox())!.y
    await withSync(page, ON, null)
    await expect(online(page)).toContainText('Your data is copied to your account')
    const before = await below()
    await withSync(page, ON, SIXTH)
    await expect(online(page)).toContainText('Cloud space')
    expect(await below()).toBe(before)
    await withSync(page, ON, { ...SIXTH, bytes_held: 3_900_000 })
    await expect(online(page)).toContainText('Sync will stop')
    expect(await below()).toBe(before)
    await withSync(page, ON, { ...SIXTH, has_place: false, seats_full: true })
    await expect(online(page)).toContainText('All the places for syncing are taken')
    expect(await below()).toBe(before)
  })

  test('the demo has no row for it', async ({ page }) => {
    await expect(online(page)).toContainText('Signed in with Discord as Traveler#2048')
    await expect(online(page).getByText('Sync my data')).toHaveCount(0)
  })

  test('is a switch, on once signed in, with the time of the last sync and a button to sync now', async ({ page }) => {
    await withSync(page, { on: true, last_at: '2026-10-13T08:00:00Z', needs_choice: false })
    const box = online(page)
    const row = box.locator('.set-row').filter({ hasText: 'Sync my data' })
    await expect(row.getByRole('button', { name: 'Sync my data' })).toHaveAttribute('aria-pressed', 'true')
    await expect(row).toContainText(`Your data is copied to your account · last synced ${localTime('2026-10-13T08:00:00Z')}`)
    const sent = page.waitForRequest((request) => request.url().endsWith('/api/online/sync') && request.method() === 'POST')
    await row.getByRole('button', { name: 'Sync now' }).click()
    await sent
  })

  test('says that nothing was synced yet', async ({ page }) => {
    await withSync(page, { on: true, last_at: null, needs_choice: false })
    await expect(online(page)).toContainText('Your data is copied to your account · not synced yet')
  })

  test('turned off, it is saved, and the data stays on this PC with no button to sync now', async ({ page, api }) => {
    await withSync(page, { on: true, last_at: null, needs_choice: false })
    const row = online(page).locator('.set-row').filter({ hasText: 'Sync my data' })
    await row.getByRole('button', { name: 'Sync my data' }).click()
    await expect(row).toContainText('Your data stays on this PC')
    await expect(row.getByRole('button', { name: 'Sync now' })).toHaveCount(0)
    await expect.poll(async () => (await api.get<Settings>('/api/settings')).sync_my_data).toBe(false)
    await page.reload()
    await expect(row.getByRole('button', { name: 'Sync my data' })).toHaveAttribute('aria-pressed', 'false')
    await row.getByRole('button', { name: 'Sync my data' }).click()
    await expect.poll(async () => (await api.get<Settings>('/api/settings')).sync_my_data).toBe(true)
  })

  test('is not there signed out', async ({ page }) => {
    await withSync(page, { on: true, last_at: null, needs_choice: false })
    await online(page).getByRole('button', { name: 'Sign out' }).click()
    await expect(online(page)).toContainText('Sign in to add friends')
    await expect(online(page).getByText('Sync my data')).toHaveCount(0)
  })

  test('asks once when this PC and the account both hold data, with what each answer replaces', async ({ page }) => {
    await withSync(page, { on: true, last_at: null, needs_choice: true })
    const asking = online(page).getByRole('group', { name: 'Which data to keep' })
    await expect(asking).toContainText('This PC and your account both hold data.')
    await expect(asking).toContainText("Replaces the data on your account with this PC's, or sends only this PC's changed settings if that is all it holds.")
    await expect(asking).toContainText("Replaces this PC's data with your account's. A backup of this PC's data is made first.")
    await expect(online(page)).toContainText('Waiting for your choice below')
    await expect(online(page).getByRole('button', { name: 'Sync now' })).toHaveCount(0)

    // The two answers are buttons of one size, one under the other.
    const [keep, use] = await Promise.all([
      asking.getByRole('button', { name: "Keep this PC's data" }).boundingBox(),
      asking.getByRole('button', { name: "Use the account's data" }).boundingBox(),
    ])
    expect(keep?.width).toBe(use?.width)
    expect(keep?.x).toBe(use?.x)
    expect(use!.y).toBeGreaterThan(keep!.y + keep!.height - 1)
  })

  for (const [button, choice] of [["Keep this PC's data", 'keep'], ["Use the account's data", 'use']] as const) {
    test(`${button} sends ${choice}`, async ({ page }) => {
      await withSync(page, { on: true, last_at: null, needs_choice: true })
      const sent = page.waitForRequest((request) => request.url().endsWith('/api/online/first-sync') && request.method() === 'POST')
      await online(page).getByRole('group', { name: 'Which data to keep' }).getByRole('button', { name: button }).click()
      expect((await sent).postDataJSON()).toEqual({ choice })
    })
  }

  test('does not ask while the switch is off', async ({ page, api }) => {
    await api.put('/api/settings', { sync_my_data: false })
    await withSync(page, { on: true, last_at: null, needs_choice: true })
    await expect(online(page).getByRole('group', { name: 'Which data to keep' })).toHaveCount(0)
    await expect(online(page)).toContainText('Your data stays on this PC')
  })
})

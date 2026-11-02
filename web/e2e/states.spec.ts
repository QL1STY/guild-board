import type { Page } from '@playwright/test'
import { holding } from './answers.ts'
import { expect, test } from './fixtures.ts'

/** The plate's sync part and the panel that its text opens. */
const syncPart = (page: Page) => page.getByTestId('sync')
async function openSyncPanel(page: Page) {
  await syncPart(page).locator('.gb-sync-text').click()
  const panel = page.getByTestId('sync-panel')
  await expect(panel).toBeVisible()
  return panel
}

test('everything is fine: Synced, and no note or banner', async ({ page }) => {
  await expect(syncPart(page)).toContainText('Synced')
  await expect(page.getByTestId('note')).toHaveCount(0)
  await expect(page.locator('main > .gb-banner')).toHaveCount(0)
})

test('offline', async ({ page, api }) => {
  await api.fault('offline')
  expect(await api.sync()).toBe('offline')
  await expect(syncPart(page)).toContainText('No connection')
  const panel = await openSyncPanel(page)
  await expect(panel).toContainText('No connection. Guild Board will try again at the next sync.')
  await expect(panel.getByText('Last sync').locator('xpath=..')).not.toContainText('Never') // the last success stays known
})

test('a verification check pauses syncing', async ({ page, api }) => {
  await api.fault('verification_needed')
  expect(await api.sync()).toBe('verification_needed')
  await expect(syncPart(page)).toContainText('Check needed')
  await expect(syncPart(page)).toContainText('HoYoLAB asks for a check')
  await syncPart(page).getByRole('button', { name: 'Verify', exact: true }).click()
  await expect(page.getByTestId('note')).toContainText('Demo mode has no login.')
  const panel = await openSyncPanel(page)
  await expect(panel).toContainText('HoYoLAB asked for a verification check.')
})

test('a rejected login asks to log in', async ({ page, api }) => {
  await api.fault('login_needed')
  expect(await api.sync()).toBe('login_needed')
  await expect(syncPart(page)).toContainText('Log in needed')
  await expect(syncPart(page)).toContainText('you were signed out')
  await expect(syncPart(page).getByRole('button', { name: 'Log in', exact: true })).toBeVisible()
  const panel = await openSyncPanel(page)
  await expect(panel).toContainText('Log in to HoYoLAB so that Guild Board can read your account.')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await syncPart(page).getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByTestId('note')).toContainText('Demo mode has no login.')
  await expect(page.getByTestId('note')).toHaveAttribute('data-tone', 'refused')
})

test('a switch that is off is named, and How to fix opens the panel that says which', async ({ page, api }) => {
  await api.fault('switch_off')
  expect(await api.sync()).toBe('switch_off')
  await expect(syncPart(page)).toContainText('A switch is off')
  await expect(syncPart(page)).toContainText('in HoYoLAB')
  await syncPart(page).getByRole('button', { name: 'How to fix' }).click()
  await expect(page.getByTestId('sync-panel')).toContainText('Real-Time Notes')
})

test('an unexpected error points to the sync log', async ({ page, api }) => {
  await api.fault('error')
  expect(await api.sync()).toBe('error')
  await expect(syncPart(page)).toContainText('Sync failed')
  await expect(syncPart(page)).toContainText('see the log')
  const panel = await openSyncPanel(page)
  await expect(panel).toContainText('The sync failed unexpectedly. See the log file.')
  await page.keyboard.press('Escape')
  await syncPart(page).getByRole('button', { name: 'See the log', exact: true }).click()
  await expect(page).toHaveURL(/#\/settings(\/log)?$/)
  const log = page.getByRole('region', { name: 'Sync log' })
  await expect(log).toBeInViewport()
  await expect(log.getByRole('row').nth(1)).toHaveText(/Sync now\s*Failed\s*The sync failed unexpectedly\. See the log file\./)
  // Pressed again from Settings, once the log is closed, it opens the log again.
  await page.getByRole('button', { name: 'Hide the sync log' }).click()
  await expect(log).toHaveCount(0)
  await syncPart(page).getByRole('button', { name: 'See the log', exact: true }).click()
  await expect(log).toBeVisible()
})

test('paused, and resumed from the plate', async ({ page, api }) => {
  await api.post('/api/sync/pause')
  await expect(syncPart(page)).toContainText('Syncing paused')
  await syncPart(page).getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(syncPart(page)).not.toContainText('Syncing paused')
  await expect(syncPart(page)).toContainText('Synced')
})

test('a running sync shows on the button', async ({ page, api }) => {
  await api.fault('slow')
  await api.advance(360)
  const button = page.getByRole('button', { name: /^Sync now/ })
  await expect(button).toHaveAccessibleName('Sync now')
  await button.click()
  await expect(syncPart(page)).toContainText('Syncing…')
  await expect(syncPart(page)).toContainText('reading HoYoLAB')
  await expect(button).toHaveAttribute('aria-disabled', 'true')
  await expect(button).toHaveClass(/spin/)
  await expect(button).toHaveAccessibleName(/^Sync now, in \d:\d\d$/, { timeout: 15_000 })
  await expect(syncPart(page)).toContainText('Synced')
  await expect(page.getByTestId('note')).toHaveCount(0)
})

test('the sync button counts down the wait in its ring and its name', async ({ page, api }) => {
  // A sync ran when the core started, so the five-minute wait is running.
  const button = page.getByRole('button', { name: /^Sync now/ })
  await expect(button).toHaveAccessibleName(/^Sync now, in [0-4]:\d\d$/)
  await expect(button).toBeDisabled()
  await expect(syncPart(page)).toContainText(/again in [0-4]:\d\d/)
  const arc = button.locator('circle.gb-sbtn-arc')
  const offset = async () => Number(await arc.getAttribute('stroke-dashoffset'))
  const length = 2 * Math.PI * 22
  expect(await offset()).toBeGreaterThan(0)
  expect(await offset()).toBeLessThan(length / 2) // most of the wait is left, so the ring is more than half full
  await api.advance(301)
  await expect(button).toHaveAccessibleName('Sync now')
  await expect(button).toBeEnabled()
  expect(await offset()).toBeCloseTo(length, 3) // an empty ring
})

test('a sync that the core refuses shows its reason in the note', async ({ page, api }) => {
  await api.advance(301)
  const button = page.getByRole('button', { name: /^Sync now/ })
  await expect(button).toBeEnabled()
  await page.route('**/api/sync', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ json: { started: false, reason: 'busy', wait_seconds: 0 } })
      : route.fallback(),
  )
  await button.click()
  await expect(page.getByTestId('note')).toContainText('A sync is already running.')
  await expect(page.getByTestId('note')).toHaveAttribute('data-tone', 'refused')
})

test('the page says so when the core is gone', async ({ page, core }) => {
  await expect(page.getByTestId('profile')).toContainText('AR 60')
  core.stop()
  const banner = page.locator('main > .gb-banner[role="alert"]') // the frame's, not a line of the Board's
  await expect(banner).toContainText('Guild Board is not answering. It may have been closed.', {
    timeout: 15_000,
  })
  await expect(page.getByTestId('profile')).toContainText('AR 60') // the last numbers stay on screen
  await expect(page.getByTestId('plate')).toContainText('/ 200')
})

test("a status read asked for before the event stream's hello does not put back an older status", async ({ page, api }) => {
  // The page counts the hellos it hears, so that the test knows when the page has the hello's status.
  await page.addInitScript(() => {
    const Native = window.EventSource
    window.EventSource = class extends Native {
      constructor(...args: ConstructorParameters<typeof EventSource>) {
        super(...args)
        this.addEventListener('hello', () => {
          const counted = window as Window & { hellos?: number }
          counted.hellos = (counted.hellos ?? 0) + 1
        })
      }
    }
  })
  // The first status read is answered as the core is now, while the wait after the start-up sync runs, and the answer
  // is held. The event stream opens only once the clock has moved past the wait, so its hello says the wait is over.
  const answered = holding() // let go once the core has answered the first read
  const answer = holding()
  const stream = holding()
  let statusReads = 0
  await page.route('**/api/status', async (route) => {
    statusReads += 1
    if (statusReads > 1) return route.fallback()
    const response = await route.fetch()
    answered.release()
    await answer.held
    await route.fulfill({ response })
  })
  await page.route('**/api/events', async (route) => {
    await stream.held
    await route.continue()
  })
  await page.reload()
  await answered.held
  await api.advance(301) // the stream is not open yet, so the page hears of it from the hello alone
  stream.release()
  await page.waitForFunction(() => (window as Window & { hellos?: number }).hellos === 1)
  answer.release() // the read's answer, older than the hello, arrives last
  const button = page.getByRole('button', { name: /^Sync now/ })
  await expect(button).toHaveAccessibleName('Sync now')
  await expect(button).toBeEnabled()
  expect(statusReads).toBe(1)
})

test('when the core is gone the page stops claiming to be in sync', async ({ page, api, core }) => {
  await api.advance(301) // past the wait, so that the button can be pressed
  const button = page.getByRole('button', { name: /^Sync now/ })
  await expect(button).toBeEnabled()
  core.stop()
  // The frame's banner: a widget whose data was on its way can say the same on a line of its own.
  await expect(page.locator('main > .gb-banner[role="alert"]')).toContainText('Guild Board is not answering.', {
    timeout: 15_000,
  })
  const sync = syncPart(page)
  await expect(sync).toContainText('Not connected')
  await expect(sync).not.toContainText('Synced')
  await expect(page.getByTestId('profile')).toContainText('AR 60')
  await expect(page.getByTestId('plate')).toContainText('/ 200') // the last figures stay
  await expect(button).toHaveAccessibleName('Sync now')
  await expect(button).toBeDisabled()
  await expect(page.getByTestId('game')).toHaveText('Game status unknown')
})

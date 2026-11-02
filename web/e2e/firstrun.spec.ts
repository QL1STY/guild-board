import type { Page } from '@playwright/test'
import type { Settings, Status } from '../src/types.ts'
import { changeAnswer } from './answers.ts'
import { expect, test } from './fixtures.ts'

test.use({ firstRun: true })

const LOGGED_IN: Status['account'] = {
  nickname: 'Lumine', server: 'os_euro', uid: 712345678, adventure_rank: 58, days_active: 900, resin: 120, resin_max: 200,
  resin_read_at: '2026-10-13T07:50:00+00:00',
  resin_full_at: null, picture_url: null,
}

async function acknowledge(page: Page) {
  await page.getByRole('checkbox', { name: 'I have read this and want to continue.' }).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
}

test('the first step says what is read and kept, and asks to acknowledge the risk', async ({ page, api }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Guild Board')
  await expect(page.getByText('Step 1 of 3')).toBeVisible()
  await expect(page.getByText('Unofficial and fan-made. Not affiliated with or endorsed by HoYoverse or COGNOSPHERE.')).toBeVisible()
  await expect(page.getByText("HoYoverse's terms of service restrict its services")).toBeVisible()
  await expect(page.getByText('Nothing is uploaded unless you sign in to an online account.')).toBeVisible()
  await expect(page.getByText('Reading your account through HoYoLAB with your own login is low-risk, but not zero-risk.')).toBeVisible()
  await expect(page.getByText((await api.get<Status>('/api/status')).data_dir)).toBeVisible()
  await expect(page.getByRole('navigation')).toHaveCount(0) // no rail before the acknowledgement
  const next = page.getByRole('button', { name: 'Continue', exact: true })
  await expect(next).toBeDisabled()
  await page.getByRole('checkbox', { name: 'I have read this and want to continue.' }).check()
  await expect(next).toBeEnabled()
})

test('the demo goes on to the Board, and the acknowledgement is kept', async ({ page, api }) => {
  await acknowledge(page)
  await expect(page.getByText('Step 2 of 3')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log in to HoYoLAB' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue with demo data' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Board')
  expect((await api.get<Settings>('/api/settings')).risk_acknowledged).toBe(true)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Board')
})

test('start with windows is offered on the way', async ({ page, api }) => {
  await acknowledge(page)
  const box = page.getByRole('checkbox', { name: 'Start Guild Board when Windows starts' })
  await expect(box).not.toBeChecked()
  await box.click()
  await expect(box).toBeChecked()
  await expect.poll(async () => (await api.get<Settings>('/api/settings')).start_with_windows).toBe(true)
})

test.describe('with a real account', () => {
  test.use({ mode: 'live' })

  test('the login and the demo need the window', async ({ page }) => {
    await acknowledge(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connect your account')
    await page.getByRole('button', { name: 'Log in to HoYoLAB' }).click()
    await expect(page.getByRole('status')).toHaveText('This needs the Guild Board window.')
    const asked = page.waitForRequest((request) => request.url().endsWith('/api/demo/open'))
    await page.getByRole('button', { name: 'Look around with demo data' }).click()
    await asked
    await expect(page.getByRole('status')).toHaveText('This needs the Guild Board window.')
  })

  test('not now opens the empty pages', async ({ page, api }) => {
    await acknowledge(page)
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Board')
    await expect(page.getByTestId('sync')).toContainText('Log in needed')
    expect((await api.get<Settings>('/api/settings')).risk_acknowledged).toBe(true)
  })

  test('after the login the first sync is followed to the Board', async ({ page }) => {
    // This core has no login, so the page is shown one, as the shell's login window will leave it.
    // The live events are cut, so that only the edited status reaches the page. The page then asks
    // again each time the event stream tries to reconnect, about every 3 seconds.
    test.setTimeout(45_000)
    let phase: 'before' | 'syncing' | 'done' = 'before'
    await page.route('**/api/events', (route) => route.abort())
    await changeAnswer<Status>(page, '/api/status', (data) => {
      if (phase === 'before') return
      data.account = LOGGED_IN
      data.sync = { ...data.sync, state: phase === 'syncing' ? 'syncing' : 'ok', last_ok_at: phase === 'done' ? data.now : null }
    })
    await page.reload()
    await acknowledge(page)
    await expect(page.getByText('Step 2 of 3')).toBeVisible()
    phase = 'syncing'
    await expect(page.getByText('Step 3 of 3')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Reading the account for the first time.')).toBeVisible()
    phase = 'done'
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Board', { timeout: 15_000 })
  })

  test('a first sync that does not start offers a way on after a while', async ({ page }) => {
    // A sync refused by the five-minute wait or the daily limit changes no state, so nothing else would end the wait.
    await page.clock.install()
    await page.route('**/api/events', (route) => route.abort())
    await changeAnswer<Status>(page, '/api/status', (data) => {
      data.account = LOGGED_IN
      data.sync = { ...data.sync, state: 'ok', last_ok_at: null }
    })
    await page.reload()
    await acknowledge(page)
    await expect(page.getByText('Reading the account for the first time.')).toBeVisible()
    const anyway = page.getByRole('button', { name: 'Open Guild Board anyway' })
    await page.clock.fastForward(19_000)
    await expect(anyway).toHaveCount(0)
    await page.clock.fastForward(2_000)
    await expect(page.getByText('This is taking longer than it should.')).toBeVisible()
    await anyway.click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Board')
  })

  test('a first sync that fails does not keep the player waiting', async ({ page }) => {
    await page.route('**/api/events', (route) => route.abort())
    await changeAnswer<Status>(page, '/api/status', (data) => {
      data.account = LOGGED_IN
      data.sync = { ...data.sync, state: 'offline', last_ok_at: null }
    })
    await page.reload()
    await acknowledge(page)
    await expect(page.getByText('Step 3 of 3')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The first sync did not finish')
    await expect(page.getByText('No connection. Guild Board will try again at the next sync.')).toBeVisible()
    await page.getByRole('button', { name: 'Open Guild Board anyway' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Board')
  })
})

test('the first run says so when the core is gone', async ({ page, core }) => {
  await expect(page.getByText('Step 1 of 3')).toBeVisible()
  core.stop()
  await expect(page.getByRole('alert')).toContainText('Guild Board is not answering. It may have been closed.', {
    timeout: 15_000,
  })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome to Guild Board') // the page stays
})

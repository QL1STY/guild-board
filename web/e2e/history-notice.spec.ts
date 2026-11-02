import { expect, test } from './fixtures.ts'

/* The notice that the game's history stopped updating (freshness.py), which the demo shows when it is asked to. */

const TEXT = 'Your primogems have not updated for 2 days. Open Feedback in the game, then press Import.'

test('every page says the history stopped updating, with the way to the page that mends it', async ({ page, api }) => {
  await api.post('/api/demo/history-stopped', { how: 'feedback' })
  const notice = page.getByTestId('history-notice')
  await expect(notice).toContainText(TEXT)
  await page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Achievements' }).click()
  await expect(notice).toContainText(TEXT)
  await notice.getByRole('link', { name: 'Open Ledger' }).click()
  await expect(page).toHaveURL(/#\/ledger$/)
  await expect(notice).toContainText(TEXT)
  await expect(notice.getByRole('link')).toHaveCount(0) // on the page it names, nothing is left to open
})

test('a login that gets no keys is sent to Settings', async ({ page, api }) => {
  await api.post('/api/demo/history-stopped', { how: 'login' })
  const notice = page.getByTestId('history-notice')
  await expect(notice).toContainText('Log in to HoYoLAB again in Settings')
  await notice.getByRole('link', { name: 'Open Settings' }).click()
  await expect(page).toHaveURL(/#\/settings$/)
})

test('a history that is well says nothing', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible()
  await expect(page.getByTestId('history-notice')).toHaveCount(0)
})

import type { CodesModel } from '../src/types.ts'
import { expect, test } from './fixtures.ts'

test('the profile panel shows the gift codes tile and three links', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/board`)
  await page.getByTestId('profile').click()
  const tile = page.getByTestId('codes-tile')
  await expect(tile).toContainText('150')
  await expect(tile).toContainText('from 2 codes')
  await expect(page.getByTestId('profile-links').getByRole('button')).toHaveText([
    /Akasha: your builds ranked/,
    /Enka\.Network: your showcase/,
    /HoYoLAB: Battle Chronicle/,
  ])
  await tile.getByRole('button', { name: 'Redeem a code' }).click()
  await expect(page).toHaveURL(/#\/codes$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gift codes')
})

test('the Codes page is not in the rail', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/codes`)
  await expect(page.getByRole('navigation', { name: 'Pages' }).getByText('Gift codes')).toHaveCount(0)
})

test('the page shows the demo livestream card and history', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/codes`)
  await expect(page.getByTestId('codes-primogems')).toContainText('150')
  await expect(page.getByTestId('codes-primogems')).toContainText('from 2 codes')
  await expect(page.getByTestId('codes-live')).toContainText('2 new livestream codes')
  await expect(page.getByTestId('codes-live').getByRole('button', { name: 'Redeem all' })).toBeVisible()
  const history = page.getByTestId('codes-history')
  await expect(history).toContainText('DEMOGIFT1')
  await expect(history).toContainText('DEMOGIFT2')
  await expect(history).toContainText('DEMOOLD')
  await expect(history).toContainText('Expired')
})

test('Redeem all sends the codes shown, so that the core redeems no code the player did not see', async ({ page, core, api }) => {
  const { live } = await api.get<CodesModel>('/api/codes')
  expect(live.length).toBe(2)
  await page.goto(`${core.origin}/#/codes`)
  await expect(page.getByTestId('codes-live')).toContainText('2 new livestream codes')
  // The page's request is what is checked here; what the core does with it is the core's (tests/test_codes.py).
  const sent: unknown[] = []
  await page.route('**/api/codes/redeem-live', async (route) => {
    sent.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, json: { started: true } })
  })
  await page.getByTestId('codes-live').getByRole('button', { name: 'Redeem all' }).click()
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0]).toEqual({ codes: live.map((one) => one.code) })
})

test('Redeem says the demo does not redeem codes', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/codes`)
  const redeem = page.getByRole('button', { name: 'Redeem', exact: true })
  await expect(redeem).toBeDisabled()
  await page.getByLabel('Codes').fill('GENSHINGIFT')
  await redeem.click()
  await expect(page.getByTestId('codes-refused')).toHaveText('The demo does not redeem codes.')
})

test('a history row’s primogems are edited in place and the total follows', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/codes`)
  await expect(page.getByTestId('codes-primogems')).toContainText('150')
  const field = page.getByLabel('Primogems from DEMOGIFT1')
  await field.fill('80')
  await field.press('Enter')
  await expect(page.getByTestId('codes-primogems')).toContainText('180')
  await field.fill('100001')
  await field.press('Enter')
  await expect(page.getByTestId('codes-history').getByRole('alert')).toContainText('Enter a whole number from 0 to 100,000.')
})

test('the × removes a code from the history at once and the total follows', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/codes`)
  await expect(page.getByTestId('codes-primogems')).toContainText('150')
  await page.getByRole('button', { name: 'Remove DEMOGIFT1 from the history' }).click()
  await expect(page.getByTestId('codes-history')).not.toContainText('DEMOGIFT1')
  await expect(page.getByTestId('codes-primogems')).toContainText('100')
  await expect(page.getByTestId('codes-primogems')).toContainText('from 1 code')
})

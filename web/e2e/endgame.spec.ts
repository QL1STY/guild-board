import { expect, test } from './fixtures.ts'

/* Endgame readiness against the demo core (the Characters plan, Task U9), which starts on Sunday 25 October 2026. */
test.use({ viewport: { width: 1640, height: 1100 }, demoNow: '2026-10-25T08:00:00+00:00' })

type Endgame = {
  modes: { key: string; value: string; ready: number }[]
  theater: { elements: string[]; calendar_elements: string[]; from_calendar: boolean }
  clear: { action: string; target: string; title: string }[]
}

test('the three modes each show a ring, and the switch asks for the readiness after the plans', async ({ page, core, api }) => {
  await page.goto(`${core.origin}/#/characters/endgame`)
  const modes = page.locator('.eg-mode')
  await expect(modes).toHaveCount(3)
  await expect(modes.locator('[role="img"]')).toHaveCount(3)
  const now = await api.get<Endgame>('/api/endgame?after=0')
  const after = await api.get<Endgame>('/api/endgame?after=1')
  await expect(modes.first()).toContainText(now.modes[0].value)
  const asked = page.waitForResponse((response) => response.url().endsWith('/api/endgame?after=1'))
  await page.getByRole('radio', { name: 'After your plans' }).click()
  await asked
  await expect(modes.first()).toContainText(after.modes[0].value)
  await page.getByRole('radio', { name: 'Now' }).click()
  await expect(modes.first()).toContainText(now.modes[0].value)
})

test("the Theater's elements come from the calendar; a pick of three is sent, kept and shown in their place", async ({ page, core, api }) => {
  await page.goto(`${core.origin}/#/characters/endgame`)
  const chips = page.getByRole('group', { name: 'Elements of the month' })
  await expect(chips.locator('button.month')).toHaveCount(3)
  await expect(chips.locator('[aria-pressed="true"]')).toHaveCount(3)
  // Taking one out leaves two, which is not sent; the third pick is.
  await chips.getByRole('button', { name: 'Anemo' }).click()
  await expect(chips.locator('[aria-pressed="true"]')).toHaveCount(2)
  const put = page.waitForRequest((request) => request.url().endsWith('/api/endgame/theater'))
  await chips.getByRole('button', { name: 'Geo' }).click()
  const request = await put
  expect(request.postDataJSON()).toEqual({ elements: ['Cryo', 'Electro', 'Geo'] })
  expect((await (await request.response())!.json()).theater.elements).toEqual(['Cryo', 'Electro', 'Geo'])
  // The core keeps the pick for the month and uses it in place of the calendar's (design §6.5: picking others previews them).
  expect((await api.get<Endgame>('/api/endgame')).theater).toMatchObject({ elements: ['Cryo', 'Electro', 'Geo'], from_calendar: false })
  await expect(page.getByText('These are your picks for October 2026.', { exact: false })).toBeVisible()
  await expect(page.locator('.eg-crow')).toHaveCount(3)
  await expect(page.locator('.eg-crow').nth(2)).toContainText('Geo')
  await page.reload()
  await expect(chips.getByRole('button', { name: 'Geo' })).toHaveAttribute('aria-pressed', 'true')
  await expect(chips.getByRole('button', { name: 'Anemo' })).toHaveAttribute('aria-pressed', 'false')
  // The calendar's own elements keep their mark beside the pick, and the way back brings them up again.
  await expect(chips.locator('button.month')).toHaveCount(3)
  await expect(chips.getByRole('button', { name: 'Anemo' })).toHaveClass(/month/)
  await page.getByRole('button', { name: "Back to this month's elements" }).click()
  await expect(chips.getByRole('button', { name: 'Anemo' })).toHaveAttribute('aria-pressed', 'true')
  await expect(chips.getByRole('button', { name: 'Geo' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: "Back to this month's elements" })).toHaveCount(0)
  expect((await api.get<Endgame>('/api/endgame')).theater).toMatchObject({ from_calendar: true, calendar_elements: ['Cryo', 'Electro', 'Anemo'] })
})

test('an action to clear everything opens a planner, or adds to the focus once there is room', async ({ page, core, api }) => {
  await page.goto(`${core.origin}/#/characters/endgame`)
  const model = await api.get<Endgame>('/api/endgame')
  const planner = model.clear.find((one) => one.action === 'planner')
  const focus = model.clear.find((one) => one.action === 'focus')
  expect(planner && focus).toBeTruthy()
  // The focus is full, so the first press is refused in plain words.
  await page.getByRole('button', { name: 'Add to your focus' }).first().click()
  await expect(page.getByText('Four at most: take one out first.')).toBeVisible()
  await api.put('/api/focus', { characters: ['sandrone', 'odette', 'alyosha'] })
  await page.reload()
  await page.getByRole('button', { name: 'Add to your focus' }).first().click()
  await expect.poll(async () => (await api.get<{ focus: string[] }>('/api/characters')).focus).toContain(focus!.target)
  await page.getByRole('link', { name: 'Open the planner' }).first().click()
  await expect(page).toHaveURL(new RegExp(`#/characters/${planner!.target}/plan$`))
})

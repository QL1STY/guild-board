import type { Page } from '@playwright/test'
import type { BoardModel, Status } from '../src/types.ts'
import { changeAnswer } from './answers.ts'
import { layoutOf, setBoard, widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'

/*
 * The Clock's styles and options (the widgets polish mockup, section 4): the Istaroth dial stays what a clock with no
 * settings is, the others are chosen in its Settings in Edit, each with the picture the Board shows. The sizes test holds
 * every style to the frame at its smallest and largest size.
 */

const clock = (settings: Record<string, unknown> = {}, w = 2, h = 1, id = 'clock-a') => ({ id, type: 'clock', w, h, x: 0, y: 0, settings })

/** Shows the page this moment as the core's clock (a time of this PC's day), whatever the demo's is. Reload afterwards. */
async function at(page: Page, hours: number, minutes: number, seconds = 0): Promise<void> {
  const from = new Date(2026, 10, 15, hours, minutes, seconds).getTime()
  const asked = Date.now()
  await page.route('**/api/events', (route) => route.abort()) // its hello would bring the demo's own time back
  await changeAnswer<Status>(page, '/api/status', (status) => {
    status.now = new Date(from + (Date.now() - asked)).toISOString() // the status is read again now and then: time has gone on
  })
}

/** The Europe server's 24-hour time at a time of this PC's day: the demo's server is UTC+1 all year. */
function serverAt(hours: number, minutes: number): string {
  const server = new Date(new Date(2026, 10, 15, hours, minutes).getTime() + 3_600_000)
  return `${String(server.getUTCHours()).padStart(2, '0')}:${String(server.getUTCMinutes()).padStart(2, '0')}`
}

async function settingsOf(page: Page, id: string) {
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await widgetById(page, id).getByRole('button', { name: 'Settings of Clock' }).click()
  return page.getByRole('region', { name: 'Settings of Clock' })
}

test('a clock saved with no settings is the Istaroth dial, with the day and the server, as before the styles', async ({ page, api }) => {
  await setBoard(api, page, [clock()])
  const frame = widgetById(page, 'clock-a')
  await expect(frame.locator('.clock .clock-face')).toBeVisible()
  await expect(frame.locator('.clock-dial .fig')).toHaveText(/^\d{2}:\d{2}$/)
  await expect(frame.locator('.clock .side')).toContainText('Server 09:00 · Europe') // DEMO_NOW is 08:00 UTC
  await expect(frame.locator('.clock .side')).toContainText(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}/)
  await expect(frame.locator('.ck')).toHaveCount(0)
  expect((await layoutOf(api)).widgets[0].settings).toEqual({})
})

test('the picker has the six styles, Istaroth chosen, and a style chosen is drawn at once and kept', async ({ page, api }) => {
  await setBoard(api, page, [clock()])
  const sheet = await settingsOf(page, 'clock-a')
  const picks = sheet.getByRole('radiogroup', { name: 'Style' }).getByRole('radio')
  await expect(picks).toHaveCount(6)
  await expect(picks.locator('.ck-pick-name')).toHaveText(
    ['Istaroth', 'Figures', 'Flip', 'Astrolabe', 'Time and reset', 'Words'].map((name) => new RegExp(`^${name}`)),
  )
  await expect(sheet.getByRole('radio', { name: /^Istaroth/ })).toHaveAttribute('aria-checked', 'true')
  const marks: [RegExp, string][] = [
    [/^Figures/, '.ck-dg'],
    [/^Flip/, '.ck-flip'],
    [/^Astrolabe/, '.ck-dial'],
    [/^Time and reset/, '.ck-two'],
    [/^Words/, '.ck-phrase'],
    [/^Istaroth/, '.clock-face'],
  ]
  const frame = widgetById(page, 'clock-a')
  for (const [name, mark] of marks) {
    await sheet.getByRole('radio', { name }).click()
    await expect(sheet.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true')
    await expect(frame.locator(mark).first()).toBeVisible()
  }
  await sheet.getByRole('radio', { name: /^Flip/ }).click()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  expect((await layoutOf(api)).widgets[0].settings).toEqual({ style: 'flip' })
  await expect(widgetById(page, 'clock-a').locator('.ck-flip')).toBeVisible()
})

test('the options: 12 hours, seconds, the date and the server change what the style writes', async ({ page, api }) => {
  await at(page, 15, 5, 7)
  await setBoard(api, page, [clock({ style: 'digital' }, 3, 2)])
  const frame = widgetById(page, 'clock-a')
  await expect(frame.locator('.ck-dg').first()).toHaveText('15:05')
  await expect(frame).toContainText('Sun 15 Nov')
  await expect(frame).toContainText(`Server ${serverAt(15, 5)} · Europe`)
  const sheet = await settingsOf(page, 'clock-a')
  await sheet.getByRole('radio', { name: '12 h' }).click()
  await expect(frame.locator('.ck-dg').first()).toContainText(/03:05\s*PM/)
  await sheet.getByRole('button', { name: 'Seconds' }).click()
  await expect(frame.locator('.ck-dg').first()).toContainText(/03:05\d{2}PM/)
  await sheet.getByRole('button', { name: 'The date' }).click()
  await expect(frame).not.toContainText('Sun 15 Nov')
  await sheet.getByRole('button', { name: "The server's time" }).click()
  await expect(frame).not.toContainText('Server')
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  expect((await layoutOf(api)).widgets[0].settings).toEqual({ style: 'digital', twelve: true, seconds: true, date: false, server: false })
})

test('a style that cannot show an option greys its switch and says why', async ({ page, api }) => {
  await setBoard(api, page, [clock({ style: 'words' })])
  const sheet = await settingsOf(page, 'clock-a')
  await expect(sheet.getByRole('button', { name: 'Seconds' })).toHaveAttribute('aria-disabled', 'true')
  await expect(sheet).toContainText('Words go by five minutes')
  await expect(sheet.getByRole('radio', { name: '12 h' })).toHaveCount(0)
  await expect(sheet).toContainText('Words are always said in 12 hours')
  await sheet.getByRole('radio', { name: /^Astrolabe/ }).click()
  await expect(sheet.getByRole('button', { name: 'Time to the daily reset' })).toHaveAttribute('aria-disabled', 'true')
  await expect(sheet.getByRole('button', { name: 'Time to the daily reset' })).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet).toContainText('The Astrolabe marks it as a diamond')
  await expect(sheet.getByRole('button', { name: 'Seconds' })).not.toHaveAttribute('aria-disabled', 'true')
})

test('each style at 2 × 2 says the time on the core\'s clock, and the reset and the server where it has room', async ({ page, api }) => {
  await at(page, 10, 8, 36)
  // The next daily reset at 05:00 of this PC's day, 18 h 51 min on, and the weekly one the same time.
  const reset = new Date(2026, 10, 16, 5, 0).toISOString()
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    board.resets = { daily_at: reset, weekly_at: reset }
  })
  await setBoard(api, page, [
    clock({ style: 'words' }, 2, 2, 'words'),
    clock({ style: 'reset' }, 2, 2, 'reset'),
    clock({ style: 'astro', twelve: true }, 2, 2, 'astro'),
    clock({ style: 'flip', twelve: true, seconds: true }, 2, 2, 'flip'),
  ])
  await expect(widgetById(page, 'words').getByText("It's five past ten")).toBeAttached()
  await expect(widgetById(page, 'words').locator('.ck-words .on.gold')).toHaveText(['T', 'E', 'N'])
  await expect(widgetById(page, 'words').locator('.ck-dots .on')).toHaveCount(3)
  const timeReset = widgetById(page, 'reset')
  await expect(timeReset.locator('.ck-dg')).toHaveText('10:08')
  await expect(timeReset).toContainText('Daily reset in18 h 51 min')
  await expect(timeReset).toContainText('Weekly reset tomorrow')
  await expect(timeReset).toContainText('The game day, 05:00 to 05:00')
  await expect(timeReset.locator('.ck-bar u')).toHaveAttribute('style', /width: 21\./) // 5 h 9 min of 24 h
  const astro = widgetById(page, 'astro')
  await expect(astro.locator('.ast-time')).toContainText('10:08 AM')
  await expect(astro.locator('.ast-sub')).toHaveText('Morning')
  await expect(astro.locator('.ast-sun')).toHaveCount(1)
  await expect(astro.locator('.ast-reset')).toHaveCount(1)
  await expect(astro).toContainText('Daily reset at 05:00 AMin 18 h 51 min')
  const flip = widgetById(page, 'flip')
  await expect(flip.locator('.ck-tile')).toHaveText(['10', '08', /^\d\d$/]) // the seconds go on from 36
  await expect(flip).toContainText('AM')
})

test('the Astrolabe shows the moon at night, and at one cell wide the server is in the heading', async ({ page, api }) => {
  await at(page, 23, 30)
  await setBoard(api, page, [clock({ style: 'astro' }, 1, 1, 'small')])
  const small = widgetById(page, 'small')
  await expect(small.locator('.ast-moon')).toHaveCount(1)
  await expect(small.locator('.ast-sun')).toHaveCount(0)
  await expect(small.locator('.w-meta')).toHaveText(/^Server \d{2}:\d{2}$/)
})

test('a clock that shows no seconds changes on the minute, and one that shows them each second', async ({ page, api }) => {
  await at(page, 10, 8, 56)
  await setBoard(api, page, [clock({ style: 'digital', seconds: true }, 2, 1, 'secs'), clock({ style: 'digital' }, 2, 1, 'mins')])
  const secs = widgetById(page, 'secs').locator('.ck-dg')
  const mins = widgetById(page, 'mins').locator('.ck-dg')
  await expect(mins).toHaveText('10:08')
  const first = await secs.textContent()
  await expect(secs).not.toHaveText(first!, { timeout: 3_000 })
  await expect(mins).toHaveText('10:09', { timeout: 6_000 }) // four seconds to the minute, and it turns then
})

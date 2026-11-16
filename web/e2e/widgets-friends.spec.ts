import type { Widget } from '../src/types.ts'
import { setBoard, widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'

/*
 * The Friends online widget (the five widgets plan, Task 5) on the Board and on the overlay's list, on the demo's friends:
 * Riley in game for 42 minutes, Kira offline 3 hours and Milo offline 2 days. Its sizes are held to the plan's table by
 * widgets-sizes.spec.ts.
 */

const RILEY = '00000000-0000-4000-8000-000000007687'
const widget = (w: number, h: number, id = 'friends'): Widget => ({ id, type: 'friends-online', w, h, x: 0, y: 0, settings: {} })

test('at 2 × 2 a row for each friend, in game first, then those offline by when they were last seen, dimmed', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 2)])
  const frame = widgetById(page, 'friends')
  await expect(frame.locator('.w-meta')).toHaveText('1 in game')
  const rows = frame.locator('.fo-r')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Riley')
  await expect(rows.nth(0)).toContainText('In game')
  await expect(rows.nth(0)).toContainText('for 42 min')
  await expect(rows.nth(1)).toContainText('Kira')
  await expect(rows.nth(1)).toContainText('Offline')
  await expect(rows.nth(1)).toContainText('3 h ago')
  await expect(rows.nth(2)).toContainText('Milo')
  await expect(rows.nth(2)).toContainText('2 days ago')
  // Offline rows are dimmed; the one in game is not, and has the dot of its status.
  await expect(rows.nth(0)).not.toHaveAttribute('data-off', /.*/)
  await expect(rows.nth(1)).toHaveCSS('opacity', '0.7')
  await expect(rows.nth(0).locator('.fo-av')).toHaveAttribute('data-game', 'true')
  await expect(rows.nth(1).locator('.fo-av')).not.toHaveAttribute('data-game', /.*/)
})

test('at 2 × 1 one line says who is in game, and how long, and how many are offline', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 1)])
  const frame = widgetById(page, 'friends')
  await expect(frame.locator('.fo-one')).toContainText('Riley is in game')
  await expect(frame.locator('.fo-one')).toContainText('for 42 min · 2 friends offline')
  await expect(frame.locator('.fo-r')).toHaveCount(0)
  await expect(frame.locator('.w-meta')).toHaveText('1 in game')
})

test("a click on a friend on the Board opens their profile", async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 2)])
  const riley = widgetById(page, 'friends').getByRole('link', { name: /Riley/ })
  await expect(riley).toHaveAttribute('href', `#/friends/${RILEY}`)
  await riley.click()
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#/friends/${RILEY}`)
  await expect(page.getByRole('heading', { name: /Riley/ }).first()).toBeVisible()
})

test('the widget does not ask the online server for anything but the two models of the core', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const asked: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (/^\/api\/(online|friends)/.test(pathname)) asked.push(pathname)
  })
  await setBoard(api, page, [widget(2, 2)])
  await expect(widgetById(page, 'friends')).toContainText('Riley')
  expect([...new Set(asked)].sort()).toEqual(['/api/friends', '/api/online'])
})

test('signed out, it says where to sign in, and is still offered in "Add a widget"', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 2)])
  await expect(widgetById(page, 'friends')).toContainText('Riley')
  await api.post('/api/demo/online', { state: 'signed_out' })
  const frame = widgetById(page, 'friends')
  await expect(frame).toContainText('Sign in with Discord in Settings to see your friends.')
  await expect(frame.getByRole('link', { name: /Sign in with Discord/ })).toHaveAttribute('href', '#/settings')
  await expect(frame).not.toContainText('Riley')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Add a widget' }).click()
  await expect(page.getByRole('region', { name: 'Add a widget' }).getByRole('button', { name: 'Add Friends online' })).toBeVisible()
})

test('after a lost session the friends stay, as they were last read', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [widget(2, 2)])
  await api.post('/api/demo/online', { state: 'sign_in_again' })
  const frame = widgetById(page, 'friends')
  await expect(frame).toContainText('Riley')
  await expect(frame).not.toContainText('Sign in with Discord')
})

test("on the overlay's list the rows are not links, in the dark panel's roles", async ({ page, core, api }) => {
  const { revision } = await api.get<{ revision: number }>('/api/layouts/overlay')
  const friends: Widget = { ...widget(2, 2, 'over-friends'), pinned: true }
  await api.put('/api/layouts/overlay', { revision, widgets: [friends] })
  await page.goto(`${core.origin}/#/overlay/open`)
  const frame = widgetById(page, 'over-friends')
  await expect(frame).toContainText('Riley')
  await expect(frame.locator('.fo-r')).toHaveCount(3)
  await expect(frame.getByRole('link')).toHaveCount(0)
  await expect(frame.locator('.fo-row').first()).toHaveJSProperty('tagName', 'DIV')
  expect(await frame.evaluate((section) => section.closest('.on-dark') !== null)).toBe(true)
  // The dot of the status is the dark panel's own green.
  expect(await frame.locator('.fo-av[data-game]').first().evaluate((face) => getComputedStyle(face, '::after').backgroundColor)).toBe('rgb(157, 196, 140)')
})

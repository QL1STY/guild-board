import type { Locator, Page } from '@playwright/test'
import type { FriendsModel, OnlineView } from '../src/onlinetypes.ts'
import { changeAnswer, holding } from './answers.ts'
import { expect, test } from './fixtures.ts'

/*
 * The Friends page (the online plan, Task B6; the online design, section 9, mockup 1). The demo's account is Traveler#2048,
 * with Riley#7687 in game, Kira#0412 with Guild Board open, Milo#3391 offline and sharing nothing, and a request from
 * Nova#5120. Every test starts a core of its own, so what one changes the next does not see.
 */

test.beforeEach(async ({ page, core }) => {
  await page.goto(`${core.origin}/#/friends`)
})

const friendList = (page: Page) => page.getByRole('list', { name: 'Friends' })
const rowOf = (page: Page, name: string) => friendList(page).getByRole('listitem').filter({ hasText: name })
const requests = (page: Page) => page.getByRole('group', { name: 'Requests' })
const addPanel = (page: Page) => page.getByRole('region', { name: 'Add a friend' })
const queryField = (page: Page) => addPanel(page).getByRole('textbox', { name: 'Their tag or Genshin UID' })

/** The text of the clipboard, once the browser has been allowed to read it. */
async function clipboardOf(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText())
}

test('Friends sits between Ledger and Settings in the rail, and lists the friends in game, open, then offline', async ({ page }) => {
  const names = await page.getByRole('navigation', { name: 'Pages' }).locator('.gb-nav').allTextContents()
  expect(names.indexOf('Friends')).toBe(names.indexOf('Ledger') + 1)
  expect(names.indexOf('Settings')).toBe(names.indexOf('Friends') + 1)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friends')
  await expect(page.getByRole('link', { name: 'Friends', exact: true })).toHaveAttribute('aria-current', 'page')

  const rows = friendList(page).getByRole('listitem')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Riley#7687')
  await expect(rows.nth(0)).toContainText(/In game for 4\d min/)
  await expect(rows.nth(1)).toContainText('Kira#0412')
  await expect(rows.nth(1)).toContainText('Guild Board open')
  await expect(rows.nth(2)).toContainText('Milo#3391')
  await expect(rows.nth(2)).toContainText('Offline 2 days ago')
  // The top bar counts those who can be played with right now.
  await expect(page.getByTestId('friends-count')).toHaveText('1 in game, 1 with Guild Board open')
})

test('each friend shows their pinned stats as chips, and a friend who shares nothing says so', async ({ page }) => {
  const riley = rowOf(page, 'Riley')
  await expect(riley.getByTitle('14,320 primogems')).toBeVisible()
  await expect(riley.getByTitle('36 Abyss')).toBeVisible()
  await expect(riley.getByTitle('1,402 achievements')).toBeVisible()
  // In the order Riley pinned them, which is not the order of the tiles.
  await expect(riley.locator('.frd-chip')).toHaveCount(3)
  const titles = await riley.locator('.frd-chip').evaluateAll((chips) => chips.map((chip) => chip.getAttribute('title')))
  expect(titles).toEqual(['14,320 primogems', '36 Abyss', '1,402 achievements'])
  const kira = rowOf(page, 'Kira')
  await expect(kira.getByTitle('1,288 achievements')).toBeVisible()
  await expect(kira.getByTitle('9 h this week')).toBeVisible()
  await expect(rowOf(page, 'Milo')).toContainText('Shares nothing yet')
  await expect(rowOf(page, 'Milo').locator('.frd-chip')).toHaveCount(0)
})

test('Compare is a button on each row, off with its reason while you share nothing', async ({ page }) => {
  const milo = rowOf(page, 'Milo').getByRole('button', { name: 'Compare' })
  await expect(milo).toHaveAttribute('aria-disabled', 'true')
  await expect(milo).toHaveAttribute('data-tip', 'You and Milo share no stat in common yet.')
  await milo.click({ force: true }) // Playwright waits for an aria-disabled button for ever: this is a press on it all the same
  await expect(page).toHaveURL(/#\/friends$/) // nothing happened
  const riley = rowOf(page, 'Riley').getByRole('button', { name: 'Compare' })
  await expect(riley).not.toHaveAttribute('aria-disabled', 'true')
  await riley.click()
  await expect(page).toHaveURL(/#\/friends\/00000000-0000-4000-8000-000000007687\/compare$/)
})

test('a click anywhere else on a row opens the friend\'s profile', async ({ page }) => {
  // The middle of the row, over its chips: the name's link stretches over all of it.
  await rowOf(page, 'Kira').click()
  await expect(page).toHaveURL(/#\/friends\/00000000-0000-4000-8000-000000000412$/)
  await page.goBack()
  await rowOf(page, 'Riley').getByRole('link', { name: 'Riley#7687' }).click()
  await expect(page).toHaveURL(/#\/friends\/00000000-0000-4000-8000-000000007687$/)
})

test('the buttons of one column are the same size', async ({ page }) => {
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  await expect(requests(page).getByRole('button')).toHaveCount(2)
  const sizes = await page.locator('.frd-row .gb-btn').evaluateAll((buttons) =>
    buttons.map((button) => Math.round(button.getBoundingClientRect().width)),
  )
  expect(sizes).toHaveLength(3)
  expect(new Set(sizes).size).toBe(1)
  const strip = await requests(page).locator('.gb-btn').evaluateAll((buttons) =>
    buttons.map((button) => [Math.round(button.getBoundingClientRect().width), Math.round(button.getBoundingClientRect().height)]),
  )
  expect(strip).toHaveLength(2)
  expect(strip[0]).toEqual(strip[1])
})

test('Accept moves the request into the list, and Decline drops it', async ({ page }) => {
  const strip = requests(page)
  await expect(strip).toContainText('Nova#5120 wants to be your friend.')
  await expect(rowOf(page, 'Nova')).toHaveCount(0)
  await strip.getByRole('button', { name: 'Accept' }).click()
  await expect(rowOf(page, 'Nova')).toHaveCount(1)
  await expect(rowOf(page, 'Nova')).toContainText('Nova#5120')
  await expect(requests(page)).toHaveCount(0)
  await expect(friendList(page).getByRole('listitem')).toHaveCount(4)
})

test('Decline sends the request away without a friend', async ({ page }) => {
  await requests(page).getByRole('button', { name: 'Decline' }).click()
  await expect(requests(page)).toHaveCount(0)
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  await expect(rowOf(page, 'Nova')).toHaveCount(0)
})

test('with the keyboard, a card that goes hands the focus to the next, and the last to the heading of the list', async ({ page }) => {
  await queryField(page).fill('Elena#0031')
  await addPanel(page).getByRole('button', { name: 'Send request' }).click()
  const cancel = requests(page).getByRole('button', { name: 'Cancel request' })
  await expect(cancel).toBeVisible()
  await requests(page).getByRole('button', { name: 'Accept' }).focus()
  await page.keyboard.press('Enter')
  await expect(rowOf(page, 'Nova')).toHaveCount(1)
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(requests(page)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Your friends' })).toBeFocused()
})

test('with the keyboard, Decline and Ignore leave the focus in the list too', async ({ page, api }) => {
  await api.post('/api/demo/online', { state: 'invite' })
  await requests(page).getByRole('button', { name: 'Ignore' }).focus()
  await page.keyboard.press('Enter')
  await expect(requests(page).getByRole('button', { name: 'Ignore' })).toHaveCount(0)
  const decline = requests(page).getByRole('button', { name: 'Accept' })
  await expect(decline).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(requests(page).getByRole('button', { name: 'Decline' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(requests(page)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Your friends' })).toBeFocused()
})

test('a refused press leaves its card, and the focus on the button', async ({ page, api }) => {
  await api.post('/api/demo/online', { state: 'offline' })
  await expect(page.getByTestId('friends-stale')).toBeVisible()
  const accept = requests(page).getByRole('button', { name: 'Accept' })
  await accept.focus()
  await page.keyboard.press('Enter')
  await expect(requests(page).getByRole('alert')).toBeVisible()
  await expect(accept).toBeFocused()
})

test('an unknown tag, and a UID nobody can be found by, say so in the words of the server', async ({ page }) => {
  await queryField(page).fill('Nobody#0000')
  await addPanel(page).getByRole('button', { name: 'Send request' }).click()
  await expect(addPanel(page).getByRole('alert')).toHaveText('No player has that tag.')
  await queryField(page).fill('712345999')
  await addPanel(page).getByRole('button', { name: 'Send request' }).click()
  await expect(addPanel(page).getByRole('alert')).toHaveText('No player can be found by that UID.')
  await queryField(page).fill('Traveler#2048')
  await addPanel(page).getByRole('button', { name: 'Send request' }).click()
  await expect(addPanel(page).getByRole('alert')).toHaveText('That is your own tag.')
  await queryField(page).fill('Riley#7687')
  await addPanel(page).getByRole('button', { name: 'Send request' }).click()
  await expect(addPanel(page).getByRole('alert')).toHaveText('You are already friends.')
})

test('Send request needs something typed, and Enter sends it', async ({ page }) => {
  const send = addPanel(page).getByRole('button', { name: 'Send request' })
  await expect(send).toHaveAttribute('aria-disabled', 'true')
  await queryField(page).fill('Nobody#0000')
  await expect(send).not.toHaveAttribute('aria-disabled', 'true')
  await queryField(page).press('Enter')
  await expect(addPanel(page).getByRole('alert')).toHaveText('No player has that tag.')
})

test('a request that was sent waits in the strip, and can be taken back', async ({ page }) => {
  await queryField(page).fill('Elena#0031')
  await addPanel(page).getByRole('button', { name: 'Send request' }).click()
  await expect(queryField(page)).toHaveValue('')
  await expect(addPanel(page).getByRole('alert')).toHaveCount(0)
  const waiting = requests(page).filter({ hasText: 'Elena#0031' })
  await expect(waiting).toContainText('Waiting for Elena#0031 to answer.')
  await waiting.getByRole('button', { name: 'Cancel request' }).click()
  await expect(requests(page)).not.toContainText('Elena#0031')
  await expect(requests(page)).toContainText('Nova#5120')
})

test('Copy puts the tag on the clipboard', async ({ page, context, core }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: core.origin })
  await expect(page.getByTestId('my-tag')).toHaveText('Traveler#2048')
  await addPanel(page).getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(addPanel(page).getByRole('status')).toHaveText('Tag copied.')
  expect(await clipboardOf(page)).toBe('Traveler#2048')
})

test('Copy an invite link puts the link on the clipboard', async ({ page, context, core }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: core.origin })
  await addPanel(page).getByRole('button', { name: 'Copy an invite link' }).click()
  await expect(addPanel(page).getByRole('status')).toHaveText('Invite link copied.')
  expect(await clipboardOf(page)).toBe('https://tspjpcyhpkfetwzolzvi.supabase.co/functions/v1/invite?c=DEMO-INVITE-0123456789')
})

test('an invite that was opened shows in the strip, and sends nothing until Send request', async ({ page, api }) => {
  await api.post('/api/demo/online', { state: 'invite' })
  const invite = requests(page).filter({ hasText: 'invited you' })
  await expect(invite).toContainText('Nova#5120 invited you.')
  // Opening it only showed who it is from.
  await expect(rowOf(page, 'Nova')).toHaveCount(0)
  await invite.getByRole('button', { name: 'Send request' }).click()
  await expect(rowOf(page, 'Nova')).toHaveCount(1)
  await expect(requests(page)).toHaveCount(0)
  expect(((await api.get('/api/online')) as OnlineView).invite).toBeNull()
})

test('Ignore drops the invite and sends nothing', async ({ page, api }) => {
  await api.post('/api/demo/online', { state: 'invite' })
  const invite = requests(page).filter({ hasText: 'invited you' })
  await expect(invite).toHaveCount(1)
  await invite.getByRole('button', { name: 'Ignore' }).click()
  await expect(requests(page).filter({ hasText: 'invited you' })).toHaveCount(0)
  await expect(rowOf(page, 'Nova')).toHaveCount(0)
  expect(((await api.get('/api/online')) as OnlineView).invite).toBeNull()
  expect(((await api.get('/api/friends')) as FriendsModel).friends).toHaveLength(3)
})

test('a link that was used says so on the page it opens, until the player ignores it', async ({ page, api }) => {
  await api.post('/api/demo/online', { state: 'invite_gone' })
  const line = requests(page).getByRole('alert')
  await expect(line).toContainText('This invite was used or has expired. Ask for a new one.')
  await line.getByRole('button', { name: 'Ignore' }).click()
  await expect(line).toHaveCount(0)
  expect(((await api.get('/api/online')) as OnlineView).message).toBeNull()
})

test('an invite refused on the press says why, though it took its card and the strip with it', async ({ page, api, core }) => {
  await requests(page).getByRole('button', { name: 'Decline' }).click()
  await expect(requests(page)).toHaveCount(0)
  await api.post('/api/demo/online', { state: 'invite' })
  // As the core does: a code that was spent meanwhile ends the invite, and the press is refused.
  await page.route('**/api/friends/invite', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await page.request.delete(`${core.origin}/api/friends/invite`)
    return route.fulfill({ status: 409, json: { error: 'This invite was used or has expired. Ask for a new one.' } })
  })
  await requests(page).getByRole('button', { name: 'Send request' }).click()
  await expect(requests(page).getByRole('alert')).toHaveText('This invite was used or has expired. Ask for a new one.')
  await expect(requests(page).locator('.frd-req')).toHaveCount(0)
})

test('the invite\'s card shows a sign, not a picture, and never asks for one', async ({ page, api }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/picture')) asked.push(request.url())
  })
  await api.post('/api/demo/online', { state: 'invite' })
  await expect(requests(page).filter({ hasText: 'invited you' })).toHaveCount(1)
  await expect(requests(page).locator('.frd-pic img:not([hidden])')).toHaveCount(0)
  await expect(requests(page).locator('.frd-pic .sign')).toHaveCount(2)
  expect(asked).toEqual([])
})

test('a request\'s card shows a sign and never asks for a picture, even when the server says there is one', async ({ page }) => {
  // Row level security gives a picture's address to accepted friends alone (decision 1 of the task): the cards of a request that
  // was sent to the player and of one the player sent are not friends yet, whatever their `has_picture` says.
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/picture')) asked.push(request.url())
  })
  await changeAnswer<FriendsModel>(page, '/api/friends', (data) => {
    for (const card of data.incoming) card.has_picture = true
    data.outgoing.push({ user_id: '00000000-0000-4000-8000-000000000031', name: 'Elena', tag: '0031', has_picture: true, ar: 31 })
  })
  await page.reload()
  await expect(requests(page).locator('.frd-req')).toHaveCount(2)
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  await expect(requests(page).locator('.frd-pic img:not([hidden])')).toHaveCount(0)
  await expect(requests(page).locator('.frd-pic .sign')).toHaveCount(2)
  await expect(requests(page).locator('.frd-ar')).toHaveCount(0) // a card shows no rank tab either
  expect(asked).toEqual([])
})

test('a friend\'s row asks for their picture, and falls back to the sign when it does not load', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/picture')) asked.push(new URL(request.url()).pathname)
  })
  await changeAnswer<FriendsModel>(page, '/api/friends', (data) => {
    data.friends[0].has_picture = true // Riley, whom the demo has no picture of: the route answers that there is none
  })
  await page.reload()
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  // Only Riley's, and only his: the other rows say there is none.
  await expect.poll(() => [...new Set(asked)]).toEqual(['/api/friends/00000000-0000-4000-8000-000000007687/picture'])
  const riley = rowOf(page, 'Riley')
  await expect(riley.locator('.frd-pic img')).toHaveAttribute('hidden', '')
  await expect(riley.locator('.frd-pic .sign')).toBeVisible()
  await expect(riley.locator('.frd-ar')).toHaveText('AR 58')
})

test('a friend\'s picture that loads fills their round frame, from the core alone', async ({ page }) => {
  const tall = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAIAAAAW4yFwAAAAEElEQVR4nGP4z8DAwMAAAAQAAf/qPnqGAAAAAElFTkSuQmCC'
  await page.route('**/picture', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(tall, 'base64') }),
  )
  await changeAnswer<FriendsModel>(page, '/api/friends', (data) => {
    data.friends[0].has_picture = true
  })
  await page.reload()
  const image = rowOf(page, 'Riley').locator('.frd-pic img')
  await expect(image).toBeVisible()
  await expect(image).toHaveJSProperty('naturalWidth', 1)
  await expect(image).toHaveCSS('object-fit', 'cover')
  const box = await image.boundingBox()
  expect([box?.width, box?.height]).toEqual([40, 40])
  expect(new URL((await image.getAttribute('src')) ?? '', page.url()).origin).toBe(new URL(page.url()).origin)
})

test('a long name keeps its number in Add a friend, where the tag is what the player gives out', async ({ page }) => {
  await changeAnswer<FriendsModel>(page, '/api/friends', (data) => {
    data.me.name = 'Aleksandra Kowalska1'
  })
  await page.reload()
  const tag = page.getByTestId('my-tag')
  await expect(tag).toHaveText('Aleksandra Kowalska1#2048')
  await expect(tag).toHaveAttribute('title', 'Aleksandra Kowalska1#2048')
  const [whole, number] = [await tag.boundingBox(), await tag.getByText('#2048').boundingBox()]
  expect((number?.x ?? 0) + (number?.width ?? 0)).toBeLessThanOrEqual((whole?.x ?? 0) + (whole?.width ?? 0))
})

test('a refused answer is said where the player pressed', async ({ page, api }) => {
  await api.post('/api/demo/online', { state: 'offline' })
  const strip = requests(page)
  await expect(page.getByTestId('friends-stale')).toBeVisible()
  await strip.getByRole('button', { name: 'Accept' }).click()
  await expect(strip.getByRole('alert')).toHaveText('The server could not be reached, so nothing changed. Try again later.')
  await expect(rowOf(page, 'Nova')).toHaveCount(0) // nothing moved
  await expect(strip).toContainText('Nova#5120 wants to be your friend.')
})

test('a list that could not be updated is marked old, and says when it was read', async ({ page, api }) => {
  await expect(page.getByTestId('friends-stale')).toHaveCount(0)
  await expect(page.getByTestId('friends-count')).toBeVisible()
  await api.post('/api/demo/online', { state: 'offline' })
  await expect(page.getByTestId('friends-stale')).toHaveText(
    /^Friends could not be updated\. This is their last known state, read (just now|\d+ min ago)\.$/,
  )
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3) // the last list stays
  await expect(page.getByTestId('friends-count')).toHaveCount(0) // the count in the top bar is of those on right now
  await api.post('/api/demo/online', { state: 'signed_in' })
  await expect(page.getByTestId('friends-stale')).toHaveCount(0)
})

test('after a lost session the last list stays, marked old, with the way to Settings', async ({ page, api }) => {
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  await api.post('/api/demo/online', { state: 'sign_in_again' })
  const mark = page.getByTestId('friends-stale')
  await expect(mark).toContainText(/^Your online session has ended\. This is your friends' last known state, read (just now|\d+ min ago)\./)
  await expect(page.getByTestId('friends-signin')).toHaveCount(0)
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  await expect(page.getByTestId('friends-count')).toHaveCount(0)
  // What can't be done without a session says so where it is pressed.
  await requests(page).getByRole('button', { name: 'Accept' }).click()
  await expect(requests(page).getByRole('alert')).toHaveText('Sign in again first.')
  await mark.getByRole('link', { name: 'Open Settings' }).click()
  await expect(page).toHaveURL(/#\/settings$/)
  await expect(page.getByRole('region', { name: 'Online', exact: true }).getByRole('button', { name: 'Sign in again' })).toBeVisible()
})

test('a page opened after a lost session shows the last list too', async ({ page, api }) => {
  await api.post('/api/demo/online', { state: 'sign_in_again' })
  await page.reload()
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  await expect(page.getByTestId('friends-stale')).toBeVisible()
})

test('a session that ended with nothing read says so, and is not told that it will be tried again', async ({ page, api }) => {
  await changeAnswer<FriendsModel>(page, '/api/friends', (data) => {
    Object.assign(data, { friends: [], incoming: [], read_at: null, stale: true })
  })
  await api.post('/api/demo/online', { state: 'sign_in_again' })
  await page.reload()
  await expect(page.getByTestId('friends-stale')).toContainText('Your online session has ended, so your friends could not be read.')
  await expect(page.getByTestId('friends-stale').getByRole('link', { name: 'Open Settings' })).toBeVisible()
})

test('signed out, the page says to sign in and links to Settings', async ({ page, api }) => {
  await api.post('/api/demo/online', { state: 'signed_out' })
  const gate = page.getByTestId('friends-signin')
  await expect(gate).toContainText('Sign in with Discord to add friends and compare your stats with theirs.')
  await expect(friendList(page)).toHaveCount(0)
  await expect(addPanel(page)).toHaveCount(0)
  const link = gate.getByRole('link', { name: 'Open Settings' })
  await expect(link).toHaveAttribute('href', '#/settings')
  await link.click()
  await expect(page).toHaveURL(/#\/settings$/)
  await expect(page.getByRole('region', { name: 'Online', exact: true })).toBeVisible()
})

test('while a sign-in waits, the page says so, and shows nothing of the account before it', async ({ page, api }) => {
  await api.post('/api/demo/online', { state: 'waiting' })
  await expect(page.getByTestId('friends-signin')).toContainText('Finish signing in in your browser, then come back.')
  await expect(friendList(page)).toHaveCount(0)
})

test('signing in brings the list back without leaving the page', async ({ page, api }) => {
  await api.post('/api/demo/online', { state: 'signed_out' })
  await expect(page.getByTestId('friends-signin')).toBeVisible()
  await api.post('/api/demo/online', { state: 'signed_in' })
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  await expect(page.getByTestId('friends-signin')).toHaveCount(0)
})

test('the page asks for a fresh list when it opens, and again each minute while it is shown', async ({ page, core }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/friends') asked.push(url.search)
  })
  await page.clock.install()
  await page.reload()
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  expect(asked.length).toBeGreaterThan(0)
  expect(asked.every((search) => search === '?fresh=1')).toBe(true)
  const before = asked.length
  await page.clock.runFor(61_000)
  await expect.poll(() => asked.length).toBeGreaterThan(before)
  void core
})

test('a read on its way when a press is answered is not shown over the answer', async ({ page, api }) => {
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  // The list as it was before the press, whose answer the route keeps back until after the press.
  const { held, release } = holding()
  let keepNext = true
  const kept: Promise<void>[] = []
  await page.route('**/api/friends?fresh=1', async (route) => {
    if (!keepNext) return route.fallback()
    keepNext = false
    const response = await route.fetch()
    const done = held.then(() => route.fulfill({ response }))
    kept.push(done)
    return done
  })
  await api.post('/api/demo/online', { state: 'invite' }) // a change that makes the page read
  await expect.poll(() => kept.length).toBe(1)
  await requests(page).getByRole('button', { name: 'Accept' }).click()
  await expect(rowOf(page, 'Nova')).toHaveCount(1)
  release()
  await kept[0]
  await page.evaluate(() => new Promise((done) => setTimeout(done, 50)))
  await expect(rowOf(page, 'Nova')).toHaveCount(1)
  await expect(requests(page).getByText('wants to be your friend')).toHaveCount(0)
})

test('a sign-out leaves nothing on the page for the next account', async ({ page, api }) => {
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  await api.post('/api/demo/online', { state: 'signed_out' })
  await expect(page.getByTestId('friends-signin')).toBeVisible()
  const { held, release } = holding()
  await page.route('**/api/friends?fresh=1', async (route) => {
    await held
    await route.fallback()
  })
  await api.post('/api/demo/online', { state: 'signed_in' })
  await expect(page.getByText('Reading your friends…')).toBeVisible()
  await expect(friendList(page)).toHaveCount(0)
  release()
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
})

test('the launch link opens Friends, with a waiting invite in its strip', async ({ browser, core, api }) => {
  await api.post('/api/demo/online', { state: 'invite' })
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(`${core.launch}&to=friends`)
    await expect(page).toHaveURL(/#\/friends$/)
    const invite = requests(page).filter({ hasText: 'invited you' })
    await expect(invite).toContainText('Nova#5120 invited you.')
    await expect(invite.getByRole('button', { name: 'Send request' })).toBeVisible()
    await expect(invite.getByRole('button', { name: 'Ignore' })).toBeVisible()
  } finally {
    await context.close()
  }
})

test('what another PC sends breaks nothing: the list shows what it can', async ({ page }) => {
  const broken: string[] = []
  page.on('pageerror', (error) => broken.push(error.message))
  await changeAnswer<FriendsModel>(page, '/api/friends', (data) => {
    const odd = data.friends as unknown as Record<string, unknown>[]
    Object.assign(odd[0], { since: 'infinity', ar: -5, uid: 1e30, has_picture: 'yes', compare: 'yes', pills: ['nothing', 'primogems', 'account'] })
    Object.assign(odd[0], { stats: { primogems: { now: 'lots' }, account: { days_active: 1e9 } } })
    Object.assign(odd[1], { since: '-infinity', ar: 1e9, uid: -1, pills: 'none', stats: 'none' })
    Object.assign(odd[2], { last_seen: 'infinity', ar: 'x', uid: 'x', stats: null, pills: null })
  })
  await page.reload()
  const rows = friendList(page).getByRole('listitem')
  await expect(rows).toHaveCount(3)
  await expect(rowOf(page, 'Riley')).toContainText('In game')
  await expect(rowOf(page, 'Riley')).not.toContainText('In game for')
  await expect(rowOf(page, 'Riley').getByTitle('1,000,000,000 days active')).toBeVisible()
  await expect(rowOf(page, 'Riley').locator('.frd-chip')).toHaveCount(1) // the primogems held no figure
  await expect(rowOf(page, 'Riley').locator('.frd-ar')).toHaveCount(0)
  await expect(rowOf(page, 'Kira')).toContainText('Shares nothing yet')
  await expect(rowOf(page, 'Milo').getByRole('button', { name: 'Compare' })).toHaveAttribute('aria-disabled', 'true')
  expect(broken).toEqual([])
})

test('a name or a tag that is not text shows nothing in its place, and the page and its rail stay', async ({ page }) => {
  const broken: string[] = []
  page.on('pageerror', (error) => broken.push(error.message))
  await changeAnswer<FriendsModel>(page, '/api/friends', (data) => {
    // As a server that is not Guild Board's could send them: Riley's name and tag, Nova's request and the player's own name.
    Object.assign(data.friends[0] as unknown as Record<string, unknown>, { name: {}, tag: ['7687'] })
    Object.assign(data.incoming[0] as unknown as Record<string, unknown>, { name: { first: 'Nova' } })
    Object.assign(data.me as unknown as Record<string, unknown>, { name: 12 })
  })
  await page.reload()
  const rows = friendList(page).getByRole('listitem')
  await expect(rows).toHaveCount(3)
  await expect(page.getByRole('navigation', { name: 'Pages' })).toBeVisible()
  await expect(rows.nth(0).locator('.frd-nm')).toHaveText('') // Riley, in game, first
  await expect(rows.nth(0)).toContainText(/In game for 4\d min/)
  await expect(requests(page)).toContainText('#5120 wants to be your friend.')
  await expect(page.getByTestId('my-tag')).toHaveText('#2048')
  // A name stands in its own run of text, so that one in a right-to-left script does not move the words around it.
  await expect(rowOf(page, 'Kira').locator('.frd-nm bdi')).toHaveText('Kira')
  expect(broken).toEqual([])
})

test('a page that cannot be drawn says so in its place, and the rail stays and leads away', async ({ page, api }) => {
  await changeAnswer<FriendsModel>(page, '/api/friends', (data) => {
    Object.assign(data as unknown as Record<string, unknown>, { incoming: 5 }) // no list at all: the page cannot be drawn
  })
  await page.reload()
  await expect(page.getByRole('main')).toContainText('This page could not be shown.')
  const rail = page.getByRole('navigation', { name: 'Pages' })
  await expect(rail).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friends')
  // It is drawn again at the core's next event: once the answer can be drawn, the page is back.
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await api.advance(1)
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  await rail.getByRole('link', { name: 'Stats', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stats')
})

test('a copy that the window refuses says so, and shows the link to copy by hand', async ({ page }) => {
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('refused'))
  })
  await addPanel(page).getByRole('button', { name: 'Copy an invite link' }).click()
  await expect(addPanel(page).getByRole('status')).toHaveText('The link could not be copied. Select it below and copy it by hand.')
  await expect(addPanel(page).getByRole('textbox', { name: 'Invite link' })).toHaveValue(/functions\/v1\/invite\?c=DEMO-INVITE/)
  await addPanel(page).getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(addPanel(page).getByRole('status').first()).toHaveText('The tag could not be copied. Select it and copy it by hand.')
})

test('a window hidden to the tray asks for nothing each minute, and asks as soon as it is shown', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/friends') asked.push(request.url())
  })
  const showWindow = (state: 'hidden' | 'visible') =>
    page.evaluate((visibility) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
      document.dispatchEvent(new Event('visibilitychange'))
    }, state)
  await page.clock.install()
  await page.reload()
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  await showWindow('hidden')
  const before = asked.length
  await page.clock.runFor(300_000)
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)))
  expect(asked.length).toBe(before)
  await showWindow('visible')
  await expect.poll(() => asked.length).toBeGreaterThan(before)
})

test('leaving the page ends its reads', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/friends') asked.push(request.url())
  })
  await page.clock.install()
  await page.reload()
  await expect(friendList(page).getByRole('listitem')).toHaveCount(3)
  await page.getByRole('link', { name: 'Stats', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stats')
  const before = asked.length
  await page.clock.runFor(300_000)
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)))
  expect(asked.length).toBe(before)
})

// The window has no smallest size, and a friend's screen may be smaller than the player's: what fits at 1,640 has to give way.
for (const width of [1100, 1280, 1366]) {
  test(`in a window ${width} pixels wide nothing runs out of its part`, async ({ page, core }) => {
    await page.setViewportSize({ width, height: 800 })
    const riley = '00000000-0000-4000-8000-000000007687'
    for (const place of ['#/friends', '#/friends/me', `#/friends/${riley}`, `#/friends/${riley}/compare`]) {
      await page.goto(`${core.origin}/${place}`)
      await expect(page.locator('.frd-row, .prf-tile, .cmp-row').first()).toBeVisible()
      const spilled = await page.evaluate(() =>
        [...document.querySelectorAll('.frd-row, .frd-req, .prf-tile, .prf-tt, .cmp-row')]
          .filter((part) => part.scrollWidth > part.clientWidth + 1)
          .map((part) => part.className),
      )
      expect(spilled, place).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth), place).toBeLessThanOrEqual(width)
    }
  })
}

test('in a narrower window a stat that is too wide for its column keeps clear of Compare', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  const row = rowOf(page, 'Riley')
  await expect(row.locator('.frd-chip')).toHaveCount(3)
  const ends = await row.locator('.frd-chip').evaluateAll((chips) => chips.map((chip) => chip.getBoundingClientRect().right))
  const button = await row.getByRole('button', { name: 'Compare' }).boundingBox()
  expect(Math.max(...ends)).toBeLessThanOrEqual(button?.x ?? 0)
})

test('the page is capped and the add panel sits beside the list, not under it', async ({ page }) => {
  await page.setViewportSize({ width: 1640, height: 1100 })
  const list: Locator = page.getByRole('region', { name: 'Your friends' })
  const add: Locator = addPanel(page)
  const [one, two] = [await list.boundingBox(), await add.boundingBox()]
  expect(one && two && two.x > one.x + one.width - 1).toBe(true)
  expect(one && two && Math.abs(two.y - one.y) < 2).toBe(true)
  expect((one?.width ?? 0) + (two?.width ?? 0)).toBeLessThanOrEqual(1440)
})

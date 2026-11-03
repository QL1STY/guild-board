import type { Page } from '@playwright/test'
import type { FriendProfile as ProfileModel, FriendsModel, YourProfile } from '../src/onlinetypes.ts'
import { changeAnswer, holding } from './answers.ts'
import { expect, test } from './fixtures.ts'

/*
 * Your profile and a friend's (the online plan, Task B7; the online design, sections 6 and 9, mockup 2). The demo's account is
 * Traveler#2048, which shares Status, Primogems, Play time, Achievements, Endgame and Account, and pins Primogems, Endgame and
 * Achievements; Wishes and Spending are off. Riley#7687 is in game and shares five stats.
 */

const RILEY = '00000000-0000-4000-8000-000000007687'
const MILO = '00000000-0000-4000-8000-000000003391'

const tile = (page: Page, name: string) => page.getByRole('group', { name, exact: true })
const share = (page: Page, name: string) => tile(page, name).getByRole('button', { name: `Share ${name}` })
const pin = (page: Page, name: string) => tile(page, name).getByRole('button', { name: `Pin ${name}` })
const preview = (page: Page) => page.getByTestId('profile-preview')
const finding = (page: Page) => page.getByRole('region', { name: 'Finding you' })

async function chipTitles(page: Page): Promise<(string | null)[]> {
  return preview(page).locator('.frd-chip').evaluateAll((chips) => chips.map((chip) => chip.getAttribute('title')))
}

test.describe('Your profile', () => {
  test.beforeEach(async ({ page, core }) => {
    await page.goto(`${core.origin}/#/friends/me`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your profile')
  })

  test('the profile card in the rail opens it once the player is signed in, and not before', async ({ page, api, core }) => {
    await page.goto(`${core.origin}/#/board`)
    await page.getByTestId('profile').click()
    const panel = page.getByTestId('profile-panel')
    const link = panel.getByRole('button', { name: 'Your profile' })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(/#\/friends\/me$/)
    await expect(panel).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your profile')
    await expect(page.getByRole('link', { name: 'Friends', exact: true })).toHaveAttribute('aria-current', 'page')
    await api.post('/api/demo/online', { state: 'signed_out' })
    await page.goto(`${core.origin}/#/board`)
    await page.getByTestId('profile').click()
    await expect(page.getByTestId('profile-panel').getByRole('button', { name: 'Account settings' })).toBeVisible()
    await expect(page.getByTestId('profile-panel').getByRole('button', { name: 'Your profile' })).toHaveCount(0)
  })

  test('the buttons of the profile card\'s panel are one size', async ({ page, core }) => {
    await page.goto(`${core.origin}/#/board`)
    await page.getByTestId('profile').click()
    const sizes = await page.getByTestId('profile-panel').locator('.gb-pop-acts .gb-btn').evaluateAll((buttons) =>
      buttons.map((button) => [Math.round(button.getBoundingClientRect().width), Math.round(button.getBoundingClientRect().height)]),
    )
    expect(sizes).toHaveLength(2)
    expect(sizes[0]).toEqual(sizes[1])
  })

  test('the header has the name and tag, the server and UID, and what the player is doing', async ({ page }) => {
    await expect(page.getByTestId('your-name')).toHaveText('Traveler#2048')
    await expect(page.getByTestId('your-header')).toHaveText('Europe. UID 700000001, checked with your HoYoLAB login.')
    await expect(page.getByTestId('your-status')).toHaveText('Not in game')
    await expect(page.getByRole('link', { name: 'Back to Friends' })).toHaveAttribute('href', '#/friends')
  })

  test('says in one line that friends also see the name, tag, rank, UID and picture, whatever the switches say', async ({ page }) => {
    const line = page.getByTestId('friends-always-see')
    await expect(line).toHaveText('Friends you accept also see your name, tag, Adventure Rank, UID and picture, whatever these switches say.')
    const heading = page.getByRole('heading', { name: 'What your friends see' })
    const [near, head] = [await line.boundingBox(), await heading.boundingBox()]
    expect(near && head && near.y - head.y < 80).toBe(true) // near the heading
    expect(near && near.height < 24).toBe(true) // one line
  })

  test('says in one sentence that friends can see when a shared stat changes, under the line before', async ({ page }) => {
    // When a shared number changes says when Guild Board ran, Status off or not (audit M14; the player's decision, item 4).
    const line = page.getByTestId('friends-see-changes')
    await expect(line).toHaveText('Friends can see when a stat you share changes, so they can tell roughly when Guild Board was running.')
    const [always, changes] = [await page.getByTestId('friends-always-see').boundingBox(), await line.boundingBox()]
    expect(always && changes && changes.y > always.y && changes.y - always.y < 40).toBe(true) // right under it
  })

  test('each tile says what a friend would read, and a tile that is off says Only you', async ({ page }) => {
    await expect(tile(page, 'Status')).toContainText('Not in game')
    await expect(tile(page, 'Status')).toContainText('and when you were last seen')
    await expect(tile(page, 'Primogems')).toContainText('16,040')
    await expect(tile(page, 'Primogems')).toContainText('now, and 9,880 earned in October')
    await expect(tile(page, 'Play time')).toContainText('18 h')
    await expect(tile(page, 'Play time')).toContainText('this week, from this PC')
    await expect(tile(page, 'Achievements')).toContainText('1,402 of 1,558')
    await expect(tile(page, 'Endgame')).toContainText('36 stars')
    await expect(tile(page, 'Endgame')).toContainText('Abyss, Theater Act 10, Stygian 5')
    await expect(tile(page, 'Account')).toContainText('812 days')
    await expect(tile(page, 'Account')).toContainText('active, with 94 characters')
    await expect(tile(page, 'Wishes')).toContainText('62 pity')
    await expect(tile(page, 'Wishes')).toContainText('Only you')
    await expect(tile(page, 'Spending')).toContainText('412 zł')
    await expect(tile(page, 'Spending')).toContainText('Only you')
    await expect(tile(page, 'Primogems')).not.toContainText('Only you')
    await expect(share(page, 'Primogems')).toHaveAttribute('aria-pressed', 'true')
    await expect(share(page, 'Wishes')).toHaveAttribute('aria-pressed', 'false')
  })

  test('the preview shows the pinned chips, as the friends see them', async ({ page }) => {
    await expect(preview(page)).toContainText("Beside your name on your friends' lists:")
    expect(await chipTitles(page)).toEqual(['16,040 primogems', '36 Abyss', '1,402 achievements'])
  })

  test('turning Wishes on shows its tile live, and the server holds it', async ({ page, api }) => {
    await share(page, 'Wishes').click()
    await expect(share(page, 'Wishes')).toHaveAttribute('aria-pressed', 'true')
    await expect(tile(page, 'Wishes')).toContainText('on the character banner, 3 five-stars in 90 days')
    await expect(tile(page, 'Wishes')).not.toContainText('Only you')
    await expect(pin(page, 'Wishes')).toBeVisible() // a stat that is on can be pinned
    expect(((await api.get('/api/profile')) as YourProfile).sharing).toContain('wishes')
    await share(page, 'Wishes').click()
    await expect(tile(page, 'Wishes')).toContainText('Only you')
    expect(((await api.get('/api/profile')) as YourProfile).sharing).not.toContain('wishes')
  })

  test('a change the server refuses puts the switch back, and says why', async ({ page, api }) => {
    await api.post('/api/demo/online', { state: 'offline' })
    await share(page, 'Wishes').click()
    await expect(page.getByTestId('profile-said')).toHaveText('The server could not be reached, so nothing changed. Try again later.')
    await expect(share(page, 'Wishes')).toHaveAttribute('aria-pressed', 'false')
    await expect(tile(page, 'Wishes')).toContainText('Only you')
    expect(((await api.get('/api/profile')) as YourProfile).sharing).not.toContain('wishes')
    // The same for a switch that is on.
    await share(page, 'Account').click()
    await expect(share(page, 'Account')).toHaveAttribute('aria-pressed', 'true')
    await expect(tile(page, 'Account')).not.toContainText('Only you')
  })

  test('a fourth pin is refused with a sentence, and a pin can be taken back and given to another', async ({ page, api }) => {
    await expect(pin(page, 'Primogems')).toHaveAttribute('aria-pressed', 'true')
    await expect(pin(page, 'Play time')).toHaveAttribute('aria-pressed', 'false')
    await pin(page, 'Play time').click()
    await expect(page.getByTestId('profile-said')).toHaveText('You can pin three stats at most.')
    await expect(pin(page, 'Play time')).toHaveAttribute('aria-pressed', 'false')
    expect(((await api.get('/api/profile')) as YourProfile).pins).toEqual(['primogems', 'endgame', 'achievements'])
    await pin(page, 'Primogems').click()
    await expect(pin(page, 'Primogems')).toHaveAttribute('aria-pressed', 'false')
    await pin(page, 'Play time').click()
    await expect(pin(page, 'Play time')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('profile-said')).toHaveCount(0)
    expect(await chipTitles(page)).toEqual(['36 Abyss', '1,402 achievements', '18 h this week'])
    expect(((await api.get('/api/profile')) as YourProfile).pins).toEqual(['endgame', 'achievements', 'playtime'])
  })

  test('Status has no pin, and a tile that is off has none', async ({ page }) => {
    await expect(tile(page, 'Status').getByRole('button', { name: /^Pin/ })).toHaveCount(0)
    await expect(share(page, 'Status')).toBeVisible()
    await expect(tile(page, 'Wishes').getByRole('button', { name: /^Pin/ })).toHaveCount(0)
  })

  test('a stat that goes off takes its pin and its chip with it', async ({ page, api }) => {
    await share(page, 'Primogems').click()
    await expect(tile(page, 'Primogems')).toContainText('Only you')
    await expect(pin(page, 'Primogems')).toHaveCount(0)
    expect(await chipTitles(page)).toEqual(['36 Abyss', '1,402 achievements'])
    expect(((await api.get('/api/profile')) as YourProfile).pins).toEqual(['endgame', 'achievements'])
  })

  test('with nothing pinned the preview is the first three that are shared, by the pin order', async ({ page }) => {
    for (const name of ['Primogems', 'Endgame', 'Achievements']) {
      await pin(page, name).click()
      await expect(pin(page, name)).toHaveAttribute('aria-pressed', 'false')
    }
    expect(await chipTitles(page)).toEqual(['16,040 primogems', '18 h this week', '36 Abyss'])
  })

  test('Find me by UID is off, switches, and the server keeps it', async ({ page, api }) => {
    const find = finding(page).getByRole('button', { name: 'Find me by UID' })
    await expect(find).toHaveAttribute('aria-pressed', 'false')
    await find.click()
    await expect(find).toHaveAttribute('aria-pressed', 'true')
    expect(((await api.get('/api/profile')) as YourProfile).find_by_uid).toBe(true)
  })

  test('the tag can be copied', async ({ page, context, core }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: core.origin })
    await expect(finding(page)).toContainText('Traveler#2048')
    await finding(page).getByRole('button', { name: 'Copy', exact: true }).click()
    await expect(finding(page).getByRole('status')).toHaveText('Tag copied.')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Traveler#2048')
  })

  test('the name can be changed here, and a name that does not fit is refused in words', async ({ page }) => {
    await finding(page).getByRole('button', { name: 'Change', exact: true }).click()
    const editor = finding(page).getByRole('group', { name: 'Change your name' })
    await editor.getByRole('textbox', { name: 'Your name' }).fill('!!')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(editor.getByRole('alert')).toHaveText('Use 2 to 20 letters, digits, spaces, _ or -.')
    await editor.getByRole('textbox', { name: 'Your name' }).fill('Aether')
    await editor.getByRole('button', { name: 'Save' }).click()
    await expect(editor).toHaveCount(0)
    await expect(page.getByTestId('your-name')).toHaveText('Aether#2048')
    await expect(finding(page)).toContainText('Aether#2048')
  })

  test('with the keyboard, the name\'s field takes the focus, and gives it back to Change', async ({ page }) => {
    const change = finding(page).getByRole('button', { name: 'Change', exact: true })
    const field = finding(page).getByRole('textbox', { name: 'Your name' })
    await change.focus()
    await page.keyboard.press('Enter')
    await expect(field).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(field).toHaveCount(0)
    await expect(change).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(field).toBeFocused()
    await finding(page).getByRole('button', { name: 'Cancel' }).focus()
    await page.keyboard.press('Enter')
    await expect(change).toBeFocused()
    await page.keyboard.press('Enter')
    await field.fill('Aether')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('your-name')).toHaveText('Aether#2048')
    await expect(change).toBeFocused()
  })

  test('Cancel leaves the name as it was', async ({ page }) => {
    await finding(page).getByRole('button', { name: 'Change', exact: true }).click()
    const editor = finding(page).getByRole('group', { name: 'Change your name' })
    await editor.getByRole('textbox', { name: 'Your name' }).fill('Someone')
    await editor.getByRole('button', { name: 'Cancel' }).click()
    await expect(editor).toHaveCount(0)
    await expect(page.getByTestId('your-name')).toHaveText('Traveler#2048')
  })

  test('says that the HoYoLAB login never goes to Discord, and signs out from here', async ({ page }) => {
    await expect(finding(page)).toContainText('Signed in with Discord')
    await expect(finding(page)).toContainText('Your HoYoLAB login never goes there.')
    await finding(page).getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByTestId('friends-signin')).toContainText('Sign in with Discord to add friends')
    await expect(page.getByRole('heading', { name: 'What your friends see' })).toHaveCount(0)
  })

  test('the buttons of the right panel are one size', async ({ page }) => {
    const sizes = await finding(page).getByRole('button').evaluateAll((buttons) =>
      buttons.filter((button) => button.classList.contains('gb-btn')).map((button) => Math.round(button.getBoundingClientRect().width)),
    )
    expect(sizes.length).toBeGreaterThanOrEqual(3)
    expect(new Set(sizes).size).toBe(1)
  })

  test('signed out, the page says to sign in', async ({ page, api }) => {
    await api.post('/api/demo/online', { state: 'signed_out' })
    await expect(page.getByTestId('friends-signin')).toContainText('Sign in with Discord to add friends')
    await expect(page.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '#/settings')
  })

  test('after a lost session the page asks to sign in again: none of its switches could change', async ({ page, api }) => {
    await api.post('/api/demo/online', { state: 'sign_in_again' })
    await expect(page.getByTestId('friends-signin')).toContainText('Your online session has ended. Sign in again in Settings.')
    await expect(page.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '#/settings')
    await expect(page.getByRole('heading', { name: 'What your friends see' })).toHaveCount(0)
  })

  test('Back to Friends goes to the list', async ({ page }) => {
    await page.getByRole('link', { name: 'Back to Friends' }).click()
    await expect(page).toHaveURL(/#\/friends$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Friends')
  })
})

test.describe("A friend's profile", () => {
  test('shows what the friend shares, read-only, with their status', async ({ page, core }) => {
    await page.goto(`${core.origin}/#/friends/${RILEY}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Riley')
    await expect(page.getByTestId('friend-name')).toHaveText('Riley#7687')
    await expect(page.getByTestId('friend-header')).toHaveText('UID 712345312')
    await expect(page.getByTestId('friend-status')).toHaveText(/^In game for 4\d min$/)
    await expect(page.getByText('AR 58', { exact: true })).toBeVisible()
    await expect(tile(page, 'Primogems')).toContainText('14,320')
    await expect(tile(page, 'Primogems')).toContainText('now, and 8,160 earned in October')
    await expect(tile(page, 'Play time')).toContainText('21 h')
    await expect(tile(page, 'Play time')).toContainText('this week')
    await expect(tile(page, 'Play time')).not.toContainText('from this PC')
    await expect(tile(page, 'Achievements')).toContainText('1,402 of 1,558')
    await expect(tile(page, 'Endgame')).toContainText('Abyss, Theater Act 8, Stygian 6')
    await expect(tile(page, 'Account')).toContainText('790 days')
    // Only what they share: no Wishes, no Spending, and no Status tile, since their status is in the header.
    await expect(tile(page, 'Wishes')).toHaveCount(0)
    await expect(tile(page, 'Spending')).toHaveCount(0)
    await expect(tile(page, 'Status')).toHaveCount(0)
    // No switches, no pins, and no tile that is grey.
    await expect(page.getByRole('button', { name: /^Share / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Pin / })).toHaveCount(0)
    await expect(page.locator('.prf-tile.off')).toHaveCount(0)
  })

  test('has a Compare button that opens Compare, and a link back to the list', async ({ page, core }) => {
    await page.goto(`${core.origin}/#/friends/${RILEY}`)
    await page.getByRole('button', { name: 'Compare' }).click()
    await expect(page).toHaveURL(new RegExp(`#/friends/${RILEY}/compare$`))
    await page.goto(`${core.origin}/#/friends/${RILEY}`)
    await page.getByRole('link', { name: 'Back to Friends' }).click()
    await expect(page).toHaveURL(/#\/friends$/)
  })

  test('a friend who shares nothing says so, and Compare is off', async ({ page, core }) => {
    await page.goto(`${core.origin}/#/friends/${MILO}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Milo')
    await expect(page.getByTestId('friend-status')).toHaveText('Offline 2 days ago')
    await expect(page.getByTestId('friend-shares')).toHaveText('Milo shares nothing yet.')
    const compare = page.getByRole('button', { name: 'Compare' })
    await expect(compare).toHaveAttribute('aria-disabled', 'true')
    await expect(compare).toHaveAttribute('data-tip', 'You and Milo share no stat in common yet.')
  })

  test('Remove friend asks first, Cancel keeps the friend, and removing goes back to the list without them', async ({ page, core, api }) => {
    await page.goto(`${core.origin}/#/friends/${RILEY}`)
    await page.getByRole('button', { name: 'Remove friend' }).click()
    const asking = page.getByRole('alertdialog', { name: 'Confirm removing Riley' })
    await expect(asking).toContainText('Remove Riley from your friends? You will stop seeing each other\'s stats.')
    expect(((await api.get('/api/friends')) as FriendsModel).friends).toHaveLength(3) // asking has sent nothing
    await asking.getByRole('button', { name: 'Cancel' }).click()
    await expect(asking).toHaveCount(0)
    expect(((await api.get('/api/friends')) as FriendsModel).friends).toHaveLength(3)
    await page.getByRole('button', { name: 'Remove friend' }).click()
    await asking.getByRole('button', { name: 'Remove friend' }).click()
    await expect(page).toHaveURL(/#\/friends$/)
    await expect(page.getByRole('list', { name: 'Friends' }).getByRole('listitem')).toHaveCount(2)
    await expect(page.getByRole('list', { name: 'Friends' })).not.toContainText('Riley')
  })

  test('a Remove friend that answers after the player left does not take them back', async ({ page, core }) => {
    await page.goto(`${core.origin}/#/friends/${RILEY}`)
    const { held, release } = holding()
    await page.route(`**/api/friends/${RILEY}`, async (route) => {
      if (route.request().method() === 'DELETE') await held
      await route.fallback()
    })
    await page.getByRole('button', { name: 'Remove friend' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove friend' }).click()
    await page.getByRole('link', { name: 'Stats', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stats')
    const answered = page.waitForResponse((response) => response.request().method() === 'DELETE')
    release()
    await answered
    await page.evaluate(() => new Promise((done) => setTimeout(done, 50)))
    await expect(page).toHaveURL(/#\/stats$/)
  })

  test('with the keyboard, the question takes the focus on Cancel, Escape ends it, and the focus comes back', async ({ page, core, api }) => {
    await page.goto(`${core.origin}/#/friends/${RILEY}`)
    const remove = page.getByRole('button', { name: 'Remove friend' })
    const asking = page.getByRole('alertdialog', { name: 'Confirm removing Riley' })
    await remove.focus()
    await page.keyboard.press('Enter')
    await expect(asking.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(asking).toHaveCount(0)
    await expect(remove).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(asking.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(asking).toHaveCount(0)
    await expect(remove).toBeFocused()
    expect(((await api.get('/api/friends')) as FriendsModel).friends).toHaveLength(3)
  })

  test('a friend who goes from the list while the page is open says so, and shows no more of them', async ({ page, core, api }) => {
    await page.goto(`${core.origin}/#/friends/${RILEY}`)
    await expect(page.getByTestId('friend-name')).toHaveText('Riley#7687')
    await page.request.delete(`${core.origin}/api/friends/${RILEY}`)
    await api.post('/api/demo/online', { state: 'invite' }) // a change that makes the page read
    await expect(page.getByTestId('friend-missing')).toContainText('This player is not on your friends list.')
    await expect(page.getByTestId('friend-name')).toHaveCount(0)
  })

  test('what another PC sends breaks nothing: the profile shows what it can', async ({ page, core }) => {
    const broken: string[] = []
    page.on('pageerror', (error) => broken.push(error.message))
    await changeAnswer<ProfileModel>(page, `/api/friends/${RILEY}`, (data) => {
      const odd = data.friend as unknown as Record<string, unknown>
      Object.assign(odd, { since: 'infinity', ar: -3, uid: 'x', has_picture: 'yes', compare: 'yes' })
      odd.stats = {
        primogems: { now: null, months: 7 },
        playtime: { week_hours: 'a', weeks: 'no', longest_run: -3 },
        achievements: { ticked: 1e9, total: 'all' },
        endgame: [],
        account: null,
        wishes: { pity: 1e308 },
        spending: { month_total: 5, currency: '<b>' },
      }
    })
    await page.goto(`${core.origin}/#/friends/${RILEY}`)
    await expect(page.getByTestId('friend-name')).toHaveText('Riley#7687')
    await expect(page.getByTestId('friend-status')).toHaveText('In game')
    await expect(page.getByTestId('friend-header')).toHaveCount(0)
    await expect(page.locator('.prf-tile')).toHaveCount(1)
    await expect(tile(page, 'Achievements')).toContainText('1,000,000,000')
    await expect(page.getByRole('button', { name: 'Compare' })).toHaveAttribute('aria-disabled', 'true')
    expect(broken).toEqual([])
  })

  test('a player who is not on the list says so, and the way back', async ({ page, core }) => {
    await page.goto(`${core.origin}/#/friends/00000000-0000-4000-8000-0000000000ff`)
    await expect(page.getByTestId('friend-missing')).toContainText('This player is not on your friends list.')
    await expect(page.getByRole('link', { name: 'Back to Friends' }).first()).toHaveAttribute('href', '#/friends')
  })

  test('signed out, the page says to sign in', async ({ page, core, api }) => {
    await page.goto(`${core.origin}/#/friends/${RILEY}`)
    await expect(page.getByTestId('friend-name')).toBeVisible()
    await api.post('/api/demo/online', { state: 'signed_out' })
    await expect(page.getByTestId('friends-signin')).toContainText('Sign in with Discord to add friends')
    await expect(page.getByTestId('friend-name')).toHaveCount(0)
  })

  test('what could not be updated stays, marked old', async ({ page, core, api }) => {
    await page.goto(`${core.origin}/#/friends/${RILEY}`)
    await expect(page.getByTestId('friend-name')).toBeVisible()
    await expect(page.getByTestId('friends-stale')).toHaveCount(0)
    await api.post('/api/demo/online', { state: 'offline' })
    await expect(page.getByTestId('friends-stale')).toContainText('Friends could not be updated.')
    await expect(page.getByTestId('friends-stale').getByRole('link')).toHaveCount(0)
    await expect(tile(page, 'Primogems')).toContainText('14,320')
    // It stands over the card, and as wide as it.
    await page.setViewportSize({ width: 1640, height: 1100 })
    const [mark, card] = [await page.getByTestId('friends-stale').boundingBox(), await page.getByRole('region', { name: 'Profile' }).boundingBox()]
    expect(mark?.x).toBe(card?.x)
    expect(mark?.width).toBe(card?.width)
  })

  test('after a lost session the friend stays, marked old, with the way to Settings', async ({ page, core, api }) => {
    await page.goto(`${core.origin}/#/friends/${RILEY}`)
    await expect(page.getByTestId('friend-name')).toBeVisible()
    await api.post('/api/demo/online', { state: 'sign_in_again' })
    const mark = page.getByTestId('friends-stale')
    await expect(mark).toContainText('Your online session has ended.')
    await expect(page.getByTestId('friend-name')).toHaveText('Riley#7687')
    await expect(tile(page, 'Primogems')).toContainText('14,320')
    await expect(mark.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '#/settings')
    await page.getByRole('button', { name: 'Remove friend' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove friend' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Sign in again first.' })).toBeVisible()
    await expect(page.getByTestId('friend-name')).toHaveText('Riley#7687')
  })

  test('the buttons of one row are the same size', async ({ page, core }) => {
    await page.goto(`${core.origin}/#/friends/${RILEY}`)
    await page.getByRole('button', { name: 'Remove friend' }).click()
    const sizes = await page.getByRole('alertdialog').getByRole('button').evaluateAll((buttons) =>
      buttons.map((button) => [Math.round(button.getBoundingClientRect().width), Math.round(button.getBoundingClientRect().height)]),
    )
    expect(sizes).toHaveLength(2)
    expect(sizes[0]).toEqual(sizes[1])
  })
})

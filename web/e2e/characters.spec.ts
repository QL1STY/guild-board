import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

/**
 * The demo ships none of the game's pictures and downloads none, so its pages show the drawn signs. The tests of how a
 * picture is asked for need one, so this gives the roster's faces and Sandrone's art an address in the core's art cache and
 * answers each request with a plain drawing, 1,024 by 2,048 pixels, tall as her art is (the asked size is read from the address).
 */
async function withPictures(page: Page) {
  await page.route(/\/api\/art\/[0-9a-f]{32}/, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="2048"><rect width="100%" height="100%" fill="#345"/></svg>',
    }),
  )
  await page.route(/\/api\/characters$/, async (route) => {
    const response = await route.fetch()
    const model = await response.json()
    model.entries.forEach((entry: { key: string; icon: string | null }) => (entry.icon = `/api/art/${'b'.repeat(32)}`))
    await route.fulfill({ response, json: model })
  })
  await page.route(/\/api\/characters\/sandrone$/, async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), art: `/api/art/${'a'.repeat(32)}` } })
  })
}

/*
 * The Characters pages against the demo core (the Characters plan, Task U9), which starts on Sunday 25 October 2026 at
 * 08:00 UTC with Sandrone, Odette, Alyosha and Jahoda in the focus. The week's and the endgame's tests are in week.spec.ts
 * and endgame.spec.ts.
 */
test.use({ viewport: { width: 1640, height: 1100 }, demoNow: '2026-10-25T08:00:00+00:00' })

test('the rail has the two Characters pages, and each opens its own', async ({ page }) => {
  const rail = page.getByRole('navigation').first()
  await expect(rail.getByRole('link', { name: 'Characters' })).toBeVisible()
  await expect(rail.getByRole('link', { name: 'Your week' })).toBeVisible()
  await rail.getByRole('link', { name: 'Your week' }).click()
  await expect(page).toHaveURL(/#\/week$/)
  await expect(page.getByRole('heading', { name: 'When each is ready' })).toBeVisible()
  await rail.getByRole('link', { name: 'Characters' }).click()
  await expect(page).toHaveURL(/#\/characters$/)
  await expect(page.getByRole('heading', { name: 'Characters', level: 2 })).toBeVisible()
})

test("the roster opens a character's profile, and the focus on a card shows its number", async ({ page, core }) => {
  await page.goto(`${core.origin}/#/characters`)
  const card = page.locator('.cr-card[data-key="sandrone"]')
  await expect(card).toContainText('In focus, 1')
  await card.locator('a.cr-link').click()
  await expect(page).toHaveURL(/#\/characters\/sandrone$/)
  await expect(page.locator('.pf-name')).toHaveText('Sandrone')
})

test('the search finds by name, element and weapon type, works with the filters and the sort, and Escape clears it', async ({ page, core, api }) => {
  const all = (await api.get<{ entries: { key: string; name: string; element: string; weapon: string }[] }>('/api/characters')).entries
  await page.goto(`${core.origin}/#/characters`)
  const cards = page.locator('.cr-card')
  await expect(cards).toHaveCount(all.length)
  const box = page.getByRole('textbox', { name: 'Search characters' })
  await box.fill('SANDRO')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toHaveAttribute('data-key', 'sandrone')
  const both = all.filter((one) => one.element === 'Hydro' && one.weapon === 'Catalyst')
  expect(both.length).toBeGreaterThan(0)
  await box.fill('hydro catalyst')
  await expect(cards).toHaveCount(both.length)
  await expect(cards.locator('.cr-kind').first()).toContainText('Catalyst')
  const catalysts = all.filter((one) => one.weapon === 'Catalyst')
  await box.fill('catalyst')
  await expect(cards).toHaveCount(catalysts.length)
  // with a filter and a sort
  await page.getByRole('button', { name: 'Cryo' }).click()
  await expect(cards).toHaveCount(catalysts.filter((one) => one.element === 'Cryo').length)
  await page.getByRole('button', { name: 'Cryo' }).click()
  await page.getByRole('radio', { name: 'Name', exact: true }).click()
  await expect(cards).toHaveCount(catalysts.length)
  const names = await cards.locator('.cr-name').allTextContents()
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })))
  await box.fill('nobody')
  await expect(page.getByText('No characters match this search and these filters.')).toBeVisible()
  // Escape clears it, and the box is reached by the keyboard
  await box.press('Escape')
  await expect(box).toHaveValue('')
  await expect(page.getByText('No characters match')).toHaveCount(0)
  await expect(cards).toHaveCount(all.length)
  await box.fill('x')
  await page.getByRole('button', { name: 'Clear the search' }).click()
  await expect(box).toHaveValue('')
  await box.focus()
  await expect(box).toBeFocused() // reached by the keyboard, like every control of the page
})

/** The animations that run on the roster page now, a hover's transition apart (its entrance is Web Animations on its parts and the rings' CSS). */
const entranceRunning = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.getAnimations().filter((animation) => !(animation instanceof CSSTransition) && (animation.effect as KeyframeEffect | null)?.target?.closest?.('.cr-page')).length)

test('the entrance plays on the first visit only: coming back from a card or another page shows the roster at once, as it was left', async ({ page, core }) => {
  await page.setViewportSize({ width: 1640, height: 420 })
  await page.goto(`${core.origin}/#/characters`)
  await expect(page.locator('.cr-card').first()).toBeVisible()
  expect(await entranceRunning(page), 'the first visit plays its entrance').toBeGreaterThan(0)
  await page.waitForFunction(() => document.getAnimations().length === 0, undefined, { timeout: 15_000 })
  // Left as the player likes it: a search, a filter, a sort and a place on the page.
  await page.getByRole('textbox', { name: 'Search characters' }).fill('a')
  await page.getByRole('button', { name: 'Hydro' }).click()
  await page.getByRole('radio', { name: 'Name', exact: true }).click()
  await page.waitForFunction(() => document.getAnimations().length === 0)
  const shown = await page.locator('.cr-card .cr-name').allTextContents()
  expect(shown.length).toBeGreaterThan(3)
  await page.evaluate(() => window.scrollTo(0, 150))
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(150)
  await page.locator('.cr-card a.cr-link').nth(2).click()
  await expect(page.locator('.pf-name')).toBeVisible()
  // Back by the card's own button: at once, with no reading line, no entrance, and all as it was.
  await page.evaluate(() => {
    const seen = { reading: false, animated: false }
    ;(window as unknown as { __back: typeof seen }).__back = seen
    new MutationObserver(() => {
      if (document.body.textContent?.includes('Reading your characters')) seen.reading = true
      if (document.querySelector('.cr-page') !== null && document.getAnimations().some((animation) => !(animation instanceof CSSTransition) && (animation.effect as KeyframeEffect | null)?.target?.closest?.('.cr-page'))) seen.animated = true
    }).observe(document.body, { childList: true, subtree: true, attributes: true })
  })
  await page.getByRole('link', { name: 'All characters' }).click()
  await expect(page.locator('.cr-card').first()).toBeVisible()
  expect(await page.locator('.cr-card .cr-name').allTextContents()).toEqual(shown)
  await expect(page.getByRole('textbox', { name: 'Search characters' })).toHaveValue('a')
  await expect(page.getByRole('button', { name: 'Hydro' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('radio', { name: 'Name', exact: true })).toHaveAttribute('aria-checked', 'true')
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - 150)).toBeLessThanOrEqual(2)
  await page.waitForTimeout(400)
  expect(await entranceRunning(page)).toBe(0)
  expect(await page.evaluate(() => (window as unknown as { __back: { reading: boolean; animated: boolean } }).__back)).toEqual({ reading: false, animated: false })
  // And from another page, after any time.
  await page.getByRole('link', { name: 'Stats' }).click()
  await expect(page).toHaveURL(/#\/stats$/)
  await expect(page.locator('.cr-card')).toHaveCount(0)
  await page.getByRole('link', { name: 'Characters', exact: true }).click()
  await expect(page.locator('.cr-card').first()).toBeVisible()
  expect(await page.locator('.cr-card .cr-name').allTextContents()).toEqual(shown)
  expect(await entranceRunning(page)).toBe(0)
})

test('the roster is read again quietly: a card that changed updates and the others are not drawn again', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/characters`)
  const jahoda = page.locator('.cr-card[data-key="jahoda"]')
  await expect(jahoda).toContainText('In focus, 4')
  await page.getByRole('link', { name: 'Stats' }).click()
  await page.getByRole('link', { name: 'Characters', exact: true }).click()
  await expect(jahoda).toBeVisible()
  await page.locator('.cr-card[data-key="nefer"]').evaluate((element) => ((element as unknown as { marked: boolean }).marked = true))
  await jahoda.getByRole('button', { name: /In focus/ }).click()
  await expect(jahoda.getByRole('button', { name: 'Add to focus' })).toBeVisible()
  expect(await page.locator('.cr-card[data-key="nefer"]').evaluate((element) => (element as unknown as { marked?: boolean }).marked)).toBe(true)
  await expect(page.getByText('Reading your characters')).toHaveCount(0)
})

test("a character's card has arrows to the characters beside her in the roster as the player left it, by the keyboard and on the screen", async ({ page, core, api }) => {
  const all = (await api.get<{ entries: { key: string; name: string; weapon: string }[] }>('/api/characters')).entries
  const order = all.filter((one) => one.weapon === 'Catalyst').sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  expect(order.length).toBeGreaterThan(3)
  await page.goto(`${core.origin}/#/characters`)
  await page.getByRole('textbox', { name: 'Search characters' }).fill('catalyst')
  await page.getByRole('radio', { name: 'Name', exact: true }).click()
  await expect(page.locator('.cr-card')).toHaveCount(order.length)
  await page.locator(`.cr-card[data-key="${order[0].key}"] a.cr-link`).click()
  await expect(page.locator('.pf-name')).toHaveText(order[0].name)
  // The first of the roster: no arrow back, and the arrow keys stop there.
  await expect(page.getByLabel('Previous character: none')).toBeVisible()
  await expect(page.getByRole('link', { name: `Next character: ${order[1].name}` })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.pf-name')).toHaveText(order[0].name)
  await expect(page).toHaveURL(new RegExp(`#/characters/${order[0].key}$`))
  // On to the next: the same page of the sidebar, the card is not drawn again, and no entrance plays.
  await page.getByRole('navigation', { name: `${order[0].name}'s pages` }).getByRole('button', { name: 'Weapon' }).click()
  await expect(page.locator('.pf-pane[data-pane="weapon"]')).toBeVisible()
  await page.waitForFunction(() => document.getAnimations().length === 0, undefined, { timeout: 15_000 }) // the entrance and the page's have played
  await page.locator('.pf-card').evaluate((element) => ((element as unknown as { same: boolean }).same = true))
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.pf-name')).toHaveText(order[1].name)
  await expect(page).toHaveURL(new RegExp(`#/characters/${order[1].key}$`))
  await expect(page.locator('.pf-pane[data-pane="weapon"]')).toBeVisible()
  expect(await page.locator('.pf-card').evaluate((element) => (element as unknown as { same?: boolean }).same)).toBe(true)
  const entering = () =>
    page.evaluate(() =>
      document.getAnimations().filter((animation) => (animation.effect as KeyframeEffect | null)?.getKeyframes().some((frame) => 'translate' in frame)).length,
    )
  expect(await entering()).toBe(0)
  // The arrows on the screen: the neighbours' names are their names, and a click moves on.
  await expect(page.getByRole('link', { name: `Previous character: ${order[0].name}` })).toBeVisible()
  // With both arrows the top bar is still one row: the title and the plate are level.
  const rows = await page.evaluate(() => [document.querySelector('.gb-title')!, document.querySelector('.gb-plate-wrap')!].map((one) => one.getBoundingClientRect().top))
  expect(Math.abs(rows[0] - rows[1])).toBeLessThan(40)
  await page.getByRole('link', { name: `Next character: ${order[2].name}` }).click()
  await expect(page.locator('.pf-name')).toHaveText(order[2].name)
  await page.getByRole('link', { name: `Previous character: ${order[1].name}` }).click()
  await expect(page.locator('.pf-name')).toHaveText(order[1].name)
  // Not while the Card panel is open.
  await page.getByRole('button', { name: /card$/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(new RegExp(`#/characters/${order[1].key}$`))
})

test('a tip of the character before goes when the card moves on, and the keys wait while the Card panel is open', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/characters/sandrone`)
  await expect(page.locator('.pf-arrow.next')).toBeVisible()
  await page.locator('.pf-panel [tabindex="0"]').first().hover({ position: { x: 20, y: 8 } })
  await expect(page.locator('.cx-tip')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page).not.toHaveURL(/#\/characters\/sandrone$/)
  await expect(page.locator('.cx-tip')).toHaveCount(0)
  const here = page.url()
  await page.getByRole('button', { name: 'Card' }).first().click()
  await expect(page.getByTestId('card-panel')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowLeft')
  expect(page.url()).toBe(here)
})

test('the last of the roster has no arrow forward, and the arrows wait for the quiet of reduced motion', async ({ page, core, api }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const all = (await api.get<{ entries: { key: string; name: string }[] }>('/api/characters')).entries
  await page.goto(`${core.origin}/#/characters`)
  await page.getByRole('radio', { name: 'Name', exact: true }).click()
  const names = await page.locator('.cr-card .cr-name').allTextContents()
  expect(names.length).toBe(all.length)
  const last = all.find((one) => one.name === names.at(-1))!
  const before = all.find((one) => one.name === names.at(-2))!
  await page.goto(`${core.origin}/#/characters/${last.key}`)
  await expect(page.locator('.pf-name')).toHaveText(last.name)
  await expect(page.getByLabel('Next character: none')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.pf-name')).toHaveText(last.name)
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.pf-name')).toHaveText(before.name)
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0) // no cross-fade under reduced motion
})

test("the pictures are asked for at the size they are shown, the roster's faces are lazy, and the chart is only there for the Constellation page", async ({ page, core }) => {
  await withPictures(page)
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/art/')) asked.push(request.url())
  })
  await page.goto(`${core.origin}/#/characters`)
  await expect(page.locator('.cr-card').first()).toBeVisible()
  await expect(page.locator('.cr-card .pic img[loading="lazy"]').first()).toHaveAttribute('decoding', 'async')
  await page.getByRole('textbox', { name: 'Search characters' }).fill('sandrone')
  await page.locator('.cr-card a.cr-link').click()
  await expect(page.locator('.pf-art img')).toHaveAttribute('src', /\/api\/art\/[0-9a-f]{32}$/) // high, the default: the original
  await expect(page.locator('.pf-cstage')).toHaveCount(0)
  await page.getByRole('navigation', { name: "Sandrone's pages" }).getByRole('button', { name: 'Constellation' }).click()
  await expect(page.locator('.pf-cstage')).toHaveCount(1)
  await page.getByRole('navigation', { name: "Sandrone's pages" }).getByRole('button', { name: 'Attributes' }).click()
  await expect(page.locator('.pf-cstage')).toHaveCount(0)
  await page.getByRole('link', { name: 'All characters' }).click()
  await expect(page.locator('.pf-art')).toHaveCount(0)
  expect(asked.length).toBeGreaterThan(0)
  for (const address of asked) {
    // The faces and icons at the size they are shown; only a large picture (her art) is the original, in the default quality.
    expect(address, 'every picture is asked for at a size or is a large original').toMatch(/(\?size=(128|256|512|1024|1536)|[0-9a-f]{32})$/)
  }
  expect(asked.filter((address) => address.includes('?size=')).length, 'the faces and icons are sized').toBeGreaterThan(0)
})

test("every page of the profile's panel fits it, and her art keeps one box on all six", async ({ page, core }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${core.origin}/#/characters/sandrone`)
  const nav = page.getByRole('navigation', { name: "Sandrone's pages" })
  const panes = { Attributes: 'attr', Weapon: 'weapon', Artifacts: 'arts', Constellation: 'cons', Talents: 'talents', Story: 'story' }
  const boxes: { x: number; y: number; width: number; height: number }[] = []
  for (const [name, key] of Object.entries(panes)) {
    await nav.getByRole('button', { name }).click()
    const pane = page.locator(`.pf-pane[data-pane="${key}"]`)
    await expect(pane).toBeVisible()
    const fit = await pane.evaluate((element) => {
      const last = element.lastElementChild?.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      return { over: element.scrollHeight - element.clientHeight, gap: Math.round(box.bottom - (last?.bottom ?? box.bottom)) }
    })
    expect(fit.over, `${name} scrolls`).toBeLessThanOrEqual(0)
    expect(fit.gap, `${name} ends above its floor`).toBeLessThanOrEqual(2)
    const art = await page.locator('.pf-art').boundingBox()
    expect(art, `${name} has her art`).not.toBeNull()
    boxes.push(art!)
  }
  for (const box of boxes) {
    expect(Math.abs(box.x - boxes[0].x)).toBeLessThanOrEqual(1)
    expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(1)
    expect(Math.abs(box.width - boxes[0].width)).toBeLessThanOrEqual(1)
    expect(Math.abs(box.height - boxes[0].height)).toBeLessThanOrEqual(1)
  }
})

test('a piece of the build strip unfolds, and shows its crit value and its verdict', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/characters/sandrone`)
  const goblet = page.locator('button[data-open="goblet"]')
  await expect(goblet).toHaveAttribute('aria-expanded', 'false')
  await goblet.click()
  await expect(goblet).toHaveAttribute('aria-expanded', 'true')
  const unfold = page.locator('#pf-unfold')
  await expect(unfold).toBeVisible()
  await expect(unfold).toContainText(/crit value/i)
})

test("the planner's goblet to Cryo shows +35%, and another goblet takes it away", async ({ page, core, api }) => {
  await page.goto(`${core.origin}/#/characters/sandrone/plan`)
  const change = page.locator('.pp-chip.hero b .sr-only')
  const goblet = page.locator('.pp-mrow', { hasText: 'Goblet' })
  await expect(change).toHaveText('+35%')
  await goblet.getByRole('button', { name: 'ATK %' }).click()
  await expect(change).not.toHaveText('+35%')
  await goblet.getByRole('button', { name: 'Cryo DMG Bonus' }).click()
  await expect(change).toHaveText('+35%')
  // The plan was sent, and the core answers it as it was kept.
  await expect.poll(async () => (await api.get<{ plan: { mains: { goblet: string } } }>('/api/characters/sandrone/plan')).plan.mains.goblet).toBe('dmg')
})

test('a change made just before leaving the planner is sent all the same', async ({ page, core, api }) => {
  type Plan = { plan: { mains: { goblet: string } } }
  await page.goto(`${core.origin}/#/characters/sandrone/plan`)
  const atk = page.locator('.pp-mrow', { hasText: 'Goblet' }).getByRole('button', { name: 'ATK %' })
  await expect(atk).toBeVisible()
  const before = (await api.get<Plan>('/api/characters/sandrone/plan')).plan.mains.goblet
  const put = page.waitForRequest(
    (request) => request.method() === 'PUT' && new URL(request.url()).pathname === '/api/characters/sandrone/plan',
    { timeout: 5_000 },
  )
  // The press and the leaving in one go, well inside the 150 ms the planner waits before it sends a change.
  await atk.evaluate((button) => {
    ;(button as HTMLButtonElement).click()
    window.location.hash = '#/board'
  })
  const goblet = ((await put).postDataJSON() as Plan['plan']).mains.goblet
  expect(goblet).not.toBe(before)
  await expect.poll(async () => (await api.get<Plan>('/api/characters/sandrone/plan')).plan.mains.goblet).toBe(goblet)
})

test('the Card panel edits a goal alone and each field goes back to the card on its own', async ({ page, core, api }) => {
  await page.goto(`${core.origin}/#/characters/sandrone`)
  await page.getByRole('button', { name: 'Her card' }).click()
  const panel = page.getByRole('dialog')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('yours')).toHaveCount(0)
  const crit = panel.locator('.cp-goal', { hasText: 'Crit Rate' }).locator('input')
  await crit.fill('60')
  await crit.press('Enter')
  await expect(panel.locator('[data-group="goals"]').getByText('yours')).toBeVisible()
  const card = () => api.get<{ card: { edited: string[]; fields: { goals: Record<string, number> } } }>('/api/characters/sandrone')
  await expect.poll(async () => (await card()).card.fields.goals.cr).toBe(60)
  expect((await card()).card.edited).toEqual(['goals'])
  // Her pronouns are another field, and going back for one leaves the other as it is.
  await panel.getByRole('radio', { name: 'they / them' }).click()
  await expect.poll(async () => (await card()).card.edited.sort()).toEqual(['goals', 'pronouns'])
  await panel.locator('[data-group="goals"]').getByRole('button', { name: 'Back to the card' }).click()
  await expect.poll(async () => (await card()).card.edited).toEqual(['pronouns'])
  expect((await card()).card.fields.goals.cr).toBe(75)
  // Back to the card for everything ends the edits.
  await panel.locator('.cp-foot').getByRole('button', { name: 'Back to the card' }).click()
  await expect.poll(async () => (await card()).card.edited).toEqual([])
  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toHaveCount(0)
})

test("her art is asked for at a size that covers its box, so the window never stretches it", async ({ page, core }) => {
  await withPictures(page)
  await page.goto(`${core.origin}/#/characters/sandrone`)
  const art = page.locator('.pf-art img')
  await expect(art).toHaveAttribute('src', /\/api\/art\/[0-9a-f]{32}/)
  await expect
    .poll(async () =>
      art.evaluate((image: HTMLImageElement) => {
        const box = image.getBoundingClientRect()
        const aspect = image.naturalWidth / image.naturalHeight
        // object-fit: cover by height: the art is drawn as wide as the larger of the box and its height times its proportions.
        const drawn = Math.max(box.width, box.height * aspect) * window.devicePixelRatio
        const asked = Number(new URL(image.src).searchParams.get('size')) || 2048 // the size the address asks for, the original being 2,048
        return image.complete && asked >= Math.min(drawn, 2048) - 1
      }),
    )
    .toBe(true)
})

test("the picture quality sets how large her art is fetched, at once and without a restart, and the faces stay small", async ({ page, core, api }) => {
  await withPictures(page)
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/art/')) asked.push(request.url())
  })
  await page.goto(`${core.origin}/#/characters/sandrone`)
  const art = page.locator('.pf-art img')
  await expect(art).toHaveAttribute('src', /\/api\/art\/[0-9a-f]{32}$/) // high: the original
  await api.put('/api/settings', { picture_quality: 'low' })
  await expect(art).toHaveAttribute('src', /\/api\/art\/[0-9a-f]{32}\?size=1024$/)
  await api.put('/api/settings', { picture_quality: 'medium' })
  await expect(art).toHaveAttribute('src', /\/api\/art\/[0-9a-f]{32}\?size=1536$/)
  await api.put('/api/settings', { picture_quality: 'high' })
  await expect(art).toHaveAttribute('src', /\/api\/art\/[0-9a-f]{32}$/)
  await page.getByRole('link', { name: 'All characters' }).click()
  await api.put('/api/settings', { picture_quality: 'low' })
  await expect(page.locator('.cr-card').first()).toBeVisible()
  const faces = await page.locator('.cr-card .pic img').evaluateAll((images) => images.map((image) => image.getAttribute('src')))
  for (const face of faces) if (face !== null) expect(face, 'a face is never the original, in any mode').toMatch(/\?size=(128|256|512)$/)
  expect(faces.length).toBeGreaterThan(0)
})

for (const { name, height, device } of [
  { name: 'usual window', height: 1100, device: 1 },
  { name: 'full screen, zoomed down', height: 922, device: 2560 / 1640 },
]) {
  test(`the stars sit where each chart's own stars are drawn, square, tall or wide, large or small: ${name}`, async ({ browser, core }) => {
    const context = await browser.newContext({ viewport: { width: 1640, height }, deviceScaleFactor: device, reducedMotion: 'reduce' })
    const points = ([width, height]: [number, number]): [number, number][] => [
      [0, 0], [width, height], [width, 0], [0, height], [Math.round(width / 2), Math.round(height / 3)], [Math.round(width / 4), Math.round(height * 0.9)],
    ]
    try {
      await context.request.get(core.launch, { maxRedirects: 0 })
      await context.request.put(`${core.origin}/api/settings`, { data: { risk_acknowledged: true } })
      const page = await context.newPage()
      let chart: [number, number] = [900, 900]
      await page.route(/\/api\/art\/testchart/, (route) =>
        route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${chart[0]}" height="${chart[1]}"><rect width="100%" height="100%" fill="#123"/></svg>` }),
      )
      await page.route(/\/api\/characters\/sandrone$/, async (route) => {
        const response = await route.fetch()
        await route.fulfill({ response, json: { ...(await response.json()), chart: '/api/art/testchart', chart_size: chart, stars: points(chart) } })
      })
      for (const size of [[900, 900], [1350, 1350], [548, 720], [563, 563], [933, 809], [876, 843]] as [number, number][]) {
        chart = size
        await page.goto(`${core.origin}/#/characters/sandrone`)
        await page.reload()
        await page.getByRole('navigation', { name: "Sandrone's pages" }).getByRole('button', { name: 'Constellation' }).click()
        await expect(page.locator('.pf-cwrap .pf-ring')).toHaveCount(6)
        const seen = await page.locator('.pf-cwrap').evaluate(async (wrap) => {
          const image = wrap.querySelector('img')!
          await image.decode()
          const box = image.getBoundingClientRect()
          // Where object-fit puts the picture in its box, read from the image the window really holds.
          const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight)
          const left = box.left + (box.width - image.naturalWidth * scale) / 2
          const top = box.top + (box.height - image.naturalHeight * scale) / 2
          const stars = [...wrap.querySelectorAll('.pf-ring')].map((ring) => {
            const circle = ring.getBoundingClientRect()
            return [(circle.left + circle.right) / 2, (circle.top + circle.bottom) / 2]
          })
          const whole = wrap.getBoundingClientRect()
          const stays = box.width <= whole.width + 0.5 && box.height <= whole.height + 0.5 && Math.max(box.width, box.height) > whole.width - 0.5
          const centred = Math.abs(box.left + box.right - whole.left - whole.right) < 1 && Math.abs(box.top + box.bottom - whole.top - whole.bottom) < 1
          return { fit: getComputedStyle(image).objectFit, natural: [image.naturalWidth, image.naturalHeight], stays, centred, left, top, scale, stars }
        })
        expect(seen.natural).toEqual(size)
        expect(seen.fit).toBe('contain')
        expect(seen.stays, `chart ${size} fills the square and stays in it`).toBe(true)
        expect(seen.centred, `chart ${size} stands in the middle`).toBe(true)
        points(size).forEach(([x, y], index) => {
          expect(Math.abs(seen.stars[index][0] - (seen.left + x * seen.scale)), `star ${index + 1} across, chart ${size}`).toBeLessThan(0.75)
          expect(Math.abs(seen.stars[index][1] - (seen.top + y * seen.scale)), `star ${index + 1} down, chart ${size}`).toBeLessThan(0.75)
        })
      }
    } finally {
      await context.close()
    }
  })
}

test('a card with no stars puts the six on a ring, and each keeps its number', async ({ page, core }) => {
  await page.route(/\/api\/characters\/sandrone$/, async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), chart: null, chart_size: null, stars: null } })
  })
  await page.goto(`${core.origin}/#/characters/sandrone`)
  await page.getByRole('navigation', { name: "Sandrone's pages" }).getByRole('button', { name: 'Constellation' }).click()
  await expect(page.locator('.pf-cwrap .pf-ring')).toHaveCount(6)
  await expect(page.locator('.pf-cwrap .pf-cstar').first()).toHaveAttribute('aria-label', /^C1\. /)
})

test("the arrows on a card are two buttons of one size with a face and no name, the name is in a tip, and they stay put from card to card", async ({ page, core, api }) => {
  const all = (await api.get<{ entries: { key: string; name: string; weapon: string }[] }>('/api/characters')).entries
  const order = all.filter((one) => one.weapon === 'Catalyst').sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  const longest = order.reduce((one, other) => (other.name.length > one.name.length ? other : one))
  expect(order.length).toBeGreaterThan(3)
  await page.goto(`${core.origin}/#/characters`)
  await page.getByRole('textbox', { name: 'Search characters' }).fill('catalyst')
  await page.getByRole('radio', { name: 'Name', exact: true }).click()
  await expect(page.locator('.cr-card')).toHaveCount(order.length)
  await page.locator(`.cr-card[data-key="${order[0].key}"] a.cr-link`).click()
  const boxes = async () =>
    page.evaluate(() => {
      const box = (element: Element | null) => {
        const rect = element!.getBoundingClientRect()
        return { left: Math.round(rect.left * 10) / 10, width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 }
      }
      return {
        previous: box(document.querySelector('.pf-arrow.previous')),
        next: box(document.querySelector('.pf-arrow.next')),
        all: box([...document.querySelectorAll('.gb-top a.gb-btn')].find((one) => one.textContent === 'All characters') ?? null),
        refresh: box(document.querySelector('.gb-top .cx-refresh')),
      }
    })
  await expect(page.locator('.pf-name')).toHaveText(order[0].name)
  const first = await boxes()
  expect(first.previous.width, 'the same width').toBe(first.next.width)
  expect(first.previous.height, 'the same height as All characters').toBe(first.all.height)
  expect(first.next.height).toBe(first.all.height)
  expect(first.refresh.height, 'and as Refresh').toBe(first.all.height)
  // No name on a button, only the arrow and a face; the end is a disabled button that stays in place.
  await expect(page.locator('.pf-arrow')).toHaveText(['', ''])
  await expect(page.getByRole('button', { name: 'Previous character: none' })).toBeDisabled()
  await expect(page.locator('.pf-arrow.next img, .pf-arrow.next svg')).not.toHaveCount(0)
  // Walking through the roster to its last card, in the order of the sort: the buttons never move or change size.
  for (let at = 1; at < order.length; at += 1) {
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.pf-name')).toHaveText(order[at].name)
    expect(await boxes(), `on ${order[at].name}`).toEqual(first)
  }
  await expect(page.getByRole('button', { name: 'Next character: none' })).toBeDisabled()
  // The longest name does not widen anything either.
  await page.goto(`${core.origin}/#/characters/${longest.key}`)
  await expect(page.locator('.pf-name')).toHaveText(longest.name)
  expect((await boxes()).next.width).toBe(first.next.width)
  // The name is in a tip on the pointer and on the keyboard's focus, and a button has its accessible name.
  await page.goto(`${core.origin}/#/characters`)
  await page.getByRole('textbox', { name: 'Search characters' }).fill('catalyst')
  await page.getByRole('radio', { name: 'Name', exact: true }).click()
  await page.locator(`.cr-card[data-key="${order[1].key}"] a.cr-link`).click()
  await expect(page.locator('.pf-name')).toHaveText(order[1].name)
  const next = page.getByRole('link', { name: `Next character: ${order[2].name}` })
  await next.hover()
  await expect(page.getByRole('tooltip')).toHaveText(order[2].name)
  await page.mouse.move(5, 500)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.getByRole('link', { name: `Previous character: ${order[0].name}` }).focus()
  await expect(page.getByRole('tooltip')).toHaveText(order[0].name)
})

test('a pane that fits never shows a scrollbar as it comes in', async ({ page, core }) => {
  await page.goto(`${core.origin}/#/characters/sandrone`)
  await expect(page.getByRole('heading', { name: 'Sandrone' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Talents' }).click()
  const pane = page.locator('.pf-pane')
  await expect(pane).toHaveClass(/settling/)
  await expect(pane).not.toHaveClass(/settling/)
})

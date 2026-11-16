import type { Locator, Page } from '@playwright/test'
import type { EndgameResetsModel, Widget } from '../src/types.ts'
import { changeAnswer } from './answers.ts'
import { layoutOf, setBoard, widgetById } from './board.ts'
import { expectCentred } from './centred.ts'
import { expect, test } from './fixtures.ts'

/*
 * The Endgame resets widget (the five widgets plan, Task 4; the polish pass's four drawings) on the Board and on the overlay's
 * list, on the demo's endgame at its fixed time (13 October 2026): the Abyss at 33 stars and 2 days to its reset, the Theater at
 * Act 10 and 18 days, the Stygian at difficulty 5 and 18 days. A widget with no style shows With pictures; Medallions, Season
 * bars and In order are chosen in Edit. Each style at its smallest and largest size is held to its frame by widgets-sizes.spec.ts.
 * The demo downloads nothing, so the pictures here are stand-ins this test draws itself, as the Stats card's are.
 */

const widget = (w: number, h: number, id = 'endgame', settings: Record<string, unknown> = {}): Widget => ({
  id, type: 'endgame-resets', w, h, x: 0, y: 0, settings,
})

/** What the art cache gives a live app once it keeps the pictures: an address for each mode's header, and the Theater's medal. */
function pictured(data: EndgameResetsModel): void {
  let at = 0
  const art = () => `/api/art/${String((at += 1)).padStart(32, '0')}`
  for (const mode of data.modes) {
    mode.header = { icon: art(), picture: art(), crop: mode.mode === 'stygian' ? [0, 0, 0.48, 0.84] : null }
    if (mode.mode === 'theater') {
      mode.medal = art()
      mode.medals = 6
    }
  }
}

const STAND_IN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#6d8fb5"/><circle cx="90" cy="100" r="60" fill="#e9c46a"/></svg>'

async function drawPictures(page: Page): Promise<void> {
  await changeAnswer<EndgameResetsModel>(page, '/api/endgame-resets', pictured)
  await page.route('**/api/art/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: STAND_IN }))
}

const notPlayed = (page: Page, index = 2) =>
  changeAnswer<EndgameResetsModel>(page, '/api/endgame-resets', (data) => {
    Object.assign(data.modes[index], { played: false, difficulty: null })
    data.not_played = 1
  })

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
})

test('a widget with no style draws With pictures: at 2 × 1 a tile for each mode with its result and the time on a pill', async ({ page, api }) => {
  await setBoard(api, page, [widget(2, 1)])
  const frame = widgetById(page, 'endgame')
  const tiles = frame.locator('.egp-t')
  await expect(tiles).toHaveCount(3)
  await expect(tiles.nth(0)).toContainText('Abyss')
  await expect(tiles.nth(0).locator('.egp-v')).toHaveText('33★/ 36')
  await expect(tiles.nth(0).locator('.egp-pill')).toHaveText('2 d')
  await expect(tiles.nth(1)).toContainText('Theater')
  await expect(tiles.nth(1).locator('.egp-v')).toHaveText('Act 106') // the demo's read carries 6 medals
  await expect(tiles.nth(1).locator('.egp-pill')).toHaveText('18 d')
  await expect(tiles.nth(2)).toContainText('Stygian')
  await expect(tiles.nth(2).locator('.egp-v')).toHaveText('5difficulty')
  await expect(tiles.nth(2).locator('.egp-pill')).toHaveText('18 d')
  await expect(frame.locator('.w-meta')).toHaveCount(0)
  await expect(frame.locator('.egp-b, .egp-c')).toHaveCount(0)
})

test('at 2 × 2 a band for each mode with its full name, its result and its time in full', async ({ page, api }) => {
  await setBoard(api, page, [widget(2, 2)])
  const frame = widgetById(page, 'endgame')
  const bands = frame.locator('.egp-b')
  await expect(bands).toHaveCount(3)
  await expect(bands.nth(0)).toContainText('Spiral Abyss')
  await expect(bands.nth(0)).toContainText('33★of 36 stars')
  await expect(bands.nth(0).locator('.egp-pill')).toHaveText(/^resets in\s*2 d/)
  await expect(bands.nth(1)).toContainText('Imaginarium Theater')
  await expect(bands.nth(1)).toContainText('Act 10')
  await expect(bands.nth(1)).not.toContainText(' of ') // the demo's read does not carry the season's acts
  await expect(bands.nth(2)).toContainText('Stygian Onslaught')
  await expect(bands.nth(2)).toContainText('Difficulty 5')
  await expect(bands.nth(2).locator('.egp-pill')).toHaveText(/^ends in\s*18 d/)
  await expect(frame.locator('.w-meta')).toHaveCount(0) // every mode is played
})

test('at 3 × 2 a column for each mode, as on the Stats card: the picture header, the result and the time', async ({ page, api }) => {
  await setBoard(api, page, [widget(3, 2)])
  const columns = widgetById(page, 'endgame').locator('.egp-c')
  await expect(columns).toHaveCount(3)
  await expect(columns.nth(0).locator('.egp-h')).toContainText('Spiral Abyss')
  await expect(columns.nth(0).locator('.egp-big')).toHaveText('33★')
  await expect(columns.nth(0).locator('.egp-cap')).toHaveText('of 36 stars')
  await expect(columns.nth(0).locator('.egp-foot')).toContainText('to reset')
  await expect(columns.nth(1).locator('.egp-big')).toHaveText('Act 10')
  await expect(columns.nth(2).locator('.egp-big')).toHaveText('Difficulty 5')
  await expect(columns.nth(2).locator('.egp-foot')).toContainText('left')
})

test('a mode not played says so, its picture is dimmed, and the meta counts it', async ({ page, api }) => {
  await notPlayed(page)
  await setBoard(api, page, [widget(2, 2)])
  const frame = widgetById(page, 'endgame')
  const band = frame.locator('.egp-b').nth(2)
  await expect(band).toContainText('Not played yet')
  await expect(band).toHaveClass(/off/)
  expect(await band.locator('.egx-pic').evaluate((one) => getComputedStyle(one).filter)).toBe('grayscale(1)')
  expect(Number(await band.locator('.egx-pic').evaluate((one) => getComputedStyle(one).opacity))).toBeLessThan(0.5)
  await expect(frame.locator('.w-meta')).toHaveText('1 not played')
})

test('a mode not played at 2 × 1 says so on its tile, and the meta stays out', async ({ page, api }) => {
  await notPlayed(page)
  await setBoard(api, page, [widget(2, 1)])
  const frame = widgetById(page, 'endgame')
  await expect(frame.locator('.egp-t').nth(2).locator('.egp-v')).toHaveText('Not played yet')
  await expect(frame.locator('.egp-t').nth(2)).toHaveClass(/off/)
  await expect(frame.locator('.w-meta')).toHaveCount(0)
})

test('a cycle that ended since the read says so, and is not counted as not played', async ({ page, api }) => {
  await changeAnswer<EndgameResetsModel>(page, '/api/endgame-resets', (data) => {
    Object.assign(data.modes[0], { played: false, stars: null, ends_at: null, starts_at: null, stale: true })
    data.not_played = 0
  })
  await setBoard(api, page, [widget(2, 2)])
  const frame = widgetById(page, 'endgame')
  await expect(frame.locator('.egp-b').nth(0)).toContainText('Not read since the reset')
  await expect(frame.locator('.egp-b').nth(0).locator('.egp-pill')).toHaveCount(0)
  await expect(frame.locator('.w-meta')).toHaveCount(0)
})

test('before any endgame read it says so in one line', async ({ page, api }) => {
  await changeAnswer<EndgameResetsModel>(page, '/api/endgame-resets', (data) => {
    Object.assign(data, { read_at: null, modes: [], not_played: 0 })
  })
  await setBoard(api, page, [widget(2, 1)])
  await expect(widgetById(page, 'endgame')).toContainText('No endgame read yet.')
})

test("the demo has no pictures, so every mode shows its colour and nothing is asked of the internet", async ({ page, api }) => {
  const outside: string[] = []
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1') && !request.url().startsWith('data:')) outside.push(request.url())
  })
  await setBoard(api, page, [widget(2, 2)])
  const frame = widgetById(page, 'endgame')
  await expect(frame.locator('.egx-pic')).toHaveCount(3)
  await expect(frame.locator('.egx-img')).toHaveCount(0)
  for (const background of await frame.locator('.egx-pic').evaluateAll((all) => all.map((one) => getComputedStyle(one).backgroundImage))) {
    expect(background).toContain('linear-gradient')
  }
  expect(outside).toEqual([])
})

test("the core's pictures are the card's: the headers through the art cache, the Stygian's cropped to its flower", async ({ page, api }) => {
  await drawPictures(page)
  await setBoard(api, page, [widget(3, 2)])
  const frame = widgetById(page, 'endgame')
  const images = frame.locator('.egx-img')
  await expect(images).toHaveCount(3)
  const asked = await images.evaluateAll((all) => all.map((one) => getComputedStyle(one).backgroundImage))
  for (const background of asked) expect(background).toContain('/api/art/')
  expect(asked[1]).toContain('size=1024')
  const size = await images.nth(2).evaluate((one) => getComputedStyle(one).backgroundSize)
  expect(parseFloat(size)).toBeGreaterThan(190) // the Stygian banner shows its left part: about 100 / 0.48 per cent wide
  // The Theater's medal, HoYoLAB's own, beside its act, with the count the read carries.
  await expect(frame.locator('.egp-c').nth(1).locator('.egx-mk img')).toBeVisible()
  await expect(frame.locator('.egp-c').nth(1).locator('.egp-cap')).toHaveText('6 medals')
  await expect(frame.locator('.egp-c').nth(0).locator('.egx-mk')).toHaveCount(0)
})

test('a picture that fails keeps the mode colour and the medal falls back to a disc, never a broken image', async ({ page, api }) => {
  await changeAnswer<EndgameResetsModel>(page, '/api/endgame-resets', pictured)
  await page.route('**/api/art/**', (route) => route.fulfill({ status: 404, body: 'not here' }))
  await setBoard(api, page, [widget(2, 2)])
  const frame = widgetById(page, 'endgame')
  await expect(frame.locator('.egp-b').nth(2)).toContainText('Difficulty 5')
  await expect(frame.locator('.egx-pic')).toHaveCount(3)
  for (const background of await frame.locator('.egx-pic').evaluateAll((all) => all.map((one) => getComputedStyle(one).backgroundImage))) {
    expect(background).toContain('linear-gradient')
  }
  await expect(frame.locator('.egx-mk.fb')).toHaveCount(1)
  await expect(frame.locator('.egx-mk img')).toHaveCount(0)
  expect(await frame.locator('img').evaluateAll((all) => (all as HTMLImageElement[]).filter((one) => !one.hidden && one.complete && one.naturalWidth === 0).length)).toBe(0)
})

test('Edit picks the drawing: each of the four, kept in the widget, with the demo\'s results in each', async ({ page, api }) => {
  await setBoard(api, page, [widget(2, 2)])
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await widgetById(page, 'endgame').getByRole('button', { name: 'Settings of Endgame resets' }).click()
  const sheet = page.getByRole('region', { name: 'Settings of Endgame resets' })
  const frame = widgetById(page, 'endgame')
  await expect(sheet.getByRole('radio', { name: /^Pictures/ })).toBeChecked() // a widget with no style shows it
  await expect(frame.locator('.egp-b')).toHaveCount(3)
  await sheet.getByRole('radio', { name: /^Medallions/ }).check()
  await expect(frame.locator('.egm-p')).toHaveCount(3)
  await expect(frame.locator('.egm-p').nth(0)).toContainText('33')
  await expect(frame.locator('.egm-p').nth(1)).toContainText('Act 10')
  await expect(frame.locator('.egm-p').nth(2)).toContainText('Difficulty')
  await sheet.getByRole('radio', { name: /^Season bars/ }).check()
  await expect(frame.locator('.egb2-r')).toHaveCount(3)
  await expect(frame.locator('.egb2-r').nth(0)).toContainText('resets in')
  await expect(frame.locator('.egb2-r').nth(1).locator('.egb-flag')).toContainText('Act 10')
  await sheet.getByRole('radio', { name: /^In order/ }).check()
  await expect(frame.locator('.egv-r')).toHaveCount(3)
  await expect(frame.locator('.egv-r').nth(0)).toContainText('Spiral Abyss') // the Abyss resets first
  await sheet.getByRole('radio', { name: /^Pictures/ }).check()
  await expect(frame.locator('.egp-b')).toHaveCount(3)
  await sheet.getByRole('radio', { name: /^Season bars/ }).check()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  expect((await layoutOf(api)).widgets[0].settings).toEqual({ style: 'bars' })
  await expect(widgetById(page, 'endgame').locator('.egb2-r')).toHaveCount(3)
})

for (const [style, short, tall] of [
  ['medallions', '.egm-c', '.egm-p'],
  ['bars', '.egb-r', '.egb2-r'],
  ['order', '.egl-m', '.egv-r'],
] as const) {
  test(`${style}: three modes at one cell tall and at two, with the demo's results and times`, async ({ page, api }) => {
    await setBoard(api, page, [widget(2, 1, 'endgame', { style })])
    const small = widgetById(page, 'endgame')
    await expect(small.locator(short)).toHaveCount(3)
    await expect(small).toContainText('Abyss')
    await expect(small).toContainText('Theater')
    await expect(small).toContainText('Stygian')
    await expect(small).toContainText('2 d')
    await expect(small.locator('.w-meta')).toHaveCount(0)
    await setBoard(api, page, [widget(3, 2, 'endgame', { style })])
    const large = widgetById(page, 'endgame')
    await expect(large.locator(tall)).toHaveCount(3)
    await expect(large).toContainText('Act 10')
  })
}

test('the order puts the mode that resets first at the left, and one with no time after the rest', async ({ page, api }) => {
  await setBoard(api, page, [widget(2, 1, 'endgame', { style: 'order' })])
  const marks = widgetById(page, 'endgame').locator('.egl-m')
  await expect(marks.nth(0)).toContainText('Abyss') // 2 days, then the Theater and the Stygian at 18
  await expect(marks.nth(0)).toHaveClass(/ l/)
  await expect(marks.nth(2)).toHaveClass(/ r/)
  await changeAnswer<EndgameResetsModel>(page, '/api/endgame-resets', (data) => {
    Object.assign(data.modes[0], { played: false, stars: null, ends_at: null, starts_at: null, stale: true })
  })
  await page.reload()
  await expect(widgetById(page, 'endgame').locator('.egl-m').nth(2)).toContainText('Abyss')
})

test('a style this version does not know draws With pictures', async ({ page, api }) => {
  await setBoard(api, page, [widget(2, 1, 'endgame', { style: 'rings' })])
  await expect(widgetById(page, 'endgame').locator('.egp-t')).toHaveCount(3)
})

test("on the overlay's list it draws in the dark panel's roles", async ({ page, core, api }) => {
  const { revision } = await api.get<{ revision: number }>('/api/layouts/overlay')
  const endgame: Widget = { ...widget(2, 2, 'over-endgame'), pinned: true }
  await api.put('/api/layouts/overlay', { revision, widgets: [endgame] })
  await page.goto(`${core.origin}/#/overlay/open`)
  const frame = widgetById(page, 'over-endgame')
  await expect(frame.locator('.egp-b')).toHaveCount(3)
  expect(await frame.evaluate((section) => section.closest('.on-dark') !== null)).toBe(true)
  // The result and each mode's name are the dark panel's ink: a mode's colour is a mark (its sign and edge), never text.
  expect(await frame.locator('.egp-n > span').first().evaluate((value) => getComputedStyle(value).color)).toBe('rgb(241, 234, 219)')
  const names = await frame.locator('.egp-n b').evaluateAll((all) => all.map((name) => getComputedStyle(name).color))
  expect(names.length).toBeGreaterThanOrEqual(3)
  expect(new Set(names)).toEqual(new Set(['rgb(241, 234, 219)']))
  // The scrim over a picture is made from the panel's own background, so it is dark here.
  const veil = await frame.locator('.egp-b').first().evaluate((band) => getComputedStyle(band, '::before').backgroundImage)
  expect(veil).toContain('linear-gradient')
})

// The modes' own icons, the Stats card's (the blue emblem of each mode's Tutorial entry), stand where the drawn signs stood.

/** A square stand-in for an icon, as the wiki's is: the picture the core serves for an `icon-<mode>` address of the art cache. */
const ICON_STAND_IN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect x="6" y="6" width="84" height="84" rx="14" fill="#2f6fd0"/><circle cx="48" cy="48" r="26" fill="#bfe0ff"/></svg>'

/** What the art cache gives once it keeps each mode's icon, over the same pictures as `pictured`. */
async function drawIcons(page: Page, failing = false): Promise<void> {
  await changeAnswer<EndgameResetsModel>(page, '/api/endgame-resets', (data) => {
    pictured(data)
    for (const mode of data.modes) mode.header.icon = `/api/art/icon-${mode.mode}`
  })
  await page.route('**/api/art/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: STAND_IN }))
  await page.route('**/api/art/icon-*', (route) =>
    failing ? route.fulfill({ status: 404, body: 'not here' }) : route.fulfill({ contentType: 'image/svg+xml', body: ICON_STAND_IN }),
  )
}

/** Each image is asked for at least as many pixels as the screen draws it with: crisp at 2x. */
async function sharp(page: Page, images: Locator): Promise<void> {
  const ratio = await page.evaluate(() => window.devicePixelRatio)
  for (const image of await images.all()) {
    const box = await image.boundingBox()
    const asked = Number(/size=(\d+)/.exec((await image.getAttribute('src')) ?? '')?.[1] ?? 0)
    expect(box).not.toBeNull()
    expect(asked).toBeGreaterThanOrEqual(Math.max(box!.width, box!.height) * ratio)
  }
}

for (const [w, h, layout] of [[2, 1, 'at 2 x 1'], [3, 2, 'at 3 x 2']] as const) {
  test(`the medallions carry each mode's own icon in place of the drawn sign ${layout}`, async ({ page, api }) => {
    await drawIcons(page)
    await setBoard(api, page, [widget(w, h, 'endgame', { style: 'medallions' })])
    const frame = widgetById(page, 'endgame')
    const icons = frame.locator('.egx-sign[data-icon] .egx-mi img')
    await expect(icons).toHaveCount(3)
    for (const image of await icons.all()) {
      await expect(image).toBeVisible()
      expect(await image.evaluate((one) => (one as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      expect(await image.getAttribute('src')).toContain('/api/art/icon-')
    }
    // The icon sits inside its ring, and the sign under it is not drawn.
    const med = await frame.locator('.egx-med').first().boundingBox()
    const icon = await icons.first().boundingBox()
    expect(icon!.width).toBeGreaterThan(med!.width * 0.5)
    expect(icon!.width).toBeLessThan(med!.width * 0.75)
    expect(await frame.locator('.egx-mi .sign').first().evaluate((one) => getComputedStyle(one).visibility)).toBe('hidden')
    await sharp(page, icons)
  })
}

for (const [w, h, band, name] of [[2, 2, '.egp-b', 'the bands'], [3, 2, '.egp-c', 'the columns']] as const) {
  test(`With pictures carries each mode's own icon in place of the drawn sign: ${name}`, async ({ page, api }) => {
    await drawIcons(page)
    await setBoard(api, page, [widget(w, h)])
    const frame = widgetById(page, 'endgame')
    const icons = frame.locator(`${band} .egp-ic[data-icon] .egx-mi img`)
    await expect(icons).toHaveCount(3)
    for (const image of await icons.all()) await expect(image).toBeVisible()
    // No ring is drawn round the badge: it is the mark, at the size of the sign's place.
    const ring = await frame.locator(`${band} .egp-ic`).first().evaluate((one) => ({
      width: getComputedStyle(one).borderTopWidth, box: one.getBoundingClientRect().width,
    }))
    expect(ring.width).toBe('0px')
    expect(Math.round((await icons.first().boundingBox())!.width)).toBe(Math.round(ring.box))
    await sharp(page, icons)
  })
}

test('with no icon kept, as in the demo, each mode keeps its drawn sign and none is asked of the art cache', async ({ page, api }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/art/')) asked.push(request.url())
  })
  for (const [style, mark] of [['medallions', '.egx-sign .sign'], ['pictures', '.egp-ic .sign']] as const) {
    await setBoard(api, page, [widget(2, 2, 'endgame', { style })])
    const frame = widgetById(page, 'endgame')
    await expect(frame.locator(mark)).toHaveCount(3)
    await expect(frame.locator('.egx-mi')).toHaveCount(0)
    await expect(frame.locator(mark).first()).toBeVisible()
  }
  expect(asked).toEqual([])
})

test('an icon that fails to load leaves the drawn sign, never a broken image', async ({ page, api }) => {
  await drawIcons(page, true)
  await setBoard(api, page, [widget(2, 2, 'endgame', { style: 'medallions' })])
  const frame = widgetById(page, 'endgame')
  await expect(frame.locator('.egx-mi')).toHaveCount(3)
  await expect(frame.locator('.egx-mi img[hidden]')).toHaveCount(3)
  await expect(frame.locator('.egx-mi .sign').first()).toBeVisible()
})

test("on the overlay's dark panel the icons draw as they do on the Board", async ({ page, core, api }) => {
  await drawIcons(page)
  const { revision } = await api.get<{ revision: number }>('/api/layouts/overlay')
  const endgame: Widget = { ...widget(2, 2, 'over-endgame', { style: 'medallions' }), pinned: true }
  await api.put('/api/layouts/overlay', { revision, widgets: [endgame] })
  await page.goto(`${core.origin}/#/overlay/open`)
  const frame = widgetById(page, 'over-endgame')
  expect(await frame.evaluate((section) => section.closest('.on-dark') !== null)).toBe(true)
  const icons = frame.locator('.egx-mi img')
  await expect(icons).toHaveCount(3)
  for (const image of await icons.all()) await expect(image).toBeVisible()
})

// The Stygian's difficulty is HoYoLAB's official medal, the Stats card's picture, in every drawing that shows it.

/** A medal stand-in that is not symmetric: a ribbon on the left and a notch at the top, so that a picture cut or moved shows. */
const MEDAL_STAND_IN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><circle cx="64" cy="64" r="58" fill="#c8a24a"/><circle cx="64" cy="64" r="40" fill="#f3d58a"/><rect x="4" y="60" width="26" height="8" fill="#a33"/><rect x="60" y="2" width="8" height="18" fill="#333"/></svg>'
const MEDAL = '/api/art/medal0000000000000000000000000'

async function stygianMedal(page: Page, failing = false): Promise<void> {
  await changeAnswer<EndgameResetsModel>(page, '/api/endgame-resets', (data) => {
    data.modes[2]!.medal = MEDAL
  })
  await page.route('**/api/art/medal*', (route) =>
    failing ? route.fulfill({ status: 404, body: 'not here' }) : route.fulfill({ contentType: 'image/svg+xml', body: MEDAL_STAND_IN }),
  )
}

for (const [w, h, style, name] of [
  [2, 1, undefined, 'the tiles'], [2, 2, undefined, 'the bands'], [3, 2, undefined, 'the columns'],
  [2, 1, 'medallions', 'the medallions at one cell tall'], [3, 2, 'medallions', 'the plates'], [3, 2, 'order', 'In order'],
] as const) {
  test(`the Stygian's difficulty is its official medal in place of the shield: ${name}`, async ({ page, api }) => {
    await stygianMedal(page)
    await setBoard(api, page, [widget(w, h, 'endgame', style === undefined ? {} : { style })])
    const frame = widgetById(page, 'endgame')
    const medal = frame.locator('.egx-dm img')
    await expect(medal).toHaveCount(1)
    await expect(medal).toBeVisible()
    expect(await medal.evaluate((one) => (one as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    expect(await medal.getAttribute('src')).toContain('/api/art/medal')
    await expect(frame.locator('.egx-shield')).toHaveCount(0)
    const box = (await medal.boundingBox())!
    expect(Math.abs(box.width - box.height)).toBeLessThan(0.5) // a round medal in a square box, never squeezed
  })
}

test('with no medal kept, as in the demo, the shield with the number is drawn and no medal is asked of the art cache', async ({ page, api }) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/art/medal')) asked.push(request.url())
  })
  await setBoard(api, page, [widget(3, 2)])
  const frame = widgetById(page, 'endgame')
  await expect(frame.locator('.egx-shield')).toHaveCount(1)
  await expect(frame.locator('.egx-dm')).toHaveCount(0)
  expect(asked).toEqual([])
})

test('a medal that fails to load leaves the shield with the number, never a broken image', async ({ page, api }) => {
  await stygianMedal(page, true)
  await setBoard(api, page, [widget(3, 2)])
  const frame = widgetById(page, 'endgame')
  await expect(frame.locator('.egx-shield')).toHaveCount(1)
  await expect(frame.locator('.egx-dm')).toHaveCount(0)
  expect(await frame.locator('img').evaluateAll((all) => (all as HTMLImageElement[]).filter((one) => !one.hidden && one.complete && one.naturalWidth === 0).length)).toBe(0)
})

test("a Stygian not played this cycle shows no medal, and the Theater's mark is never taken for it", async ({ page, api }) => {
  await stygianMedal(page)
  await changeAnswer<EndgameResetsModel>(page, '/api/endgame-resets', (data) => {
    data.modes[2]!.medal = MEDAL
    Object.assign(data.modes[2]!, { played: false, difficulty: null })
    data.modes[1]!.medal = '/api/art/theater000000000000000000000000'
  })
  await setBoard(api, page, [widget(3, 2)])
  const frame = widgetById(page, 'endgame')
  await expect(frame.locator('.egp-c')).toHaveCount(3)
  await expect(frame.locator('.egx-dm, .egx-shield')).toHaveCount(0)
})

// An icon in a ring is centred in it, within a quarter of a pixel, at 1x and 2x; the layout box is the ring's own where it can be.

for (const scale of [1, 2]) {
  test.describe(`at ${scale}x`, () => {
    test.use({ deviceScaleFactor: scale })
    for (const [w, h, name] of [[2, 1, 'one cell tall'], [3, 2, 'the plates']] as const) {
      test(`each medallion's icon is centred in its ring: ${name}`, async ({ page, api }) => {
        await drawIcons(page)
        await setBoard(api, page, [widget(w, h, 'endgame', { style: 'medallions' })])
        await expectCentred(widgetById(page, 'endgame').locator('.egx-med'), '.egx-mi img')
      })
    }
  })
}

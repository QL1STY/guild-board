import type { Locator } from '@playwright/test'
import type { Layout, Pulls, Widget } from '../src/types.ts'
import { changeAnswer, holding } from './answers.ts'
import { setBoard, widgetById } from './board.ts'
import { expect, test } from './fixtures.ts'

/*
 * The six Pulls widgets (the Pulls plan, Task 12) on the Board and on the overlay's list, on the demo's history. Their
 * sizes are held to the plan's table by widgets-sizes.spec.ts.
 */

/** A number as the widgets write it, to the whole: 1234 is "1,234". */
const num = (value: number): string => Math.round(value).toLocaleString('en-US')

/** The tops of a widget's rings, rounded: one value for a row of them, two for two rows. */
function ringTops(frame: Locator): Promise<number[]> {
  return frame.locator('.ring').evaluateAll((rings) => rings.map((ring) => Math.round(ring.getBoundingClientRect().top)))
}

/** The six, each at its starting size, in a row. */
const SIX: Widget[] = [
  { id: 'wishing-now', type: 'wishing-now', w: 3, h: 2, x: 0, y: 0, settings: {} },
  { id: 'pity', type: 'pity', w: 2, h: 2, x: 3, y: 0, settings: {} },
  { id: 'savings', type: 'savings', w: 2, h: 2, x: 5, y: 0, settings: {} },
  { id: 'wishlist', type: 'wishlist', w: 2, h: 2, x: 7, y: 0, settings: {} },
  { id: 'last-pulls', type: 'last-pulls', w: 2, h: 2, x: 9, y: 0, settings: {} },
  { id: 'luck', type: 'luck', w: 1, h: 2, x: 11, y: 0, settings: {} },
]

test('the widgets say they are reading, and that there is no wish history before an import', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const { held, release } = holding()
  await page.route('**/api/pulls', async (route) => {
    await held
    await route.continue()
  })
  await setBoard(api, page, SIX)
  for (const widget of SIX) await expect(widgetById(page, widget.id), widget.type).toContainText('Reading the pulls…')
  release()
  await expect(widgetById(page, 'luck')).toContainText('average 5★ pity')
  await page.unroute('**/api/pulls')
  // Before any import the core names no account: each widget says there is no history.
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    data.uid = null
  })
  await page.reload()
  for (const widget of SIX) await expect(widgetById(page, widget.id), widget.type).toContainText('No wish history yet.')
})

test('the Pity widget shows one wish and all four at a wide size', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [
    { id: 'one', type: 'pity', w: 2, h: 2, settings: {}, x: 0, y: 0 },
    { id: 'weapon', type: 'pity', w: 2, h: 2, settings: { show: 'weapon' }, x: 2, y: 0 },
    { id: 'wide', type: 'pity', w: 4, h: 2, settings: { show: 'all' }, x: 4, y: 0 },
    { id: 'square', type: 'pity', w: 3, h: 3, settings: { show: 'all' }, x: 0, y: 2 },
  ])
  // One wish: the character event, unless another is chosen.
  const one = widgetById(page, 'one')
  await expect(one.locator('.w-meta')).toHaveText('character event')
  await expect(one.locator('.ring')).toHaveCount(1)
  await expect(one.locator('.ring')).toContainText('61')
  await expect(one.locator('.seal')).toHaveText('Next 5★ is the featured one')
  await expect(one).toContainText('13 to soft pity')
  await expect(one).toContainText('4★ in 3')
  const weapon = widgetById(page, 'weapon')
  await expect(weapon.locator('.w-meta')).toHaveText('weapon event')
  await expect(weapon.locator('.ring')).toContainText('23')
  await expect(weapon.locator('.seal')).toHaveText('Next 5★ is a 75/25')
  // All four: in a row from four cells wide, two by two below that, each named.
  const wide = widgetById(page, 'wide')
  await expect(wide.locator('.ring')).toHaveCount(4)
  expect(new Set(await ringTops(wide)).size).toBe(1)
  await expect(wide).toContainText('Character event')
  await expect(wide).toContainText('Chronicled')
  const square = widgetById(page, 'square')
  await expect(square.locator('.ring')).toHaveCount(4)
  expect(new Set(await ringTops(square)).size).toBe(2)
})

test('the Pity widget says at least where the history cannot tell', async ({ page, api }) => {
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    Object.assign(data.pity.find((one) => one.pool === 'character')!, { known: false, pity: 40, guarantee: 'unknown' })
  })
  await setBoard(api, page, [{ id: 'one', type: 'pity', w: 3, h: 2, settings: {} }])
  const one = widgetById(page, 'one')
  await expect(one.locator('.ring')).toHaveText('40+')
  await expect(one).toContainText('at most 34 to soft pity')
  await expect(one.locator('.seal')).toHaveText('Guarantee not known')
  await expect(one.locator('.seal')).toHaveClass(/quiet/)
})

test('Wishing now follows its chosen banner', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await setBoard(api, page, [
    { id: 'first', type: 'wishing-now', w: 3, h: 2, settings: {}, x: 0, y: 0 },
    { id: 'weapon', type: 'wishing-now', w: 3, h: 2, settings: { banner: '33203' }, x: 3, y: 0 },
    { id: 'second', type: 'wishing-now', w: 3, h: 2, settings: { banner: '33202' }, x: 6, y: 0 },
  ])
  // Without a choice, the first banner running; its time left is in the heading.
  const first = widgetById(page, 'first')
  await expect(first).toContainText("Void Star's Advent")
  await expect(first).toContainText('Skirk · your pity 61 · guaranteed')
  await expect(first.locator('.w-meta')).toHaveText(/^ends in 10 d 2[12] h$/)
  // The demo downloads no art: the banner's sign shows on the plate.
  await expect(first.locator('img')).toBeHidden()
  await expect(first.locator('.wn-art .sign')).toBeVisible()
  await expect(widgetById(page, 'weapon')).toContainText('Epitome Invocation')
  await expect(widgetById(page, 'weapon')).toContainText('Azurelight · Symphonist of Scents · pity 23')
  await expect(widgetById(page, 'second')).toContainText('Escoffier · shares the same pity')

  // Its Settings list the banners by name.
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await first.getByRole('button', { name: 'Settings of Wishing now' }).click()
  const sheet = page.getByRole('region', { name: 'Settings of Wishing now' })
  const banner = sheet.getByRole('combobox', { name: 'Banner' })
  await expect(banner.locator('option')).toHaveText([
    'The first running banner', "Void Star's Advent", 'La Chanson Cerise', 'Epitome Invocation',
  ])
  await banner.selectOption({ label: 'La Chanson Cerise' })
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(first).toContainText('La Chanson Cerise')
  const saved = await api.get<Layout>('/api/layouts/board')
  expect(saved.widgets.find((one) => one.id === 'first')!.settings).toEqual({ banner: '33202' })
})

test('the other widgets show the savings, the wishlist, the last pulls and the luck', async ({ page, api }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const model = await api.get<Pulls>('/api/pulls')
  await setBoard(api, page, [
    { id: 'savings', type: 'savings', w: 2, h: 2, settings: {}, x: 0, y: 0 },
    { id: 'wishlist', type: 'wishlist', w: 3, h: 2, settings: {}, x: 2, y: 0 },
    { id: 'last', type: 'last-pulls', w: 3, h: 2, settings: {}, x: 5, y: 0 },
    { id: 'luck', type: 'luck', w: 1, h: 2, settings: {}, x: 8, y: 0 },
  ])
  const savings = widgetById(page, 'savings')
  await expect(savings.locator('.w-meta')).toHaveText('set today')
  await expect(savings).toContainText(`${model.savings.pulls} pulls`)
  // The second line is the Pulls page's total: the pulls by the end of the next version (the second pass).
  expect(model.savings.by_next_end).not.toBeNull()
  await expect(savings.locator('.sv-by')).toHaveText(`${num(model.savings.by_next_end!)} by 16 Dec`)
  // The player's own wishlist alone, each a face in its rarity's frame: the running banners stay on the Pulls page's
  // planner (the player, 2026-10-24: "i don't want skirk and escoffier").
  const wishes = widgetById(page, 'wishlist').getByRole('listitem')
  await expect(wishes).toHaveCount(1)
  await expect(wishes.nth(0)).toContainText('Citlali · about 11 Nov, certain')
  await expect(wishes.locator('.wl-face.r5')).toHaveCount(1)
  await expect(widgetById(page, 'wishlist')).not.toContainText('Skirk')
  // The newest twelve as faces, newest first, each titled; the demo's newest 5★, Diluc, is among them.
  const last = widgetById(page, 'last')
  await expect(last.locator('.w-meta')).toHaveText('445 kept')
  const faces = last.locator('.lp-face')
  await expect(faces).toHaveCount(12)
  await expect(faces.first()).toHaveAttribute('title', model.history.rows[0].name)
  await expect(last.locator('.lp-face.r4').first()).toHaveAttribute('title', /^.+, pity \d+$/)
  await expect(last).toContainText('Diluc at 34')
  // The figure is the first tile's, the character event's average, and is named so.
  const luck = widgetById(page, 'luck')
  expect(model.history.average_pity).not.toBeNull()
  await expect(luck.locator('.lk-big')).toHaveText(num(model.history.average_pity!))
  await expect(luck.locator('.lk-what')).toHaveText('average 5★ pity, character event')
  await expect(luck).toContainText(`${model.history.won}–${model.history.lost}`)
  await expect(luck).toContainText('50/50')
  // A small bar of the 50/50s, won then lost, as the Pulls page's tile has.
  await expect(luck.locator('.lk-bar i')).toHaveCount(2)
})

test('the Savings widget keeps its look with no total, and says the forecast then', async ({ page, api }) => {
  // With no balance there is no total, and the widget says where to set one, as it did.
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    Object.assign(data.savings, { set: null, pulls: null, estimated: null, by_next_end: null })
  })
  await setBoard(api, page, [{ id: 'savings', type: 'savings', w: 2, h: 2, settings: {}, x: 0, y: 0 }])
  await expect(widgetById(page, 'savings')).toContainText('Set the balance on the Pulls page.')
  await expect(widgetById(page, 'savings').locator('.sv-by')).toHaveCount(0)
})

test("the Luck widget's label fits at its smallest size", async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'luck', type: 'luck', w: 1, h: 2, settings: {}, x: 0, y: 0 }])
  const luck = widgetById(page, 'luck')
  await expect(luck.locator('.lk-what')).toHaveText('average 5★ pity, character event')
  // Nothing of the widget is cut off by its frame: the label and the record end inside its body.
  const inside = await luck.evaluate((frame) => {
    const room = frame.getBoundingClientRect()
    const ends = (selector: string) => {
      const box = frame.querySelector(selector)!.getBoundingClientRect()
      return box.bottom <= room.bottom && box.right <= room.right && box.left >= room.left
    }
    return [ends('.lk-big'), ends('.lk-what'), ends('.lk-fifty')]
  })
  expect(inside).toEqual([true, true, true])
})

test('the Wishlist widget shows the icon the model gives an entry', async ({ page, api }) => {
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    data.wishlist[0].icon = '/api/icon/wish.character.citlali'
  })
  await setBoard(api, page, [{ id: 'wishlist', type: 'wishlist', w: 3, h: 2, settings: {}, x: 0, y: 0 }])
  const wishes = widgetById(page, 'wishlist').getByRole('listitem')
  await expect(wishes.nth(0)).toContainText('Citlali')
  await expect(wishes.nth(0).locator('img')).toHaveAttribute('src', '/api/icon/wish.character.citlali')
})

test('the Wishlist widget says where to add one when the list is empty, with no running banner in it', async ({
  page,
  api,
}) => {
  await changeAnswer<Pulls>(page, '/api/pulls', (data) => {
    data.wishlist = []
  })
  await setBoard(api, page, [{ id: 'wishlist', type: 'wishlist', w: 3, h: 2, settings: {}, x: 0, y: 0 }])
  await expect(widgetById(page, 'wishlist')).toContainText('Add the characters you are saving for, with a rough date.')
  await expect(widgetById(page, 'wishlist').getByRole('listitem')).toHaveCount(0)
})

test('the widgets draw with the widget roles', async ({ page, api }) => {
  await setBoard(api, page, [{ id: 'pity', type: 'pity', w: 2, h: 2, settings: {} }])
  const frame = widgetById(page, 'pity')
  await expect(frame.locator('.ring')).toBeVisible()
  const drawn = () =>
    frame.evaluate((section) => {
      const head = section.querySelector('.w-head')!
      return {
        card: getComputedStyle(section).backgroundColor,
        plate: getComputedStyle(head).backgroundColor,
        name: getComputedStyle(head.querySelector('.w-name')!).color,
        fill: getComputedStyle(section.querySelector('.r-fill')!).stroke,
        figure: getComputedStyle(section.querySelector('.ring-in')!).color,
      }
    })
  expect(await drawn()).toEqual({
    card: 'rgb(247, 242, 231)', plate: 'rgb(241, 234, 217)', name: 'rgb(94, 98, 114)', fill: 'rgb(166, 117, 31)',
    figure: 'rgb(59, 66, 85)',
  })
  await frame.evaluate((section) => section.classList.add('on-dark'))
  expect(await drawn()).toEqual({
    card: 'rgba(43, 49, 66, 0.93)', plate: 'rgba(241, 234, 219, 0.07)', name: 'rgb(217, 210, 195)',
    fill: 'rgb(226, 201, 143)', figure: 'rgb(241, 234, 219)',
  })
})

test("the widgets show on the overlay's list", async ({ page, core, api }) => {
  const { revision } = await api.get<Layout>('/api/layouts/overlay')
  const pity: Widget = { id: 'over-pity', type: 'pity', w: 2, h: 2, x: 0, y: 0, settings: {}, pinned: true }
  await api.put('/api/layouts/overlay', { revision, widgets: [pity] })
  await page.goto(`${core.origin}/#/overlay/open`)
  const frame = widgetById(page, 'over-pity')
  await expect(frame.locator('.ring')).toContainText('61')
  await expect(frame.locator('.w-meta')).toHaveText('character event')
  // "Add a widget" over the game lists the six with the other types.
  await page.getByRole('region', { name: 'Overlay' }).getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Add a widget' }).click()
  const sheet = page.getByRole('region', { name: 'Add a widget' })
  for (const name of ['Wishing now', 'Pity', 'Savings', 'Wishlist', 'Last pulls', 'Luck']) {
    await expect(sheet.getByRole('button', { name: `Add ${name}`, exact: true })).toBeVisible()
  }
})

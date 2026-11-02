import { deflateSync, crc32 } from 'node:zlib'
import type { Locator } from '@playwright/test'
import type { Achievements, BoardModel, CommissionsModel } from '../src/types.ts'
import { changeAnswer } from './answers.ts'
import { counted, setBoard, widgetById } from './board.ts'
import { type Api, expect, test } from './fixtures.ts'

/*
 * The achievement widgets on the demo's Board. The demo pins 84508 (Pirates! Argh!, three parts of which two are done),
 * 84512 (For the Love of Godwin, 3 of 5 times finished) and 82057 (...Well, That Was Strange, stage III of three, with
 * stages I and II ticked and 37 of 50 kills); its commission region is Liyue.
 */

/** A pinned achievement's row in the Pinned widget, by its name. */
const rowOf = (widget: Locator, name: string): Locator => widget.getByRole('listitem', { name, exact: true })

/** The box that ticks the stage a row stands at. A part's chip is a box too, and is named by its part. */
const boxOf = (row: Locator): Locator => row.getByRole('checkbox', { name: /^Done:/ })

/** What the undo note says. */
const noteTextOf = (page: Parameters<typeof widgetById>[0]): Locator => page.getByTestId('note').locator('.note-text')

/** The pinned achievements as the core holds them: each stage's number, status, pin and day it was ticked. */
async function pinnedStages(api: Api): Promise<{ id: number; status: string; pinned: boolean; done_at: string | null }[]> {
  const { groups } = await api.get<Achievements>('/api/achievements?view=all&pinned=true')
  return groups.flatMap((group) => group.stages.map(({ id, status, pinned, done_at }) => ({ id, status, pinned, done_at })))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The day of an instant in this PC's time, as the widgets write it: "13 Oct". */
function dayOf(instant: string): string {
  const at = new Date(instant)
  return `${at.getDate()} ${MONTHS[at.getMonth()]}`
}

/** Takes the hilichurl's second stage back and pins it, so that the achievement stands at stage II, as it is pinned at III. */
async function standAtStageTwo(api: Api): Promise<void> {
  await api.post('/api/achievements/stage/82056', { status: 'not_started' })
  await api.post('/api/achievements/stage/82056', { pinned: true })
}

test("Pinned achievements ticks and counts the demo's pinned stages, with Undo on the Board", async ({ page }) => {
  const pinned = widgetById(page, 'start-pinned')
  for (const name of ['Pirates! Argh!', 'For the Love of Godwin', '...Well, That Was Strange']) {
    await expect(rowOf(pinned, name)).toBeVisible()
  }
  const strange = rowOf(pinned, '...Well, That Was Strange')
  await expect(strange).toContainText('37 of 50 kills')
  await expect(strange.getByRole('checkbox')).toHaveCount(1) // the box of its current stage alone
  await strange.getByRole('button', { name: 'Count up' }).click()
  await expect(strange).toContainText('38 of 50 kills')
  const note = noteTextOf(page)
  await expect(note).toHaveText('Set the count of ...Well, That Was Strange to 38')
  await page.getByTestId('note').getByRole('button', { name: 'Undo' }).click()
  await expect(strange).toContainText('37 of 50 kills')
  const pirates = rowOf(pinned, 'Pirates! Argh!')
  await boxOf(pirates).check()
  await expect(note).toContainText('Pirates! Argh!')
  await expect(boxOf(pirates)).toBeChecked()
})

test('Pinned achievements shows each pinned achievement at its current stage, with its pips, tick, count and reward', async ({ page }) => {
  const pinned = widgetById(page, 'start-pinned') // 4 × 3
  // An achievement of three stages, at the third: the numeral and the pips beside its name, and its count as a bar.
  const strange = rowOf(pinned, '...Well, That Was Strange')
  await expect(strange.locator('.pn-numeral')).toHaveText('III')
  await expect(strange.getByRole('img', { name: '2 of 3 stages done' })).toBeVisible()
  await expect(strange.locator('.pn-top .pips i.on')).toHaveCount(2)
  await expect(strange.locator('.pn-top .pips i')).toHaveCount(3)
  const box = boxOf(strange)
  await expect(box).toHaveAccessibleName('Done: III, Defeat the Unusual Hilichurl 50 times.')
  await expect(box).not.toBeChecked()
  await expect(strange.locator('.pn-prog .bar-fill')).toHaveAttribute('style', /width:\s*74%/) // 37 of 50
  // The stage's text, two lines at most, and its reward with the primogem's picture, here its sign.
  await expect(strange.locator('.pn-desc')).toHaveText('Defeat the Unusual Hilichurl 50 times.')
  await expect(strange.locator('.pn-reward')).toHaveText('20 primogems')
  await expect(strange.locator('.pn-reward .pic .sign')).toBeVisible()
  // An achievement of one stage has no numeral and no pips, and a count of its own: 3 of 5.
  const godwin = rowOf(pinned, 'For the Love of Godwin')
  await expect(godwin.locator('.pn-numeral')).toHaveCount(0)
  await expect(godwin.getByRole('img')).toHaveCount(0)
  await expect(boxOf(godwin)).toHaveAccessibleName('Done: Finish "Whispers in the Wind" 5 times.')
  await expect(godwin.locator('.steps b')).toHaveText('3 of 5 times finished')
  await expect(godwin.locator('.pn-reward')).toHaveText('5 primogems')
  // A checklist: its parts are chips, two of them ticked, and no count.
  const pirates = rowOf(pinned, 'Pirates! Argh!')
  await expect(pirates.locator('.pn-chips').getByRole('checkbox')).toHaveCount(3)
  await expect(pirates.getByRole('button', { name: 'Count up' })).toHaveCount(0)
})

test('Pinned achievements at 3 × 2 has the name, pips, tick and count, and from 3 × 3 the stage text and the reward too', async ({
  page,
  api,
}) => {
  await setBoard(api, page, [
    { id: 'pin-s', type: 'pinned', w: 3, h: 2, settings: {} },
    { id: 'pin-l', type: 'pinned', w: 3, h: 3, settings: {} },
  ])
  for (const id of ['pin-s', 'pin-l']) {
    const strange = rowOf(widgetById(page, id), '...Well, That Was Strange')
    await strange.scrollIntoViewIfNeeded()
    await expect(strange.locator('.pn-title')).toBeVisible()
    await expect(strange.getByRole('img', { name: '2 of 3 stages done' })).toBeVisible()
    await expect(boxOf(strange)).toBeVisible()
    await expect(strange.locator('.pn-numeral')).toBeVisible()
    await expect(strange.locator('.steps b')).toHaveText('37 of 50 kills')
    await expect(strange.getByRole('button', { name: 'Count down' })).toBeVisible()
    await expect(strange.getByRole('button', { name: 'Count up' })).toBeVisible()
  }
  const [small, large] = ['pin-s', 'pin-l'].map((id) => rowOf(widgetById(page, id), '...Well, That Was Strange'))
  await expect(small.locator('.pn-desc')).toBeHidden()
  await expect(small.locator('.pn-reward')).toBeHidden()
  await expect(large.locator('.pn-desc')).toBeVisible()
  await expect(large.locator('.pn-reward')).toBeVisible()
})

test("the stage's text in Pinned achievements is two lines at most, and the rest is cut", async ({ page, api }) => {
  const sentence = 'A stage whose text goes on for a good while, because the list holds some that do'
  await changeAnswer<Achievements>(page, '/api/achievements', (model) => {
    for (const group of model.groups) {
      group.stages.forEach((stage) => (stage.description = Array.from({ length: 6 }, () => sentence).join(', ') + '.'))
    }
  })
  await setBoard(api, page, [{ id: 'pin-l', type: 'pinned', w: 4, h: 3, settings: {} }])
  const texts = widgetById(page, 'pin-l').locator('.pn-desc')
  await expect(texts).toHaveCount(3)
  const lines = await texts.evaluateAll((all) =>
    all.map((one) => {
      const clamped = one.getBoundingClientRect().height
      one.style.setProperty('-webkit-line-clamp', 'none') // what the text takes when nothing cuts it
      const whole = one.getBoundingClientRect().height
      one.style.removeProperty('-webkit-line-clamp')
      return { clamped, whole, lineHeight: parseFloat(getComputedStyle(one).lineHeight) }
    }),
  )
  for (const line of lines) {
    expect(line.clamped).toBeLessThanOrEqual(line.lineHeight * 2 + 1) // two lines, not three
    expect(line.whole).toBeGreaterThan(line.lineHeight * 2 + 1) // and the text was longer than that
  }
})

test('the count of a pinned achievement stands between the − and + that change it, and − does nothing at 0', async ({ page, api }) => {
  await api.post('/api/achievements/counter/84512', { value: 0 })
  await page.reload()
  const godwin = rowOf(widgetById(page, 'start-pinned'), 'For the Love of Godwin')
  const [down, up] = [godwin.getByRole('button', { name: 'Count down' }), godwin.getByRole('button', { name: 'Count up' })]
  const count = godwin.locator('.steps b')
  await expect(count).toHaveText('0 of 5 times finished')
  await expect(down).toHaveAttribute('aria-disabled', 'true')
  // The two buttons are one size, at least 24 pixels, and the count is between them.
  const [downBox, upBox, countBox] = [await down.boundingBox(), await up.boundingBox(), await count.boundingBox()]
  expect([downBox!.width, downBox!.height]).toEqual([upBox!.width, upBox!.height])
  expect(upBox!.height).toBeGreaterThanOrEqual(24)
  expect(downBox!.x + downBox!.width).toBeLessThanOrEqual(countBox!.x + 0.5)
  expect(countBox!.x + countBox!.width).toBeLessThanOrEqual(upBox!.x + 0.5)
  // + raises the count by one, from the keyboard too, and the focus stays on it; − at 0 sends nothing.
  await up.focus()
  await page.keyboard.press('Enter')
  await expect(count).toHaveText('1 of 5 times finished')
  await expect(noteTextOf(page)).toHaveText('Set the count of For the Love of Godwin to 1')
  await expect(up).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(down).toBeFocused()
  await page.keyboard.press('Space')
  await expect(count).toHaveText('0 of 5 times finished')
  await page.keyboard.press('Space') // at 0
  await page.waitForTimeout(300)
  await expect(down).toBeFocused()
  await expect(count).toHaveText('0 of 5 times finished')
  await expect(noteTextOf(page)).toHaveText('Set the count of For the Love of Godwin to 0')
})

test('a pinned achievement moves on to its next stage when its stage is ticked on the Board', async ({ page, api }) => {
  await standAtStageTwo(api)
  await page.reload()
  const strange = rowOf(widgetById(page, 'start-pinned'), '...Well, That Was Strange')
  const box = boxOf(strange)
  await expect(strange.locator('.pn-numeral')).toHaveText('II')
  await expect(box).toHaveAccessibleName('Done: II, Defeat the Unusual Hilichurl 20 times.')
  await expect(box).not.toBeChecked()
  await expect(strange.getByRole('img', { name: '1 of 3 stages done' })).toBeVisible()
  await expect(strange.locator('.pn-reward')).toHaveText('10 primogems')
  // The tick is sent, not asked for twice: the box is pressed, not checked, since the row moves on once the core has it.
  await box.click()
  await expect(strange.locator('.pn-numeral')).toHaveText('III')
  await expect(box).toHaveAccessibleName('Done: III, Defeat the Unusual Hilichurl 50 times.')
  await expect(box).not.toBeChecked()
  await expect(strange.getByRole('img', { name: '2 of 3 stages done' })).toBeVisible()
  await expect(strange.locator('.pn-desc')).toHaveText('Defeat the Unusual Hilichurl 50 times.')
  await expect(noteTextOf(page)).toHaveText('Ticked ...Well, That Was Strange')
  // The core ticked stage II and nothing else: both stages are still pinned.
  const stages = await pinnedStages(api)
  expect(stages.filter((stage) => [82056, 82057].includes(stage.id))).toEqual([
    expect.objectContaining({ id: 82056, status: 'done', pinned: true }),
    expect.objectContaining({ id: 82057, status: 'in_progress', pinned: true }),
  ])
})

test('the focus stays on the box as its row moves on to the next stage, and Space ticks it', async ({ page, api }) => {
  await standAtStageTwo(api)
  await page.reload()
  const strange = rowOf(widgetById(page, 'start-pinned'), '...Well, That Was Strange')
  const box = boxOf(strange)
  await box.focus()
  await page.keyboard.press('Space')
  await expect(strange.locator('.pn-numeral')).toHaveText('III')
  await expect(box).toBeFocused()
  await expect(box).not.toBeChecked()
})

test('a pinned achievement with every stage ticked shows Done and the day, until it is unpinned', async ({ page, api }) => {
  await api.post('/api/achievements/stage/82057', { status: 'done' }) // ticks the stages before it too
  await page.reload()
  const [last] = (await pinnedStages(api)).filter((stage) => stage.id === 82057)
  const strange = rowOf(widgetById(page, 'start-pinned'), '...Well, That Was Strange')
  const box = boxOf(strange)
  // It stands at its last stage, ticked, with every pip filled and the seal with the day the last stage was ticked.
  await expect(strange.locator('.pn-numeral')).toHaveText('III')
  await expect(box).toBeChecked()
  await expect(strange.getByRole('img', { name: '3 of 3 stages done' })).toBeVisible()
  const done = strange.locator('.pn-done')
  await expect(done.locator('.seal')).toHaveText('Done')
  await expect(done).toHaveText(`Done ${dayOf(last.done_at!)}`)
  // There is no count left to change.
  await expect(strange.getByRole('button', { name: /^Count (up|down)$/ })).toHaveCount(0)
  // The box unticks the last stage, and the achievement stands at it again.
  await box.click()
  await expect(box).not.toBeChecked()
  await expect(done).toHaveCount(0)
  await expect(strange.locator('.pn-numeral')).toHaveText('III')
  await expect(strange.getByRole('img', { name: '2 of 3 stages done' })).toBeVisible()
  await expect(strange.getByRole('button', { name: 'Count up' })).toBeVisible()
  await expect(noteTextOf(page)).toHaveText('Unticked ...Well, That Was Strange')
})

test('a stage reached by its count or its parts says so and outlines its box, and Guild Board does not tick it', async ({ page, api }) => {
  const pinned = widgetById(page, 'start-pinned')
  const strange = rowOf(pinned, '...Well, That Was Strange')
  const pirates = rowOf(pinned, 'Pirates! Argh!')
  const outline = (row: Locator) => boxOf(row).evaluate((input) => getComputedStyle(input).borderTopColor)
  const gold = () => strange.locator('.pn-prog .bar-fill').evaluate((fill) => getComputedStyle(fill).backgroundColor)
  await expect(strange.locator('.pn-reached')).toHaveCount(0)
  await expect(pirates.locator('.pn-reached')).toHaveCount(0)
  const plain = await outline(strange)
  expect(plain).not.toBe(await gold())
  await api.post('/api/achievements/counter/82055', { value: 50 })
  await api.post('/api/achievements/stage/84508', { part: { index: 2, done: true } })
  await page.reload()
  await expect(strange.locator('.pn-reached')).toHaveText('The count reached 50. Tick it once the game shows it.')
  await expect(pirates.locator('.pn-reached')).toHaveText('All parts are done. Tick it once the game shows it.')
  for (const row of [strange, pirates]) {
    expect(await outline(row)).toBe(await gold()) // the progress gold
    await expect(boxOf(row)).not.toBeChecked() // offered, never ticked
  }
  expect((await pinnedStages(api)).find((stage) => stage.id === 82057)!.status).toBe('in_progress')
})

test('the parts of a pinned achievement are chips that tick, with Undo on the Board', async ({ page }) => {
  const pirates = rowOf(widgetById(page, 'start-pinned'), 'Pirates! Argh!')
  // The stage's own box names its description, which holds these names, so a part is found by its exact name.
  const [meng, lulu, fei] = ['Little Meng', 'Little Lulu', 'Little Fei'].map((name) =>
    pirates.getByRole('checkbox', { name, exact: true }),
  )
  await expect(meng).toBeChecked()
  await expect(lulu).toBeChecked()
  await expect(fei).not.toBeChecked()
  await expect(pirates.locator('.pn-chips label').nth(2)).toHaveText('Little Fei')
  await fei.check()
  await expect(noteTextOf(page)).toHaveText('Ticked a part of Pirates! Argh!')
  await expect(fei).toBeChecked()
  await expect(pirates.locator('.pn-reached')).toHaveText('All parts are done. Tick it once the game shows it.')
  await page.getByTestId('note').getByRole('button', { name: 'Undo' }).click()
  await expect(fei).not.toBeChecked()
  await expect(pirates.locator('.pn-reached')).toHaveCount(0)
})

test("a part's chip ticks from the keyboard, and shows its focus", async ({ page }) => {
  const pirates = rowOf(widgetById(page, 'start-pinned'), 'Pirates! Argh!')
  const [lulu, fei] = ['Little Lulu', 'Little Fei'].map((name) => pirates.getByRole('checkbox', { name, exact: true }))
  await lulu.focus()
  await page.keyboard.press('Tab') // on to the next chip, from the keyboard, so that it shows its focus
  await expect(fei).toBeFocused()
  // The box is unseen over its chip, so the chip shows the ring: 2 pixels, set 2 pixels off, as every control's.
  const face = pirates.locator('.pn-chip').nth(2).locator('.pn-chip-face')
  await expect(face).toHaveCSS('outline-style', 'solid')
  await expect(face).toHaveCSS('outline-width', '2px')
  await expect(face).toHaveCSS('outline-offset', '2px')
  await page.keyboard.press('Space')
  await expect(fei).toBeChecked()
  await expect(noteTextOf(page)).toHaveText('Ticked a part of Pirates! Argh!')
  await expect(fei).toBeFocused()
})

test("the ring of a control in the list of Pinned achievements has room inside the list and the body, which clip it", async ({ page }) => {
  const frame = widgetById(page, 'start-pinned')
  // The first row's box stands in the list's top corner.
  const first = boxOf(rowOf(frame, 'Pirates! Argh!'))
  const [list, body, corner] = await Promise.all([
    frame.locator('.pn-list').boundingBox(),
    frame.locator('.w-body').boundingBox(),
    first.boundingBox(),
  ])
  const RING = 4 // 2 pixels wide, set 2 pixels off, as every control's
  for (const edge of [list!, body!]) {
    expect(corner!.x - RING).toBeGreaterThanOrEqual(edge.x)
    expect(corner!.y - RING).toBeGreaterThanOrEqual(edge.y)
  }
  // The list takes the room for the rings back with its margins: the box stands where the body's padding puts content.
  const padding = await frame.locator('.w-body').evaluate((one) => parseFloat(getComputedStyle(one).paddingLeft))
  expect(corner!.x - body!.x).toBeCloseTo(padding, 0)
})

test('the list of Pinned achievements scrolls inside the widget when it is long, and the widget does not', async ({ page, api }) => {
  // Pin the Wonders of the World's first twelve stages besides the demo's three.
  const { groups } = await api.get<Achievements>('/api/achievements?view=all&category=0')
  for (const group of groups.slice(0, 12)) await api.post(`/api/achievements/stage/${group.stages[0].id}`, { pinned: true })
  await setBoard(api, page, [{ id: 'pin-s', type: 'pinned', w: 3, h: 2, settings: {} }])
  const frame = widgetById(page, 'pin-s')
  await expect(frame.getByRole('listitem').first()).toBeVisible()
  const measure = () =>
    frame.evaluate((section) => {
      const body = section.querySelector('.w-body')!
      const list = section.querySelector('.pn-list')!
      return {
        body: body.scrollHeight - body.clientHeight,
        list: list.scrollHeight - list.clientHeight,
        scrollTop: list.scrollTop,
      }
    })
  const before = await measure()
  expect(before.body).toBeLessThanOrEqual(1) // the widget does not scroll
  expect(before.list).toBeGreaterThan(100) // its list does
  // A wheel over the list moves the list and not the page, and the last row can be reached.
  await frame.locator('.pn-list').hover()
  await page.mouse.wheel(0, 4000)
  await expect.poll(async () => (await measure()).scrollTop).toBeGreaterThan(0)
  expect((await measure()).body).toBeLessThanOrEqual(1)
  expect(await frame.getByRole('listitem').count()).toBeGreaterThan(10)
})

test('Commissions to look for follows the region in Settings, or the one chosen for it', async ({ page, api }) => {
  const region = widgetById(page, 'start-commissions').locator('.look-region')
  await expect(region).toHaveText('Liyue')
  await api.put('/api/settings', { commission_region: 'mondstadt' })
  await page.reload() // a setting sends the pages no event (spec 25)
  await expect(region).toHaveText('Mondstadt')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await widgetById(page, 'start-commissions').getByRole('button', { name: 'Settings of Commissions to look for' }).click()
  const sheet = page.getByRole('region', { name: 'Settings of Commissions to look for' })
  await sheet.getByRole('combobox', { name: 'Region' }).selectOption({ label: 'Inazuma' })
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(region).toHaveText('Inazuma')
})

test("Commissions to look for shows the region's sign and its names, one a line", async ({ page }) => {
  const widget = widgetById(page, 'start-commissions')
  await expect(widget.getByRole('heading', { name: 'Liyue' })).toBeVisible()
  await expect(widget.locator('.w-meta')).toHaveText('3 to look for')
  // The demo has no emblem to download, so the region's sign, the star, shows in the ring.
  const emblem = widget.locator('.look-emblem')
  await expect(emblem.locator('.sign')).toBeVisible()
  await expect(emblem.locator('img')).toBeHidden()
  // The names the core gives, each once, one to a line, each with the commission's star on a rule of its own.
  const names = widget.locator('.look-list li')
  await expect(names).toHaveText(["For Old Time's Sake", 'Pirate Invasion, in Liyue Harbor!', 'Where Is the Unseen Razor?'])
  await expect(names.locator('.sign')).toHaveCount(3)
  const lines = await names.evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect()
      return { top: box.top, height: box.height, rule: getComputedStyle(item).borderTopWidth }
    }),
  )
  expect(lines.map((line) => line.rule)).toEqual(['1px', '1px', '1px'])
  expect(lines[1].top).toBeGreaterThan(lines[0].top + lines[0].height - 1) // below, not beside
  expect(lines[2].top).toBeGreaterThan(lines[1].top + lines[1].height - 1)
  for (const line of lines) expect(line.height).toBeLessThan(36) // a name is one line of its row
})

test("Commissions to look for draws the region's emblem in a ring when the core names it, and the star under it hides", async ({
  page,
  api,
}) => {
  await page.route('**/api/icon/explore.3', (route) => route.fulfill({ contentType: 'image/png', body: pixels() }))
  await changeAnswer<CommissionsModel>(page, '/api/commissions', (model) => {
    model.region_icon = '/api/icon/explore.3'
  })
  await setBoard(api, page, [{ id: 'look', type: 'commissions', w: 2, h: 2, settings: {} }])
  const emblem = widgetById(page, 'look').locator('.look-emblem')
  const image = emblem.locator('img')
  await expect(image).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => image.evaluate((one: HTMLImageElement) => one.complete && one.naturalWidth)).toBe(2)
  await expect(image).toHaveAttribute('src', '/api/icon/explore.3')
  await expect(emblem.locator('.sign')).toBeHidden()
  // The picture is round, inside a gold ring of the emblem's own.
  const [ring, drawn] = await Promise.all([emblem.boundingBox(), image.boundingBox()])
  expect(ring!.width).toBeGreaterThanOrEqual(28)
  expect(ring!.width).toBe(ring!.height)
  expect(drawn!.width).toBeLessThan(ring!.width)
  expect(await emblem.evaluate((one) => getComputedStyle(one).borderTopWidth)).toBe('2px')
  expect(await emblem.evaluate((one) => getComputedStyle(one).borderTopLeftRadius)).toBe('50%')
})

test("Commissions to look for says there is nothing to look for in a region that has none, and counts nothing in its heading", async ({
  page,
  api,
}) => {
  await api.put('/api/settings', { commission_region: 'fontaine' })
  await page.reload()
  const widget = widgetById(page, 'start-commissions')
  await expect(widget.getByRole('heading', { name: 'Fontaine' })).toBeVisible()
  await expect(widget.getByText('Nothing to look for in Fontaine.')).toBeVisible()
  await expect(widget.locator('.look-list')).toHaveCount(0)
  await expect(widget.locator('.w-meta')).toHaveCount(0)
})

test('a long list of commissions to look for scrolls inside the widget, which does not scroll', async ({ page, api }) => {
  const names = Array.from({ length: 14 }, (_, number) => `Commission number ${number + 1}`)
  await changeAnswer<CommissionsModel>(page, '/api/commissions', (model) => {
    model.looking_for = names
  })
  await setBoard(api, page, [{ id: 'look', type: 'commissions', w: 2, h: 2, settings: {} }])
  const frame = widgetById(page, 'look')
  await expect(frame.locator('.w-meta')).toHaveText('14 to look for')
  await expect(frame.locator('.look-list li')).toHaveCount(14)
  const measure = () =>
    frame.evaluate((section) => {
      const body = section.querySelector('.w-body')!
      const list = section.querySelector('.look-list')!
      const head = section.querySelector('.look-head')!.getBoundingClientRect()
      const box = list.getBoundingClientRect()
      return { body: body.scrollHeight - body.clientHeight, list: list.scrollHeight - list.clientHeight, scrollTop: list.scrollTop, headBottom: head.bottom, listTop: box.top }
    })
  const before = await measure()
  expect(before.body).toBeLessThanOrEqual(1)
  expect(before.list).toBeGreaterThan(100)
  expect(before.listTop).toBeGreaterThanOrEqual(before.headBottom - 0.5) // the emblem and the name stay above the names
  await frame.locator('.look-list').hover()
  await page.mouse.wheel(0, 2000)
  await expect.poll(async () => (await measure()).scrollTop).toBeGreaterThan(100)
  // It holds nothing to stop at, so the browser makes the list itself a stop of the keyboard, and the frame shows the ring.
  const list = await frame.locator('.look-list').elementHandle()
  let reached = false
  for (let step = 0; step < 40 && !reached; step += 1) {
    await page.keyboard.press('Tab')
    reached = await list!.evaluate((one) => one === document.activeElement)
  }
  expect(reached, 'Tab reaches the list that scrolls').toBe(true)
  await expect(frame).toHaveCSS('outline-style', 'solid')
})

test('Achievement progress shows the ticks against all and the primogems to earn, and no HoYoLAB count', async ({ page, api }) => {
  await setBoard(api, page, [
    { id: 'progress-s', type: 'progress', w: 2, h: 1, settings: {} },
    { id: 'progress-l', type: 'progress', w: 3, h: 2, settings: {} },
  ])
  const [small, large] = ['progress-s', 'progress-l'].map((id) => widgetById(page, id))
  const ticked = (1219 / 1854) * 100 // 65.75
  for (const widget of [small, large]) {
    // The demo has ticked 1,219 of 1,854 and has 5,815 primogems to earn; the heading says what is left.
    await expect(counted(widget.locator('.prog-top .fig'))).toHaveText('1,219')
    await expect(widget.locator('.prog-top')).toContainText('of 1,854 ticked')
    await expect(widget.locator('.w-meta')).toHaveText('635 left')
    // The bar is the visual centre, with its percentage at its end.
    await expect(widget.locator('[data-centre] .bar')).toBeVisible()
    expect(parseFloat((await widget.locator('[data-centre] .bar-fill').getAttribute('style'))!.replace('width:', ''))).toBeCloseTo(ticked, 1)
    await expect(widget.locator('[data-centre] .prog-percent')).toHaveText('66%')
    // HoYoLAB's count is not shown, nor when it was counted.
    await expect(widget).not.toContainText('HoYoLAB')
    await expect(widget).not.toContainText('Read at')
  }
  // The primogems to earn come with room: not at 2 × 1, at 3 × 2 with the primogem's picture, here its sign, and what is left.
  await expect(small.getByText(/5,815/)).toBeHidden()
  const earn = large.locator('.prog-info')
  await expect(earn).toBeVisible()
  await expect(earn.locator('.pic .sign')).toBeVisible()
  await expect(earn).toContainText('5,815 primogems to earn')
  await expect(earn).toContainText('635 left')
})

test('Achievement progress says "1 primogem to earn" for one, as the Achievements page does', async ({ page, api }) => {
  await changeAnswer<BoardModel>(page, '/api/board', (board) => {
    board.achievements.primogems_left = 1
  })
  await setBoard(api, page, [{ id: 'progress-l', type: 'progress', w: 3, h: 2, settings: {} }])
  const earn = widgetById(page, 'progress-l').locator('.prog-info')
  await expect(earn).toContainText('1 primogem to earn')
  await expect(earn).not.toContainText('primogems')
})

/** A solid 2 × 2 picture in PNG, made here so that the test needs no file. */
function pixels(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(2, 0) // width
  header.writeUInt32BE(2, 4) // height
  header[8] = 8 // bits to a channel
  header[9] = 2 // red, green and blue
  const row = Buffer.from([0, 0xc9, 0xa2, 0x4b, 0xc9, 0xa2, 0x4b]) // no filter, two pixels
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat([row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

test('a picture that loads is drawn at the size of its place, and the sign under it is hidden', async ({ page, api }) => {
  // The demo downloads no picture, so the core has none for the primogem; this one is given by the test.
  await page.route('**/api/icon/static.primogem', (route) => route.fulfill({ contentType: 'image/png', body: pixels() }))
  await setBoard(api, page, [{ id: 'progress-l', type: 'progress', w: 3, h: 2, settings: {} }])
  const place = widgetById(page, 'progress-l').locator('.prog-info .pic')
  const image = place.locator('img')
  await expect(image).toBeVisible({ timeout: 15_000 }) // the Board model comes first, which a busy machine can be slow to give
  await expect.poll(() => image.evaluate((one: HTMLImageElement) => one.complete && one.naturalWidth)).toBe(2)
  const [around, drawn] = await Promise.all([place.boundingBox(), image.boundingBox()])
  expect(around!.width).toBeGreaterThanOrEqual(14) // the place gives its class a size
  expect(drawn).toEqual(around)
  await expect(place.locator('.sign')).toBeHidden() // it is drawn, but not seen
  await expect(image).toHaveAttribute('draggable', 'false')
})

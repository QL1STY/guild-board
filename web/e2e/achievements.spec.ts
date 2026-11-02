import type { Locator, Page } from '@playwright/test'
import type { Achievements } from '../src/types.ts'
import { changeAnswer, holding } from './answers.ts'
import { type Api, expect, test } from './fixtures.ts'

test.beforeEach(async ({ page, core }) => {
  await page.goto(`${core.origin}/#/achievements`)
})

/** The first achievement that a search of every achievement finds, as the core holds it. */
async function found(api: Api, search: string): Promise<Achievements['groups'][number]> {
  const model = await api.get<Achievements>(`/api/achievements?view=all&q=${encodeURIComponent(search)}`)
  return model.groups[0]
}

/** The status the core holds for the first stage that a search of every achievement finds. */
async function statusOf(api: Api, search: string): Promise<string> {
  return (await found(api, search)).stages[0].status
}

/** The count the core holds for the first achievement that a search of every achievement finds. */
async function countOf(api: Api, search: string): Promise<number | undefined> {
  return (await found(api, search)).counter?.value
}

/** The top line's count once `more` stages are ticked, for example "1,220 of 1,854 ticked". */
async function tickedLine(api: Api, more: number): Promise<string> {
  const { totals } = await api.get<Achievements>('/api/achievements')
  return `${(totals.done + more).toLocaleString('en-US')} of ${totals.stages.toLocaleString('en-US')} ticked`
}

/** Where a card is on the page, whatever the scroll, once the fonts are in: a font that lands later moves the cards. */
function placeOf(card: Locator): Promise<{ x: number; y: number }> {
  return card.evaluate(async (element) => {
    await document.fonts.ready
    const box = element.getBoundingClientRect()
    return { x: box.x + window.scrollX, y: box.y + window.scrollY }
  })
}

const searchbox = (page: Page) => page.getByRole('searchbox', { name: 'Search achievements' })
/** What the undo note says (ui/note.tsx), without its button. */
const noteText = (page: Page) => page.getByTestId('note').locator('.note-text')
const categories = (page: Page) => page.getByRole('navigation', { name: 'Categories' })

/** The stage an achievement stands at, as the card shows it: the first not ticked, or the last once all are. */
function standsAt(group: Achievements['groups'][number]): Achievements['groups'][number]['stages'][number] {
  return group.stages.find((stage) => stage.status !== 'done') ?? group.stages[group.stages.length - 1]
}

/** Opens the panel of the card named `name` with its "3 stages" or "Details", and answers the panel. */
async function openPanel(page: Page, name: string): Promise<Locator> {
  const card = page.getByRole('article', { name, exact: true })
  await card.getByRole('button', { name: /^(\d+ stages|Details)$/ }).click()
  const panel = page.getByTestId('ach-panel')
  await expect(panel).toBeVisible()
  return panel
}

test('the page opens on the first category with something left, and a tick can be undone', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Achievements')
  await expect(page.getByTestId('ach-top')).toContainText('of 1,854 ticked')
  const letter = page.getByRole('article', { name: "Winter Night's Letter" })
  await letter.getByRole('checkbox', { name: 'Done: Complete "Secret Tsarist Assignment: Part I."' }).check()
  await expect(noteText(page)).toHaveText("Ticked Winter Night's Letter")
  await page.getByTestId('note').getByRole('button', { name: 'Undo' }).click()
  await expect(noteText(page)).toHaveText("Undone: Ticked Winter Night's Letter")
  await expect(letter.getByRole('checkbox')).not.toBeChecked()
  // The core holds no earlier change from this visit, so the note offers no Undo again; Ctrl+Z says so.
  await expect(page.getByTestId('note').getByRole('button')).toHaveCount(1) // Close alone
  await page.keyboard.press('Control+z')
  await expect(noteText(page)).toHaveText('There is nothing to undo.')
  await expect(page.getByTestId('note').getByRole('button', { name: 'Undo' })).toHaveCount(0)
})

test('no note shows when the page opens, even when the core holds an earlier change', async ({ page, api }) => {
  await api.post('/api/achievements/stage/81000', { status: 'done' }) // a change made before this page was opened
  await page.reload()
  await expect(page.getByRole('article', { name: "Winter Night's Letter" })).toBeVisible()
  await expect(page.getByTestId('note')).toHaveCount(0)
})

test('a done stage is unticked, the stages before it stay ticked, and Undo ticks it again', async ({ page, api }) => {
  await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'All' }).click()
  await searchbox(page).fill('zoo tycoon') // the demo has its three stages done
  const zoo = page.getByRole('article', { name: 'Zoo Tycoon' })
  await expect(zoo.getByRole('checkbox')).toHaveCount(1) // the card's box ticks the stage it stands at: the last
  const last = zoo.getByRole('checkbox', { name: 'Done: III, Use the Omni-Ubiquity Net item to capture 100 wild animals.' })
  await expect(last).toBeChecked()
  const statuses = async () => (await found(api, 'zoo tycoon')).stages.map((stage) => stage.status)
  await last.uncheck()
  await expect(noteText(page)).toHaveText('Unticked Zoo Tycoon')
  await expect.poll(statuses).toEqual(['done', 'done', 'not_started']) // spec 7.2: the others stay as they are
  await expect(last).not.toBeChecked()
  await page.getByTestId('note').getByRole('button', { name: 'Undo' }).click()
  await expect(noteText(page)).toHaveText('Undone: Unticked Zoo Tycoon')
  await expect.poll(statuses).toEqual(['done', 'done', 'done'])
  await expect(last).toBeChecked()
})

test('the note goes after eight seconds and stays while the pointer is on it', async ({ page }) => {
  const letter = page.getByRole('article', { name: "Winter Night's Letter" })
  const note = page.getByTestId('note')
  await letter.getByRole('checkbox').check()
  await expect(note).toBeVisible()
  await note.hover()
  await page.waitForTimeout(9_000) // longer than its eight seconds
  await expect(note).toBeVisible()
  await expect(note.locator('.note-life')).toHaveCSS('animation-play-state', 'paused')
  await page.mouse.move(5, 5) // away from the note
  await expect(note).toHaveCount(0, { timeout: 9_000 })
})

test('Ctrl+Z undoes, but not in the search box', async ({ page }) => {
  const letter = page.getByRole('article', { name: "Winter Night's Letter" })
  await letter.getByRole('checkbox').check()
  await expect(noteText(page)).toHaveText("Ticked Winter Night's Letter")
  await searchbox(page).fill('zoo')
  await page.keyboard.press('Control+z') // the box's own undo takes the typing back, and the page's change stays
  await expect(searchbox(page)).toHaveValue('')
  await expect(noteText(page)).toHaveText("Ticked Winter Night's Letter")
  await searchbox(page).blur()
  await page.keyboard.press('Control+z')
  await expect(noteText(page)).toHaveText("Undone: Ticked Winter Night's Letter")
  await expect(letter.getByRole('checkbox')).not.toBeChecked()
})

test('a page change closes the note, and Ctrl+Z on coming back still undoes the change', async ({ page, api }) => {
  const letter = page.getByRole('article', { name: "Winter Night's Letter" })
  await letter.getByRole('checkbox').check()
  await expect(noteText(page)).toHaveText("Ticked Winter Night's Letter")
  const rail = page.getByRole('navigation', { name: 'Pages' })
  await rail.getByRole('link', { name: 'Backlog' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Backlog')
  await expect(page.getByTestId('note')).toHaveCount(0) // the note does not follow the player to another page
  await rail.getByRole('link', { name: 'Achievements' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Achievements')
  await expect(page.getByTestId('note')).toHaveCount(0) // nor does one wait for the page to open again
  await page.keyboard.press('Control+z')
  await expect(noteText(page)).toHaveText("Undone: Ticked Winter Night's Letter")
  await expect.poll(() => statusOf(api, "Winter Night's Letter")).toBe('not_started')
  await expect(letter.getByRole('checkbox')).not.toBeChecked() // back in Left, unticked
})

test('Esc closes the note, and the note stands at the middle of the page area, also at 2,560 pixels', async ({ page }) => {
  const note = page.getByTestId('note')
  await page.getByRole('article', { name: "Winter Night's Letter" }).getByRole('checkbox').check()
  await expect(note).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(note).toHaveCount(0)
  await page.setViewportSize({ width: 2560, height: 1400 })
  await page.getByRole('article', { name: 'Juggernaut', exact: true }).getByRole('checkbox').check()
  await expect(note).toBeVisible()
  await page.waitForTimeout(400) // its entrance has settled
  const [box, main] = await Promise.all([note.boundingBox(), page.locator('.gb-main').boundingBox()])
  expect(Math.abs(box!.x + box!.width / 2 - (main!.x + main!.width / 2))).toBeLessThanOrEqual(2)
})

test('in Left, a ticked card stays where it is, ticked, until the player moves on', async ({ page, api }) => {
  const letter = page.getByRole('article', { name: "Winter Night's Letter" })
  const juggernaut = page.getByRole('article', { name: 'Juggernaut', exact: true }) // the card after it
  await expect(juggernaut).toBeVisible()
  const ticked = await tickedLine(api, 1)
  const before = await placeOf(juggernaut)
  await letter.getByRole('checkbox').check()
  await expect(noteText(page)).toHaveText("Ticked Winter Night's Letter")
  await expect(page.getByTestId('ach-top')).toContainText(ticked) // the page has read the model since the tick
  await expect(letter.getByRole('checkbox')).toBeChecked()
  expect(await placeOf(juggernaut)).toEqual(before)
  await categories(page).getByRole('button', { name: 'Memories of the Heart' }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Memories of the Heart')
  await categories(page).getByRole('button', { name: 'Wonders of the World' }).click()
  await expect(juggernaut).toBeVisible()
  await expect(letter).toHaveCount(0)
})

test('a click on the view already chosen is not moving on, but a click on the category shown is', async ({ page, api }) => {
  const letter = page.getByRole('article', { name: "Winter Night's Letter" })
  await letter.getByRole('checkbox').check()
  await expect(noteText(page)).toHaveText("Ticked Winter Night's Letter")
  await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'Left' }).click()
  // A read that comes later: Overlooking View is ticked elsewhere, here through the API, and the top line counts it.
  const later = await tickedLine(api, 1)
  await api.post('/api/achievements/stage/81000', { status: 'done' })
  await expect(page.getByTestId('ach-top')).toContainText(later)
  await expect(letter.getByRole('checkbox')).toBeChecked()
  // Picking the category already shown tidies the list without leaving it.
  await categories(page).getByRole('button', { name: 'Wonders of the World' }).click()
  await expect(letter).toHaveCount(0)
})

test('a space after the search is not another search, so a ticked card stays', async ({ page, api }) => {
  await searchbox(page).fill('pirates')
  // Pirates! Argh! is on the opening list too, so the tick waits for the search's results: a search that arrives after
  // a tick is moving on.
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Search results')
  const pirates = page.getByRole('article', { name: 'Pirates! Argh!' })
  const done = pirates.getByRole('checkbox', { name: /^Done: / })
  const ticked = await tickedLine(api, 1)
  await done.check()
  await expect(noteText(page)).toHaveText('Ticked Pirates! Argh!')
  await expect(page.getByTestId('ach-top')).toContainText(ticked) // the page has read the model since the tick
  await expect(done).toBeChecked()
  await searchbox(page).press('End')
  await searchbox(page).press('Space')
  await expect(searchbox(page)).toHaveValue('pirates ')
  // The page would ask again 250 ms after the last key. Past that, a read that comes later: Overlooking View is ticked
  // elsewhere, here through the API, and the top line counts it.
  await page.waitForTimeout(500)
  const later = await tickedLine(api, 1)
  await api.post('/api/achievements/stage/81000', { status: 'done' })
  await expect(page.getByTestId('ach-top')).toContainText(later)
  await expect(done).toBeChecked()
})

test('after its first read, the page asks for the category the core opened on', async ({ page, api }) => {
  await expect(page.getByTestId('ach-group').first()).toBeVisible()
  const asked: (string | null)[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/achievements') asked.push(url.searchParams.get('category'))
  })
  const ticked = await tickedLine(api, 1)
  await page.getByRole('article', { name: "Winter Night's Letter" }).getByRole('checkbox').check()
  await expect(page.getByTestId('ach-top')).toContainText(ticked)
  // Wonders of the World ("0"), even when a tick leaves nothing there: the core would open on another category.
  expect(asked.length).toBeGreaterThan(0)
  expect(new Set(asked)).toEqual(new Set(['0']))
})

test('search and pinned', async ({ page }) => {
  await searchbox(page).fill('unusual hilichurl')
  await expect(page.getByTestId('ach-group')).toHaveCount(1)
  await searchbox(page).fill('')
  await categories(page).getByRole('button', { name: 'Pinned' }).click()
  await expect(page.getByTestId('ach-group')).toHaveCount(3)
})

test('a search that finds nothing in the view says where it looked', async ({ page }) => {
  // The demo has Zoo Tycoon done, so Left, the view the page opens on, does not hold it.
  await searchbox(page).fill('zoo tycoon')
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Search results')
  await expect(page.getByText('Nothing left matches zoo tycoon. All shows every achievement.')).toBeVisible()
  await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'All' }).click()
  await expect(page.getByRole('article', { name: 'Zoo Tycoon' })).toBeVisible()
})

test('every card in a list has one height', async ({ page }) => {
  for (const [width, columns] of [[1440, 2], [2560, 3]] as const) {
    await page.setViewportSize({ width, height: 1000 })
    const cards = page.getByTestId('ach-group')
    await expect(cards.nth(5)).toBeVisible() // Wonders of the World, which the page opens on
    const boxes = await cards.evaluateAll((all) =>
      all.map((card) => {
        const box = card.getBoundingClientRect()
        return { left: Math.round(box.left), height: box.height }
      }),
    )
    expect(boxes.length).toBeGreaterThan(columns * 2)
    expect(new Set(boxes.map((box) => box.height))).toEqual(new Set([154]))
    expect(new Set(boxes.map((box) => box.left)).size).toBe(columns)
  }
})

test('a tiered card shows its stages as pips and ticks its current stage', async ({ page, api }) => {
  // The demo has its first two stages ticked.
  const card = page.getByRole('article', { name: "It's Yesterday Once More" })
  await expect(card.getByRole('img', { name: '2 of 3 stages done' })).toBeVisible()
  await expect(card.locator('.ach-numeral')).toHaveText('III')
  await expect(card.locator('.ach-text')).toContainText('Activate 60 tunes in the Serenitea Pot')
  await expect(card.locator('.seal')).toHaveCount(0)
  const box = card.getByRole('checkbox', { name: /^Done: III, Activate 60 tunes/ })
  await box.check()
  await expect(card).toHaveClass(/\bglint\b/) // the card glints once
  await expect(card.locator('.ach-box')).toHaveClass(/\bstamp\b/) // and the box stamps
  await expect(noteText(page)).toHaveText("Ticked It's Yesterday Once More")
  await expect(card.getByRole('img', { name: '3 of 3 stages done' })).toBeVisible()
  const { stages } = await found(api, "It's Yesterday Once More")
  const day = await page.evaluate((at) => {
    const then = new Date(at) // in the PC's own time, as the page shows it
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${then.getDate()} ${months[then.getMonth()]}`
  }, stages[2].done_at ?? '')
  await expect(card.locator('.seal')).toHaveText(`Done ${day}`) // the day the last stage was ticked
  await expect(box).toBeChecked()
  await expect(card.locator('.ach-numeral')).toHaveText('III')
  await expect(card).not.toHaveClass(/\bglint\b/) // once, and then the card holds still
})

test('Pin pins the whole achievement, and pressing it again unpins every stage in one Undo', async ({ page, api }) => {
  await searchbox(page).fill('unusual hilichurl')
  const card = page.getByRole('article', { name: '...Well, That Was Strange' })
  const pin = card.getByRole('button', { name: 'Pin', exact: true })
  const pins = async () => (await found(api, 'unusual hilichurl')).stages.map((stage) => stage.pinned)
  // The demo pins its third stage. Its first is pinned too, as an import can leave it: Pin is on while any stage is.
  await api.post('/api/achievements/stage/82055', { pinned: true })
  await expect.poll(pins).toEqual([true, false, true])
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await pin.click()
  await expect(noteText(page)).toHaveText('Unpinned ...Well, That Was Strange')
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(pins).toEqual([false, false, false])
  await page.getByTestId('note').getByRole('button', { name: 'Undo' }).click()
  await expect(noteText(page)).toHaveText('Undone: Unpinned ...Well, That Was Strange')
  await expect.poll(pins).toEqual([true, false, true]) // one Undo puts back every pin
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await expect(noteText(page)).toHaveText('Unpinned ...Well, That Was Strange')
  // Not pinned, Pin pins the stage the achievement stands at: its third, the first two being ticked.
  await pin.click()
  await expect(noteText(page)).toHaveText('Pinned ...Well, That Was Strange')
  await expect.poll(pins).toEqual([false, false, true])
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
})

test('− and + on the card change the count beside them', async ({ page, api }) => {
  await searchbox(page).fill('unusual hilichurl')
  const card = page.getByRole('article', { name: '...Well, That Was Strange' })
  const down = card.getByRole('button', { name: 'Count down' })
  const up = card.getByRole('button', { name: 'Count up' })
  await expect(card.getByText('37 of 50 kills', { exact: true })).toBeVisible()
  await expect(card.locator('.bar-fill')).toHaveAttribute('style', 'width: 74%;') // the bar of the count
  // The count stands between the buttons that change it.
  const left = async (locator: Locator) => (await locator.boundingBox())?.x ?? Number.NaN
  const count = card.getByText('37 of 50 kills', { exact: true })
  expect(await left(down)).toBeLessThan(await left(count))
  expect(await left(count)).toBeLessThan(await left(up))
  await up.click()
  await expect(card.getByText('38 of 50 kills', { exact: true })).toBeVisible()
  await expect.poll(() => countOf(api, 'unusual hilichurl')).toBe(38)
  await expect(noteText(page)).toHaveText('Set the count of ...Well, That Was Strange to 38')
  await down.click()
  await down.click()
  await expect.poll(() => countOf(api, 'unusual hilichurl')).toBe(36)
  await expect(card.getByText('36 of 50 kills', { exact: true })).toBeVisible()
  await expect(card.locator('.bar-fill')).toHaveAttribute('style', 'width: 72%;')
})

test("a checklist's parts tick on the card", async ({ page, api }) => {
  await searchbox(page).fill('pirates')
  const card = page.getByRole('article', { name: 'Pirates! Argh!' })
  // In progress in the demo, with Little Meng and Little Lulu done, and a note.
  await expect(card.getByRole('checkbox', { name: 'Little Meng', exact: true })).toBeChecked()
  await expect(card.getByRole('checkbox', { name: 'Little Lulu', exact: true })).toBeChecked()
  const fei = card.getByRole('checkbox', { name: 'Little Fei', exact: true })
  await expect(fei).not.toBeChecked()
  await expect(card.locator('.ach-prog')).toContainText('2 of 3')
  await expect(card.locator('.ach-quill')).toBeVisible() // the note itself is in the panel
  await fei.click()
  await expect(noteText(page)).toHaveText('Ticked a part of Pirates! Argh!')
  await expect.poll(async () => (await found(api, 'Pirates! Argh!')).stages[0].parts.map((part) => part.done_at !== null))
    .toEqual([true, true, true])
  // Every part done: the card says so, and offers the tick that Guild Board never makes.
  await expect(card.locator('.ach-prog')).toContainText('All parts are done. Tick it once the game shows it.')
  await expect(card.getByRole('checkbox', { name: /^Done: / })).not.toBeChecked()
})

test("a count that reached its stage's target says so and offers the tick", async ({ page, api }) => {
  await api.post('/api/achievements/counter/82055', { value: 49 })
  await searchbox(page).fill('unusual hilichurl')
  const card = page.getByRole('article', { name: '...Well, That Was Strange' })
  const box = card.getByRole('checkbox', { name: 'Done: III, Defeat the Unusual Hilichurl 50 times.' })
  await expect(card.getByText('49 of 50 kills', { exact: true })).toBeVisible()
  await expect(card.locator('.ach-box')).not.toHaveClass(/\breached\b/)
  await card.getByRole('button', { name: 'Count up' }).click()
  await expect(card.locator('.ach-prog')).toContainText('The count reached 50. Tick it once the game shows it.')
  // The box gets a gold outline, and stays empty until the player ticks it.
  await expect(card.locator('.ach-box')).toHaveClass(/\breached\b/)
  await expect(box).toHaveCSS('border-top-color', 'rgb(166, 117, 31)')
  await expect(box).not.toBeChecked()
  await expect(card.getByText('50 of 50 kills', { exact: true })).toBeVisible() // − and + stay beside the count
  await box.check()
  await expect(noteText(page)).toHaveText('Ticked ...Well, That Was Strange')
  await expect(card.locator('.ach-prog')).not.toContainText('The count reached')
  await expect(card.locator('.seal')).toContainText('Done')
})

test("the panel opens under the card's row with every stage, and Escape closes it and gives the focus back", async ({ page }) => {
  const card = page.getByRole('article', { name: "It's Yesterday Once More" })
  const button = card.getByRole('button', { name: '3 stages' })
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await button.click()
  const panel = page.getByRole('region', { name: "It's Yesterday Once More" })
  await expect(panel).toBeVisible()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await expect(button).toHaveAttribute('aria-controls', (await panel.getAttribute('id')) ?? 'no id')
  await expect(panel.getByRole('checkbox', { name: /^Done: / })).toHaveCount(3) // every stage, with its box
  await expect(panel.locator('.ach-numeral')).toHaveText(['I', 'II', 'III'])
  // The card and the panel have gold borders.
  await expect(card).toHaveCSS('border-top-color', 'rgb(142, 102, 27)')
  await expect(panel).toHaveCSS('border-top-color', 'rgb(142, 102, 27)')
  // Right under the card's row, across it: the cards after it fill the row's other places.
  await expect.poll(async () => (await panel.boundingBox())?.height ?? 0).toBeGreaterThan(150) // grown to its height
  const boxes = await page.getByTestId('ach-group').evaluateAll((cards) =>
    cards.map((each) => each.getBoundingClientRect().toJSON() as DOMRect),
  )
  const [own] = await card.evaluateAll((cards) => cards.map((each) => each.getBoundingClientRect().toJSON() as DOMRect))
  const row = boxes.filter((box) => Math.abs(box.top - own.top) < 1)
  expect(row.length).toBe(2) // the row is full
  const top = (await panel.boundingBox())?.y ?? 0
  expect(top).toBeGreaterThan(Math.max(...row.map((box) => box.bottom)))
  const main = page.locator('.ach-cards')
  const across = await main.evaluate((cards) => cards.getBoundingClientRect().width)
  expect(Math.abs(((await panel.boundingBox())?.width ?? 0) - across)).toBeLessThan(2)
  // Escape from a control inside it closes it and hands the focus back to the button.
  await panel.getByRole('button', { name: 'Note', exact: true }).first().focus()
  await page.keyboard.press('Escape')
  await expect(button).toBeFocused()
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('ach-panel')).toHaveCount(0)
  await expect(card).not.toHaveCSS('border-top-color', 'rgb(142, 102, 27)')
  // Enter on the button opens it again, and Escape in the note's editor closes the editor alone.
  await page.keyboard.press('Enter')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Note', exact: true }).first().click()
  await expect(panel.getByRole('textbox')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel.getByRole('textbox')).toHaveCount(0)
  await expect(panel).toBeVisible()
})

test("opening another card's panel closes the first, and its button closes it again", async ({ page }) => {
  const tunes = page.getByRole('article', { name: "It's Yesterday Once More" })
  await tunes.getByRole('button', { name: '3 stages' }).click()
  await expect(page.getByRole('region', { name: "It's Yesterday Once More" })).toBeVisible()
  const view = page.getByRole('article', { name: 'Overlooking View', exact: true })
  await view.getByRole('button', { name: 'Details' }).click()
  await expect(page.getByRole('region', { name: 'Overlooking View' })).toBeVisible()
  await expect(tunes.getByRole('button', { name: '3 stages' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('ach-panel')).toHaveCount(1) // one at a time
  await view.getByRole('button', { name: 'Details' }).click()
  await expect(view.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('ach-panel')).toHaveCount(0)
})

test("the panel's notch follows its card to another column, as a card before it leaves", async ({ page, api }) => {
  const view = page.getByRole('article', { name: 'Overlooking View', exact: true })
  await view.getByRole('button', { name: 'Details' }).click()
  const panel = page.getByRole('region', { name: 'Overlooking View' })
  await expect(panel).toBeVisible()
  // How far the notch is from the middle of its card.
  const off = async () => {
    const [card, box, notch] = await Promise.all([
      view.boundingBox(),
      panel.boundingBox(),
      panel.evaluate((element) => parseFloat(getComputedStyle(element).getPropertyValue('--notch'))),
    ])
    return Math.abs(card!.x + card!.width / 2 - box!.x - notch)
  }
  await expect.poll(off).toBeLessThanOrEqual(1) // under its card, in the second column
  const column = (await view.boundingBox())!.x
  // It's Yesterday Once More, before it in the list, has its last stage ticked elsewhere, and leaves Left.
  const tunes = await found(api, "It's Yesterday Once More")
  await api.post(`/api/achievements/stage/${tunes.stages[2].id}`, { status: 'done' })
  await expect(page.getByRole('article', { name: "It's Yesterday Once More" })).toHaveCount(0)
  await expect.poll(async () => (await view.boundingBox())!.x).toBeLessThan(column) // in the first column now
  await expect(panel).toBeVisible()
  await expect.poll(off).toBeLessThanOrEqual(1)
})

test('a panel opened near the bottom of the window is brought into view', async ({ page }) => {
  const card = page.getByRole('article', { name: 'Hero-in-Training', exact: true })
  // The card's foot just above the window's bottom edge: its panel opens below it, out of sight.
  await card.evaluate((element) => window.scrollBy(0, element.getBoundingClientRect().bottom - window.innerHeight + 8))
  await card.getByRole('button', { name: /^(\d+ stages|Details)$/ }).click()
  const panel = page.getByRole('region', { name: 'Hero-in-Training' })
  await expect(panel).toBeInViewport({ ratio: 1 })
  await expect(card).toBeInViewport() // and its card stays in sight above it
})

test('the panel closes when the player moves on to another category, view or search', async ({ page }) => {
  await openPanel(page, "It's Yesterday Once More")
  await categories(page).getByRole('button', { name: /^Memories of the Heart/ }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Memories of the Heart')
  await expect(page.getByTestId('ach-panel')).toHaveCount(0)
  await categories(page).getByRole('button', { name: /^Wonders of the World/ }).click()
  await expect(page.getByRole('article', { name: "It's Yesterday Once More" })).toBeVisible()
  await expect(page.getByTestId('ach-panel')).toHaveCount(0) // back where it was, it stays closed
  await openPanel(page, "It's Yesterday Once More")
  await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'All' }).click()
  await expect(page.getByTestId('ach-panel')).toHaveCount(0)
  await openPanel(page, "It's Yesterday Once More")
  await searchbox(page).fill('yesterday once more')
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Search results')
  await expect(page.getByTestId('ach-panel')).toHaveCount(0)
  // A change on the page is not moving on: the panel stays open.
  const panel = await openPanel(page, "It's Yesterday Once More")
  await panel.getByRole('button', { name: 'Count up' }).click()
  await expect(noteText(page)).toHaveText("Set the count of It's Yesterday Once More to 1")
  await expect(panel).toBeVisible()
})

test('a card that leaves the list takes its panel, and the focus goes to the next card', async ({ page, api }) => {
  const panel = await openPanel(page, "Winter Night's Letter")
  await panel.getByRole('button', { name: 'Note', exact: true }).focus() // in the panel, without Escape
  // Ticked elsewhere, here through the API as from another window, it leaves Left.
  await api.post('/api/achievements/stage/81732', { status: 'done' })
  await expect(page.getByRole('article', { name: "Winter Night's Letter" })).toHaveCount(0)
  await expect(page.getByTestId('ach-panel')).toHaveCount(0)
  // Juggernaut came next in Wonders of the World. Its card has no Note, so its box takes the focus.
  await expect(page.getByRole('article', { name: 'Juggernaut', exact: true }).getByRole('checkbox')).toBeFocused()
})

test('a counter and a part', async ({ page, api }) => {
  await searchbox(page).fill('unusual hilichurl')
  const hilichurl = page.getByRole('article', { name: '...Well, That Was Strange' })
  await expect(hilichurl).toContainText('37 of 50 kills')
  await hilichurl.getByRole('button', { name: 'Count up' }).click()
  await expect(hilichurl).toContainText('38 of 50 kills')
  await expect.poll(() => countOf(api, 'unusual hilichurl')).toBe(38)
  await searchbox(page).fill('pirates')
  const pirates = await openPanel(page, 'Pirates! Argh!')
  await expect(pirates).toContainText('Little Fei is the last one.') // the note, in the panel
  await pirates.getByRole('checkbox', { name: 'Little Fei', exact: true }).check()
  await expect(noteText(page)).toHaveText('Ticked a part of Pirates! Argh!')
  await expect(pirates).toContainText('All parts are done. Tick it once the game shows it.')
})

test('a count heads for the first stage not ticked, or the last target once every stage is', async ({ page, api }) => {
  await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'All' }).click()
  await searchbox(page).fill('zoo tycoon')
  // Its stages of 1, 30 and 100 are all ticked, and its count was never set.
  await expect(page.getByRole('article', { name: 'Zoo Tycoon' }).getByText('0 of 100', { exact: true })).toBeVisible()
  // The hilichurl's stages of 1 and 20 kills are ticked. With neither ticked and no kill counted, it heads for 1 kill.
  await api.post('/api/achievements/stage/82055', { status: 'not_started' })
  await api.post('/api/achievements/stage/82056', { status: 'not_started' })
  await api.post('/api/achievements/counter/82055', { value: 0 })
  await searchbox(page).fill('unusual hilichurl')
  const hilichurl = page.getByRole('article', { name: '...Well, That Was Strange' })
  await expect(hilichurl.getByText('0 of 1 kill', { exact: true })).toBeVisible()
})

test('the count is typed: Enter or leaving the field sets it, and an emptied field goes back', async ({ page, api }) => {
  await searchbox(page).fill('unusual hilichurl')
  const hilichurl = page.getByRole('article', { name: '...Well, That Was Strange' })
  await expect(hilichurl.getByRole('spinbutton')).toHaveCount(0) // the typed number is in the panel
  const panel = await openPanel(page, '...Well, That Was Strange')
  const count = panel.getByRole('spinbutton', { name: 'Count' })
  await count.fill('40')
  await count.press('Enter')
  await expect(hilichurl).toContainText('40 of 50 kills')
  await expect.poll(() => countOf(api, 'unusual hilichurl')).toBe(40)
  await count.fill('41')
  await count.press('Tab')
  await expect.poll(() => countOf(api, 'unusual hilichurl')).toBe(41)
  await expect(hilichurl).toContainText('41 of 50 kills')
  const sent: unknown[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/achievements/counter/')) sent.push(request.postDataJSON())
  })
  await count.fill('')
  await count.press('Tab')
  await expect(count).toHaveValue('41')
  // The changes go out in order, so a count sent for the emptied field would come before this one.
  await hilichurl.getByRole('button', { name: 'Count up' }).click()
  await expect.poll(() => countOf(api, 'unusual hilichurl')).toBe(42)
  await expect.poll(() => sent).toEqual([{ value: 42 }])
})

test('the wheel over the count never changes it, also when the field has the focus', async ({ page, api }) => {
  await searchbox(page).fill('unusual hilichurl')
  const hilichurl = page.getByRole('article', { name: '...Well, That Was Strange' })
  const panel = await openPanel(page, '...Well, That Was Strange')
  const count = panel.getByRole('spinbutton', { name: 'Count' })
  await expect(count).toHaveValue('37')
  await count.click() // the field has the focus, with the pointer over it, as when the player clicks it to type
  await expect(count).toBeFocused()
  const sent: unknown[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/achievements/counter/')) sent.push(request.postDataJSON())
  })
  await page.mouse.wheel(0, 100) // one notch down
  await page.waitForTimeout(300)
  await expect(count).toHaveValue('37')
  await page.keyboard.press('Tab') // leaving the field sets what it holds
  await page.waitForTimeout(500)
  expect(sent).toEqual([])
  expect(await countOf(api, 'unusual hilichurl')).toBe(37)
  await expect(hilichurl.getByText('37 of 50 kills', { exact: true })).toBeVisible()
})

test('the wiki link searches the wiki in a new tab, once for stages that share it', async ({ page }) => {
  await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'All' }).click() // the demo has Zoo Tycoon done
  await searchbox(page).fill('zoo tycoon')
  const links = page.getByRole('article', { name: 'Zoo Tycoon' }).getByRole('link', { name: 'Look it up' })
  await expect(links).toHaveCount(1) // its three stages share the address
  const link = links.first()
  await expect(link).toHaveAttribute('href', 'https://genshin-impact.fandom.com/wiki/Special:Search?query=Zoo%20Tycoon')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})

test("Tundra Gunsmith's stages show their own names and their own links", async ({ page, api }) => {
  await searchbox(page).fill('tundra gunsmith')
  const gunsmith = page.getByRole('article', { name: 'Tundra Gunsmith (I)' }) // the group is named by its first stage
  // The card's Look it up is the stage it stands at; the panel has each stage's own.
  const at = standsAt(await found(api, 'tundra gunsmith'))
  await expect(gunsmith.getByRole('link', { name: 'Look it up' })).toHaveAttribute('href', at.wiki)
  const panel = await openPanel(page, 'Tundra Gunsmith (I)')
  await expect(panel.getByRole('heading', { level: 4 })).toHaveText(['Tundra Gunsmith (II)', 'Tundra Gunsmith (III)'])
  const links = panel.getByRole('link', { name: 'Look it up' })
  await expect(links).toHaveCount(3)
  await expect(links.nth(2)).toHaveAttribute(
    'href',
    'https://genshin-impact.fandom.com/wiki/Special:Search?query=Tundra%20Gunsmith%20%28III%29',
  )
})

test('the demo has no primogem icon, so every reward reads as its text beside the drawn gem', async ({ page, api }) => {
  const model = await api.get<Achievements>('/api/achievements')
  const images = page.getByTestId('ach-group').locator('img[src="/api/icon/static.primogem"]')
  await expect(images).toHaveCount(model.groups.length) // one on each card: its current stage's reward
  await expect.poll(() => images.evaluateAll((all) => all.filter((image) => !(image as HTMLElement).hidden).length)).toBe(0)
  // The picture's box sits inside the reward, so the reward's text is the number of primogems alone: the sign has no
  // words.
  const rewards = await images.evaluateAll((all) => all.map((image) => image.parentElement?.parentElement?.textContent ?? ''))
  expect(rewards).toEqual(model.groups.map((group) => `${standsAt(group).reward} primogems`))
  const letter = page.getByRole('article', { name: "Winter Night's Letter" })
  await expect(letter.getByText('5 primogems')).toBeVisible()
  const version = model.groups.find((group) => group.name === "Winter Night's Letter")?.stages[0].version
  await expect(letter).toContainText(`Added in ${version}`)
  // In the panel, each stage's reward has the picture too.
  const tunes = await found(api, "It's Yesterday Once More")
  const panel = await openPanel(page, "It's Yesterday Once More")
  const inPanel = panel.locator('img[src="/api/icon/static.primogem"]')
  await expect(inPanel).toHaveCount(3)
  expect(await inPanel.evaluateAll((all) => all.map((image) => image.parentElement?.parentElement?.textContent ?? '')))
    .toEqual(tunes.stages.map((stage) => `${stage.reward} primogems`))
})

test('a reward whose picture cannot load shows the gem sign, never a broken image', async ({ page, api }) => {
  const model = await api.get<Achievements>('/api/achievements')
  const gems = page.locator('.ach-gem')
  await expect(gems).toHaveCount(model.groups.length)
  // The demo downloads no picture, so the core answers each request with a 404 and every image hides.
  await expect
    .poll(() => gems.evaluateAll((all) => all.filter((gem) => gem.querySelector('img')?.hidden === false).length))
    .toBe(0)
  // What each reward's picture box shows, with the states that differ listed once each: there should be only one.
  const states = await gems.evaluateAll((all) => {
    const sizeOf = (element: Element | null) => {
      const box = element?.getBoundingClientRect()
      return [box?.width ?? 0, box?.height ?? 0]
    }
    const distinct = new Map<string, object>()
    for (const gem of all) {
      const image = gem.querySelector('img')
      const sign = gem.querySelector('svg')
      const state = {
        imageDrawn: image !== null && image.getClientRects().length > 0, // false for display: none: nothing is drawn
        signShown: sign !== null && getComputedStyle(sign).visibility === 'visible',
        // The box keeps the 16 px of the picture it replaces, and the sign fills it.
        box: sizeOf(gem),
        signBox: sizeOf(sign),
      }
      distinct.set(JSON.stringify(state), state)
    }
    return [...distinct.values()]
  })
  expect(states).toEqual([{ imageDrawn: false, signShown: true, box: [16, 16], signBox: [16, 16] }])
  // One card, as the player sees it: the sign is there, and a sign is hidden from screen readers.
  const sign = page.getByRole('article', { name: "Winter Night's Letter" }).locator('.ach-gem svg')
  await expect(sign).toBeVisible()
  await expect(sign).toHaveAttribute('aria-hidden', 'true')
})

test("the Show filter's focus ring is drawn inside the option, where the pill around it does not clip it", async ({ page }) => {
  const left = page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'Left' })
  await left.focus()
  const ring = await left.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      shown: element.matches(':focus-visible'),
      width: parseFloat(style.outlineWidth),
      offset: parseFloat(style.outlineOffset),
    }
  })
  expect(ring.shown).toBe(true)
  expect(ring.width).toBeGreaterThan(0)
  expect(ring.offset + ring.width).toBeLessThanOrEqual(0) // within the option's own box
})

test('the top line shows the ticks, what is left and the primogems to earn, and no HoYoLAB count', async ({ page }) => {
  const top = page.getByTestId('ach-top')
  // The ticks count up once. The counting digits are hidden from screen readers, which are given the final number.
  await expect(top.locator('.ach-fig > [aria-hidden="true"]')).toHaveText('1,219')
  await expect(top).toContainText('1,219 of 1,854 ticked')
  await expect(top).toContainText('635 left')
  await expect(top.locator('.ach-percent')).toHaveText('66%') // beside the bar of the ticks against all
  await expect(top.locator('.ach-meter .bar-fill')).toHaveAttribute('style', 'width: 65.75%;')
  await expect(top.locator('.ach-earn-n > [aria-hidden="true"]')).toHaveText('5,815')
  await expect(top).toContainText('5,815 primogems to earn')
  // The primogem's picture, or in the demo, which downloads none, its sign.
  await expect(top.locator('.ach-earn img')).toHaveAttribute('src', '/api/icon/static.primogem')
  await expect(top.locator('.ach-earn svg')).toBeVisible()
  await expect(top.getByRole('button', { name: 'Check for new achievements' })).toBeVisible()
  // HoYoLAB's count, its read time and the line on how it differs from the ticks are not shown (look pass spec 11.1).
  await expect(top).not.toContainText('HoYoLAB')
  await expect(page.getByRole('main')).not.toContainText('HoYoLAB counts')
})

test('each game category shows a bar of its ticked stages, the special ones none', async ({ page, api }) => {
  const model = await api.get<Achievements>('/api/achievements')
  const open = model.categories.filter((category) => category.left > 0)
  // The game's categories, in the model's order, after the special ones.
  const withBars = categories(page).locator('.ach-cat:has(.bar)')
  await expect(withBars).toHaveCount(open.length)
  for (const [index, category] of open.entries()) {
    const ticked = category.stages - category.left
    const share = Number(((ticked / category.stages) * 100).toFixed(3)) // as the bar draws it: three decimals at most
    const said = `${ticked.toLocaleString('en-US')} of ${category.stages.toLocaleString('en-US')} ticked`
    const button = withBars.nth(index)
    // The number shown stays what is left; the share ticked is in the name, and in the tip on hover and focus.
    await expect(button).toHaveAccessibleName(`${category.name}, ${category.left.toLocaleString('en-US')} left, ${said}`)
    await expect(button).toHaveAttribute('data-tip', said)
    await expect(button.locator('.n')).toHaveText(category.left.toLocaleString('en-US'))
    await expect(button.locator('.bar-fill')).toHaveAttribute('style', `width: ${share}%;`)
  }
  for (const name of ['Timers', 'Daily commissions', 'Pinned']) {
    const special = categories(page).getByRole('button', { name: new RegExp(`^${name}`) })
    await expect(special).toHaveCount(1)
    await expect(special.locator('.bar')).toHaveCount(0) // they keep their counts, and have no bar
  }
  // A complete category, once shown, has its full bar too.
  await categories(page).getByRole('button', { name: 'Show 3 complete categories' }).click()
  const marksmanship = categories(page).getByRole('button', { name: /^Marksmanship/ })
  await expect(marksmanship.locator('.bar-fill')).toHaveAttribute('style', 'width: 100%;')
  await expect(marksmanship).toHaveAccessibleName(/^Marksmanship, [\d,]+ of [\d,]+ ticked$/)
})

test('at 2,560 pixels the cards stay in columns and none is stretched', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await expect(page.getByTestId('ach-group').nth(1)).toBeVisible()
  const boxes = await page.getByTestId('ach-group').evaluateAll((cards) =>
    cards.map((card) => {
      const { top, width } = card.getBoundingClientRect()
      return { top, width }
    }),
  )
  expect(boxes.length).toBeGreaterThan(1)
  expect(Math.max(...boxes.map((box) => box.width))).toBeLessThanOrEqual(640)
  const firstRow = new Set(boxes.slice(0, 3).map((box) => box.top))
  expect(firstRow.size).toBeLessThan(3) // at least two of the first three cards share a row
})

test("at 2,560 pixels a panel spans its row, and a stage's day, reward and buttons stay near its text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  const panel = await openPanel(page, "It's Yesterday Once More")
  const widths = await panel.evaluate((element) => ({
    panel: element.getBoundingClientRect().width,
    parts: [...element.children].map((child) => child.getBoundingClientRect().width),
  }))
  expect(widths.panel).toBeGreaterThan(1200) // under the whole row of three cards, its notch under any of them
  expect(Math.max(...widths.parts)).toBeLessThanOrEqual(1040)
})

test('a note is saved in the panel and shows a quill on its card, and a pin is set', async ({ page }) => {
  const letter = page.getByRole('article', { name: "Winter Night's Letter" })
  await expect(letter.locator('.ach-quill')).toHaveCount(0)
  const panel = await openPanel(page, "Winter Night's Letter")
  await panel.getByRole('button', { name: 'Note', exact: true }).click()
  await panel.getByRole('textbox', { name: "Note on Winter Night's Letter" }).fill('Ask Mother first.')
  await panel.getByRole('button', { name: 'Save note' }).click()
  await expect(noteText(page)).toHaveText("Changed the note on Winter Night's Letter")
  await expect(panel.getByRole('textbox')).toHaveCount(0) // the editor closes; the note shows as text
  await expect(panel).toContainText('Ask Mother first.')
  await expect(letter).not.toContainText('Ask Mother first.')
  await expect(letter.locator('.ach-quill')).toBeVisible() // beside the reward
  await expect(letter.locator('.ach-quill')).toHaveText('Has a note') // for screen readers
  await letter.getByRole('button', { name: 'Pin', exact: true }).click()
  await expect(noteText(page)).toHaveText("Pinned Winter Night's Letter")
  await expect(letter.getByRole('button', { name: 'Pin', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('a note being typed survives a re-read', async ({ page, api }) => {
  const panel = await openPanel(page, "Winter Night's Letter")
  await panel.getByRole('button', { name: 'Note', exact: true }).click()
  const editor = panel.getByRole('textbox', { name: "Note on Winter Night's Letter" })
  await editor.fill('Ask Mother first.') // not saved
  // A change elsewhere, here through the API, as from another window: Overlooking View, before Winter Night's Letter
  // in the list, is ticked and leaves it, so every card after it moves up a place.
  const overlooking = page.getByRole('article', { name: 'Overlooking View', exact: true })
  await expect(overlooking).toBeVisible()
  await api.post('/api/achievements/stage/81000', { status: 'done' })
  await expect(overlooking).toHaveCount(0) // the page has read the model again
  await expect(editor).toHaveValue('Ask Mother first.')
})

test('in progress is pressed and pressed again, but not on a done stage, and a count stops at 0', async ({ page, api }) => {
  const letter = page.getByRole('article', { name: "Winter Night's Letter" })
  const started = letter.getByRole('button', { name: 'In progress' })
  await started.click()
  await expect(noteText(page)).toHaveText("Marked Winter Night's Letter as in progress")
  await expect(started).toHaveAttribute('aria-pressed', 'true')
  await started.click()
  await expect(noteText(page)).toHaveText("Marked Winter Night's Letter as not started")
  await expect(started).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => statusOf(api, "Winter Night's Letter")).toBe('not_started')
  await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'All' }).click()
  await searchbox(page).fill('zoo tycoon')
  const zoo = page.getByRole('article', { name: 'Zoo Tycoon' })
  const inProgress = zoo.getByRole('button', { name: 'In progress' })
  await expect(inProgress).toHaveCount(1) // the stage the card stands at: the last, done
  // aria-disabled, which keeps the focus where disabled would drop it to the page.
  for (const button of await inProgress.all()) {
    await expect(button).toHaveAttribute('aria-disabled', 'true')
    await expect(button).toHaveAttribute('aria-pressed', 'false')
  }
  const countDown = zoo.getByRole('button', { name: 'Count down' })
  await expect(countDown).toHaveAttribute('aria-disabled', 'true') // its count is 0
  // A press on either sends nothing.
  const sent: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST') sent.push(new URL(request.url()).pathname)
  })
  await inProgress.first().focus()
  await page.keyboard.press('Enter')
  await countDown.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  expect(sent).toEqual([])
  await expect(noteText(page)).toHaveText("Marked Winter Night's Letter as not started")
})

test('a change the core refuses says why in the brown note, the box goes back, and Ctrl+Z still undoes the change before', async ({ page }) => {
  const letter = page.getByRole('article', { name: "Winter Night's Letter" })
  const refusal = page.getByRole('alert').getByTestId('note')
  await letter.getByRole('button', { name: 'Pin', exact: true }).click()
  await expect(noteText(page)).toHaveText("Pinned Winter Night's Letter")
  const before = await placeOf(letter)
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/achievements/stage/*', async (route) => {
    await held
    await route.fulfill({ status: 404, json: { error: 'There is no achievement with this number.' } })
  })
  const box = letter.getByRole('checkbox')
  await box.click()
  await expect(box).toBeChecked() // at once, while the core's answer is held
  release()
  await expect(refusal).toHaveText(/There is no achievement with this number\./)
  await expect(refusal).toHaveAttribute('data-tone', 'refused')
  await expect(refusal.getByRole('button', { name: 'Undo' })).toHaveCount(0) // a refusal offers no Undo
  expect(await placeOf(letter)).toEqual(before) // the note lies over the page: the cards do not move
  await expect(box).not.toBeChecked()
  await page.unroute('**/api/achievements/stage/*')
  await box.focus() // Ctrl+Z works from a checkbox
  await page.keyboard.press('Control+z')
  await expect(noteText(page)).toHaveText("Undone: Pinned Winter Night's Letter")
  await expect(page.getByRole('alert').getByTestId('note')).toHaveCount(0) // the next success replaced the refusal
  expect(await placeOf(letter)).toEqual(before)
})

test('a refused change stays until closed', async ({ page }) => {
  await page.route('**/api/achievements/stage/*', (route) =>
    route.fulfill({ status: 404, json: { error: 'There is no achievement with this number.' } }),
  )
  await page.getByRole('article', { name: "Winter Night's Letter" }).getByRole('checkbox').click()
  const note = page.getByRole('alert').getByTestId('note')
  await expect(note).toContainText('There is no achievement with this number.')
  await page.waitForTimeout(9_000) // a note of a change would have gone
  await expect(note).toBeVisible()
  await note.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByTestId('note')).toHaveCount(0)
})

test('complete categories fold away', async ({ page }) => {
  await expect(categories(page).getByRole('button', { name: 'Wonders of the World' })).toHaveAttribute('aria-current', 'true')
  await expect(categories(page).getByRole('button', { name: 'Marksmanship' })).toHaveCount(0)
  await categories(page).getByRole('button', { name: 'Show 3 complete categories' }).click()
  await categories(page).getByRole('button', { name: 'Marksmanship' }).click()
  await expect(page.getByText('Nothing left here.')).toBeVisible()
  await categories(page).getByRole('button', { name: 'Hide complete categories' }).click()
  await expect(categories(page).getByRole('button', { name: 'Marksmanship' })).toHaveCount(0)
})

test('progress on achievements the list does not hold is shown apart', async ({ page }) => {
  await changeAnswer<Achievements>(page, '/api/achievements', (data) => {
    data.unlisted = 3
    if (!data.query.unlisted) return
    // As the core keeps them: a row, checklist parts alone, or a count alone (spec 6.3).
    data.unlisted_rows = [
      { id: 81219, status: 'done', note: 'From the old list.', pinned: true, parts: 0, count: null },
      { id: 99901, status: 'not_started', note: '', pinned: false, parts: 2, count: 3 },
      { id: 99902, status: 'not_started', note: '', pinned: false, parts: 1, count: null },
    ]
  })
  await page.reload()
  await categories(page).getByRole('button', { name: 'Not in the current list' }).click()
  const rows = page.getByTestId('unlisted').getByRole('listitem')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Achievement 81219')
  await expect(rows.nth(0)).toContainText('Done')
  await expect(rows.nth(0)).toContainText('From the old list.')
  await expect(rows.nth(0).getByText('Pinned', { exact: true })).toBeVisible()
  await expect(rows.nth(1).getByText('2 parts done · Count: 3', { exact: true })).toBeVisible()
  await expect(rows.nth(1)).toContainText('Not started')
  await expect(rows.nth(2).getByText('1 part done', { exact: true })).toBeVisible()
})

test('the focus never lands under the sticky bar, also when its tools wrap', async ({ page }) => {
  // At the frame's least width the heading, the filter and the search take two rows.
  await page.setViewportSize({ width: 1040, height: 800 })
  const bar = page.getByTestId('ach-bar')
  const box = page.getByRole('article', { name: "Winter Night's Letter" }).getByRole('checkbox')
  await expect(box).toBeAttached()
  const title = bar.getByRole('heading', { level: 2 })
  const titleBottom = await title.evaluate((element) => element.getBoundingClientRect().bottom)
  const searchTop = await searchbox(page).evaluate((element) => element.getBoundingClientRect().top)
  expect(searchTop).toBeGreaterThanOrEqual(titleBottom) // the tools wrap: the search box sits below the heading
  // Taller than the padding achievements.css falls back on (56 px and 8 px), so that only the page's measure of the
  // bar can keep the focus out from under it.
  const height = await bar.evaluate((element) => element.getBoundingClientRect().height)
  expect(height).toBeGreaterThan(64)
  await expect
    .poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)))
    .toBeGreaterThanOrEqual(height)
  // Scroll the box under the bar's lower edge, then give it the focus: it is scrolled out from under the bar.
  await box.evaluate((element, under) => window.scrollBy(0, element.getBoundingClientRect().top - under), height - 4)
  await box.focus()
  const top = await box.evaluate((element) => element.getBoundingClientRect().top)
  expect(top).toBeGreaterThanOrEqual(await bar.evaluate((element) => element.getBoundingClientRect().bottom))
})

test.describe('the focus has somewhere to go', () => {
  test('after Save note, it goes back to the Note button', async ({ page }) => {
    const panel = await openPanel(page, "Winter Night's Letter")
    const note = panel.getByRole('button', { name: 'Note', exact: true })
    await note.focus()
    await page.keyboard.press('Enter')
    await panel.getByRole('textbox', { name: "Note on Winter Night's Letter" }).focus()
    await page.keyboard.type('Ask Mother first.')
    await page.keyboard.press('Tab')
    await expect(panel.getByRole('button', { name: 'Save note' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(noteText(page)).toHaveText("Changed the note on Winter Night's Letter")
    await expect(panel.getByRole('textbox')).toHaveCount(0)
    await expect(note).toBeFocused()
  })

  test('Note opens its editor with the focus in it, and Escape closes it unsaved, back on Note', async ({ page, api }) => {
    const panel = await openPanel(page, "Winter Night's Letter")
    const note = panel.getByRole('button', { name: 'Note', exact: true })
    await note.focus()
    await page.keyboard.press('Enter')
    const editor = panel.getByRole('textbox', { name: "Note on Winter Night's Letter" })
    await expect(editor).toBeFocused()
    await page.keyboard.type('Ask Mother first.')
    await page.keyboard.press('Escape')
    await expect(panel.getByRole('textbox')).toHaveCount(0)
    await expect(note).toBeFocused()
    await expect(note).toHaveAttribute('aria-expanded', 'false')
    await expect(panel).not.toContainText('Ask Mother first.')
    expect((await found(api, "Winter Night's Letter")).stages[0].note).toBe('') // nothing was saved
    // Opened again, the editor starts from the note as saved.
    await page.keyboard.press('Enter')
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue('')
  })

  test("after the last undo, the focus goes to the note's sentence", async ({ page }) => {
    await page.getByRole('article', { name: "Winter Night's Letter" }).getByRole('checkbox').focus()
    await page.keyboard.press('Space')
    await expect(noteText(page)).toHaveText("Ticked Winter Night's Letter")
    const undo = page.getByTestId('note').getByRole('button', { name: 'Undo' })
    await undo.focus()
    await page.keyboard.press('Enter')
    await expect(noteText(page)).toHaveText("Undone: Ticked Winter Night's Letter")
    await expect(undo).toHaveCount(0) // the core keeps no earlier change, so there is no Undo again
    await expect(noteText(page)).toBeFocused() // the button had the focus: the sentence takes it
  })
})

test('a change the core announced while the event stream was not listening shows once the stream opens', async ({ page, api }) => {
  // The stream opens late, as after a sleep or a core started again: the core tells no one of a change meanwhile.
  const stream = holding()
  await page.route('**/api/events', async (route) => {
    await stream.held
    await route.continue()
  })
  // The page reads its model twice as it opens: without a category, then with the one the core opened on.
  const read = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/achievements' && url.searchParams.get('category') === '0'
  })
  await page.reload()
  await read
  const letter = page.getByRole('article', { name: "Winter Night's Letter" })
  await expect(letter.getByRole('checkbox')).not.toBeChecked()
  const ticked = await tickedLine(api, 1)
  await api.post('/api/achievements/stage/81732', { status: 'done' })
  await page.waitForTimeout(500)
  await expect(letter.getByRole('checkbox')).not.toBeChecked() // the page has not heard of it
  stream.release()
  await expect(page.getByTestId('ach-top')).toContainText(ticked)
  await expect(letter).toHaveCount(0) // ticked elsewhere, it leaves Left
})

test.describe('the keyboard keeps its place', () => {
  test('a tick from the keyboard keeps its card, and the focus on its box', async ({ page, api }) => {
    const ticked = await tickedLine(api, 1)
    const box = page.getByRole('article', { name: "Winter Night's Letter" }).getByRole('checkbox')
    await box.focus()
    await page.keyboard.press('Space')
    await expect(noteText(page)).toHaveText("Ticked Winter Night's Letter")
    await expect(page.getByTestId('ach-top')).toContainText(ticked) // read again since the tick
    await expect(box).toBeChecked()
    await expect(box).toBeFocused()
  })

  test('Count down from 1 to 0 keeps the focus on Count down', async ({ page, api }) => {
    await api.post('/api/achievements/counter/82055', { value: 1 })
    await searchbox(page).fill('unusual hilichurl')
    const hilichurl = page.getByRole('article', { name: '...Well, That Was Strange' })
    await expect(hilichurl.getByText('1 of 50 kills', { exact: true })).toBeVisible()
    const countDown = hilichurl.getByRole('button', { name: 'Count down' })
    await countDown.focus()
    await page.keyboard.press('Enter')
    await expect(hilichurl.getByText('0 of 50 kills', { exact: true })).toBeVisible()
    await expect(countDown).toBeFocused()
    await expect(countDown).toHaveAttribute('aria-disabled', 'true')
    await expect.poll(() => countOf(api, 'unusual hilichurl')).toBe(0)
  })

  test('unpinning in Pinned keeps its card, and the focus on Pin', async ({ page }) => {
    await categories(page).getByRole('button', { name: 'Pinned' }).click()
    await expect(page.getByTestId('ach-group')).toHaveCount(3)
    const pin = page.getByRole('article', { name: 'For the Love of Godwin' }).getByRole('button', { name: 'Pin', exact: true })
    await pin.focus()
    await page.keyboard.press('Enter')
    await expect(noteText(page)).toHaveText('Unpinned For the Love of Godwin')
    await expect(categories(page).getByRole('button', { name: 'Pinned' })).toHaveText('Pinned 2') // read again since
    await expect(page.getByTestId('ach-group')).toHaveCount(3)
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    await expect(pin).toBeFocused()
  })

  // A card leaves when a change made elsewhere takes it off the list: here, through the API, as from another window.
  test('a card that leaves hands the focus to the card that took its place', async ({ page, api }) => {
    const letter = page.getByRole('article', { name: "Winter Night's Letter" })
    await letter.getByRole('checkbox').focus()
    await api.post('/api/achievements/stage/81732', { status: 'done' })
    await expect(letter).toHaveCount(0)
    // Juggernaut came next in Wonders of the World.
    await expect(page.getByRole('article', { name: 'Juggernaut', exact: true }).getByRole('checkbox')).toBeFocused()
  })

  test("in Pinned, a card that leaves hands the focus to the next card's Pin", async ({ page, api }) => {
    await categories(page).getByRole('button', { name: 'Pinned' }).click()
    await expect(page.getByTestId('ach-group')).toHaveCount(3)
    await page.getByRole('article', { name: 'For the Love of Godwin' }).getByRole('button', { name: 'Pin', exact: true }).focus()
    await api.post('/api/achievements/stage/84512', { pinned: false })
    await expect(page.getByTestId('ach-group')).toHaveCount(2)
    // The hilichurl comes next. Its third stage is pinned, so its Pin, the whole achievement's, is on.
    const pin = page.getByRole('article', { name: '...Well, That Was Strange' }).getByRole('button', { name: 'Pin', exact: true })
    await expect(pin).toBeFocused()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
  })

  test('when no card is left, the focus moves to the heading', async ({ page, api }) => {
    await page.getByRole('article', { name: 'Juggernaut', exact: true }).getByRole('button', { name: 'Pin', exact: true }).click()
    await expect(noteText(page)).toHaveText('Pinned Juggernaut')
    await searchbox(page).fill('winter night')
    await expect(page.getByTestId('ach-group')).toHaveCount(1)
    await page.getByRole('article', { name: "Winter Night's Letter" }).getByRole('checkbox').focus()
    await api.post('/api/achievements/stage/81732', { status: 'done' })
    await expect(page.getByText('Nothing left matches winter night. All shows every achievement.')).toBeVisible()
    await expect(page.getByTestId('ach-bar').getByRole('heading', { level: 2 })).toBeFocused()
  })

  test("ticking a checklist's last part hands the focus to the card's box, which the line then asks for", async ({ page }) => {
    await searchbox(page).fill('pirates')
    const card = page.getByRole('article', { name: 'Pirates! Argh!' })
    await card.getByRole('checkbox', { name: 'Little Fei', exact: true }).focus()
    await page.keyboard.press('Space')
    await expect(noteText(page)).toHaveText('Ticked a part of Pirates! Argh!')
    // Every part done: the chips give way to the line that offers the tick.
    await expect(card.locator('.ach-prog')).toContainText('All parts are done. Tick it once the game shows it.')
    await expect(card.getByRole('checkbox', { name: 'Little Fei', exact: true })).toHaveCount(0)
    await expect(card.getByRole('checkbox', { name: /^Done: / })).toBeFocused()
  })
})

test('a tick in the panel stamps its box once and glints the card, as a tick on the card does', async ({ page }) => {
  const card = page.getByRole('article', { name: "It's Yesterday Once More" })
  const panel = await openPanel(page, "It's Yesterday Once More")
  const third = { name: /^Done: III, Activate 60 tunes/ }
  const row = panel.locator('.ach-row').filter({ has: page.getByRole('checkbox', third) })
  await panel.getByRole('checkbox', third).check()
  await expect(row.locator('.ach-box')).toHaveClass(/\bstamp\b/) // the box the tick was made with
  await expect(card).toHaveClass(/\bglint\b/)
  await expect(panel.locator('.ach-box.stamp')).toHaveCount(1) // and no other
  await expect(card.locator('.ach-box')).not.toHaveClass(/\bstamp\b/)
  await expect(noteText(page)).toHaveText("Ticked It's Yesterday Once More")
  // Once, and then both hold still.
  await expect(card).not.toHaveClass(/\bglint\b/)
  await expect(row.locator('.ach-box')).not.toHaveClass(/\bstamp\b/)
})

test.describe('a note being typed', () => {
  const noteOf = async (api: Api, name: string) => (await found(api, name)).stages[0].note

  test('is saved when its panel closes as another opens, as the view changes and as its card leaves', async ({
    page,
    api,
  }) => {
    // Another card's panel opens: one at a time.
    const letter = await openPanel(page, "Winter Night's Letter")
    await letter.getByRole('button', { name: 'Note', exact: true }).click()
    await letter.getByRole('textbox').fill('Ask Mother first.')
    await page.getByRole('article', { name: 'Overlooking View', exact: true }).getByRole('button', { name: 'Details' }).click()
    await expect(noteText(page)).toHaveText("Changed the note on Winter Night's Letter")
    await expect.poll(() => noteOf(api, "Winter Night's Letter")).toBe('Ask Mother first.')
    await expect(page.getByRole('article', { name: "Winter Night's Letter" }).locator('.ach-quill')).toBeVisible()
    // Another view: in Done, the card of an achievement left goes, and its note is saved.
    const view = page.getByRole('region', { name: 'Overlooking View' })
    await view.getByRole('button', { name: 'Note', exact: true }).click()
    await view.getByRole('textbox').fill('From the cliff.')
    await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'Done' }).click()
    await expect.poll(() => noteOf(api, 'Overlooking View')).toBe('From the cliff.')
    // Saved after the player moved on, the note keeps no card in a list it does not belong to.
    await expect(page.getByTestId('ach-group').first()).toBeVisible()
    await expect(page.getByRole('article', { name: 'Overlooking View', exact: true })).toHaveCount(0)
    // Its card leaves the list, ticked elsewhere, here through the API as from another window.
    await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'Left' }).click()
    const again = await openPanel(page, "Winter Night's Letter")
    await again.getByRole('button', { name: 'Note', exact: true }).click()
    await again.getByRole('textbox').fill('Ask Father too.')
    await api.post('/api/achievements/stage/81732', { status: 'done' })
    await expect(page.getByRole('article', { name: "Winter Night's Letter" })).toHaveCount(0)
    await expect.poll(() => noteOf(api, "Winter Night's Letter")).toBe('Ask Father too.')
  })

  test('is not saved when Escape closes its panel', async ({ page, api }) => {
    const panel = await openPanel(page, "Winter Night's Letter")
    await panel.getByRole('button', { name: 'Note', exact: true }).click()
    await panel.getByRole('textbox').fill('Ask Mother first.')
    await panel.getByRole('button', { name: 'In progress' }).focus() // out of the editor, which keeps its own Escape
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('ach-panel')).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(await noteOf(api, "Winter Night's Letter")).toBe('')
    await expect(page.getByTestId('note')).toHaveCount(0) // no change was made, so there is no note
  })
})

test('Escape in the typed count puts the count back and sets nothing, and then Escape closes the panel', async ({
  page,
  api,
}) => {
  await searchbox(page).fill('unusual hilichurl')
  const panel = await openPanel(page, '...Well, That Was Strange')
  const count = panel.getByRole('spinbutton', { name: 'Count' })
  await expect(count).toHaveValue('37')
  const sent: unknown[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/achievements/counter/')) sent.push(request.postDataJSON())
  })
  await count.fill('45')
  await count.press('Escape')
  await expect(count).toHaveValue('37')
  await expect(count).toBeFocused() // the panel stays: the field kept its Escape
  await count.press('Escape') // nothing typed now: the panel closes, as from its other controls
  await expect(page.getByTestId('ach-panel')).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(sent).toEqual([])
  expect(await countOf(api, 'unusual hilichurl')).toBe(37)
})

test("a checklist's chips are cut short to fit the card, each name whole in its tip", async ({ page }) => {
  // Four parts with names as long as four chips take (achievementsview.ts, chipsFit), on cards at their least width of
  // 440 pixels, two to a row: the window is a little narrower than 1,440 pixels.
  await page.setViewportSize({ width: 1392, height: 900 })
  const names = ['Wendover', 'Hawthorn', 'Mortimer', 'Whitmore']
  await changeAnswer<Achievements>(page, '/api/achievements', (data) => {
    const pirates = data.groups.find((group) => group.name === 'Pirates! Argh!')
    if (pirates === undefined) return
    pirates.stages[0].parts = names.map((label) => ({ label, done_at: null }))
  })
  await page.reload()
  await searchbox(page).fill('pirates')
  const card = page.getByRole('article', { name: 'Pirates! Argh!' })
  const chips = card.locator('.ach-chip')
  await expect(chips).toHaveCount(4)
  expect((await card.boundingBox())!.width).toBe(440)
  const inside = await card.evaluate((element) => element.getBoundingClientRect().right - parseFloat(getComputedStyle(element).paddingRight))
  const rights = await card.locator('.ach-chip, .ach-of-parts').evaluateAll((all) => all.map((one) => one.getBoundingClientRect().right))
  expect(rights).toHaveLength(5) // the four chips and "0 of 4"
  for (const right of rights) expect(right).toBeLessThanOrEqual(inside + 0.5)
  for (const [index, name] of names.entries()) {
    await expect(chips.nth(index)).toHaveAttribute('title', name) // whole in its tip
    await expect(card.getByRole('checkbox', { name, exact: true })).toBeAttached() // and in its name
  }
})

test.describe('on a core without a login', () => {
  test.use({ mode: 'live' })

  test("the page reaches neither the internet nor the player's files", async ({ page, core }) => {
    // The primogem icon's download goes to a proxy where nothing listens, so there is no icon to serve.
    const icon = await page.request.get(`${core.origin}/api/icon/static.primogem`)
    expect(icon.status()).toBe(404)
  })
})

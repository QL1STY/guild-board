import type { Locator, Page } from '@playwright/test'
import type { Backlog } from '../src/types.ts'
import { changeAnswer, holding } from './answers.ts'
import { counted } from './board.ts'
import { expect, test } from './fixtures.ts'

test.beforeEach(async ({ page, core }) => {
  await page.goto(`${core.origin}/#/backlog`) // the Board opens first
})

test('the counters show totals and the change this week', async ({ page }) => {
  const chests = page.getByTestId('counter-chests')
  await expect(chests).toContainText('Chests')
  await expect(chests).toContainText('5,349')
  await expect(chests).toContainText('▲ 36 this week')
  await expect(page.getByTestId('counter-oculi')).toContainText('1,434')
  await expect(page.getByTestId('counter-achievements')).toContainText('1,304')
  await expect(page.getByTestId('counter-waypoints')).toContainText('521')
  await expect(page.getByTestId('counter-archon')).toContainText('2 open')
})

test('unfinished regions come least explored first', async ({ page }) => {
  const cards = page.getByTestId('region')
  await expect(cards).toHaveCount(6)
  const first = cards.first()
  await expect(first.getByRole('heading')).toHaveText('Snezhnaya')
  await expect(first).toContainText('36.7%') // beside the name, as the core has it
  await expect(first).toContainText('Offering 4')
  await expect(first.locator('.gb-bar')).toHaveCount(2)
  await expect(first.locator('.gb-bar').first()).toHaveText(/Capital district\s*28\.7%/)
  await expect(first.getByRole('button', { name: '+ 1 more area' })).toBeVisible()
  const last = cards.last()
  await expect(last.getByRole('heading')).toHaveText('Chenyu Vale')
  await expect(last).toContainText('Liyue · Rainjade Oblation 10')
  await expect(last.getByRole('button', { name: '+ 1 more area, all 100%' })).toBeVisible()
})

test('a card lists all its areas on request', async ({ page }) => {
  const card = page.getByTestId('region').filter({ hasText: 'Natlan' })
  await expect(card.locator('.gb-bar')).toHaveCount(2)
  await card.getByRole('button', { name: '+ 2 more areas' }).click()
  await expect(card.locator('.gb-bar')).toHaveCount(4)
  await expect(card).toContainText('Ancient Sacred Mountain')
  await card.getByRole('button', { name: 'Show fewer areas' }).click()
  await expect(card.locator('.gb-bar')).toHaveCount(2)
})

test('the sort switch reorders the regions, by mouse and by keyboard', async ({ page }) => {
  const first = page.getByTestId('region').first().getByRole('heading')
  await page.getByRole('radio', { name: 'Closest to done' }).click()
  await expect(first).toHaveText('Chenyu Vale')
  await expect(page.getByRole('radio', { name: 'Closest to done' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('radio', { name: 'Least explored' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: 'Least explored' })).toBeFocused()
  await expect(first).toHaveText('Snezhnaya')
})

/** The demo's unfinished regions, least explored first, and its complete ones, in game order. */
const UNFINISHED = ['Snezhnaya', 'Nod-Krai', 'Natlan', 'Sumeru', 'Inazuma', 'Chenyu Vale']
const COMPLETE = ['Mondstadt', 'Dragonspine', 'Liyue', 'The Chasm', 'Enkanomiya', 'Fontaine', 'Sea of Bygone Eras']

test('every region is a card, the unfinished first, then the complete in game order', async ({ page }) => {
  // One grid holds them all.
  const grid = page.locator('.gb-regions')
  const names = grid.getByRole('article').getByRole('heading')
  await expect(names).toHaveText([...UNFINISHED, ...COMPLETE])
  await expect(grid).toHaveCount(1)
  await expect(page.getByTestId('region')).toHaveCount(6)
  await expect(page.getByTestId('region-complete')).toHaveCount(7)
  // The sort orders the unfinished ones; the complete ones stay after them, in game order.
  await page.getByRole('radio', { name: 'Closest to done' }).click()
  await expect(names).toHaveText([...[...UNFINISHED].reverse(), ...COMPLETE])
  await page.getByRole('radio', { name: 'Game order' }).click()
  await expect(names).toHaveText(['Chenyu Vale', 'Inazuma', 'Sumeru', 'Natlan', 'Nod-Krai', 'Snezhnaya', ...COMPLETE])
  // The row of chips is gone.
  await expect(page.getByTestId('complete')).toHaveCount(0)
  await expect(page.locator('.gb-chip')).toHaveCount(0)
})

test('long names and many regions keep the layout', async ({ page }) => {
  const long = 'Achromatic-Hinterlands-Of-The-Unnamed-Northern-Reaches-Beyond-The-Frostbound-Sea'
  await changeAnswer<Backlog>(page, '/api/backlog', (data) => {
    data.counters[0].value = 1234567
    data.regions = Array.from({ length: 30 }, (_, index) => ({
      id: 100 + index,
      name: `${long} ${index + 1}`,
      parent: long,
      pct: 12.3,
      icon: '',
      note: long,
      areas: Array.from({ length: 20 }, (_, area) => ({ name: `${long} area ${area + 1}`, pct: area * 5 })),
      complete: false,
    }))
    data.complete = Array.from({ length: 40 }, (_, index) => ({
      id: 200 + index,
      name: `${long} ${index + 1}`,
      parent: long,
      pct: 100,
      icon: '',
      note: long,
      areas: Array.from({ length: 20 }, (_, area) => ({ name: `${long} area ${area + 1}`, pct: 100 })),
      complete: true,
    }))
  })
  await page.reload()
  const cards = page.getByTestId('region')
  await expect(cards).toHaveCount(30)
  await expect(page.getByTestId('counter-chests')).toContainText('1,234,567')
  // Nothing pushes the page wider than the window, and every card stays inside its column: as wide as the grid's column,
  // in the grid's own pixels, whatever its name.
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: window.innerWidth }))
  expect(widths.page).toBeLessThanOrEqual(widths.window)
  const wider = await page.locator('.gb-regions').evaluate((grid) => {
    const column = parseFloat(getComputedStyle(grid).gridTemplateColumns)
    return [...grid.querySelectorAll<HTMLElement>('article')].filter((card) => Math.abs(card.offsetWidth - column) >= 1)
      .length
  })
  expect(wider).toBe(0)
  // A card's name shows whole, on as many lines as it needs, the unfinished ones' as the complete ones': no part of it is
  // cut, so it needs no title to show the rest.
  for (const name of [cards.first().getByRole('heading'), page.getByTestId('region-complete').first().getByRole('heading')]) {
    await expect(name).toHaveText(/ 1$/)
    expect(await name.evaluate((one) => one.scrollWidth <= one.clientWidth && one.scrollHeight <= one.clientHeight)).toBe(true)
    expect(await name.evaluate((one) => one.clientHeight / parseFloat(getComputedStyle(one).lineHeight))).toBeGreaterThan(1.5)
    await expect(name).not.toHaveAttribute('title')
  }
  await cards.first().getByRole('button', { name: '+ 18 more areas' }).click()
  await expect(cards.first().locator('.gb-bar')).toHaveCount(20)
})

test.describe('before the first sync', () => {
  test.use({ mode: 'live' })

  test('the backlog says that there is nothing yet', async ({ page }) => {
    await expect(page.getByText('Nothing to show yet. This page fills in after the first sync.')).toBeVisible()
    await expect(page.getByTestId('region')).toHaveCount(0)
    // Without a login the plate asks for one.
    await expect(page.getByTestId('sync')).toContainText('Log in needed')
    await expect(page.getByTestId('profile')).toContainText('Not logged in')
    await expect(page.getByText('Demo data')).toHaveCount(0)
  })
})

test('closest to done lists the smallest remainders', async ({ page }) => {
  const rows = page.getByRole('region', { name: 'Closest to done' }).getByRole('listitem')
  await expect(rows).toHaveCount(5)
  await expect(rows.nth(0)).toHaveText(/Natlan · Ancient Sacred Mountain\s*1% left/)
  await expect(rows.nth(1)).toHaveText(/Chenyu Vale · Upper Vale\s*1\.8% left/)
  await expect(rows.nth(4)).toHaveText(/Natlan · Tezcatepetonco Range\s*9% left/)
})

test('oculi without a known total show the count alone', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Oculi still missing' })
  await expect(panel).toContainText('Cryoculi')
  await expect(panel).toContainText('43 found')
  await expect(panel).toContainText('Guild Board has no total for these types yet, so only the count is shown.')
  await expect(panel).toContainText('5 other types complete')
})

test('oculi with a known total show how many there are', async ({ page }) => {
  await changeAnswer<Backlog>(page, '/api/backlog', (data) => {
    data.oculi = { missing: [{ type: 'pyro', label: 'Pyroculi', have: 318, total: 321 }], complete_count: 7, unknown: [] }
  })
  await page.reload()
  const panel = page.getByRole('region', { name: 'Oculi still missing' })
  await expect(panel).toContainText('Pyroculi')
  await expect(panel).toContainText('318 of 321')
  await expect(panel).toContainText('7 other types complete')
  await expect(panel).not.toContainText('no total')
})

test('open archon quest chapters are listed', async ({ page }) => {
  const rows = page.getByRole('region', { name: 'Archon Quests' }).getByRole('listitem')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Chapter VII: Act II')
  await expect(rows.nth(0)).toContainText('In progress')
  await expect(rows.nth(1)).toContainText('Chapter VII: Act III')
  await expect(rows.nth(1)).toContainText('Not started')
})

test('finished archon quests say so', async ({ page }) => {
  await changeAnswer<Backlog>(page, '/api/backlog', (data) => {
    data.archon = { known: true, all_finished: true, open: 0, chapters: [] }
  })
  await page.reload()
  await expect(page.getByRole('region', { name: 'Archon Quests' })).toContainText('All chapters finished')
})

test('exploration that has not been read is not called finished', async ({ page }) => {
  // A first sync whose overview failed: the core has the notes, but nothing about exploration.
  await changeAnswer<Backlog>(page, '/api/backlog', (data) => {
    data.counters = data.counters.filter((counter) => counter.id === 'archon')
    data.regions = []
    data.complete = []
    data.closest = []
  })
  await page.reload()
  await expect(page.getByTestId('counter-archon')).toContainText('2 open')
  await expect(page.getByText('Exploration has not been read yet.')).toBeVisible()
  await expect(page.getByText('Every region is fully explored.')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Closest to done' })).toContainText('Not read yet.')
  await expect(page.getByText('Nothing is left to explore.')).toHaveCount(0)
})

test('a finished map is called finished', async ({ page }) => {
  await changeAnswer<Backlog>(page, '/api/backlog', (data) => {
    data.regions = []
    data.closest = []
  })
  await page.reload()
  const said = page.getByText('Every region is fully explored.')
  await expect(said).toBeVisible()
  await expect(page.getByRole('region', { name: 'Closest to done' })).toContainText('Nothing is left to explore.')
  // The complete regions' cards show below it.
  const cards = page.getByTestId('region-complete')
  await expect(cards.getByRole('heading')).toHaveText(COMPLETE)
  const [sentence, first] = await Promise.all([said.boundingBox(), cards.first().boundingBox()])
  expect(first!.y).toBeGreaterThan(sentence!.y + sentence!.height)
})

/** A solid 1 x 1 picture, for an emblem: a data address, which the core's content policy allows for images. */
const EMBLEM =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test('each region card shows its emblem in its ring and its percentage beside the name', async ({ page }) => {
  const first = page.getByTestId('region').first()
  const name = first.getByRole('heading')
  await expect(name).toHaveText('Snezhnaya')
  const share = first.locator('.gb-rp')
  await expect(share).toHaveText('36.7%')
  // Beside the name: to its right, on its line.
  const [named, shown] = await Promise.all([name.boundingBox(), share.boundingBox()])
  expect(shown!.x).toBeGreaterThanOrEqual(named!.x + named!.width - 1)
  expect(Math.abs(shown!.y + shown!.height / 2 - (named!.y + named!.height / 2))).toBeLessThan(8)
  // The emblem is in the ring. The demo has no picture to download, so the region's sign, the compass, shows in it; and
  // the ring says what it fills to, which the figure beside the name says in words.
  const ring = first.locator('.gb-ring')
  await expect(ring.locator('.pic .sign')).toBeVisible()
  await expect(ring.locator('img')).toBeHidden()
  await expect(ring).toHaveAttribute('data-tip', '36.7% explored')
  await expect(ring).not.toContainText('%') // the ring no longer holds the figure
  const [outer, inner] = await Promise.all([ring.boundingBox(), ring.locator('.pic').boundingBox()])
  expect(inner!.width).toBeLessThan(outer!.width)
  expect(inner!.x).toBeGreaterThan(outer!.x)
  // Every card has one, also the one whose region has no emblem (the core gives an empty address).
  await expect(page.getByTestId('region').locator('.gb-ring .pic .sign')).toHaveCount(6)
  await expect(page.getByTestId('region').last().locator('.gb-ring img')).toBeHidden()
})

test('a region card draws the emblem that the core names, and the sign under it hides', async ({ page }) => {
  await changeAnswer<Backlog>(page, '/api/backlog', (data) => {
    data.regions[0].icon = EMBLEM
  })
  await page.reload()
  const ring = page.getByTestId('region').first().locator('.gb-ring')
  const image = ring.locator('img')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((one: HTMLImageElement) => one.complete && one.naturalWidth)).toBe(1)
  await expect(ring.locator('.sign')).toBeHidden()
  const [outer, inner] = await Promise.all([ring.boundingBox(), image.boundingBox()])
  expect(inner!.width).toBeLessThan(outer!.width) // inside the ring, not as wide as it
})

test("a complete region's card shows its emblem, 100% and its areas in one line", async ({ page, api }) => {
  const model = await api.get<Backlog>('/api/backlog')
  const named = (name: string) => model.complete.find((region) => region.name === name)!
  await changeAnswer<Backlog>(page, '/api/backlog', (data) => {
    data.complete.find((region) => region.name === 'Mondstadt')!.icon = EMBLEM // the demo has no picture to download
    data.complete.find((region) => region.name === 'Liyue')!.areas = [{ name: 'Lisha', pct: 100 }]
  })
  await page.reload()
  const card = (name: string) =>
    page.getByTestId('region-complete').filter({ has: page.getByRole('heading', { name, exact: true }) })
  const mondstadt = card('Mondstadt')
  // Its emblem on its nation's disc, in its ring, which is full.
  const ring = mondstadt.locator('.gb-ring')
  const image = ring.locator('.gb-emb img')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((one: HTMLImageElement) => one.complete && one.naturalWidth)).toBe(1)
  await expect(ring.locator('.gb-emb')).toHaveCSS('background-color', 'rgb(47, 138, 126)') // Mondstadt's teal
  await expect(ring).toHaveAttribute('data-tip', '100% explored')
  // 100% beside its name, and under it its offering's level, as the model has it.
  await expect(mondstadt.locator('.gb-rp')).toHaveText('100%')
  await expect(mondstadt.locator('.sub')).toHaveText(named('Mondstadt').note)
  // Mondstadt has no areas in the model, so no line sums them up.
  expect(named('Mondstadt').areas).toHaveLength(0)
  await expect(mondstadt.locator('.gb-areas')).toHaveCount(0)
  // Fontaine's are summed up in one line, their number from the model.
  const areas = named('Fontaine').areas
  expect(areas.length).toBeGreaterThan(1)
  await expect(card('Fontaine').locator('.gb-areas')).toHaveText(`${areas.length} areas, all 100%`)
  await expect(card('Fontaine').locator('.sub')).toHaveText(named('Fontaine').note)
  await expect(card('Liyue').locator('.gb-areas')).toHaveText('1 area, 100%') // one area
  // No complete card lists its areas, and none has anything to open.
  for (const name of COMPLETE) {
    await expect(card(name).locator('.gb-bar')).toHaveCount(0)
    await expect(card(name).getByRole('button')).toHaveCount(0)
  }
})

/**
 * Before the scaling pass, in the tests' window 1,440 pixels wide, the rendered heights in pixels of a region card's
 * name, a counter's value, the toolbar's heading and a heading of the side column (Edge 155, 2026-10-23, at 042cb72).
 */
const BEFORE_SCALING = { name: 21.59375, value: 24.140625, toolbar: 18.890625, side: 18.890625 }

test('the Backlog reads a third larger', async ({ page, core }) => {
  await expect(page.getByTestId('region')).toHaveCount(6)
  const heights = {
    name: (await page.getByTestId('region').first().getByRole('heading').boundingBox())!.height,
    value: (await page.getByTestId('counter-chests').locator('.v').boundingBox())!.height,
    toolbar: (await page.getByRole('heading', { name: 'Unfinished regions' }).boundingBox())!.height,
    side: (await page.getByRole('region', { name: 'Closest to done' }).getByRole('heading').boundingBox())!.height,
  }
  for (const [part, height] of Object.entries(heights)) {
    const before = BEFORE_SCALING[part as keyof typeof BEFORE_SCALING]
    expect(Math.abs(height - 1.33 * before), `${part}: ${height} after ${before}`).toBeLessThanOrEqual(1)
  }
  // The frame around it keeps its size: the top bar's title is as tall as on Stats.
  const title = page.getByRole('heading', { level: 1 })
  const here = (await title.boundingBox())!.height
  await page.goto(`${core.origin}/#/stats`)
  await expect(title).toHaveText('Stats')
  expect((await title.boundingBox())!.height).toBe(here)
})

/** How many columns the elements stand in: the number of different places their left edges are at. */
const columnsOf = (elements: Locator) =>
  elements.evaluateAll((all) => new Set(all.map((one) => Math.round(one.getBoundingClientRect().left))).size)

test('a narrower window shows fewer columns of cards and counters; 1,640 pixels and wider show three and five', async ({
  page,
}) => {
  await expect(page.getByTestId('region-complete')).toHaveCount(7)
  const sizes: [width: number, cards: number, counters: number][] = [
    [2560, 3, 5], [1640, 3, 5], [1440, 2, 5], [1280, 2, 5], [1040, 1, 4],
  ]
  for (const [width, cards, counters] of sizes) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => columnsOf(page.locator('.gb-regions > article')), `cards at ${width}`).toBe(cards)
    await expect.poll(() => columnsOf(page.locator('.gb-counter')), `counters at ${width}`).toBe(counters)
  }
})

test('the counters share their row, five or four of them, and a lone one keeps the width of one', async ({ page }) => {
  await page.setViewportSize({ width: 1640, height: 900 })
  const counters = page.locator('.gb-counter')
  /** The row's width and each counter's, in their own pixels. */
  const measure = async () => ({
    row: await page.locator('.gb-counters').evaluate((grid) => grid.clientWidth),
    widths: await counters.evaluateAll((all) => all.map((one) => (one as HTMLElement).offsetWidth)),
  })
  const filled = ({ row, widths }: { row: number; widths: number[] }) =>
    widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * 10 - row
  // Five, as wide as each other, across the whole row.
  await expect(counters).toHaveCount(5)
  const five = await measure()
  expect(Math.max(...five.widths) - Math.min(...five.widths)).toBeLessThanOrEqual(1)
  expect(Math.abs(filled(five))).toBeLessThanOrEqual(5)
  // Four, before the notes are read: still across the whole row.
  await changeAnswer<Backlog>(page, '/api/backlog', (data) => {
    data.counters = data.counters.filter((counter) => counter.id !== 'archon')
  })
  await page.reload()
  await expect(counters).toHaveCount(4)
  expect(Math.abs(filled(await measure()))).toBeLessThanOrEqual(4)
  // One, when only the notes are read: a counter's width, not the row's.
  await changeAnswer<Backlog>(page, '/api/backlog', (data) => {
    data.counters = data.counters.filter((counter) => counter.id === 'archon')
  })
  await page.reload()
  await expect(counters).toHaveCount(1)
  expect((await measure()).widths[0]).toBeLessThanOrEqual(280)
})

test('in the narrowest window, 1,040 pixels, every name shows and nothing spills out of a card or a counter', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 900 })
  await expect(page.getByTestId('region-complete')).toHaveCount(7)
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0) // the rings have filled
  // Each region's name shows whole, on one line or two.
  const hidden = await page.locator('.gb-region h3').evaluateAll((names) =>
    names
      .filter((name) => name.clientWidth === 0 || name.scrollWidth > name.clientWidth || name.scrollHeight > name.clientHeight)
      .map((name) => name.textContent),
  )
  expect(hidden).toEqual([])
  // Nothing drawn in a card or a counter reaches past its edges. (The number for screen readers is not drawn.)
  const spills = await page.locator('.gb-region, .gb-counter').evaluateAll((boxes) =>
    boxes.flatMap((box) => {
      const edge = box.getBoundingClientRect()
      return [...box.querySelectorAll('*')]
        .filter((part) => !part.matches('.sr-only'))
        .filter((part) => {
          const { left, right, top, bottom, width, height } = part.getBoundingClientRect()
          const outside = left < edge.left - 0.5 || right > edge.right + 0.5 || top < edge.top - 0.5 || bottom > edge.bottom + 0.5
          return width > 0 && height > 0 && outside
        })
        .map((part) => `${box.querySelector('h3, .k')?.textContent}: ${part.tagName} ${part.getAttribute('class') ?? ''}`)
    }),
  )
  expect(spills).toEqual([])
  // The section's heading keeps its words inside it, and the sort switch clear of it: under it, where the row is short.
  const section = page.getByRole('heading', { name: 'Unfinished regions' })
  const [heading, sorts] = await Promise.all([
    section.boundingBox(),
    page.getByRole('radiogroup', { name: 'Order of the regions' }).boundingBox(),
  ])
  expect(await section.evaluate((one) => one.scrollWidth <= one.clientWidth)).toBe(true)
  expect(sorts!.y >= heading!.y + heading!.height || sorts!.x >= heading!.x + heading!.width).toBe(true)
})

test('a heading counts the complete regions, between the last unfinished card and the first complete one', async ({
  page,
}) => {
  const grid = page.locator('.gb-regions')
  const heading = grid.getByRole('heading', { level: 2 })
  await expect(heading).toHaveText('Complete · 7')
  // In the grid, after the last unfinished card and before the first complete one, across the whole row.
  const order = await grid.evaluate((one) =>
    [...one.children].map((child) => child.getAttribute('data-testid') ?? child.textContent),
  )
  expect(order).toEqual([...Array<string>(6).fill('region'), 'Complete · 7', ...Array<string>(7).fill('region-complete')])
  // All the boxes are read in one go: while the counters above count up, a delta beside a longer number wraps under it
  // and the page below moves down a line, so boxes read one call after another could belong to two different layouts.
  const { last, row, first, all, section } = await page.evaluate(() => {
    const box = (one: Element | null) => {
      const { y, width, height } = one!.getBoundingClientRect()
      return { y, width, height }
    }
    const cards = document.querySelectorAll('.gb-regions [data-testid="region"]')
    const title = [...document.querySelectorAll('h2')].find((one) => one.textContent === 'Unfinished regions')
    return {
      last: box(cards[cards.length - 1] ?? null),
      row: box(document.querySelector('.gb-regions > h2')),
      first: box(document.querySelector('.gb-regions [data-testid="region-complete"]')),
      all: box(document.querySelector('.gb-regions')),
      section: box(title ?? null),
    }
  })
  expect(row.y).toBeGreaterThanOrEqual(last.y + last.height)
  expect(row.y + row.height).toBeLessThanOrEqual(first.y)
  expect(Math.abs(row.width - all.width)).toBeLessThan(1)
  // The section's heading and its sort switch stay above the grid.
  expect(section.y + section.height).toBeLessThanOrEqual(all.y)
  await expect(page.getByRole('radiogroup', { name: 'Order of the regions' })).toBeVisible()
})

test('a long region name shows whole, on a second line where it needs one, unfinished or complete', async ({ page }) => {
  await changeAnswer<Backlog>(page, '/api/backlog', (data) => {
    data.complete.find((region) => region.name === 'The Chasm')!.name = 'The Chasm: Underground Mines' // as HoYoLAB lists it
    data.regions.find((region) => region.name === 'Natlan')!.name = 'Ancient Sacred Mountain'
  })
  await page.setViewportSize({ width: 1640, height: 1100 })
  await page.reload()
  const cards = [
    page.getByTestId('region-complete').filter({ hasText: 'The Chasm: Underground Mines' }),
    page.getByTestId('region').filter({ hasText: 'Ancient Sacred Mountain' }),
  ]
  for (const card of cards) {
    const name = card.getByRole('heading')
    await expect(name).toBeVisible()
    expect(await name.evaluate((one) => one.scrollWidth <= one.clientWidth && one.scrollHeight <= one.clientHeight)).toBe(true)
    expect(await name.evaluate((one) => one.clientHeight / parseFloat(getComputedStyle(one).lineHeight))).toBeCloseTo(2, 1)
    await expect(name).not.toHaveAttribute('title') // nothing of it is hidden
  }
  // On the unfinished card the bars start under the name's second line.
  const [name, bar] = await Promise.all([cards[1].getByRole('heading').boundingBox(), cards[1].locator('.gb-bar').first().boundingBox()])
  expect(bar!.y).toBeGreaterThanOrEqual(name!.y + name!.height)
})

test('the names on a row of cards line up, with or without an areas line under them', async ({ page }) => {
  // At either width Fontaine, which has an areas line, shares a row with complete cards that have none.
  for (const width of [1640, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByTestId('region-complete')).toHaveCount(7)
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0)
    const spreads = await page.locator('.gb-regions > article').evaluateAll((cards) => {
      const rows = new Map<number, number[]>()
      for (const card of cards) {
        const row = Math.round(card.getBoundingClientRect().top)
        rows.set(row, [...(rows.get(row) ?? []), card.querySelector('h3')!.getBoundingClientRect().top])
      }
      return [...rows.values()].map((names) => Math.max(...names) - Math.min(...names))
    })
    for (const spread of spreads) expect(spread, `at ${width}`).toBeLessThan(1)
  }
})

test('the counters show their signs and count up', async ({ page }) => {
  const ids = ['chests', 'oculi', 'achievements', 'waypoints', 'archon']
  for (const id of ids) await expect(page.getByTestId(`counter-${id}`).locator('.sign')).toHaveCount(1)
  const drawings = await page.locator('.gb-counter .sign').evaluateAll((signs) => signs.map((sign) => sign.innerHTML))
  expect(new Set(drawings).size).toBe(5) // a sign of its own for each counter
  // The labels are in sentence case: nothing is set in capitals by the style.
  await expect(page.getByTestId('counter-chests').locator('.k')).toHaveCSS('text-transform', 'none')
  // The model is held back until the page's clock has stopped, so that the count begins at a moment the test knows.
  const { held, release } = holding()
  await page.route('**/api/backlog*', async (route) => {
    await held
    await route.continue()
  })
  await page.clock.install()
  await page.reload()
  await page.clock.pauseAt(Date.now() + 1_000)
  release()
  const chests = counted(page.getByTestId('counter-chests').locator('.v'))
  await expect(chests).toHaveText('0') // it begins at 0
  await expect(page.getByTestId('counter-chests').locator('.v .sr-only')).toHaveText('5,349') // screen readers have the final number
  await page.clock.runFor(100)
  const partway = Number((await chests.textContent())!.replace(/,/g, ''))
  expect(partway).toBeGreaterThan(0)
  expect(partway).toBeLessThan(5349)
  await page.clock.runFor(1_000) // --t-count is 800 ms
  await expect(chests).toHaveText('5,349')
  await expect(counted(page.getByTestId('counter-oculi').locator('.v'))).toHaveText('1,434')
  await expect(counted(page.getByTestId('counter-archon').locator('.v'))).toHaveText('2 open') // the words go with the number
})

test('with reduced motion the counters show their numbers at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(page.getByTestId('counter-chests')).toBeVisible()
  expect(await counted(page.getByTestId('counter-chests').locator('.v')).textContent()).toBe('5,349') // at once
})

test('Closest to done shows a bar for each entry', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Closest to done' })
  const rows = panel.getByRole('listitem')
  await expect(rows).toHaveCount(5)
  await expect(rows.locator('.bar')).toHaveCount(5)
  // Each bar is the share explored: what is not left, beside the words that say what is left.
  await expect(rows.nth(0).locator('.bar-fill')).toHaveAttribute('style', /width: 99%/)
  await expect(rows.nth(1).locator('.bar-fill')).toHaveAttribute('style', /width: 98\.2%/)
  await expect(rows.nth(4).locator('.bar-fill')).toHaveAttribute('style', /width: 91%/)
  const [bar, words] = await Promise.all([rows.nth(0).locator('.bar').boundingBox(), rows.nth(0).locator('b').boundingBox()])
  expect(words!.x).toBeGreaterThanOrEqual(bar!.x + bar!.width - 1) // beside it, to its right
  expect(Math.abs(words!.y + words!.height / 2 - (bar!.y + bar!.height / 2))).toBeLessThan(8)
  expect(bar!.height).toBeLessThanOrEqual(5) // thin
  // The value is in words, not in the bar alone (spec 15).
  await expect(rows.nth(0)).toContainText('1% left')
})

test('the side column has its headings in sentence case, each with its sign, and the chapters their seals', async ({ page }) => {
  for (const name of ['Closest to done', 'Oculi still missing', 'Archon Quests']) {
    const heading = page.getByRole('region', { name }).getByRole('heading')
    await expect(heading).toHaveText(name)
    await expect(heading.locator('.sign')).toHaveCount(1)
    await expect(heading).toHaveCSS('text-transform', 'none')
  }
  const chapters = page.getByRole('region', { name: 'Archon Quests' }).getByRole('listitem')
  const inProgress = chapters.nth(0).locator('.seal')
  const notStarted = chapters.nth(1).locator('.seal')
  await expect(inProgress).toHaveText('In progress')
  await expect(notStarted).toHaveText('Not started')
  // In progress is a gold plate; not started is outlined, with no plate.
  await expect(inProgress).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(notStarted).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  expect(await notStarted.evaluate((seal) => getComputedStyle(seal).boxShadow)).not.toBe('none')
})

type Glide = { id: string; from: string }

/**
 * The names of the animations that start on the page, in order, and each glide of a card (Web Animations): which card
 * glided and the transform it began from, which is where it was seen, less where it is now.
 */
async function recordMotion(page: Page): Promise<{ started: () => Promise<string[]>; glides: () => Promise<Glide[]> }> {
  await page.addInitScript(() => {
    const started: string[] = []
    const glides: { id: string; from: string }[] = []
    const seen = window as unknown as { started: string[]; glides: typeof glides }
    seen.started = started
    seen.glides = glides
    document.addEventListener('animationstart', (event) => started.push((event as AnimationEvent).animationName), true)
    const animate = Element.prototype.animate
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      if ((args[1] as KeyframeAnimationOptions | undefined)?.id === 'glide') {
        const first = (args[0] as Keyframe[])[0]
        glides.push({ id: this.getAttribute('data-region') ?? '', from: String(first.transform) })
      }
      return animate.apply(this, args)
    }
  })
  return {
    started: () => page.evaluate(() => (window as unknown as { started: string[] }).started),
    glides: () => page.evaluate(() => (window as unknown as { glides: { id: string; from: string }[] }).glides),
  }
}

/** Each card's id and where it is on the screen. */
const placesOf = (cards: Locator) =>
  cards.evaluateAll((all) =>
    all.map((card) => {
      const box = card.getBoundingClientRect()
      return { id: card.getAttribute('data-region') ?? '', x: box.x, y: box.y }
    }),
  )

test('the rings fill and the bars grow once, when the page opens', async ({ page }) => {
  const seen = await recordMotion(page)
  await page.reload()
  await expect(page.getByTestId('region')).toHaveCount(6)
  await expect.poll(async () => [...new Set(await seen.started())]).toEqual(expect.arrayContaining(['ring-fill', 'grow-w']))
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0) // all done: nothing loops
  const names = await seen.started()
  expect(names.filter((name) => name === 'ring-fill')).toHaveLength(6) // a ring for each card, once
  // The ring has not moved from the share the model gives: 36.7 of 100.
  const ring = page.getByTestId('region').first().locator('.gb-ring')
  expect(await ring.evaluate((one) => getComputedStyle(one).getPropertyValue('--p'))).toBe('36.7')
  // Sorting does not fill them again, nor grow the bars again.
  const before = (await seen.started()).length
  await page.getByRole('radio', { name: 'Closest to done' }).click()
  await expect(page.getByTestId('region').first().getByRole('heading')).toHaveText('Chenyu Vale')
  await page.waitForTimeout(600)
  expect((await seen.started()).filter((name) => name === 'ring-fill')).toHaveLength(6)
  expect((await seen.started()).length).toBe(before)
})

test("a card's entry lasts until its ring has filled, whatever else in it ends sooner", async ({ page }) => {
  await page.addInitScript(() => {
    const cancelled: string[] = []
    ;(window as unknown as { cancelled: string[] }).cancelled = cancelled
    document.addEventListener('animationcancel', (event) => cancelled.push((event as AnimationEvent).animationName), true)
    // Something in the card that moves for less time than the ring fills, as a later look may give it. The rule goes
    // into the page's own stylesheet: the page's policy refuses a style element of a script's.
    addEventListener('DOMContentLoaded', () => {
      const sheet = document.styleSheets[0]
      sheet.insertRule('.gb-region.in .gb-rp { animation: fade-in 40ms linear; }', sheet.cssRules.length)
    })
  })
  await page.reload()
  const cards = page.getByTestId('region')
  await expect(cards).toHaveCount(6)
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0)
  // No ring stopped short, nor any bar: each ran to its end before the entry ended.
  expect(await page.evaluate(() => (window as unknown as { cancelled: string[] }).cancelled)).toEqual([])
  await expect(cards.first()).not.toContainClass('in')
})

test('the region cards keep their ids when the order changes, and end in the new order', async ({ page }) => {
  const seen = await recordMotion(page)
  await page.reload()
  const cards = page.getByTestId('region')
  await expect(cards).toHaveCount(6)
  const ids = () => cards.evaluateAll((all) => all.map((card) => card.getAttribute('data-region')))
  const before = await ids()
  expect(new Set(before).size).toBe(6) // an id for each card
  expect(await seen.glides()).toEqual([]) // nothing glides as the page opens
  await cards.first().evaluate((card) => card.setAttribute('data-was', 'here')) // to see that the card is not replaced
  await page.getByRole('radio', { name: 'Closest to done' }).click()
  await expect.poll(ids).toEqual([...before].reverse()) // the least explored, first, is now last
  await expect(cards.last()).toHaveAttribute('data-was', 'here') // the same card, moved
  // The cards that changed places glided there (their ids tell which), and each did so once.
  await expect.poll(() => seen.glides().then((all) => all.length)).toBeGreaterThanOrEqual(1)
  const glided = (await seen.glides()).map((glide) => glide.id)
  expect(new Set(glided).size).toBe(glided.length)
  for (const id of glided) expect(before).toContain(id)
  // Game order is the order HoYoLAB lists them in.
  await page.getByRole('radio', { name: 'Game order' }).click()
  await expect.poll(ids).toEqual(['5', '6', '8', '11', '12', '13'])
})

test('a sort moves the cards from where they were seen, also after a card was opened', async ({ page }) => {
  const seen = await recordMotion(page)
  await page.reload()
  const cards = page.getByTestId('region')
  await expect(cards).toHaveCount(6)
  await cards.first().getByRole('button', { name: '+ 1 more area' }).click() // the card grows, and the ones below move
  await expect(cards.first().locator('.gb-bar')).toHaveCount(3)
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0) // whatever moved has settled
  // What is below the card moved down with it, gliding: the complete regions' heading too.
  expect((await seen.glides()).map((glide) => glide.id)).toContain('complete')
  const seenAt = await placesOf(cards)
  const earlier = (await seen.glides()).length // what glided as the card opened is not the sort's
  await page.getByRole('radio', { name: 'Closest to done' }).click()
  await expect(cards.first().getByRole('heading')).toHaveText('Chenyu Vale')
  await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0)
  const now = await placesOf(cards)
  // Each glide began at the card's old place less its new one, as the screen had it: nothing jumped as it began. The
  // Backlog is zoomed (backlog.css), so a glide moves the card in its own pixels, which the zoom makes larger on the
  // screen.
  const zoom = await cards.first().evaluate((card) => card.currentCSSZoom)
  expect(zoom).toBeCloseTo(1.33, 5)
  const glides = (await seen.glides()).slice(earlier)
  expect(glides.length).toBeGreaterThanOrEqual(1)
  for (const { id, from } of glides) {
    const [, dx, dy] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(from)!.map(Number)
    const was = seenAt.find((card) => card.id === id)!
    const is = now.find((card) => card.id === id)!
    expect(dx * zoom).toBeCloseTo(was.x - is.x, 0)
    expect(dy * zoom).toBeCloseTo(was.y - is.y, 0)
  }
  // At the end each card is where the page puts it: nothing is left offset by a glide.
  const offsets = await cards.evaluateAll((all) => all.map((card) => getComputedStyle(card).transform))
  expect(offsets.every((offset) => offset === 'none')).toBe(true)
})

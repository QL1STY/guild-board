import { describe, expect, it } from 'vitest'
import type { MonthWishes } from '../types.ts'
import {
  GAP, monthsLayout, monthsTable, monthTick, monthTitle, monthTotal, MOST_WIDE, type Segment, segmentPath, segmentWords,
  WISHES, wishesShown,
} from './months.ts'

/** A month of the history by wish, in the order the model gives them: character, weapon, standard, chronicled. */
const month = (key: string, character: number, weapon = 0, standard = 0, chronicled = 0): MonthWishes => ({
  month: key, character, weapon, standard, chronicled,
})

/** Three months: one busy, a quiet one between, and the busiest, this month's, with 300 wishes. */
const THREE = [month('2026-08', 100, 40, 10), month('2026-09', 0), month('2026-10', 240, 40, 20)]

describe('the months of the graph', () => {
  it('are named in full for the tooltip and short for the axis', () => {
    expect(monthTitle('2026-10')).toBe('October 2026')
    expect(monthTitle('2025-01')).toBe('January 2025')
    expect(monthTick('2026-10')).toBe('Oct')
    expect(monthTick('2026-05')).toBe('May')
  })

  it('total the four wishes', () => {
    expect(monthTotal(THREE[2])).toBe(300)
    expect(monthTotal(month('2026-09', 0))).toBe(0)
    expect(monthTotal(month('2026-10', 1, 2, 3, 4))).toBe(10)
  })

  it('stack the character event, the weapon event, the standard wish and the chronicled wish, in that order', () => {
    expect(WISHES).toEqual(['character', 'weapon', 'standard', 'chronicled'])
  })

  it('show the chronicled wish only when some month holds its wishes', () => {
    expect(wishesShown(THREE)).toEqual(['character', 'weapon', 'standard'])
    expect(wishesShown([...THREE, month('2026-11', 5, 0, 0, 3)])).toEqual(['character', 'weapon', 'standard', 'chronicled'])
    expect(wishesShown([])).toEqual(['character', 'weapon', 'standard'])
  })

  it("say a segment's month, its wish and count, and the month's total", () => {
    expect(segmentWords(THREE[2], 'character')).toEqual({
      title: 'October 2026', line: 'Character event: 240', all: 'All banners: 300',
    })
    expect(segmentWords(THREE[2], 'standard')).toMatchObject({ line: 'Standard: 20' })
    expect(segmentWords(month('2026-10', 1234, 0, 0, 1), 'chronicled')).toEqual({
      title: 'October 2026', line: 'Chronicled: 1', all: 'All banners: 1,235',
    })
  })
})

describe('the table of the months', () => {
  it('has a column for each wish shown and one for all, a row for each month', () => {
    expect(monthsTable(THREE, wishesShown(THREE))).toEqual({
      head: ['Month', 'Character event', 'Weapon event', 'Standard', 'All'],
      rows: [
        ['August 2026', '100', '40', '10', '150'],
        ['September 2026', '0', '0', '0', '0'],
        ['October 2026', '240', '40', '20', '300'],
      ],
      numeric: [1, 2, 3, 4],
    })
  })

  it('has a column for the chronicled wish when it is shown, and writes thousands with a comma', () => {
    const months = [month('2026-10', 1200, 40, 20, 7)]
    const table = monthsTable(months, wishesShown(months))
    expect(table.head).toEqual(['Month', 'Character event', 'Weapon event', 'Standard', 'Chronicled', 'All'])
    expect(table.rows).toEqual([['October 2026', '1,200', '40', '20', '7', '1,267']])
  })
})

describe("a segment's path", () => {
  const segment = (over: Partial<Segment> = {}): Segment => ({
    wish: 'character', count: 10, x: 100, y: 50, width: 24, height: 60, rounded: false,
    hit: { x: 90, y: 50, width: 44, height: 60 }, ...over,
  })

  it('is a plain rectangle where the segment is not the top of its column, square at both ends', () => {
    expect(segmentPath(segment())).toBe('M100 50h24v60h-24Z')
  })

  it('has the 4 pixel radius on its upper corners where it is the top, and a square foot', () => {
    expect(segmentPath(segment({ rounded: true }))).toBe('M100 110V54a4 4 0 0 1 4 -4h16a4 4 0 0 1 4 4V110Z')
  })

  it('never rounds more than it is tall or wide', () => {
    expect(segmentPath(segment({ rounded: true, height: 2 }))).toBe('M100 52V52a2 2 0 0 1 2 -2h20a2 2 0 0 1 2 2V52Z')
    expect(segmentPath(segment({ rounded: true, width: 4 }))).toContain('a2 2')
  })
})

describe('the layout of the graph', () => {
  const size = { width: 600, height: 220 }
  const layout = monthsLayout(THREE, wishesShown(THREE), size)

  it('puts the axis top just above the busiest month, with its ticks as hairline grid lines from the foot to the top', () => {
    expect(layout.ticks.map((tick) => tick.value)).toEqual([0, 100, 200, 300])
    const [foot, , , top] = layout.ticks
    expect(foot.y).toBe(layout.box.bottom)
    expect(top.y).toBe(layout.box.top)
    // The plot has room above for the busiest month's total, and below for the months' names.
    expect(layout.box.top).toBeGreaterThanOrEqual(16)
    expect(layout.box.bottom).toBeLessThanOrEqual(size.height - 18)
    expect(layout.box.right).toBeLessThanOrEqual(size.width)
    expect(layout.box.left).toBeGreaterThan(20) // the width of the axis's numbers
  })

  it('gives each month a slot of the plot, and its column the middle of it', () => {
    const slot = (layout.box.right - layout.box.left) / 3
    expect(layout.columns.map((column) => column.slot.width)).toEqual([slot, slot, slot])
    layout.columns.forEach((column, index) => {
      expect(column.slot.x).toBeCloseTo(layout.box.left + slot * index)
      expect(column.cx).toBeCloseTo(column.slot.x + slot / 2)
    })
  })

  it('draws a column at most 24 pixels wide, and a thinner one in a crowded plot', () => {
    for (const segment of layout.columns.flatMap((column) => column.segments)) {
      expect(segment.width).toBe(MOST_WIDE)
    }
    const crowded = Array.from({ length: 40 }, (_, at) => month(`2025-${String((at % 12) + 1).padStart(2, '0')}`, 10 + at))
    const thin = monthsLayout(crowded, wishesShown(crowded), size).columns.flatMap((column) => column.segments)
    expect(Math.max(...thin.map((segment) => segment.width))).toBeLessThan(MOST_WIDE)
    expect(Math.min(...thin.map((segment) => segment.width))).toBeGreaterThanOrEqual(2)
  })

  it('stacks the wishes from the foot up, a gap of 2 pixels between them, the foot square and the top rounded', () => {
    const [, , october] = layout.columns
    expect(october.segments.map((segment) => segment.wish)).toEqual(['character', 'weapon', 'standard'])
    const [character, weapon, standard] = october.segments
    const scale = (layout.box.bottom - layout.box.top) / 300
    expect(character.y + character.height).toBeCloseTo(layout.box.bottom) // on the baseline
    expect(character.height).toBeCloseTo(240 * scale)
    expect(GAP).toBe(2)
    expect(weapon.y + weapon.height).toBeCloseTo(character.y - GAP)
    expect(weapon.height).toBeCloseTo(40 * scale - GAP)
    expect(standard.y + standard.height).toBeCloseTo(weapon.y - GAP)
    // The stack ends where its total says: the whole axis, for the busiest month.
    expect(standard.y).toBeCloseTo(layout.box.top)
    expect(october.segments.map((segment) => segment.rounded)).toEqual([false, false, true])
  })

  it('leaves a quiet month as a gap, and gives a month with one wish a rounded, standing column', () => {
    expect(layout.columns[1].segments).toEqual([])
    const only = monthsLayout([month('2026-10', 50)], ['character'], size).columns[0].segments
    expect(only).toHaveLength(1)
    expect(only[0].rounded).toBe(true)
    expect(only[0].y + only[0].height).toBeCloseTo(monthsLayout([month('2026-10', 50)], ['character'], size).box.bottom)
  })

  it('draws a segment of one wish in a month of hundreds as thin as it is, but visible', () => {
    const tall = monthsLayout([month('2026-10', 400, 1)], ['character', 'weapon'], size)
    const [, weapon] = tall.columns[0].segments
    expect(weapon.height).toBeGreaterThanOrEqual(1)
  })

  it("carries the busiest month's total over its column, and no other", () => {
    expect(layout.busiest).toBe(2)
    expect(layout.columns[2].top).toBeCloseTo(layout.box.top)
    // The first of two equally busy months.
    const tied = monthsLayout([month('2026-08', 50), month('2026-09', 50)], ['character'], size)
    expect(tied.busiest).toBe(0)
    // No wishes at all: nothing is busiest.
    expect(monthsLayout([month('2026-10', 0)], ['character'], size).busiest).toBeNull()
  })

  it('gives each segment a hit area as wide as its month and as tall as its share, never thinner than 8 pixels', () => {
    const [, , october] = layout.columns
    for (const segment of october.segments) {
      expect(segment.hit.x).toBeCloseTo(october.slot.x)
      expect(segment.hit.width).toBeCloseTo(october.slot.width)
      expect(segment.hit.height).toBeGreaterThanOrEqual(8)
    }
    const [character] = october.segments
    expect(character.hit.y + character.hit.height).toBeCloseTo(layout.box.bottom)
  })

  it('names every month on the axis while there is room, with its short name under its column', () => {
    expect(layout.labels.map((label) => label.text)).toEqual(['Aug', 'Sep', 'Oct'])
    layout.labels.forEach((label, index) => expect(label.x).toBeCloseTo(layout.columns[index].cx))
    expect(layout.labels.every((label) => label.year === null)).toBe(true)
  })

  it('names every other month, or fewer, as they crowd, and always the last', () => {
    const years = Array.from({ length: 30 }, (_, at) => month(`${2024 + Math.floor((at + 3) / 12)}-${String(((at + 3) % 12) + 1).padStart(2, '0')}`, 10))
    const crowded = monthsLayout(years, ['character'], size)
    expect(crowded.labels.length).toBeLessThan(30)
    expect(crowded.labels.length).toBeGreaterThan(5)
    expect(crowded.labels.at(-1)!.index).toBe(29)
    // Two labels never share their room.
    const xs = crowded.labels.map((label) => label.x)
    for (let at = 1; at < xs.length; at += 1) expect(xs[at] - xs[at - 1]).toBeGreaterThanOrEqual(30)
  })

  it('adds the year under the first month named and under each January, once the months span two years', () => {
    const across = [month('2025-11', 5), month('2025-12', 5), month('2026-01', 5), month('2026-02', 5)]
    const labels = monthsLayout(across, ['character'], size).labels
    expect(labels.map((label) => label.year)).toEqual(['2025', null, '2026', null])
    // The room for the year grows the room under the plot.
    expect(monthsLayout(across, ['character'], size).box.bottom).toBeLessThan(layout.box.bottom)
  })

  it('adds the year under the first month named of each year when the months are thinned and no January is named', () => {
    // 26 months from Sep 2024 to Oct 2026, named every other month back from the last: Oct 2024, Dec 2024, Feb 2025 ...
    const long = Array.from({ length: 26 }, (_, at) =>
      month(`${2024 + Math.floor((at + 8) / 12)}-${String(((at + 8) % 12) + 1).padStart(2, '0')}`, 10),
    )
    const labels = monthsLayout(long, ['character'], size).labels
    expect(labels[0].text).toBe('Oct')
    expect(labels.filter((label) => label.year !== null).map((label) => [label.text, label.year])).toEqual([
      ['Oct', '2024'], ['Feb', '2025'], ['Feb', '2026'],
    ])
  })

  it('names no year when the months are all of one', () => {
    const one = [month('2026-04', 5), month('2026-05', 5), month('2026-06', 5)]
    expect(monthsLayout(one, ['character'], size).labels.every((label) => label.year === null)).toBe(true)
  })
})

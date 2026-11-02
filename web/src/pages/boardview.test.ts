import { describe, expect, it, test } from 'vitest'
import type { Widget } from '../types.ts'
import type { WidgetType } from '../widgets/widget.ts'
import {
  addWidget, arrange, columnsFor, columnsUsed, dropCell, firstFree, freeCells, gripSize, moveTo, newWidgetId, type Placed,
  pushDown, removeWidget, resizeTo, rowsFor, setSettings, sizeLabel, sizeTag, sizeWithin, stepWith, withPlaces,
} from './boardview.ts'

const clockType: WidgetType = {
  id: 'clock',
  name: 'Clock',
  about: '',
  sign: 'clock',
  min: { w: 1, h: 1 },
  max: { w: 3, h: 2 },
  start: { w: 2, h: 1 },
  settings: { seconds: false },
  View: () => null,
}
const widget = (id: string, over: Partial<Widget> = {}): Widget => ({ id, type: 'clock', w: 2, h: 1, settings: {}, ...over })
const ids = (widgets: readonly Widget[]) => widgets.map((one) => one.id)

describe("the Board's layout", () => {
  const board = [widget('a'), widget('b'), widget('c')]

  it('adds a widget at the first free place, at the size its type starts at, with its default settings', () => {
    const placed: Placed[] = [{ id: 'a', x: 0, y: 0, w: 2, h: 1 }, { id: 'b', x: 4, y: 0, w: 3, h: 2 }]
    expect(addWidget(board, clockType, 'd', placed, 7).at(-1)).toEqual({
      id: 'd', type: 'clock', w: 2, h: 1, settings: { seconds: false }, x: 2, y: 0,
    })
    expect(addWidget(board, clockType, 'd', placed, 3).at(-1)).toMatchObject({ x: 0, y: 1 }) // no room on the first row
    expect(addWidget([], { ...clockType, start: { w: 3, h: 1 } }, 'd', [], 2).at(-1)).toMatchObject({ x: 0, y: 0, w: 3 })
    expect(board).toHaveLength(3) // the layout given is left as it was
  })

  it('removes and changes the settings of one widget only', () => {
    expect(ids(removeWidget(board, 'b'))).toEqual(['a', 'c'])
    expect(setSettings(board, 'c', { seconds: true }).map((one) => one.settings)).toEqual([{}, {}, { seconds: true }])
  })

  it('keeps a widget of an unknown type and its unknown keys untouched', () => {
    const later = widget('map-1', { type: 'map', w: 6, h: 4, settings: { tab: 'fishing' }, anchor: 'top-right' })
    expect(removeWidget([...board, later], 'a')[2]).toBe(later)
    expect(setSettings([later], 'map-1', { tab: 'teapot' })[0]).toEqual({ ...later, settings: { tab: 'teapot' } })
  })

  it('makes ids of the type that a later id never repeats', () => {
    expect(newWidgetId('clock', 0, 0)).toBe('clock-000')
    expect(newWidgetId('notes', 1_700_000_000_000, 0.5)).toBe(`notes-${(1_700_000_000_000).toString(36)}i0`)
  })

  it('names a size by its cells', () => {
    expect(sizeLabel({ w: 3, h: 2 })).toBe('3 × 2')
  })
})

describe("a widget's size (spec 8.2)", () => {
  it('a size stays within its type and the window', () => {
    const range = { min: { w: 2, h: 1 }, max: { w: 3, h: 2 } }
    expect(sizeWithin(range, { w: 4, h: 3 }, 13)).toEqual({ w: 3, h: 2 })
    expect(sizeWithin(range, { w: 1, h: 1 }, 13)).toEqual({ w: 2, h: 1 })
    expect(sizeWithin({ min: { w: 3, h: 2 }, max: { w: 6, h: 5 } }, { w: 6, h: 5 }, 4)).toEqual({ w: 4, h: 5 })
    expect(sizeWithin(undefined, { w: 7, h: 9 }, 4)).toEqual({ w: 4, h: 8 })
  })

  it('keeps a size that is inside its type and the window as it is, and an unknown type at its own size', () => {
    const range = { min: { w: 2, h: 1 }, max: { w: 6, h: 5 } }
    expect(sizeWithin(range, { w: 4, h: 3 }, 13)).toEqual({ w: 4, h: 3 })
    expect(sizeWithin(range, { w: 5, h: 5 }, 5)).toEqual({ w: 5, h: 5 })
    expect(sizeWithin(undefined, { w: 6, h: 4 }, 13)).toEqual({ w: 6, h: 4 })
    expect(sizeWithin(undefined, { w: 0, h: 0 }, 13)).toEqual({ w: 1, h: 1 }) // never smaller than a cell
  })

  it('is at most as wide as the window even where the type is wider at its smallest', () => {
    expect(sizeWithin({ min: { w: 3, h: 2 }, max: { w: 6, h: 5 } }, { w: 3, h: 2 }, 2)).toEqual({ w: 2, h: 2 })
  })

  it('counts the columns a width holds as cells of 168 pixels with 12-pixel gaps', () => {
    expect(columnsFor(168)).toBe(1)
    expect(columnsFor(347)).toBe(1) // two cells need 348
    expect(columnsFor(348)).toBe(2)
    expect(columnsFor(1250)).toBe(7) // the 1,440-pixel window, beside the rail
    expect(columnsFor(2327)).toBe(12) // thirteen need 2,328
    expect(columnsFor(2328)).toBe(13)
    expect(columnsFor(2370)).toBe(13)
    expect(columnsFor(0)).toBe(1) // never none
  })

  it("counts the rows a height holds as cells of 96 pixels with 12-pixel gaps, as the overlay's display holds them", () => {
    expect(rowsFor(96)).toBe(1)
    expect(rowsFor(203)).toBe(1) // two rows need 204
    expect(rowsFor(204)).toBe(2)
    expect(rowsFor(884)).toBe(8) // a window 900 pixels tall, under the 16 pixels above the grid
    expect(rowsFor(1424)).toBe(13) // the display 1,440 pixels tall
    expect(rowsFor(0)).toBe(1) // never none
  })
})

describe("the widgets' places (look pass spec 10)", () => {
  const range = () => undefined
  const w = (id: string, ww: number, hh: number, place?: { x: number; y: number }): Widget =>
    ({ id, type: 'x', w: ww, h: hh, settings: {}, ...place })
  const at = (placed: readonly Placed[]) => placed.map(({ id, x, y, w: ww, h: hh }) => `${id} ${x},${y} ${ww}×${hh}`)
  const clockRange = { min: { w: 1, h: 1 }, max: { w: 3, h: 2 } }
  const names: Record<string, string> = { r: 'Resin', c: 'Clock', d: 'Daily notes', t: 'Timers' }
  const nameOf = (id: string) => names[id]

  test('a layout without places is arranged as the grid packed it', () => {
    // dense: c (3 × 1) fills the gap right of a
    expect(arrange([w('a', 4, 1), w('b', 4, 1), w('c', 3, 1)], 7, range).map(({ id, x, y }) => [id, x, y]))
      .toEqual([['a', 0, 0], ['c', 4, 0], ['b', 0, 1]])
  })
  test('saved places stay, gaps included', () => {
    expect(arrange([w('a', 2, 1, { x: 5, y: 3 })], 13, range)[0]).toMatchObject({ x: 5, y: 3 })
  })
  test('a widget too far right for the window moves below, and its saved place is kept', () => {
    const widgets = [w('a', 4, 2, { x: 0, y: 0 }), w('b', 2, 1, { x: 10, y: 0 })]
    expect(arrange(widgets, 7, range)[1]).toMatchObject({ id: 'b', x: 4, y: 0 })
    expect(withPlaces(widgets, arrange(widgets, 13, range))[1]).toMatchObject({ x: 10, y: 0 })
  })
  test('a widget dropped on others pushes them down, in a cascade, and moving back puts them back', () => {
    const start = arrange([w('a', 2, 1, { x: 0, y: 0 }), w('b', 2, 2, { x: 2, y: 0 }), w('c', 2, 1, { x: 2, y: 2 })], 7, range)
    const moved = moveTo(start, 'a', 2, 0, 7)
    expect(moved.find((p) => p.id === 'b')).toMatchObject({ x: 2, y: 1 })
    expect(moved.find((p) => p.id === 'c')).toMatchObject({ x: 2, y: 3 })
    expect(moveTo(start, 'a', 0, 0, 7)).toEqual(start)
  })
  test('the keyboard resizes within the range and says so', () => {
    const start = arrange([w('r', 3, 2, { x: 0, y: 0 })], 7, () => ({ min: { w: 1, h: 1 }, max: { w: 3, h: 2 } }))
    expect(stepWith(start, 'r', 'ArrowRight', true, 'Resin', { min: { w: 1, h: 1 }, max: { w: 3, h: 2 } }, 7).said)
      .toBe('Resin is at its largest size.')
  })

  test('the first free place is found row by row and left to right, where the whole size fits', () => {
    const placed = [{ x: 0, y: 0, w: 2, h: 1 }, { x: 3, y: 0, w: 4, h: 2 }]
    expect(firstFree(placed, 1, 1, 7)).toEqual({ x: 2, y: 0 })
    expect(firstFree(placed, 2, 1, 7)).toEqual({ x: 0, y: 1 }) // the gap at x 2 is one cell wide
    expect(firstFree(placed, 3, 2, 7)).toEqual({ x: 0, y: 1 })
    expect(firstFree(placed, 4, 1, 7)).toEqual({ x: 0, y: 2 }) // row 1 has only 3 cells free
    expect(firstFree([], 3, 1, 7)).toEqual({ x: 0, y: 0 })
  })

  test('a saved place that overlaps one placed already goes to the first free place, before the widgets without one', () => {
    // In reading order of the places: c at (0,0) stays; b at (1,0) overlaps it; a at (0,1) stays.
    const widgets = [w('new', 2, 1), w('b', 2, 2, { x: 1, y: 0 }), w('a', 2, 1, { x: 0, y: 1 }), w('c', 2, 1, { x: 0, y: 0 })]
    expect(at(arrange(widgets, 4, range))).toEqual(['c 0,0 2×1', 'b 2,0 2×2', 'a 0,1 2×1', 'new 0,2 2×1'])
  })

  test("a widget's size is its saved size within its type's range and the window's columns", () => {
    const placed = arrange([w('c', 4, 3, { x: 0, y: 0 }), w('m', 9, 2)], 7, (type) => (type === 'x' ? undefined : clockRange))
    expect(at(placed)).toEqual(['c 0,0 4×3', 'm 0,3 7×2']) // a type it does not know keeps its size, at most 7 wide
    const clocks = [{ ...w('c', 4, 3, { x: 0, y: 0 }), type: 'clock' }]
    expect(at(arrange(clocks, 7, (type) => (type === 'clock' ? clockRange : undefined)))).toEqual(['c 0,0 3×2'])
  })

  test('a move stays inside the columns and at row 0 or below, and nothing moves up or sideways', () => {
    const start = arrange([w('a', 2, 1, { x: 0, y: 0 }), w('b', 3, 1, { x: 0, y: 3 }), w('c', 1, 1, { x: 6, y: 0 })], 7, range)
    expect(at(moveTo(start, 'a', 9, -2, 7))).toEqual(['a 5,0 2×1', 'c 6,1 1×1', 'b 0,3 3×1'])
    expect(at(moveTo(start, 'b', 0, 0, 7))).toEqual(['b 0,0 3×1', 'c 6,0 1×1', 'a 0,1 2×1'])
    expect(moveTo(start, 'nobody', 1, 1, 7)).toEqual(start)
  })

  test('widgets pushed down keep their order from top to bottom', () => {
    const start = arrange([w('e', 1, 1, { x: 1, y: 0 }), w('l', 2, 1, { x: 0, y: 1 }), w('m', 2, 2, { x: 4, y: 0 })], 7, range)
    expect(at(pushDown(start, { id: 'm', x: 0, y: 0, w: 2, h: 2 }))).toEqual(['m 0,0 2×2', 'e 1,2 1×1', 'l 0,3 2×1'])
  })

  test('a resize stays within its range and the columns, pushes down what it runs into, and shrinking frees the room', () => {
    const start = arrange([w('d', 2, 2, { x: 2, y: 0 }), w('c', 1, 1, { x: 4, y: 0 }), w('r', 1, 1, { x: 6, y: 0 })], 7, range)
    const range23 = { min: { w: 2, h: 2 }, max: { w: 4, h: 3 } }
    const grown = resizeTo(start, 'd', { w: 3, h: 2 }, range23, 7)
    expect(at(grown)).toEqual(['d 2,0 3×2', 'r 6,0 1×1', 'c 4,2 1×1'])
    expect(at(resizeTo(grown, 'd', { w: 2, h: 2 }, range23, 7))).toEqual(['d 2,0 2×2', 'r 6,0 1×1', 'c 4,2 1×1'])
    expect(at(resizeTo(start, 'd', { w: 9, h: 9 }, range23, 7))).toEqual(['d 2,0 4×3', 'r 6,0 1×1', 'c 4,3 1×1'])
    expect(at(resizeTo(start, 'd', { w: 1, h: 1 }, range23, 7))).toEqual(['d 2,0 2×2', 'c 4,0 1×1', 'r 6,0 1×1'])
    expect(at(resizeTo(start, 'r', { w: 3, h: 1 }, clockRange, 7))).toEqual(at(start)) // at the right edge already
    expect(resizeTo(start, 'd', { w: 3, h: 2 }, undefined, 7)).toEqual(start) // a type it does not know keeps its size
  })

  test('the arrow keys move a widget one cell and say where, and say which widgets moved down', () => {
    const start = arrange([w('r', 2, 1, { x: 2, y: 0 }), w('c', 1, 1, { x: 3, y: 1 }), w('d', 2, 2, { x: 2, y: 2 })], 7, range)
    expect(stepWith(start, 'r', 'ArrowRight', false, 'Resin', clockRange, 7, nameOf).said).toBe('Resin, column 4, row 1.')
    const down = stepWith(start, 'r', 'ArrowDown', false, 'Resin', clockRange, 7, nameOf)
    expect(at(down.placed)).toEqual(['r 2,1 2×1', 'c 3,2 1×1', 'd 2,3 2×2'])
    expect(down.said).toBe('Resin, column 3, row 2. Clock and Daily notes moved down.')
    const three = arrange([w('t', 3, 1, { x: 0, y: 3 }), w('c', 1, 1, { x: 0, y: 1 }), w('d', 1, 1, { x: 1, y: 1 }), w('r', 1, 1, { x: 2, y: 1 })], 7, range)
    expect(stepWith(three, 't', 'ArrowUp', false, 'Timers', undefined, 7, nameOf).said).toBe('Timers, column 1, row 3.')
    expect(stepWith(moveTo(three, 't', 0, 2, 7), 't', 'ArrowUp', false, 'Timers', undefined, 7, nameOf).said)
      .toBe('Timers, column 1, row 2. Clock, Daily notes and Resin moved down.')
  })

  test('the arrow keys stop at the left and right edges and the top, and say so', () => {
    const start = arrange([w('r', 2, 1, { x: 0, y: 0 }), w('c', 1, 1, { x: 6, y: 1 })], 7, range)
    expect(stepWith(start, 'r', 'ArrowLeft', false, 'Resin', clockRange, 7)).toEqual({ placed: start, said: 'Resin is at the left edge.' })
    expect(stepWith(start, 'r', 'ArrowUp', false, 'Resin', clockRange, 7).said).toBe('Resin is at the top.')
    expect(stepWith(start, 'c', 'ArrowRight', false, 'Clock', clockRange, 7).said).toBe('Clock is at the right edge.')
    expect(stepWith(start, 'c', 'ArrowLeft', false, 'Clock', clockRange, 7).said).toBe('Clock, column 6, row 2.')
  })

  test('Shift with the arrow keys resizes a cell at a time within the range, and says the size or the limit', () => {
    const start = arrange([w('r', 2, 1, { x: 0, y: 0 }), w('c', 1, 1, { x: 2, y: 0 }), w('e', 1, 1, { x: 6, y: 0 })], 7, range)
    const wider = stepWith(start, 'r', 'ArrowRight', true, 'Resin', clockRange, 7, nameOf)
    expect(wider.said).toBe('Resin, 3 by 1. Clock moved down.')
    expect(at(wider.placed)).toEqual(['r 0,0 3×1', 'e 6,0 1×1', 'c 2,1 1×1'])
    expect(stepWith(start, 'r', 'ArrowDown', true, 'Resin', clockRange, 7).said).toBe('Resin, 2 by 2.')
    expect(stepWith(start, 'r', 'ArrowLeft', true, 'Resin', clockRange, 7).said).toBe('Resin, 1 by 1.')
    expect(stepWith(start, 'r', 'ArrowUp', true, 'Resin', clockRange, 7).said).toBe('Resin is at its smallest size.')
    expect(stepWith(start, 'e', 'ArrowRight', true, 'Clock', clockRange, 7).said).toBe('Clock is at the right edge.')
    expect(stepWith(start, 'e', 'ArrowLeft', true, 'Clock', clockRange, 7)).toEqual({ placed: start, said: 'Clock is at its smallest size.' })
  })

  test('the places go into the widgets, which keep every other key and their order', () => {
    const later = { ...w('m', 6, 4), type: 'map', anchor: 'top-right', settings: { tab: 'fishing' } }
    const widgets = [later, w('a', 2, 1, { x: 9, y: 9 })]
    const placed: Placed[] = [{ id: 'a', x: 0, y: 0, w: 3, h: 1 }, { id: 'm', x: 0, y: 1, w: 6, h: 4 }]
    expect(withPlaces(widgets, placed)).toEqual([{ ...later, x: 0, y: 1 }, { ...widgets[1], x: 0, y: 0, w: 3 }])
    expect(withPlaces(widgets, [])).toEqual(widgets)
    expect(widgets[1]).toMatchObject({ x: 9, y: 9, w: 2 }) // the widgets given are left as they were
  })

  test("Edit's empty cells are every cell no widget takes, across the columns and down to two rows below the lowest", () => {
    const placed: Placed[] = [{ id: 'a', x: 0, y: 0, w: 2, h: 2 }, { id: 'b', x: 3, y: 1, w: 1, h: 1 }]
    const cells = freeCells(placed, 4)
    expect(cells).toHaveLength(4 * 4 - 5) // rows 0 to 3: the lowest widget ends at row 1
    expect(cells.slice(0, 5)).toEqual([{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }])
    expect(cells.at(-1)).toEqual({ x: 3, y: 3 })
    expect(freeCells([], 2)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }])
  })

  test("a drag lands on the cell nearest the widget's top-left corner, wherever the pointer took it", () => {
    expect(dropCell({ x: 2, y: 1 }, 0, 0)).toEqual({ x: 2, y: 1 })
    expect(dropCell({ x: 2, y: 1 }, 89, 53)).toEqual({ x: 2, y: 1 }) // under half a cell: it stays
    expect(dropCell({ x: 2, y: 1 }, 91, 55)).toEqual({ x: 3, y: 2 })
    expect(dropCell({ x: 2, y: 1 }, -380, -230)).toEqual({ x: 0, y: -1 }) // moveTo keeps it inside the Board
  })

  test('a grip asks for a cell more or less for each cell the pointer went, in its own directions', () => {
    const size = { w: 2, h: 1 }
    expect(gripSize(size, 'e', 200, 300)).toEqual({ w: 3, h: 1 })
    expect(gripSize(size, 's', 200, 300)).toEqual({ w: 2, h: 4 })
    expect(gripSize(size, 'se', 360, 108)).toEqual({ w: 4, h: 2 })
    expect(gripSize(size, 'se', -400, -60)).toEqual({ w: 0, h: 0 }) // resizeTo keeps it within the type
  })

  test('the size tag says the size, and where the pointer asks for more or less than the type allows, the limit', () => {
    expect(sizeTag({ w: 3, h: 2 }, { w: 4, h: 3 }, clockRange, 'se')).toBe('3 × 2, largest')
    expect(sizeTag({ w: 3, h: 1 }, { w: 5, h: 1 }, clockRange, 'e')).toBe('3 × 1, largest')
    expect(sizeTag({ w: 1, h: 1 }, { w: 0, h: 1 }, clockRange, 'e')).toBe('1 × 1, smallest')
    expect(sizeTag({ w: 2, h: 1 }, { w: 2, h: 1 }, clockRange, 'se')).toBe('2 × 1') // a corner just taken
    expect(sizeTag({ w: 2, h: 1 }, { w: 2, h: 0 }, clockRange, 'e')).toBe('2 × 1') // the right edge changes no height
    // Held by the window's columns, not by the type: no limit of the type to name.
    expect(sizeTag({ w: 2, h: 1 }, { w: 3, h: 1 }, { min: { w: 1, h: 1 }, max: { w: 6, h: 6 } }, 'e')).toBe('2 × 1')
  })

  test('the size tag names the limit as soon as every side its grip changes is at it', () => {
    expect(sizeTag({ w: 3, h: 2 }, { w: 3, h: 2 }, clockRange, 'se')).toBe('3 × 2, largest') // a corner dragged to exactly it
    expect(sizeTag({ w: 3, h: 1 }, { w: 3, h: 1 }, clockRange, 'e')).toBe('3 × 1, largest') // the right edge: the width
    expect(sizeTag({ w: 2, h: 2 }, { w: 2, h: 2 }, clockRange, 's')).toBe('2 × 2, largest') // the bottom edge: the height
    expect(sizeTag({ w: 1, h: 1 }, { w: 1, h: 1 }, clockRange, 'se')).toBe('1 × 1, smallest')
    expect(sizeTag({ w: 1, h: 2 }, { w: 1, h: 2 }, clockRange, 'e')).toBe('1 × 2, smallest')
    // A corner with one side at a limit and the other not names none, until the pointer asks past that side.
    expect(sizeTag({ w: 3, h: 1 }, { w: 3, h: 1 }, clockRange, 'se')).toBe('3 × 1')
    expect(sizeTag({ w: 1, h: 2 }, { w: 1, h: 2 }, clockRange, 'se')).toBe('1 × 2')
    expect(sizeTag({ w: 3, h: 1 }, { w: 4, h: 1 }, clockRange, 'se')).toBe('3 × 1, largest')
  })

  test('the columns an arrangement uses are the furthest right a saved place reaches', () => {
    expect(columnsUsed([w('a', 2, 1, { x: 11, y: 0 }), w('b', 4, 1, { x: 3, y: 2 }), w('c', 9, 1)])).toBe(13)
    expect(columnsUsed([w('a', 2, 1), w('b', 4, 1)])).toBe(0)
    expect(columnsUsed([])).toBe(0)
  })

  /*
   * A place with a last row (plan 2A-4): the overlay keeps its widgets on its display, where the Board grows downward
   * without end. Here it has eight rows, 0 to 7.
   */

  test('a move stays inside the rows as it stays inside the columns, and the Board has no last row', () => {
    const start = arrange([w('a', 2, 2, { x: 0, y: 0 })], 7, range)
    expect(at(moveTo(start, 'a', 0, 9, 7, 8))).toEqual(['a 0,6 2×2']) // its bottom on the last row
    expect(at(moveTo(start, 'a', 0, 9, 7))).toEqual(['a 0,9 2×2'])
  })

  test('a move that would push a widget below the last row is refused', () => {
    const start = arrange([w('a', 2, 2, { x: 0, y: 0 }), w('b', 2, 2, { x: 0, y: 6 })], 7, range)
    expect(moveTo(start, 'a', 0, 5, 7, 8)).toEqual(start) // b would go to rows 7 and 8
    expect(at(moveTo(start, 'a', 0, 3, 7, 8))).toEqual(['a 0,3 2×2', 'b 0,6 2×2'])
    expect(at(moveTo(start, 'a', 0, 5, 7))).toEqual(['a 0,5 2×2', 'b 0,7 2×2']) // the Board pushes on
  })

  test('a resize stays inside the rows, and one that would push a widget below the last row is refused', () => {
    const start = arrange([w('d', 2, 2, { x: 0, y: 5 }), w('e', 2, 1, { x: 3, y: 7 })], 7, range)
    const big = { min: { w: 1, h: 1 }, max: { w: 6, h: 6 } }
    expect(at(resizeTo(start, 'd', { w: 2, h: 5 }, big, 7, 8))).toEqual(['d 0,5 2×3', 'e 3,7 2×1']) // to the last row
    expect(resizeTo(start, 'd', { w: 4, h: 3 }, big, 7, 8)).toEqual(start) // e, on the last row, would go below it
    expect(at(resizeTo(start, 'd', { w: 2, h: 5 }, big, 7))).toEqual(['d 0,5 2×5', 'e 3,7 2×1'])
  })

  test('the arrow keys stop at the last row and say so, and say when there is no room below', () => {
    const start = arrange([w('c', 2, 1, { x: 0, y: 7 }), w('r', 2, 1, { x: 2, y: 6 }), w('t', 2, 1, { x: 2, y: 7 })], 7, range)
    expect(stepWith(start, 'c', 'ArrowDown', false, 'Clock', clockRange, 7, nameOf, 8))
      .toEqual({ placed: start, said: 'Clock is at the bottom.' })
    expect(stepWith(start, 'c', 'ArrowDown', true, 'Clock', clockRange, 7, nameOf, 8))
      .toEqual({ placed: start, said: 'Clock is at the bottom.' })
    // The Clock onto the Timers' cell, and Resin onto the Timers, would push the Timers below the last row.
    expect(stepWith(start, 'c', 'ArrowRight', false, 'Clock', clockRange, 7, nameOf, 8))
      .toEqual({ placed: start, said: 'There is no room below.' })
    expect(stepWith(start, 'r', 'ArrowDown', false, 'Resin', clockRange, 7, nameOf, 8).said).toBe('There is no room below.')
    expect(stepWith(start, 'r', 'ArrowDown', true, 'Resin', clockRange, 7, nameOf, 8).said).toBe('There is no room below.')
    // The Board goes on down.
    expect(stepWith(start, 'c', 'ArrowDown', false, 'Clock', clockRange, 7, nameOf).said).toBe('Clock, column 1, row 9.')
  })

  test('a widget below the last row, as one saved on a taller display, steps back onto the display', () => {
    // Two rows past the last row: up brings it onto the last row, where a drag would put it.
    const below = arrange([w('c', 2, 1, { x: 0, y: 9 })], 7, range)
    const up = stepWith(below, 'c', 'ArrowUp', false, 'Clock', clockRange, 7, nameOf, 8)
    expect(up.said).toBe('Clock, column 1, row 8.')
    expect(at(up.placed)).toEqual(['c 0,7 2×1'])
    expect(stepWith(below, 'c', 'ArrowDown', false, 'Clock', clockRange, 7, nameOf, 8).said).toBe('Clock is at the bottom.')
    // One row past: a step right lands it on the display.
    const right = stepWith(arrange([w('c', 2, 1, { x: 0, y: 8 })], 7, range), 'c', 'ArrowRight', false, 'Clock', clockRange, 7, nameOf, 8)
    expect(right.said).toBe('Clock, column 2, row 8.')
    expect(at(right.placed)).toEqual(['c 1,7 2×1'])
    // A widget two rows tall on the last row reaches past it: a step right, with nothing in the way, lifts it on.
    const tall = stepWith(arrange([w('t', 2, 2, { x: 0, y: 7 })], 7, range), 't', 'ArrowRight', false, 'Timers', undefined, 7, nameOf, 8)
    expect(tall.said).toBe('Timers, column 2, row 7.')
    expect(at(tall.placed)).toEqual(['t 1,6 2×2'])
  })

  test("Edit's empty cells fill the rows a place with a last row holds, and go no further", () => {
    const placed: Placed[] = [{ id: 'a', x: 0, y: 0, w: 2, h: 2 }]
    const cells = freeCells(placed, 3, 4)
    expect(cells).toHaveLength(3 * 4 - 4)
    expect(cells.at(-1)).toEqual({ x: 2, y: 3 })
    expect(freeCells(placed, 3, 1)).toEqual([{ x: 2, y: 0 }]) // a widget taller than the rows: row 0 alone
  })

  /*
   * The overlay at a larger size, or on a smaller display, holds fewer cells than its layout was made for (Task 14): a
   * widget whose saved place would put it below the last row shows at the first free place on the display, as a widget
   * past the last column does, and keeps its saved place until Edit's Done saves the place shown.
   */

  test('a widget saved below the last row shows at the first free place on the display, as one past the last column', () => {
    const widgets = [w('a', 2, 2, { x: 0, y: 0 }), w('low', 2, 1, { x: 0, y: 10 }), w('wide', 2, 1, { x: 9, y: 0 })]
    // Seven columns and eight rows: low is below the last row, and wide past the last column. Both go to the first free
    // places, in reading order of their saved places.
    expect(at(arrange(widgets, 7, range, 8))).toEqual(['a 0,0 2×2', 'wide 2,0 2×1', 'low 4,0 2×1'])
    // The layout keeps its saved places: Edit starts from the places shown, and its Done saves them.
    expect(widgets.map(({ x, y }) => [x, y])).toEqual([[0, 0], [0, 10], [9, 0]])
    // The Board has no last row: low stays at row 10, as it always did.
    expect(at(arrange(widgets, 7, range))).toEqual(['a 0,0 2×2', 'wide 2,0 2×1', 'low 0,10 2×1'])
    expect(arrange(widgets, 7, range, Infinity)).toEqual(arrange(widgets, 7, range))
  })

  test('a widget that reaches past the last row moves too, and only one with no room on the display stays below it', () => {
    // Its top on the display and its bottom below it: it goes to the first place that holds all of it.
    expect(at(arrange([w('a', 7, 2, { x: 0, y: 0 }), w('t', 2, 3, { x: 0, y: 6 })], 7, range, 8))).toEqual(['a 0,0 7×2', 't 0,2 2×3'])
    // A display full to its last row: the first free place is below it.
    expect(at(arrange([w('a', 7, 8, { x: 0, y: 0 }), w('t', 2, 1, { x: 3, y: 10 })], 7, range, 8))).toEqual(['a 0,0 7×8', 't 0,8 2×1'])
  })

  test('a widget taller than the display keeps its place on row 0, where a step or a drag puts it', () => {
    // Notes five rows tall on a display of four, as at 200% on 1,080 pixels: row 0 is the only row it has, so a
    // saved place there fits, and a step to the right is where it then shows.
    const widgets = [w('n', 3, 5, { x: 0, y: 0 }), w('c', 1, 1, { x: 4, y: 3 })]
    const shown = arrange(widgets, 5, range, 4)
    expect(at(shown)).toEqual(['n 0,0 3×5', 'c 4,3 1×1'])
    const step = stepWith(shown, 'n', 'ArrowRight', false, 'Notes', undefined, 5, nameOf, 4)
    expect(step.said).toBe('Notes, column 2, row 1.')
    expect(at(arrange(withPlaces(widgets, step.placed), 5, range, 4))).toEqual(['n 1,0 3×5', 'c 4,3 1×1'])
  })
})

import type { Place, Widget } from '../types.ts'
import type { Size, SizeRange, WidgetType } from '../widgets/widget.ts'

/*
 * The Board's layout, as Edit changes it (spec 13.2). Each function leaves the layout it is given as it was, and keeps
 * every widget it does not change as it is: one of a type this version does not know, with its keys, included.
 */

/** The core keeps at most this many cells a side (layouts.py), which holds a type this version does not know. */
const MAX_CELLS = 8
/**
 * The grid of the Board and the overlay, as board.css and gridColumns draw it: cells 96 pixels tall with gaps of 12, in
 * columns 168 pixels wide on the overlay and at least that on the Board, whose columns share its width (columnWidth).
 */
const CELL_WIDTH = 168
const CELL_HEIGHT = 96
const GAP = 12

/**
 * A widget of this type at the end of the list, at the size it is added at and with its default settings, placed at the
 * first free place of the arrangement `placed` in a window of `columns` columns (spec 10.4). It is placed by the size it
 * shows at there, which a window narrower than its size cuts.
 */
export function addWidget(
  widgets: readonly Widget[],
  type: WidgetType,
  id: string,
  placed: readonly Rect[],
  columns: number,
): Widget[] {
  const shown = sizeWithin(type, type.start, columns)
  const { x, y } = firstFree(placed, shown.w, shown.h, columns)
  return [...widgets, { id, type: type.id, w: type.start.w, h: type.start.h, settings: { ...type.settings }, x, y }]
}

export function removeWidget(widgets: readonly Widget[], id: string): Widget[] {
  return widgets.filter((one) => one.id !== id)
}

export function setSettings(widgets: readonly Widget[], id: string, settings: Record<string, unknown>): Widget[] {
  return widgets.map((one) => (one.id === id ? { ...one, settings } : one))
}

/**
 * An id for a new widget of a type, from the time and a random number, which a later widget never repeats: a widget's
 * own data, such as a note, is kept by its id.
 */
export function newWidgetId(type: string, now: number, random: number): string {
  return `${type}-${now.toString(36)}${Math.floor(random * 1296).toString(36).padStart(2, '0')}`
}

/** "3 × 2" */
export function sizeLabel(size: Size): string {
  return `${size.w} × ${size.h}`
}

/**
 * The size a widget shows at (look pass spec 8.2): its saved size within its type's range, and at most `columns` wide,
 * as a window with fewer columns shows it (spec 10.3). The window comes first: a type wider at its smallest than the
 * window is the window's width. A type this version does not know keeps its saved size, at most `columns` wide and
 * 8 tall. A saved size is no change: Done saves the size a widget shows at in Edit (withPlaces).
 */
export function sizeWithin(range: SizeRange | undefined, size: Size, columns: number): Size {
  const between = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)
  const w = range === undefined ? size.w : between(size.w, range.min.w, range.max.w)
  const h = range === undefined ? Math.min(size.h, MAX_CELLS) : between(size.h, range.min.h, range.max.h)
  return { w: Math.max(1, Math.min(w, columns)), h: Math.max(1, h) }
}

/**
 * How many columns a place `width` pixels wide has: as many cells of 168 pixels with 12-pixel gaps as fit, at least one.
 * On the Board they then share what is left over (columnWidth); on the overlay it stays at the right.
 */
export function columnsFor(width: number): number {
  return Math.max(1, Math.floor((width + GAP) / (CELL_WIDTH + GAP)))
}

/**
 * How wide each column of a Board `width` pixels wide is: its `columns`, as many as columnsFor gives unless the count it
 * is drawn with is given, share the width, the gaps aside, so that the last column ends at the Board's right edge, where
 * the top bar ends. A wider window shows more columns, and what is left over, less than one more column, goes to the
 * columns: each is at least 168 pixels wide, and less than 168 + 180 / columns.
 */
export function columnWidth(width: number, columns = columnsFor(width)): number {
  return (width - (columns - 1) * GAP) / columns
}

/** How far apart neighbouring cells are, across and down: a column's width and a row's height, each with its gap. */
export type Pitch = { x: number; y: number }

/** The overlay's cells (stage 2A spec 14): 168 pixels wide and 96 tall, with gaps of 12, however wide the overlay is. */
export const FIXED_PITCH: Pitch = { x: CELL_WIDTH + GAP, y: CELL_HEIGHT + GAP }

/** How far apart the cells of a Board `width` pixels wide are: its columns share its width (columnWidth), and rows are 96. */
export function boardPitch(width: number, columns = columnsFor(width)): Pitch {
  return { x: columnWidth(width, columns) + GAP, y: CELL_HEIGHT + GAP }
}

/**
 * A place's columns, as its grid draws them (grid-template-columns): the Board's share its width, so they fill it to
 * its right edge, and the overlay's are 168 pixels each, its widgets the same size on any display (spec 14).
 */
export function gridColumns(place: Place, columns: number): string {
  return place === 'board' ? `repeat(${columns}, minmax(0, 1fr))` : `repeat(${columns}, ${CELL_WIDTH}px)`
}

/**
 * How far apart a place's cells are, when its grid is `width` pixels wide and drawn with `columns` columns: what a drag
 * or a grip turns the pointer's pixels into cells with (dropCell, gripSize).
 */
export function pitchOf(place: Place, width: number, columns: number): Pitch {
  return place === 'board' ? boardPitch(width, columns) : FIXED_PITCH
}

/**
 * How many rows a place `height` pixels tall holds, for a place with a last row: as many cells of 96 pixels with
 * 12-pixel gaps as fit, at least one. The overlay keeps its widgets on its display (plan 2A-4); the Board has no last
 * row.
 */
export function rowsFor(height: number): number {
  return Math.max(1, Math.floor((height + GAP) / (CELL_HEIGHT + GAP)))
}

/*
 * Places (look pass spec 10). A widget keeps its place as `x` (its column) and `y` (its row), whole numbers from 0,
 * beside its size. The Board works out where each widget shows for the columns its window has (arrange), and Edit
 * changes that arrangement, which Done saves into the widgets (withPlaces). A move or a resize is always worked out
 * from the arrangement it starts from, so going back puts every widget back.
 */

/** Cells: the column and the row of the top-left one, from 0, and how many across and down. */
export type Rect = { x: number; y: number; w: number; h: number }
/** A widget where the Board shows it. */
export type Placed = Rect & { id: string }
/** A type's smallest and largest size. */
export type Range = SizeRange
/** The keys that move a widget, and resize it with Shift. */
export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
/** A widget's grips in Edit: its right edge, its bottom edge and its bottom-right corner (spec 10.6). */
export type Grip = 'e' | 's' | 'se'

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Reading order: by row, then by column. */
const reading = (a: { x: number; y: number }, b: { x: number; y: number }) => a.y - b.y || a.x - b.x

/** The first place, row by row and left to right, where `w` by `h` cells overlap none of `placed`. */
export function firstFree(placed: readonly Rect[], w: number, h: number, columns: number): { x: number; y: number } {
  const last = Math.max(0, columns - w)
  // Below every widget there is room, so this ends.
  for (let y = 0; ; y += 1) {
    for (let x = 0; x <= last; x += 1) {
      const cells = { x, y, w, h }
      if (!placed.some((one) => overlap(one, cells))) return { x, y }
    }
  }
}

/** A widget's saved place, or null when it has none: both numbers, whole and from 0. */
function savedPlace(widget: Widget): { x: number; y: number } | null {
  const { x, y } = widget
  const whole = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0
  return whole(x) && whole(y) ? { x, y } : null
}

/**
 * Where each widget shows in a window of `columns` columns (spec 10.2), in reading order. Its size is its saved size
 * within its type's range and the columns. The widgets with a saved place that fits the window go there, taken in
 * reading order of their places; one whose place overlaps a widget placed already loses it. Then every widget without
 * a place goes to the first free place: those that lost theirs in reading order of it, and those that never had one
 * in the list's order. So a layout saved before places shows as the grid's dense flow packed it.
 *
 * On a place with a last row, `rows` of them, a saved place that would put a widget below it does not fit either (Task
 * 14): the overlay at a larger size, or on a smaller display, shows the widget at the first free place, which is on the
 * display while one there holds it. The widget keeps its saved place until Edit's Done saves the place shown.
 */
export function arrange(
  widgets: readonly Widget[],
  columns: number,
  rangeOf: (type: string) => Range | undefined,
  rows = Infinity,
): Placed[] {
  const sized = widgets.map((widget) => ({
    id: widget.id,
    size: sizeWithin(rangeOf(widget.type), widget, columns),
    saved: savedPlace(widget),
  }))
  const placed: Placed[] = []
  const lost: typeof sized = []
  const withPlaces = sized.filter((one) => one.saved !== null).sort((a, b) => reading(a.saved!, b.saved!))
  for (const one of withPlaces) {
    const cells = { id: one.id, ...one.saved!, ...one.size }
    // A widget taller than the display has row 0 alone, where moveTo keeps it: a place there fits.
    const fits = cells.x + cells.w <= columns && cells.y + Math.min(cells.h, rows) <= rows
    if (fits && !placed.some((other) => overlap(other, cells))) placed.push(cells)
    else lost.push(one)
  }
  for (const one of [...lost, ...sized.filter((one) => one.saved === null)]) {
    placed.push({ id: one.id, ...firstFree(placed, one.size.w, one.size.h, columns), ...one.size })
  }
  return placed.sort(reading)
}

/**
 * The arrangement with `moved` at its cells (spec 10.5): each widget it overlaps goes down to just below it, and each
 * widget that one lands on goes below that one, and so on. Nothing moves up or sideways. The others are taken in
 * reading order, so widgets pushed down keep their order from top to bottom. In reading order.
 */
export function pushDown(placed: readonly Placed[], moved: Placed): Placed[] {
  const settled: Placed[] = [moved]
  for (const one of placed.filter((other) => other.id !== moved.id).sort(reading)) {
    let y = one.y
    for (;;) {
      const under = settled.filter((other) => overlap(other, { ...one, y }))
      if (under.length === 0) break
      y = Math.max(...under.map((other) => other.y + other.h))
    }
    settled.push(y === one.y ? one : { ...one, y })
  }
  return settled.sort(reading)
}

/**
 * Whether an arrangement keeps on a place's `rows` every widget it took lower than at `start`: none goes down past the
 * last row. A widget that was below it already, as on a display smaller than the one it was saved on, may stay there.
 */
function withinRows(start: readonly Placed[], placed: readonly Placed[], rows: number): boolean {
  const bottoms = new Map(start.map((one) => [one.id, one.y + one.h]))
  return placed.every((one) => one.y + one.h <= rows || one.y + one.h <= (bottoms.get(one.id) ?? 0))
}

/**
 * The arrangement with a widget moved to a cell, kept inside the columns, at row 0 or below and, on a place with
 * `rows`, on its last row or above, and others pushed down. A move that would push a widget below the last row leaves
 * the arrangement as it was.
 */
export function moveTo(
  start: readonly Placed[],
  id: string,
  x: number,
  y: number,
  columns: number,
  rows = Infinity,
): Placed[] {
  const moving = start.find((one) => one.id === id)
  if (moving === undefined) return [...start]
  const column = Math.min(Math.max(0, x), Math.max(0, columns - moving.w))
  const placed = pushDown(start, { ...moving, x: column, y: Math.max(0, Math.min(y, rows - moving.h)) })
  return withinRows(start, placed, rows) ? placed : [...start]
}

/**
 * The arrangement with a widget at a size held within its type's range, inside the columns and, on a place with `rows`,
 * above its last row, and the widgets that the new size runs into pushed down (spec 10.6). Shrinking leaves the room
 * free. A type this version does not know keeps its size, and so does a widget whose new size would push another below
 * the last row.
 */
export function resizeTo(
  start: readonly Placed[],
  id: string,
  size: Size,
  range: Range | undefined,
  columns: number,
  rows = Infinity,
): Placed[] {
  const resizing = start.find((one) => one.id === id)
  if (resizing === undefined || range === undefined) return [...start]
  const within = sizeWithin(range, size, columns - resizing.x)
  // No taller than the rows from its top down allow, unless it was taller already.
  const h = Math.min(within.h, Math.max(rows - resizing.y, resizing.h))
  const placed = pushDown(start, { ...resizing, ...within, h })
  return withinRows(start, placed, rows) ? placed : [...start]
}

const STEPS: Record<Arrow, { dx: number; dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
}

/** "Clock moved down.", "Daily notes and Clock moved down.", or "" when no widget but `id` went down. */
function movedDown(start: readonly Placed[], placed: readonly Placed[], id: string, nameOf: (id: string) => string): string {
  const before = new Map(start.map((one) => [one.id, one.y]))
  const names = placed.filter((one) => one.id !== id && one.y > (before.get(one.id) ?? one.y)).map((one) => nameOf(one.id))
  if (names.length === 0) return ''
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return ` ${list} moved down.`
}

/**
 * An arrow key on a widget in Edit (spec 10.7): it moves the widget one cell, or with Shift resizes it by one cell
 * (Right and Left wider and narrower, Down and Up taller and shorter), by the push-down rule, and says what happened in
 * one sentence, after which it names the widgets that went down: "Resin, column 4, row 2. Clock moved down." At an edge
 * or a limit nothing changes and it says so: on a place with `rows`, at its last row too, or where the widgets it would
 * push down have no room below. `name` names the widget, and `nameOf` the others, by their ids.
 */
export function stepWith(
  start: readonly Placed[],
  id: string,
  key: Arrow,
  resize: boolean,
  name: string,
  range: Range | undefined,
  columns: number,
  nameOf: (id: string) => string = (other) => other,
  rows = Infinity,
): { placed: Placed[]; said: string } {
  const one = start.find((other) => other.id === id)
  if (one === undefined) return { placed: [...start], said: '' }
  const { dx, dy } = STEPS[key]
  const stay = (said: string) => ({ placed: [...start], said })
  const noRoom = 'There is no room below.'
  if (resize) {
    const placed = resizeTo(start, id, { w: one.w + dx, h: one.h + dy }, range, columns, rows)
    const now = placed.find((other) => other.id === id) ?? one
    if (range !== undefined && now.w === one.w && now.h === one.h) {
      if (dx < 0 || dy < 0) return stay(`${name} is at its smallest size.`)
      // Held by the columns or the rows, or by what it would push down, and not by its type.
      const atRight = one.x + one.w >= columns
      if (dx > 0 && one.w < range.max.w) return stay(atRight ? `${name} is at the right edge.` : noRoom)
      if (dy > 0 && one.h < range.max.h) return stay(one.y + one.h >= rows ? `${name} is at the bottom.` : noRoom)
      return stay(`${name} is at its largest size.`)
    }
    return { placed, said: `${name}, ${now.w} by ${now.h}.${movedDown(start, placed, id, nameOf)}` }
  }
  const x = one.x + dx
  const y = one.y + dy
  if (x < 0) return stay(`${name} is at the left edge.`)
  if (x + one.w > columns) return stay(`${name} is at the right edge.`)
  if (y < 0) return stay(`${name} is at the top.`)
  if (dy > 0 && y + one.h > rows) return stay(`${name} is at the bottom.`)
  // The row moveTo gives: a widget below the last row, as one saved on a taller display, comes onto it as it steps.
  const row = Math.max(0, Math.min(y, rows - one.h))
  const placed = moveTo(start, id, x, y, columns, rows)
  const now = placed.find((other) => other.id === id) ?? one
  if (now.x !== x || now.y !== row) return stay(noRoom) // what it would push down has no room below the last row
  return { placed, said: `${name}, column ${x + 1}, row ${row + 1}.${movedDown(start, placed, id, nameOf)}` }
}

/**
 * Where a widget that started at `from` lands when the pointer has taken it `dx` and `dy` pixels (spec 10.5): the cell
 * nearest its top-left corner, which keeps its place under the pointer, by the place's own `pitch` (pitchOf). moveTo
 * keeps it inside the Board.
 */
export function dropCell(from: { x: number; y: number }, dx: number, dy: number, pitch: Pitch): { x: number; y: number } {
  return { x: from.x + Math.round(dx / pitch.x), y: from.y + Math.round(dy / pitch.y) }
}

/**
 * The size a grip asks for when the pointer has gone `dx` and `dy` pixels from where it pressed (spec 10.6): a cell
 * wider or taller for each cell the pointer went in the grip's directions, by the place's own `pitch` (pitchOf), from
 * the size at the press. resizeTo keeps it within the type and the columns.
 */
export function gripSize(size: Size, grip: Grip, dx: number, dy: number, pitch: Pitch): Size {
  return {
    w: size.w + (grip === 's' ? 0 : Math.round(dx / pitch.x)),
    h: size.h + (grip === 'e' ? 0 : Math.round(dy / pitch.y)),
  }
}

/**
 * The tag of a resize with the pointer (spec 10.6): the size, "3 × 2", and the limit of the type it is at, "3 × 2,
 * largest" or "1 × 1, smallest", once every side its grip changes is at that limit, or where the pointer asks for more
 * or less of such a side than the type allows.
 */
export function sizeTag(size: Size, asked: Size, range: Range, grip: Grip): string {
  const sides: readonly (keyof Size)[] = grip === 'e' ? ['w'] : grip === 's' ? ['h'] : ['w', 'h']
  const every = (limit: Size) => sides.every((side) => size[side] === limit[side])
  const largest = every(range.max) || sides.some((side) => asked[side] > size[side] && size[side] === range.max[side])
  const smallest = every(range.min) || sides.some((side) => asked[side] < size[side] && size[side] === range.min[side])
  return `${sizeLabel(size)}${largest ? ', largest' : smallest ? ', smallest' : ''}`
}

/*
 * The Board's arrangement in a maximized window. A full screen at a smaller page size has more columns than the usual
 * window, so the Board keeps a second arrangement for it: each widget's place and size there is its `full`, beside its
 * place and size in a window. The widgets themselves, their settings and their data are the same in both.
 */

/** Cells with a size, as a widget's `full` holds them: its place and size in a maximized window. */
function fullOf(widget: Widget): Rect | null {
  const full = widget.full as Partial<Rect> | undefined
  const whole = (value: unknown) => Number.isInteger(value) && (value as number) >= 0
  if (full === undefined || full === null || typeof full !== 'object') return null
  return [full.x, full.y, full.w, full.h].every(whole) ? (full as Rect) : null
}

/** A widget without its place and size, and without its `full`. */
function unplaced(widget: Widget): Widget {
  const { x: _x, y: _y, w: _w, h: _h, full: _full, ...rest } = widget
  return rest as Widget
}

/**
 * The widgets as the maximized window arranges them, each at its place and size there, and its place and size in a
 * window kept in `full` meanwhile: arrange and Edit work on them as they do on a window's, and fromFull puts both back.
 * While the maximized window was never arranged, no widget has a place there, and each shows at its place in a window.
 * Once it was, a widget without one, added in a window since, has no place there and goes to the first free one.
 */
export function toFull(widgets: readonly Widget[]): Widget[] {
  const arranged = widgets.some((one) => fullOf(one) !== null)
  return widgets.map((widget) => {
    const { x, y, w, h } = widget
    const inWindow = { ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }), w, h }
    const own = fullOf(widget)
    if (own !== null) return { ...unplaced(widget), ...own, full: inWindow }
    if (!arranged) return { ...unplaced(widget), ...inWindow, full: inWindow }
    return { ...unplaced(widget), w, h, full: inWindow }
  })
}

/**
 * The widgets toFull gave, as they are saved: each at its place and size in a window, kept in `full` meanwhile, with the
 * place and size it has now as its `full`. A widget added in the maximized window has no place in a window yet, which
 * puts it at its first free place there, at the size it has now.
 */
export function fromFull(widgets: readonly Widget[]): Widget[] {
  return widgets.map((widget) => {
    const kept = widget.full as Partial<Rect> | undefined
    const inWindow = kept !== undefined && kept !== null && typeof kept === 'object' ? kept : { w: widget.w, h: widget.h }
    const placed = savedPlace(widget)
    const full = placed === null ? {} : { full: { x: placed.x, y: placed.y, w: widget.w, h: widget.h } }
    return { ...unplaced(widget), ...inWindow, ...full } as Widget
  })
}

/** The widgets with the places and sizes of an arrangement, in their own order, with every other key kept. */
export function withPlaces(widgets: readonly Widget[], placed: readonly Placed[]): Widget[] {
  const at = new Map(placed.map((one) => [one.id, one]))
  return widgets.map((widget) => {
    const cells = at.get(widget.id)
    return cells === undefined ? widget : { ...widget, x: cells.x, y: cells.y, w: cells.w, h: cells.h }
  })
}

/**
 * The cells no widget of the arrangement takes, in reading order: across the columns, and down to two rows below the
 * lowest widget, so that Edit shows room to drop (spec 10.4); on a place whose rows end, `last` of them, down to its
 * last row and no further.
 */
export function freeCells(placed: readonly Rect[], columns: number, last = Infinity): { x: number; y: number }[] {
  const rows = Number.isFinite(last) ? last : Math.max(0, ...placed.map((one) => one.y + one.h)) + 2
  const taken = new Set<string>()
  for (const one of placed) {
    for (let y = one.y; y < one.y + one.h; y += 1) {
      for (let x = one.x; x < one.x + one.w; x += 1) taken.add(`${x} ${y}`)
    }
  }
  const cells: { x: number; y: number }[] = []
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) if (!taken.has(`${x} ${y}`)) cells.push({ x, y })
  }
  return cells
}

/** The columns an arrangement uses: the furthest right a saved place reaches, or 0 when none has a place (spec 10.3). */
export function columnsUsed(widgets: readonly Widget[]): number {
  return Math.max(0, ...widgets.map((widget) => (savedPlace(widget) === null ? 0 : (widget.x as number) + widget.w)))
}

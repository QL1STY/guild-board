import { duration, num, plural } from '../../format.ts'
import type { FiveResult, MonthChip, MonthModel, MonthRecord, MonthTile } from '../../types.ts'
import { resultWords } from '../pullsview.ts'
import { hoursAndMinutes } from '../statsview.ts'

/** An amount of time as a comparison writes it: "9 h", "7 h 55 min", "25 min". */
function span(minutes: number): string {
  const total = Math.round(Math.abs(minutes))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')} min`
}

/**
 * A tile's comparison with the month before, in two parts as the Overview's tiles word theirs: the change ("▲ 9 h", "▼ 707",
 * "No change"), which is bold and green when it is a gain, and the rest, the model's own "vs September" or "vs 1–6 Oct".
 * A comparison that cannot be made (`delta` null) has none.
 */
export function deltaParts(delta: number | null, unit: string, compare: string): { change: string; gain: boolean; rest: string } | null {
  if (delta === null) return null
  if (delta === 0) return { change: 'No change', gain: false, rest: compare }
  const amount = unit === 'minutes' ? span(delta) : num(Math.abs(delta))
  return { change: `${delta > 0 ? '▲' : '▼'} ${amount}`, gain: delta > 0, rest: compare }
}

/** The same as one line: "▲ 9 h vs September", "▼ 707 vs September", "No change vs 1–6 Oct"; '' when it cannot be made. */
export function deltaText(delta: number | null, unit: string, compare: string): string {
  const parts = deltaParts(delta, unit, compare)
  return parts === null ? '' : `${parts.change} ${parts.rest}`
}

/** What a tile says when it cannot be compared: "Not compared with July", "Not compared with 1–6 Oct". */
export function noCompareText(compare: string): string {
  return `Not compared ${compare.replace(/^vs /, 'with ')}`
}

/** The strip of months by year, in the order given. */
export function stripYears(months: MonthChip[]): { year: number; months: MonthChip[] }[] {
  const years: { year: number; months: MonthChip[] }[] = []
  for (const month of months) {
    const last = years[years.length - 1]
    if (last !== undefined && last.year === month.year) last.months.push(month)
    else years.push({ year: month.year, months: [month] })
  }
  return years
}

/** A tile's big figure: the time in hours and minutes, days played "of" the days kept, the rest as numbers. */
export function tileFigure(
  tile: Pick<MonthTile, 'id' | 'value' | 'unit'>,
  daysKept: number | null,
): { text: string; small?: true }[] {
  if (tile.id === 'time') return hoursAndMinutes(tile.value)
  if (tile.id === 'days' && daysKept !== null) return [{ text: num(tile.value) }, { text: `of ${num(daysKept)}`, small: true }]
  return [{ text: num(tile.value) }]
}

/** What a record says at its right: "4 h 12 min · 26 Oct", "1,320 · 16 Oct", "Furina · 12 pulls · 15 Aug". */
export function recordText(record: MonthRecord): string {
  const value =
    record.unit === 'minutes'
      ? duration(record.value)
      : record.unit === 'days'
        ? plural(record.value, 'day')
        : record.unit === 'pulls'
          ? plural(record.value, 'pull')
          : num(record.value)
  return [record.name, value, record.when].filter((part) => part !== undefined && part !== '').join(' · ')
}

/**
 * A 5-star of the month: "76 pulls, lost the 50/50" with the Pulls page's own words for how it fell (`pool` is the wish's
 * pool). The pity is not known for a wish the history cannot place.
 */
export function fiveWords(pity: number | null, result: FiveResult, pool: string): string {
  if (pity === null) return 'pity not known'
  const pulls = plural(pity, 'pull')
  const known = pool === 'novice' || pool === 'character' || pool === 'weapon' || pool === 'chronicled'
  const how = resultWords(result, known ? pool : 'standard')
  return how === '' ? pulls : `${pulls}, ${how}`
}

/** The empty cells before a month's first day in a week that begins on Monday. */
export function leadingBlanks(firstDay: string): number {
  const [year, month, date] = firstDay.split('-').map(Number)
  return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7
}

/** The days the month's calendar shows: the blanks before its first day, and its days, to the last with time kept. */
export function calendarDays(month: Pick<MonthModel, 'days'>): { blanks: number; shown: NonNullable<MonthModel['days']> } {
  const days = month.days ?? []
  const blanks = days.length === 0 ? 0 : leadingBlanks(days[0].day)
  const filled = days.findLastIndex((day) => day.minutes !== null) + 1
  // The month so far shows its days to the end of the week it has reached; the days still to come take no room.
  return { blanks, shown: filled === 0 ? days : days.slice(0, filled) }
}

/*
 * ---------- How the month's parts are laid out (the Months and Wrapped design, section 5.1: no blank space) ----------
 *
 * The parts stand in rows across the page. A row's cards are as tall as its tallest, and what is inside each card spreads
 * to fill it: a record, a bar or a 5-star grows, up to the size at which it would read as a gap. The calendar's cells stay
 * square: it is the one card whose width follows its height, so it is given the cell size at which it is as tall as the
 * row, and the other cards of its row share the rest of the width.
 *
 * Which parts share a row is chosen from what each card can be: its height with every line at its least and at its most
 * (`partRange`), which follow from months.css and charts.css (the sizes below). Every way to put the parts in rows is
 * tried, and the one kept fills every row with nothing left blank, closes up (a part alone in a row only when nothing
 * else fits), keeps each card near the width it is made for and stretches the least.
 */

/** The gap between two parts, and between two rows. */
export const PART_GAP = 12
/** The calendar's cell size, in pixels: at least the size at which its title and its button fit beside each other. */
export const CELL_MIN = 28
export const CELL_MAX = 64
/** The cell size of a calendar alone in its row. */
export const CELL_ALONE = 40
/** How much taller than wide a cell may grow when its row is taller than the calendar. */
const CELL_STRETCH = 1.25
/** A card's padding and border across (charts.css .ch), and the width inside it at which two lists stand side by side. */
const CARD_X = 30
const SIDE_BY_SIDE = 620
/** A card's title, the line under it (.cs), its padding and its border. */
const RECORDS_CHROME = 74
const ENDGAME_CHROME = 74
const LISTS_CHROME = 75
/** The calendar's title, line, weekdays and key, and the gap between its cells. */
const CALENDAR_CHROME = 118
const CALENDAR_GAP = 3
/** A list's title, and the gap between two lists one above the other. */
const LIST_HEAD = 20
const LIST_GAP = 12
/** Each row's least and most height: a record or an endgame cycle, a bar, a 5-star, and a bar of a list spread in columns. */
const ROW = [34, 76] as const
const BAR = [26, 48] as const
const FIVE = [52, 76] as const
const SPREAD = [44, 48] as const
const SPREAD_COLUMN = 190
const SPREAD_GAP = [8, 28] as const
/** How far short of its row a card may end: the page allows 12 pixels, this keeps a margin. */
const SLACK = 8

/** What a part holds, as far as its height goes. */
export type PartShape =
  | { kind: 'rows'; chrome: number; rows: number }
  | { kind: 'lists'; lists: { fives: boolean; count: number }[] }
  | { kind: 'calendar'; weeks: number }

export type MonthPart = { id: string; wide: boolean; shape: PartShape }

/** A part as it is laid out: its width in pixels, and for the calendar its cell size. */
export type PlacedPart = { id: string; width: number; cell: number | null }

/** A row of parts. A row of one part (`alone`) keeps that part's own width, at the left; any other row fills the width. */
export type PartRow = { parts: PlacedPart[]; height: number; alone: boolean }

/**
 * The parts a month has, in the page's order: records, the calendar, where it came from, endgame, pulls. A part is `wide`
 * when it holds two lists, which then stand side by side.
 */
export function monthParts(month: MonthModel): { id: string; wide: boolean }[] {
  const parts: { id: string; wide: boolean }[] = []
  if (month.records.length > 0) parts.push({ id: 'records', wide: false })
  if (month.days !== null) parts.push({ id: 'days', wide: false })
  if (month.sources.length > 0 || month.resin.length > 0) {
    parts.push({ id: 'flow', wide: month.sources.length > 0 && month.resin.length > 0 })
  }
  if (month.endgame.length > 0) parts.push({ id: 'endgame', wide: false })
  if (month.pulls !== null && month.pulls.banners.length > 0) parts.push({ id: 'pulls', wide: month.pulls.fives.length > 0 })
  return parts
}

/** The shape of each part of the month. */
export function partShape(id: string, month: MonthModel): PartShape {
  switch (id) {
    case 'records':
      return { kind: 'rows', chrome: RECORDS_CHROME, rows: month.records.length }
    case 'endgame':
      return { kind: 'rows', chrome: ENDGAME_CHROME, rows: month.endgame.length }
    case 'days': {
      const { blanks, shown } = calendarDays(month)
      return { kind: 'calendar', weeks: Math.max(1, Math.ceil((blanks + shown.length) / 7)) }
    }
    case 'flow':
      return {
        kind: 'lists',
        lists: [month.sources.length, month.resin.length].filter((count) => count > 0).map((count) => ({ fives: false, count })),
      }
    default: {
      const pulls = month.pulls
      const lists = pulls === null ? [] : [{ fives: false, count: pulls.banners.length }, { fives: true, count: pulls.fives.length }]
      return { kind: 'lists', lists: lists.filter((list) => list.count > 0) }
    }
  }
}

/** The calendar card's height and width at a cell size. */
export const calendarHeight = (weeks: number, cell: number): number =>
  CALENDAR_CHROME + weeks * cell + CALENDAR_GAP * (weeks - 1)
export const calendarWidth = (cell: number): number => 7 * cell + 6 * CALENDAR_GAP + CARD_X

/**
 * The least and the most height of a card of `width` pixels: every line at its least, and every line at its most (more
 * would leave a blank under the last). In a wide card the records stand in two columns, and two lists stand side by side
 * and grow together; one above the other, the space is shared between the lists equally, so the one that can grow least
 * decides. A lone list of bars in a wide card spreads in columns. The calendar has its own (`calendarHeight`).
 */
export function partRange(shape: PartShape, width: number): { min: number; max: number } {
  const wide = width - CARD_X >= SIDE_BY_SIDE
  if (shape.kind === 'rows') {
    const lines = Math.ceil(shape.rows / (wide ? 2 : 1))
    return { min: shape.chrome + ROW[0] * lines, max: shape.chrome + ROW[1] * lines }
  }
  if (shape.kind === 'calendar') {
    const height = calendarHeight(shape.weeks, (width - calendarWidth(0)) / 7)
    return { min: height, max: height }
  }
  const lists = shape.lists
  if (lists.length === 0) return { min: LISTS_CHROME, max: LISTS_CHROME }
  const sizes = (list: { fives: boolean }) => (list.fives ? FIVE : BAR)
  const low = (list: { fives: boolean; count: number }) => LIST_HEAD + sizes(list)[0] * list.count
  const high = (list: { fives: boolean; count: number }) => LIST_HEAD + sizes(list)[1] * list.count
  if (wide && lists.length > 1) {
    return { min: LISTS_CHROME + Math.max(...lists.map(low)), max: LISTS_CHROME + Math.min(...lists.map(high)) }
  }
  if (wide && !lists[0].fives) {
    const columns = Math.max(1, Math.floor((width - CARD_X + SPREAD_GAP[1]) / (SPREAD_COLUMN + SPREAD_GAP[1])))
    const rows = Math.ceil(lists[0].count / columns)
    const min = LISTS_CHROME + LIST_HEAD + SPREAD[0] * rows + SPREAD_GAP[0] * (rows - 1)
    return { min, max: min + (SPREAD[1] - SPREAD[0]) * rows }
  }
  const min = LISTS_CHROME + lists.reduce((sum, list) => sum + low(list), 0) + LIST_GAP * (lists.length - 1)
  return { min, max: min + lists.length * Math.min(...lists.map((list) => high(list) - low(list))) }
}

/** The lines of a card that grow to fill it: its records, bars and 5-stars, or the calendar's weeks. */
function linesOf(shape: PartShape): number {
  if (shape.kind === 'rows') return Math.max(1, shape.rows)
  if (shape.kind === 'calendar') return shape.weeks
  return Math.max(1, shape.lists.reduce((sum, list) => sum + list.count, 0))
}

// What the choice weighs: a row that leaves a blank costs most; then a part alone in its row, more for a larger hole beside
// it; a narrow card widened to two columns or more, a wide one narrowed; a card a little short of its row (less than the
// page allows), by the pixel; how much each line has to grow, a small calendar, and the parts out of the page's order (the
// records most, which come first).
const COST = {
  blank: 1000, alone: 80, hole: 80, widened: 20, narrowed: 5, short: 2, growth: 0.2, small: 1, order: 0.5, records: 2,
}
const CELL_EASY = 32

type Plan = { row: PartRow; cost: number }

/**
 * The best way to lay out one row of parts across `width` pixels, and what it costs. `many` is true when the month has more
 * parts than this one row: a part alone in its row then leaves a hole beside it.
 */
function planRow(row: MonthPart[], width: number, many: boolean): Plan {
  const column = (width - 2 * PART_GAP) / 3
  const growth = (height: number, parts: { shape: PartShape; min: number }[]) =>
    parts.reduce((sum, part) => sum + ((height - part.min) / linesOf(part.shape)) * COST.growth, 0)
  const fit = (part: MonthPart, partWidth: number) => {
    if (!part.wide && partWidth > 1.5 * column + PART_GAP) return COST.widened
    if (part.wide && partWidth < 1.5 * column) return COST.narrowed
    return 0
  }
  if (row.length === 1) {
    const [part] = row
    const alone = (partWidth: number) => (many ? COST.alone + (COST.hole * (width - partWidth)) / width : 0)
    if (part.shape.kind === 'calendar') {
      const height = calendarHeight(part.shape.weeks, CELL_ALONE)
      const partWidth = calendarWidth(CELL_ALONE)
      return { row: { parts: [{ id: part.id, width: partWidth, cell: CELL_ALONE }], height, alone: true }, cost: alone(partWidth) }
    }
    const span = part.wide ? 2 : 1
    const partWidth = Math.min(width, span * column + (span - 1) * PART_GAP)
    const height = partRange(part.shape, partWidth).min
    return { row: { parts: [{ id: part.id, width: partWidth, cell: null }], height, alone: true }, cost: alone(partWidth) }
  }
  const calendar = row.find((part) => part.shape.kind === 'calendar')
  const others = row.filter((part) => part !== calendar)
  let best: Plan | null = null
  const consider = (widths: number[], cell: number | null) => {
    const ranges = others.map((part, at) => partRange(part.shape, widths[at]))
    let low = Math.max(...ranges.map((range) => range.min))
    let high = Math.min(...ranges.map((range) => range.max)) + SLACK
    let cost = others.reduce((sum, part, at) => sum + fit(part, widths[at]), 0)
    if (calendar !== undefined && cell !== null && calendar.shape.kind === 'calendar') {
      const weeks = calendar.shape.weeks
      const natural = calendarHeight(weeks, cell)
      high = Math.min(high, CALENDAR_CHROME + weeks * cell * CELL_STRETCH + CALENDAR_GAP * (weeks - 1))
      cost += (natural > low ? 0 : (low - natural) / weeks) * COST.growth + Math.max(0, CELL_EASY - cell) * COST.small
      low = Math.max(low, natural)
    }
    const blank = Math.max(0, low - high)
    const short = ranges.reduce((sum, range) => sum + Math.max(0, low - range.max), 0)
    cost += (blank > 0 ? COST.blank + blank : 0) + short * COST.short
    cost += growth(low, others.map((part, at) => ({ shape: part.shape, min: ranges[at].min })))
    if (best !== null && best.cost <= cost) return
    const parts = row.map((part) =>
      part === calendar
        ? { id: part.id, width: calendarWidth(cell ?? CELL_MIN), cell }
        : { id: part.id, width: widths[others.indexOf(part)], cell: null },
    )
    best = { row: { parts, height: low, alone: false }, cost }
  }
  if (calendar !== undefined) {
    // The others share what the calendar leaves, as wide parts twice what narrow ones take.
    const weights = others.map((part) => (part.wide ? 2 : 1))
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    for (let cell = CELL_MAX; cell >= CELL_MIN; cell -= 0.5) {
      const rest = width - calendarWidth(cell) - PART_GAP * others.length
      if (rest < 160 * others.length) continue
      consider(weights.map((weight) => (rest * weight) / total), cell)
    }
  } else {
    // Each part takes one column or two; together they take the three.
    const choices = (at: number, left: number): number[][] =>
      at === others.length
        ? left === 0 ? [[]] : []
        : [1, 2, 3].flatMap((span) => (span <= left - (others.length - at - 1) ? choices(at + 1, left - span).map((rest) => [span, ...rest]) : []))
    for (const spans of choices(0, 3)) consider(spans.map((span) => span * column + (span - 1) * PART_GAP), null)
  }
  return best ?? { row: { parts: [], height: 0, alone: false }, cost: Infinity }
}

/**
 * The month's parts in rows across `width` pixels: every arrangement of them in rows of one to three is weighed (`COST`),
 * and the best is kept. The parts come in the page's order (records, the calendar, where it came from, endgame, pulls),
 * which an arrangement keeps where it can.
 */
export function layoutParts(parts: MonthPart[], width: number): PartRow[] {
  if (parts.length === 0) return []
  const many = parts.length > 1
  const plans = new Map<string, Plan>()
  const planOf = (row: MonthPart[]) => {
    const key = row.map((part) => part.id).join()
    let plan = plans.get(key)
    if (plan === undefined) {
      plan = planRow(row, width, many)
      plans.set(key, plan)
    }
    return plan
  }
  let best: { rows: PartRow[]; cost: number } | null = null
  const orders = (left: MonthPart[]): MonthPart[][] =>
    left.length === 0 ? [[]] : left.flatMap((part, at) => orders([...left.slice(0, at), ...left.slice(at + 1)]).map((rest) => [part, ...rest]))
  for (const order of orders(parts)) {
    // What it costs to put each pair of parts the other way round from the page's order.
    let unordered = 0
    for (let a = 0; a < order.length; a += 1) {
      for (let b = a + 1; b < order.length; b += 1) {
        if (parts.indexOf(order[a]) > parts.indexOf(order[b])) unordered += order[b].id === 'records' ? COST.records : COST.order
      }
    }
    // Every way to cut the order into rows of one to three parts.
    for (let cuts = 0; cuts < 2 ** (order.length - 1); cuts += 1) {
      const rows: MonthPart[][] = [[order[0]]]
      for (let at = 1; at < order.length; at += 1) {
        if (cuts & (1 << (at - 1))) rows.push([order[at]])
        else rows[rows.length - 1].push(order[at])
      }
      if (rows.some((row) => row.length > 3)) continue
      const planned = rows.map(planOf)
      const cost = planned.reduce((sum, plan) => sum + plan.cost, 0) + unordered
      if (best === null || cost < best.cost) best = { rows: planned.map((plan) => plan.row), cost }
    }
  }
  return best === null ? [] : best.rows
}

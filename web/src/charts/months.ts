import { MONTHS, num } from '../format.ts'
import { POOL_LABELS } from '../pages/pullsview.ts'
import type { MonthWishes, PullsPool } from '../types.ts'
import type { TableData } from './ChartCard.tsx'
import { axis } from './scale.ts'

/*
 * The monthly graph of the Pulls history (the second pass, spec 3.3): a column a month, stacked by wish. This is its
 * arithmetic, apart from the drawing: where each column and segment stands in a plot of a measured size, and the words
 * that name them. The marks follow the plan's chart constraints: columns at most 24 pixels wide with a 4 pixel rounded
 * top and a square foot, a 2 pixel gap between stacked segments, the busiest month carrying its total.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
]

/** The wishes of a column, bottom up. The chronicled wish is the fourth, and shows only where some month holds its wishes. */
export const WISHES: readonly PullsPool[] = ['character', 'weapon', 'standard', 'chronicled']

/** The widest a column is, and the surface gap between the segments stacked in it, in pixels. */
export const MOST_WIDE = 24
export const GAP = 2
/** The radius of a column's rounded top. */
export const TOP_RADIUS = 4

/** The month of "2026-10" in full, as the tooltip says it: "October 2026". */
export function monthTitle(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
}

/** The month of "2026-10" as the axis names it: "Oct". */
export function monthTick(month: string): string {
  return MONTHS[Number(month.slice(5, 7)) - 1]
}

/** All the wishes of a month. */
export function monthTotal(month: MonthWishes): number {
  return month.character + month.weapon + month.standard + month.chronicled
}

/** The wishes the graph shows, bottom up: the chronicled wish only when some month holds its wishes. */
export function wishesShown(months: readonly MonthWishes[]): PullsPool[] {
  return WISHES.filter((wish) => wish !== 'chronicled' || months.some((month) => month.chronicled > 0))
}

/** The name of the month's total in a tooltip: all four wishes of it. */
export const ALL_BANNERS = 'All banners'

/** What a segment's tooltip says: its month, its wish and the wishes of it, and the month's total. */
export function segmentWords(month: MonthWishes, wish: PullsPool): { title: string; line: string; all: string } {
  return {
    title: monthTitle(month.month),
    line: `${POOL_LABELS[wish]}: ${num(month[wish])}`,
    all: `${ALL_BANNERS}: ${num(monthTotal(month))}`,
  }
}

/** The graph's numbers as a table: a row a month, a column for each wish shown and one for all of them. */
export function monthsTable(months: readonly MonthWishes[], shown: readonly PullsPool[]): TableData {
  return {
    head: ['Month', ...shown.map((wish) => POOL_LABELS[wish]), 'All'],
    rows: months.map((month) => [
      monthTitle(month.month),
      ...shown.map((wish) => num(month[wish])),
      num(monthTotal(month)),
    ]),
    numeric: Array.from({ length: shown.length + 1 }, (_, at) => at + 1),
  }
}

/** A box, in pixels of the plot's own drawing. */
type Box = { x: number; y: number; width: number; height: number }

export type Segment = Box & {
  wish: PullsPool
  count: number
  /** The top segment of its column has the rounded top; the others are square. */
  rounded: boolean
  /** What answers the pointer and the keyboard: its month's whole slot, as tall as its share and never under 8 pixels. */
  hit: Box
}

export type Column = {
  month: MonthWishes
  total: number
  /** The middle of the month's slot, where the column stands. */
  cx: number
  slot: { x: number; width: number }
  /** The top of the stack; the plot's foot for a quiet month. */
  top: number
  segments: Segment[]
}

export type MonthsLayout = {
  /** The plot's edges, inside the drawing: the numbers of the axis stand left of it, the months' names under it. */
  box: { left: number; top: number; right: number; bottom: number }
  ticks: { value: number; y: number }[]
  columns: Column[]
  /** The month that carries its total over its column: the busiest, the first of equals; null with no wish at all. */
  busiest: number | null
  /** The months named under the plot, and the year under a January or the first. */
  labels: { index: number; text: string; year: string | null; x: number }[]
}

/** The room above the plot for the busiest month's total, under it for the months' names and for the years. */
const HEAD = 20
const FOOT = 22
const FOOT_YEAR = 12
const RIGHT = 4
/** The width of one digit of the axis's numbers, and the room between them and the plot. */
const DIGIT = 6.4
const AXIS_GAP = 8
/** The room a month's name needs: names are every month while the slots are this wide, and thin out below. */
const LABEL_ROOM = 34
const LEAST_WIDE = 2
/** A column fills this much of its slot, up to its most. */
const SHARE = 0.6
const LEAST_SEGMENT = 1.5
const LEAST_HIT = 8

/**
 * Lays the months out in a plot of `size` pixels: the axis to the busiest month, a slot for each month with its column
 * in the middle, the wishes stacked from the foot up, and the months named under the plot as far as there is room.
 */
export function monthsLayout(months: readonly MonthWishes[], shown: readonly PullsPool[], size: { width: number; height: number }): MonthsLayout {
  const totals = months.map(monthTotal)
  const { top: axisTop, ticks: values } = axis(Math.max(0, ...totals))
  const left = Math.ceil(num(axisTop).length * DIGIT) + AXIS_GAP
  const right = size.width - RIGHT
  const slotWidth = (right - left) / Math.max(1, months.length)

  // The months named: every month while the slots allow, else every few, counting back from the last.
  const every = Math.max(1, Math.ceil(LABEL_ROOM / slotWidth))
  const named = months.flatMap((_, index) => ((months.length - 1 - index) % every === 0 ? [index] : []))
  // The year goes under the first month named, and under each that is of another year than the one named before it, which
  // is a January while every month is named.
  const spans = new Set(months.map((month) => month.month.slice(0, 4))).size > 1
  const yearOf = (index: number) => {
    const year = months[index].month.slice(0, 4)
    const before = named[named.indexOf(index) - 1]
    return spans && (before === undefined || months[before].month.slice(0, 4) !== year) ? year : null
  }
  const anyYear = named.some((index) => yearOf(index) !== null)

  const box = { left, top: HEAD, right, bottom: size.height - FOOT - (anyYear ? FOOT_YEAR : 0) }
  const plotHeight = box.bottom - box.top
  const tall = (value: number) => (value / axisTop) * plotHeight

  const columns: Column[] = months.map((month, index) => {
    const x = left + slotWidth * index
    const cx = x + slotWidth / 2
    const width = Math.min(MOST_WIDE, Math.max(LEAST_WIDE, slotWidth * SHARE))
    const segments: Segment[] = []
    let cursor = box.bottom
    for (const wish of shown) {
      const count = month[wish]
      if (count <= 0) continue
      // The gap between this segment and the one below it is taken from this one's own share.
      const share = tall(count)
      const gap = segments.length > 0 ? GAP : 0
      const y = cursor - share
      segments.push({
        wish, count, x: cx - width / 2, y, width, height: Math.max(LEAST_SEGMENT, share - gap), rounded: false,
        hit: { x, y, width: slotWidth, height: Math.max(LEAST_HIT, share) },
      })
      cursor = y
    }
    if (segments.length > 0) segments[segments.length - 1].rounded = true
    return { month, total: totals[index], cx, slot: { x, width: slotWidth }, top: cursor, segments }
  })

  let busiest: number | null = null
  let most = 0
  totals.forEach((total, index) => {
    if (total > most) {
      most = total
      busiest = index
    }
  })

  return {
    box,
    ticks: values.map((value) => ({ value, y: box.bottom - tall(value) })),
    columns,
    busiest,
    labels: named.map((index) => ({
      index, text: monthTick(months[index].month), year: yearOf(index), x: columns[index].cx,
    })),
  }
}

/** The path of a segment: a rectangle with the radius of the rounded top on its upper corners, never more than it holds. */
export function segmentPath(segment: Segment): string {
  const { x, y, width, height } = segment
  const r = segment.rounded ? Math.min(TOP_RADIUS, height, width / 2) : 0
  if (r === 0) return `M${x} ${y}h${width}v${height}h${-width}Z`
  return `M${x} ${y + height}V${y + r}a${r} ${r} 0 0 1 ${r} ${-r}h${width - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${y + height}Z`
}

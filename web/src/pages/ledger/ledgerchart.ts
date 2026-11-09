import { num, plural } from '../../format.ts'
import type { LedgerDay } from '../../ledgertypes.ts'
import { signed } from '../ledgerview.ts'
import { addDays, longDate } from './ledgerdays.ts'

/**
 * The Primogems chart and the big number above it (the Ledger revamp design, section 4.1), worked out with no DOM: which days a
 * range shows, the curve through their balances, the day under the pointer and the words of the headline.
 */

/** The range pills: the last 7 days, this calendar month so far, and the last 3 and 6 calendar months with this one. */
export type Range = 'week' | 'month' | 'month3' | 'month6'

/** The first day of the calendar month `back` months before the one `today` is in. */
function monthStart(today: string, back: number): string {
  const [year, month] = today.split('-').map(Number)
  const index = year * 12 + (month - 1) - back
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`
}

/** The days a range shows, oldest first: none after `today`, whatever the core sent. */
export function rangeDays<T extends { day: string }>(days: T[], range: Range, today: string): T[] {
  const first = range === 'week' ? addDays(today, -6) : monthStart(today, range === 'month' ? 0 : range === 'month3' ? 2 : 5)
  return days.filter((day) => day.day >= first && day.day <= today)
}

/** The chart's margins inside its box, as the mockup draws it: left, right, top, and the room under the line for the day labels. */
export const CHART_MARGINS = { left: 2, right: 2, top: 10, bottom: 28 }

/** What a big number reads for a day or a range the log does not cover. */
export const UNKNOWN = '—'

/** A coordinate as it goes into a path: two decimals at most. */
function round(value: number): string {
  return String(Math.round(value * 100) / 100)
}

export type ChartPoint = { x: number; y: number; day: string }

export type ChartGeometry = {
  /** The curve, as an SVG path. */
  line: string
  /** The same curve closed down to the chart's floor, for the faint gradient under it. */
  area: string
  points: ChartPoint[]
  /** Where the period began: the dashed line, and the balance it stands for. */
  start: { y: number; value: number }
  /** The days with a big moment, each a point on the line, for a small hollow dot. */
  moments: { x: number; y: number }[]
}

/**
 * A monotone cubic through the days' balances: smooth, and never above or below a day's real value between two days (the
 * slopes at a day are the average of the two secants, held to three times the smaller, and zero at a turn). A day's value is
 * the balance at its end where the core knows it, else the running net from 0 (no balance typed in Pulls).
 */
export function chartGeometry(days: LedgerDay[], box: { w: number; h: number }): ChartGeometry {
  const { left, right, top, bottom } = CHART_MARGINS
  const floor = box.h - bottom
  const n = days.length
  if (n === 0) return { line: '', area: '', points: [], start: { y: floor, value: 0 }, moments: [] }

  let running = 0
  const values = days.map((day) => {
    running += day.earned - day.spent
    return day.held ?? running
  })
  const first = days[0]
  const startValue = first.held === null ? 0 : first.held - (first.earned - first.spent)

  const lo = Math.min(startValue, ...values)
  const hi = Math.max(startValue, ...values)
  const pad = hi === lo ? 1 : (hi - lo) * 0.12
  const bottomValue = lo - pad
  const span = hi + pad - bottomValue
  const yOf = (value: number) => top + (1 - (value - bottomValue) / span) * (floor - top)
  const width = box.w - left - right
  const xOf = (index: number) => (n === 1 ? left + width / 2 : left + (index / (n - 1)) * width)

  const points: ChartPoint[] = days.map((day, index) => ({ x: xOf(index), y: yOf(values[index]), day: day.day }))
  const dx = points.map((point, index) => (index < n - 1 ? points[index + 1].x - point.x : 0))
  const secant = points.map((point, index) => (index < n - 1 ? (points[index + 1].y - point.y) / dx[index] : 0))
  const slope = points.map((_, index) => {
    if (n === 1) return 0
    if (index === 0) return secant[0]
    if (index === n - 1) return secant[n - 2]
    const before = secant[index - 1]
    const after = secant[index]
    if (before * after <= 0) return 0
    const average = (before + after) / 2
    const limit = 3 * Math.min(Math.abs(before), Math.abs(after))
    return Math.sign(average) * Math.min(Math.abs(average), limit)
  })
  // The ends take a secant too, and must not run past three times it either way.
  if (n > 1) {
    slope[0] = Math.sign(secant[0]) * Math.min(Math.abs(slope[0]), 3 * Math.abs(secant[0]))
    slope[n - 1] = Math.sign(secant[n - 2]) * Math.min(Math.abs(slope[n - 1]), 3 * Math.abs(secant[n - 2]))
  }

  let line = `M${round(points[0].x)},${round(points[0].y)}`
  for (let index = 0; index < n - 1; index += 1) {
    const h = dx[index] / 3
    const a = points[index]
    const b = points[index + 1]
    line += `C${round(a.x + h)},${round(a.y + slope[index] * h)} ${round(b.x - h)},${round(b.y - slope[index + 1] * h)} ${round(b.x)},${round(b.y)}`
  }
  const area = `${line}L${round(points[n - 1].x)},${round(floor)}L${round(points[0].x)},${round(floor)}Z`
  const moments = days.flatMap((day, index) => (day.moments.length > 0 ? [{ x: points[index].x, y: points[index].y }] : []))
  return { line, area, points, start: { y: yOf(startValue), value: startValue }, moments }
}

/** The index of the point nearest a pointer's x (in the chart's own units); -1 with no points. */
export function dayAt(points: { x: number }[], x: number): number {
  let best = -1
  let distance = Infinity
  points.forEach((point, index) => {
    const away = Math.abs(point.x - x)
    if (away < distance) {
      best = index
      distance = away
    }
  })
  return best
}

const PERIODS: Record<Range, string> = {
  week: 'the last 7 days',
  month: '',
  month3: 'the last 3 months',
  month6: 'the last 6 months',
}

/** A range in a sentence: "in October", "in the last 7 days". */
export function periodOf(range: Range, monthName: string): string {
  return range === 'month' ? `in ${monthName}` : `in ${PERIODS[range]}`
}

/** The day labels under a chart: the indexes of about five of its `count` days, from the first on. */
export function labelIndexes(count: number): number[] {
  const step = Math.max(1, Math.ceil(count / 5))
  const found: number[] = []
  for (let index = 0; index < count; index += step) found.push(index)
  return found
}

/** What a balance chart calls its things: the primogems' held, earned and the wishes they make; the crystals', if one is kept. */
export type ChartWords = {
  /** The big number's label with no pointer: "Primogems held". */
  held: string
  /** What came in: "earned" for the primogems, "bought" for the crystals. */
  came: string
  /** The small word beside a balance: the wishes it makes, "crystals". */
  unit: (held: number) => string
  /** The chart's name for a screen reader, with a balance and without. */
  aria: { held: string; net: string }
}

export const PRIMOGEM_WORDS: ChartWords = {
  held: 'Primogems held',
  came: 'earned',
  unit: (held) => plural(Math.max(0, Math.floor(held / 160)), 'wish', 'wishes'),
  aria: { held: 'Primogems held each day', net: 'Net primogems each day' },
}

/** "+7,815 earned and −1,760 spent": nothing spent is left out. */
function movement(earned: number, spent: number, came: string): string {
  return `${signed(earned)} ${came}${spent > 0 ? ` and −${num(spent)} spent` : ''}`
}

/**
 * The big number and its words. With no pointer it is the balance now (the last day's) with the wishes it makes, and the
 * range's earning and spending under it; without a balance it is the range's net. Over a day it is that day's.
 */
export function headline(
  days: LedgerDay[],
  at: number | null,
  range: Range,
  monthName: string,
  words: ChartWords = PRIMOGEM_WORDS,
): { label: string; amount: string; wishes: string; line: string } {
  if (at !== null && days[at] !== undefined) {
    const day = days[at]
    const named = day.moments.map((moment) => `${moment.title} ${signed(moment.amount)}`)
    // A day the logs do not cover is unknown: no balance (the line carries one across the gap) and no net of 0.
    if (!day.known) return { label: longDate(day.day), amount: UNKNOWN, wishes: '', line: 'No record of this day' }
    const line = `${movement(day.earned, day.spent, words.came)} that day${named.length > 0 ? ` · ${named.join(', ')}` : ''}`
    const held = day.held
    return {
      label: longDate(day.day),
      amount: held === null ? signed(day.earned - day.spent) : num(held),
      wishes: held === null ? '' : words.unit(held),
      line,
    }
  }
  const earned = days.reduce((sum, day) => sum + day.earned, 0)
  const spent = days.reduce((sum, day) => sum + day.spent, 0)
  const held = days.length > 0 ? days[days.length - 1].held : null
  const period = periodOf(range, monthName)
  const line = days.length === 0 ? '' : `${movement(earned, spent, words.came)} ${period}`
  if (held !== null) return { label: words.held, amount: num(held), wishes: words.unit(held), line }
  const net = range === 'month' ? `Net in ${monthName}` : `Net over ${PERIODS[range]}`
  if (!days.some((day) => day.known)) return { label: net, amount: UNKNOWN, wishes: '', line: 'No record of these days' }
  return { label: net, amount: signed(earned - spent), wishes: '', line }
}

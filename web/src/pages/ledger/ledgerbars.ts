import { num } from '../../format.ts'

/**
 * The bar chart of the Crystals, Resin and Artifacts views (the Ledger revamp design, section 6), worked out with no DOM: the
 * scale, the stacks, the grid and the day under the pointer. These kinds keep no balance (the design, 8a), so a day's bars
 * are what came in (up) and what went out (down), as the mockup draws them.
 */

/** One part of a day's stack: its size and the colour it is drawn in (a token, `var(--…)`). */
export type Segment = { value: number; color: string }

/** A day's bars: what came in stacks up from the line, what went out stacks down from it. */
export type BarDay = { day: string; known: boolean; up: Segment[]; down: Segment[] }

export const BAR_BOX = { w: 760, h: 230 }
export const BAR_MARGINS = { left: 2, right: 2, top: 12, bottom: 28 }

const MINUS = '−'

/** The smallest of 1, 2 and 5 times a power of ten that fits `limit` in three steps or fewer. */
export function niceStep(limit: number): number {
  if (!(limit > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(limit / 3))
  for (const factor of [1, 2, 5, 10]) {
    if (limit / (factor * power) <= 3) return factor * power
  }
  return 10 * power
}

export type BarScale = { lo: number; hi: number; step: number; grid: { value: number; label: string }[] }

/** The sum of a stack. */
export function stackOf(segments: Segment[]): number {
  return segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0)
}

/**
 * The scale of a set of bars: the top is the tallest stack up (or `ref`, a reference line that must show, such as the 180
 * resin a day regrows) with a tenth of room above it and never under `minHi`; the bottom is the tallest stack down with a tenth
 * below it, and 0 when nothing goes down. Grid lines fall on whole steps of 1, 2 or 5 times a power of ten, none on 0.
 */
export function barScale(bars: BarDay[], options: { ref?: number; minHi?: number } = {}): BarScale {
  const up = Math.max(0, options.ref ?? 0, ...bars.map((bar) => stackOf(bar.up)))
  const down = Math.max(0, ...bars.map((bar) => stackOf(bar.down)))
  const hi = Math.max(options.minHi ?? 1, up * 1.1)
  const lo = down > 0 ? -down * 1.1 : 0
  const step = niceStep(Math.max(hi, -lo))
  const grid: BarScale['grid'] = []
  for (let value = Math.ceil(lo / step) * step; value < hi - 1e-9; value += step) {
    if (value === 0) continue
    grid.push({ value, label: value < 0 ? `${MINUS}${num(-value)}` : num(value) })
  }
  return { lo, hi, step, grid }
}

/** A coordinate as it goes into a drawing: two decimals at most. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

export type BarRect = { x: number; y: number; w: number; h: number; color: string; index: number }

export type BarGeometry = {
  /** The width of a day's slot, and of its bar. */
  slot: number
  width: number
  rects: BarRect[]
  grid: { y: number; label: string }[]
  zero: number
  ref: number | null
  /** The middle of each day's slot. */
  centers: number[]
  floor: number
}

/**
 * Where everything falls in the chart's box: a bar a day, 60% of its slot wide and at most 24, a stack's parts a pixel apart,
 * every part at least 3 tall so that a small one shows.
 */
export function barsGeometry(bars: BarDay[], scale: BarScale, ref: number | null, box = BAR_BOX): BarGeometry {
  const { left, right, top, bottom } = BAR_MARGINS
  const floor = box.h - bottom
  const count = bars.length
  const slot = count === 0 ? 0 : (box.w - left - right) / count
  const width = Math.min(slot * 0.6, 24)
  const yOf = (value: number) => top + (1 - (value - scale.lo) / (scale.hi - scale.lo)) * (floor - top)
  const centers = bars.map((_, index) => round(left + (index + 0.5) * slot))
  const rects: BarRect[] = []
  bars.forEach((bar, index) => {
    const x = round(centers[index] - width / 2)
    let sum = 0
    for (const part of bar.up) {
      if (part.value <= 0) continue
      const y = yOf(sum + part.value)
      rects.push({ x, y: round(y), w: round(width), h: round(Math.max(3, yOf(sum) - y - (sum > 0 ? 1 : 0))), color: part.color, index })
      sum += part.value
    }
    sum = 0
    for (const part of bar.down) {
      if (part.value <= 0) continue
      const y = yOf(-sum)
      const h = Math.max(3, yOf(-sum - part.value) - y - (sum > 0 ? 1 : 0))
      rects.push({ x, y: round(y + (sum > 0 ? 1 : 0)), w: round(width), h: round(h), color: part.color, index })
      sum += part.value
    }
  })
  return {
    slot: round(slot),
    width: round(width),
    rects,
    grid: scale.grid.map((line) => ({ y: round(yOf(line.value)), label: line.label })),
    zero: round(yOf(0)),
    ref: ref === null ? null : round(yOf(ref)),
    centers,
    floor,
  }
}

/** The day under a pointer's x (in the chart's own units): the slot it falls in; -1 with no days. */
export function barAt(count: number, x: number, box = BAR_BOX): number {
  if (count === 0) return -1
  const { left, right } = BAR_MARGINS
  const slot = (box.w - left - right) / count
  return Math.max(0, Math.min(count - 1, Math.floor((x - left) / slot)))
}

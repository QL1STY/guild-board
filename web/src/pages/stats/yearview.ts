import { MONTHS } from '../../format.ts'
import type { YearCard } from '../../types.ts'

/**
 * The whole number a count from `from` to `value` shows when `t` (0 to 1) of its time has passed: eased out as a cube, rounded.
 * A counter counts from nothing the first time, and from the number it shows when a new read changes its value.
 */
export function countUp(value: number, t: number, from = 0): number {
  const k = Math.min(1, Math.max(0, t))
  return Math.round(from + (value - from) * (1 - (1 - k) ** 3))
}

/** The columns of the grid. */
const COLUMNS = 3

/** The kinds of card that take two columns where there is room: the character, and the month with its twelve bars. */
const WIDE = new Set(['character', 'biggest_month'])

/**
 * Which cards take two columns. The character and the biggest month do where there is room. A grid of three columns is full
 * when the cards and the wide ones among them add to a multiple of three, or to one more than a multiple: the last row then
 * has two cards, which share it. With one column over, the last card would stand alone across the whole grid, so one wide card
 * is given up (when two or more are wide) or the card with the most to say is made wide (when one is or none).
 */
function wideOnes(cards: YearCard[]): boolean[] {
  const wide = cards.map((card) => cards.length > 3 && WIDE.has(card.kind))
  const count = wide.filter(Boolean).length
  if (cards.length <= 3 || (cards.length + count) % COLUMNS !== 1) return wide
  if (count >= 2) {
    wide[wide.lastIndexOf(true)] = false
    return wide
  }
  const weight = (card: YearCard) => card.line.length + 60 * card.faces.length + (card.kind === 'resin' ? 80 : 0)
  let most = -1
  cards.forEach((card, at) => {
    if (!wide[at] && (most < 0 || weight(card) > weight(cards[most]))) most = at
  })
  if (most >= 0) wide[most] = true
  return wide
}

type Packed = YearCard & { span: number }

/** The cards in the order given, row by row (see `packCards`). `wide` says for each card, by its place in `cards`, whether it wants two columns. */
function lay(cards: YearCard[], wide: boolean[]): Packed[] {
  const pending = cards.map((card, at) => ({ card, wide: wide[at] }))
  const packed: Packed[] = []
  while (pending.length > 0) {
    const row: { card: YearCard; wide: boolean; span: number }[] = []
    let space = COLUMNS
    while (space > 0 && pending.length > 0) {
      const ahead = pending[0].wide && space < 2 ? pending.findIndex((one) => !one.wide) : 0
      const [one] = pending.splice(Math.max(0, ahead), 1)
      const span = one.wide ? Math.min(2, space) : 1
      row.push({ ...one, span })
      space -= span
    }
    // Only the last row can be short: its cards share what is left, the wide ones first.
    const order = [...row.keys()].sort((a, b) => Number(row[b].wide) - Number(row[a].wide))
    for (let at = 0; space > 0; at = (at + 1) % order.length, space -= 1) row[order[at]].span += 1
    packed.push(...row.map((one) => ({ ...one.card, span: one.span })))
  }
  return packed
}

/**
 * The cards in a grid of three columns with no hole in it, in the order given: a wide card takes two columns where two are left in
 * its row, and where one is left the next narrow card takes it (a wide card with none behind it narrows). Only the last row can
 * be short, and its cards share what is left, the wide ones first. When that leaves one card alone across the last row, the one
 * card is moved that takes the least change of order to avoid it (the last card first). The list comes back in row order.
 */
export function packCards(cards: YearCard[]): Packed[] {
  const wide = wideOnes(cards)
  const alone = (packed: Packed[]): boolean => packed.length > 1 && packed[packed.length - 1].span === COLUMNS
  const first = lay(cards, wide)
  if (!alone(first)) return first
  const moves: [number, number][] = []
  for (let from = cards.length - 1; from >= 0; from -= 1) {
    for (let to = 0; to < cards.length; to += 1) if (to !== from) moves.push([from, to])
  }
  moves.sort((a, b) => Math.abs(a[0] - a[1]) - Math.abs(b[0] - b[1]))
  for (const [from, to] of moves) {
    const order = cards.map((_, at) => at)
    order.splice(to, 0, ...order.splice(from, 1))
    const moved = lay(order.map((at) => cards[at]), order.map((at) => wide[at]))
    if (!alone(moved)) return moved
  }
  return first
}

const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/**
 * A month of the biggest-month card: `kept` with its wishes (none is a real zero), `untracked` for a month gone by that the
 * wish history does not reach, `later` for a month after the core's today.
 */
export type MonthBar = {
  name: string
  label: string
  wishes: number
  height: number
  peak: boolean
  state: 'kept' | 'untracked' | 'later'
}

/**
 * The twelve bars of the biggest-month card: the month with the most wishes is the full height and a month with none keeps a
 * baseline. A month gone by that the history does not reach (no number) is a ghost the whole height, which never reads as a
 * month with none, and a month after `through` (the last month the year has reached on the core's clock, 12 for a year gone
 * by) is nothing. Nothing when the card has no twelve months.
 */
export function monthBars(numbers: Record<string, unknown>): MonthBar[] {
  const months = numbers.months
  if (!Array.isArray(months) || months.length !== 12) return []
  const counts = months.map((count) => whole(count))
  const most = Math.max(...counts.map((count) => count ?? 0), 1)
  const peak = whole(numbers.month)
  const through = whole(numbers.through) ?? 12
  return counts.map((count, at) => {
    const state = count !== null ? 'kept' : at + 1 > through ? 'later' : 'untracked'
    const wishes = Math.max(0, count ?? 0)
    const height = state === 'kept' ? Math.max(2, Math.round((wishes / most) * 100)) : state === 'untracked' ? 100 : 0
    return { name: MONTHS[at], label: MONTHS[at][0], wishes, height, peak: peak === at + 1, state }
  })
}

/** The share of the year's resin that went into Condensed Resin, in percent; none where nothing did. */
export function resinShare(numbers: Record<string, unknown>): number | null {
  const total = whole(numbers.total)
  const crafted = whole(numbers.crafted)
  if (total === null || crafted === null || total <= 0 || crafted <= 0) return null
  return Math.min(100, Math.max(1, Math.round((crafted / total) * 100)))
}

/** The faces a card shows, at most `most`, and how many more there are. */
export function faceList(faces: string[], most = 8): { shown: string[]; more: number } {
  return { shown: faces.slice(0, most), more: Math.max(0, faces.length - most) }
}

/** The year switch: nothing for a single year; the current year, the one still going, is "so far". */
export function yearOptions(years: number[], chosen: number, current: number): { year: number; label: string; on: boolean }[] {
  if (years.length < 2) return []
  return years.map((year) => ({ year, label: year === current ? `${year} so far` : String(year), on: year === chosen }))
}

import { change, dayMonth, duration, num, plural } from '../format.ts'
import type { Stats, Tile } from '../types.ts'

export const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'all', label: 'All' },
] as const

export type Range = Stats['range']

/** The parts of a Stats answer that say which period it covers. */
export type Scope = Pick<Stats, 'range' | 'period' | 'coverage'>

/** "in the last 30 days", or "since 15 Jul" for the whole history. */
export function inPeriod(scope: Scope): string {
  return scope.range === 'all' ? `since ${dayMonth(scope.period.first)}` : `in the last ${scope.period.days} days`
}

/** The same at the start of a line: "Last 30 days", "Since 15 Jul". */
export function periodTitle(scope: Scope): string {
  return scope.range === 'all' ? `Since ${dayMonth(scope.period.first)}` : `Last ${scope.period.days} days`
}

/** The earlier end of a comparison: "30 days ago", or the day tracking began when the period starts there. */
export function startLabel(scope: Scope): string {
  const since = scope.coverage.tracking_since
  if (since !== null && (scope.range === 'all' || scope.coverage.partial)) return `On ${dayMonth(since)}`
  return `${scope.period.days} days ago`
}

/** What the page says when the history does not reach back over the whole period (spec section 9). */
export function coverageNote(coverage: Stats['coverage']): string | null {
  if (coverage.tracking_since === null) return 'No history yet'
  return coverage.partial ? `Tracking since ${dayMonth(coverage.tracking_since)}` : null
}

/**
 * The date range beside the title (freshness design, section 2): "5 Oct – 3 Nov", and its tip, which adds where the
 * history begins when it does not reach back over the whole period: "5 Oct – 3 Nov. Tracking since 19 Oct."
 */
export function rangeChip(first: string, last: string, coverage: Stats['coverage']): { label: string; tip: string } {
  const label = first === last ? dayMonth(first) : `${dayMonth(first)} – ${dayMonth(last)}`
  const note = coverageNote(coverage)
  return { label, tip: note === null ? label : `${label}. ${note}.` }
}

export type TileView = {
  id: Tile['id']
  label: string
  /** The big figure as words. Unit words are set small. */
  figure: { text: string; small?: true }[]
  /** The line under the figure: a change in bold, coloured only when it is a gain, then the rest. */
  line: { strong: string | null; gain: boolean; rest: string }
  /** The trend line and what its tooltip says; null for a tile without one. */
  trend: { values: number[]; tip: string } | null
  /** A share from 0 to 1, for the tile that shows a meter. */
  meter: number | null
}

function compared(delta: number | null, text: (amount: number) => string, scope: Scope): TileView['line'] {
  if (delta === null) {
    return { strong: null, gain: false, rest: scope.range === 'all' ? periodTitle(scope) : 'No earlier period to compare' }
  }
  return { strong: change(delta, text), gain: delta > 0, rest: `vs previous ${scope.period.days} days` }
}

function trendOf(values: number[], text: (amount: number) => string): TileView['trend'] {
  if (values.length === 0) return null
  return { values, tip: `Lowest ${text(Math.min(...values))}, highest ${text(Math.max(...values))}` }
}

function hoursAndMinutes(minutes: number): TileView['figure'] {
  const total = Math.max(0, Math.round(minutes))
  const rest = total % 60
  if (total < 60) return [{ text: String(rest) }, { text: 'min', small: true }]
  return [
    { text: num(Math.floor(total / 60)) },
    { text: 'h', small: true },
    { text: String(rest).padStart(2, '0') },
    { text: 'min', small: true },
  ]
}

/** The number a tile's figure counts up to: the figure's value, and for Playtime its minutes. */
export function countedValue(tile: Tile): number {
  return tile.id === 'playtime' ? tile.minutes : tile.value
}

/**
 * A tile's big figure worded for `value`, the number on it while it counts up. At the end of the count, with the
 * tile's own `countedValue`, it is the figure the tile ends on. Days played's length of the period is `of` while it
 * counts with the number from the period before (Tiles.tsx), and the tile's own otherwise; it is never shown below the
 * number, so that no figure on the way has more days played than days ("27 of 7").
 */
export function figureOf(tile: Tile, value: number, of?: number): TileView['figure'] {
  switch (tile.id) {
    case 'playtime':
      return hoursAndMinutes(value)
    case 'days':
      return [{ text: num(value) }, { text: `of ${num(Math.max(of ?? tile.of, value))}`, small: true }]
    default:
      return [{ text: num(value) }]
  }
}

/** What one tile shows, in words. */
export function tileView(tile: Tile, scope: Scope): TileView {
  const { id, label } = tile
  const figure = figureOf(tile, countedValue(tile))
  switch (tile.id) {
    case 'playtime':
      return {
        id,
        label,
        figure,
        line: compared(tile.delta_minutes, duration, scope),
        trend: trendOf(tile.trend, duration),
        meter: null,
      }
    case 'days':
      return {
        id,
        label,
        figure,
        line: { strong: null, gain: false, rest: `Longest run ${plural(tile.longest_run, 'day')}` },
        trend: null,
        meter: tile.of > 0 ? Math.min(1, tile.value / tile.of) : 0,
      }
    default:
      return {
        id,
        label,
        figure,
        line: compared(tile.delta, num, scope),
        trend: trendOf(tile.trend, num),
        meter: null,
      }
  }
}

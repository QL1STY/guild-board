import { dayMonth, num, weekday } from '../format.ts'
import type { Group, PrimogemColumn, PrimogemColumns } from '../ledgertypes.ts'
import type { TableData } from './ChartCard.tsx'

/**
 * The columns chart's words and, for primogems, its stack by source (the ledger plan, Task 7): each column split into
 * the five groups of the game's reasons, from the bottom in `order`. A day that neither the game's log nor the diary's
 * detail records is empty, never an estimate; a column that includes such days is striped.
 */
export type Stack = { order: readonly Group[]; labels: Record<Group, string>; colours: Record<Group, string> }

/** What an empty column and a column with some empty days are called: days without a sync for the counts, days
 * without a record for the primogems. */
export type Words = { none: string; partial: string }
export const SYNC_WORDS: Words = { none: 'No sync', partial: 'Includes days without a sync' }
export const RECORD_WORDS: Words = { none: 'No record', partial: 'Includes days without a record' }

/** The plan's colours, as tokens: the progress gold, Resin's series blue, two of the wishes' colours, and a quiet tan. */
export const GROUP_COLOURS: Record<Group, string> = {
  commissions: 'var(--fill)',
  welkin: 'var(--series)',
  events: 'var(--wish-standard)',
  endgame: 'var(--wish-chronicled)',
  other: 'var(--other)',
}

/** Whether the core split the columns by source: it sends the order, and some column has its groups. */
export function stacked(data: PrimogemColumns): boolean {
  return data.groups_order !== undefined && data.columns.some((column) => column.groups !== undefined)
}

/** A column's parts, in order from the bottom, with what share of the column each is; none without groups. */
export function segmentsOf(
  column: PrimogemColumn,
  order: readonly Group[],
): { group: Group; value: number; share: number }[] {
  const groups = column.groups
  if (groups === undefined || column.no_data) return []
  const sum = order.reduce((total, group) => total + Math.max(0, groups[group] ?? 0), 0)
  if (sum <= 0) return []
  return order
    .filter((group) => (groups[group] ?? 0) > 0)
    .map((group) => ({ group, value: groups[group], share: groups[group] / sum }))
}

/** The stripe a column is drawn with: a gap's, or none. */
export function stripeOf(column: PrimogemColumn): 'gap' | null {
  return !column.no_data && column.after_gap ? 'gap' : null
}

/** "Tue 21 Oct" for a day, "21 Oct" for a week's first day. */
export function dayOf(label: string, unit: 'day' | 'week'): string {
  return unit === 'week' ? dayMonth(label) : `${weekday(label)} ${dayMonth(label)}`
}

/**
 * What a column's tip and label say, a line each. Without a stack: "Sun 20 Sep: 120, includes days without a sync".
 * With one: "Tue 21 Oct · 150 primogems", then each group it holds with its amount, and the note of a partial column.
 */
export function columnTip(
  column: PrimogemColumn,
  unit: 'day' | 'week',
  noun: string,
  stack?: Stack,
  words: Words = SYNC_WORDS,
): string[] {
  const name = unit === 'week' ? `Week of ${dayOf(column.label, unit)}` : dayOf(column.label, unit)
  if (column.no_data) return [`${name}: ${words.none.toLowerCase()}`]
  if (stack === undefined) {
    return [`${name}: ${num(column.value)}${column.after_gap ? `, ${words.partial.toLowerCase()}` : ''}`]
  }
  const lines = [`${name} · ${num(column.value)} ${noun.toLowerCase()}`]
  for (const segment of segmentsOf(column, stack.order)) lines.push(`${stack.labels[segment.group]} ${num(segment.value)}`)
  if (column.after_gap) lines.push(words.partial)
  return lines
}

/** The chart's table: a row per column, with each group's amount when stacked ("–" where the day has none). */
export function columnsTable(data: PrimogemColumns, noun: string, stack?: Stack, words: Words = SYNC_WORDS): TableData {
  const groupHeads = stack === undefined ? [] : stack.order.map((group) => stack.labels[group])
  return {
    head: [data.unit === 'week' ? 'Week of' : 'Day', noun, ...groupHeads, 'Note'],
    rows: data.columns.map((column) => {
      const groups = column.groups
      const parts =
        stack === undefined
          ? []
          : stack.order.map((group) => (column.no_data || groups === undefined ? '–' : num(groups[group] ?? 0)))
      const note = column.no_data ? words.none : column.after_gap ? words.partial : ''
      return [dayOf(column.label, data.unit), column.no_data ? '–' : num(column.value), ...parts, note]
    }),
    numeric: [1, ...groupHeads.map((_, at) => at + 2)],
  }
}

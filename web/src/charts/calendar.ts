import { dayMonth, duration, monthName, weekday } from '../format.ts'
import type { Stats } from '../types.ts'

export type Cell = Stats['calendar']['cells'][number]

/** The label over each week column: the month's name where a month begins, otherwise nothing. */
export function monthMarks(cells: Cell[]): string[] {
  const months: string[] = []
  for (let first = 0; first < cells.length; first += 7) months.push(monthName(cells[first].day))
  return months.map((month, week) => {
    // The first column is named only when the next one is the same month, so that two names never touch.
    if (week === 0) return months[1] === month ? month : ''
    return month !== months[week - 1] ? month : ''
  })
}

/** What a cell says on hover, and to a screen reader. */
export function cellTip(cell: Cell): string {
  const day = `${weekday(cell.day)} ${dayMonth(cell.day)}`
  if (cell.minutes === null) return `${day}: no data`
  return cell.minutes === 0 ? `${day}: none recorded` : `${day}: ${duration(cell.minutes)}`
}

/** The calendar as a table: one row per week, starting with the date of its first day. */
export function weekRows(cells: Cell[]): string[][] {
  const rows: string[][] = []
  for (let first = 0; first < cells.length; first += 7) {
    const week = cells.slice(first, first + 7)
    rows.push([
      dayMonth(week[0].day),
      ...week.map((cell) => (cell.minutes === null ? '' : cell.minutes === 0 ? '–' : duration(cell.minutes))),
    ])
  }
  return rows
}

/** The fewest weeks the calendar shows, in however narrow a card. */
export const MIN_WEEKS = 4

/** How many week columns fit `width`, with `labels` pixels taken by the weekday labels: whole columns only. */
export function weeksThatFit(width: number, cell: number, gap: number, labels: number): number {
  return Math.max(MIN_WEEKS, Math.floor((width - labels + gap) / (cell + gap)))
}

/** The cell size at which seven rows fill `height`, under `labelsAbove` pixels of month names, within `min` and `max`. */
export function cellSize(height: number, gap: number, labelsAbove: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor((height - labelsAbove - 6 * gap) / 7)))
}

/** The newest `weeks` weeks of `cells`, which come in whole weeks, the newest last. */
export function lastWeeks(cells: Cell[], weeks: number): Cell[] {
  return cells.slice(Math.max(0, cells.length - weeks * 7))
}

/** The run of days played, as the legend row says it: the run now, if any, and the best. */
export function runText(run: { current: number; best: number }): string {
  const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`
  if (run.best === 0) return ''
  return run.current > 0 ? `${days(run.current)} in a row · Best ${days(run.best)}` : `Best ${days(run.best)}`
}

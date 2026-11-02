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

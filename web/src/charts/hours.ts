import type { Stats } from '../types.ts'

export type PlayHours = Stats['play_hours']

/** The weekdays as the core's rows go, Monday first. */
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/** The names beside the grid. */
export const WEEKDAY_SHORT = WEEKDAY_NAMES.map((name) => name.slice(0, 3))

/** What each of the five levels of a cell means, none first: the legend. */
export const HOUR_LEVELS = ['None', 'Under 15 min', 'Under 30 min', 'Under 45 min', '45 min or more']

const twoDigits = (hour: number) => String(hour).padStart(2, '0')

/** The hours of the day as the table's headings and the grid's labels: "00" to "23". */
export const HOURS = Array.from({ length: 24 }, (_, hour) => twoDigits(hour))

/**
 * What a cell says on hover, and to a screen reader: "Tuesdays, 20:00 to 21:00: 32 min on average". `weekday` counts
 * from Monday at 0. A cell with no minutes is a weekday that Guild Board was not tracking (null), which is not the same
 * as a weekday in which nothing was played (0).
 */
export function hourTip(weekday: number, hour: number, minutes: number | null): string {
  const when = `${WEEKDAY_NAMES[weekday]}s, ${twoDigits(hour)}:00 to ${twoDigits(hour + 1)}:00`
  if (minutes === null) return `${when}: not tracked`
  if (minutes <= 0) return `${when}: none recorded`
  return `${when}: ${minutes < 0.5 ? 'under 1' : Math.round(minutes)} min on average`
}

export type HourCell = { weekday: number; hour: number; minutes: number | null; level: number; tip: string }

/**
 * The 168 cells in the order the grid is drawn and walked in: an hour at a time, each from Monday to Sunday, so that a
 * column of the grid is an hour. The arrow keys move by one cell up and down and by seven across (ui/roving.ts).
 */
export function hourCells(play: PlayHours): HourCell[] {
  return HOURS.flatMap((_, hour) =>
    WEEKDAY_NAMES.map((_, weekday) => {
      const minutes = play.cells[weekday][hour]
      return { weekday, hour, minutes, level: play.levels[weekday][hour], tip: hourTip(weekday, hour, minutes) }
    }),
  )
}

/** The same cells as a table: a row for each weekday, with its name and then the minutes of each hour. */
export function hourRows(play: PlayHours): string[][] {
  const text = (minutes: number | null) =>
    minutes === null ? '' : minutes <= 0 ? '–' : minutes < 0.5 ? '<1' : String(Math.round(minutes))
  return play.cells.map((row, weekday) => [WEEKDAY_NAMES[weekday], ...row.map(text)])
}

/** Whether some weekday has no cells with minutes: the part of the period that Guild Board tracked holds none of it. */
export function notTracked(play: PlayHours): boolean {
  return play.days.some((count) => count === 0)
}

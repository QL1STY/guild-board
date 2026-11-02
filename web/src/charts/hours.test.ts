import { expect, test } from 'vitest'
import type { Stats } from '../types.ts'
import { HOUR_LEVELS, HOURS, hourCells, hourRows, hourTip, notTracked } from './hours.ts'

/** Seven weekdays of 24 hours, each hour with the minutes that `minutes` gives for its weekday and hour. */
function play(
  minutes: (weekday: number, hour: number) => number | null = () => 0,
  days: number[] = [4, 4, 4, 4, 4, 4, 4],
): Stats['play_hours'] {
  const cells = Array.from({ length: 7 }, (_, weekday) =>
    Array.from({ length: 24 }, (_, hour) => (days[weekday] === 0 ? null : minutes(weekday, hour))),
  )
  const levels = cells.map((row) => row.map((cell) => (cell === null || cell <= 0 ? 0 : cell < 15 ? 1 : cell < 30 ? 2 : cell < 45 ? 3 : 4)))
  return { cells, levels, days, empty: cells.every((row) => row.every((cell) => !cell)) }
}

test('a cell of play by the hour says its weekday, hour and minutes', () => {
  expect(hourTip(1, 20, 32)).toBe('Tuesdays, 20:00 to 21:00: 32 min on average')
  expect(hourTip(6, 23, null)).toBe('Sundays, 23:00 to 24:00: not tracked')
})

test('a cell says none for no play, and under a minute for a little', () => {
  expect(hourTip(0, 0, 0)).toBe('Mondays, 00:00 to 01:00: none recorded')
  expect(hourTip(2, 9, 0.3)).toBe('Wednesdays, 09:00 to 10:00: under 1 min on average')
  expect(hourTip(4, 5, 7.5)).toBe('Fridays, 05:00 to 06:00: 8 min on average')
  expect(hourTip(5, 22, 60)).toBe('Saturdays, 22:00 to 23:00: 60 min on average')
})

test('the legend names the five levels', () => {
  expect(HOUR_LEVELS).toEqual(['None', 'Under 15 min', 'Under 30 min', 'Under 45 min', '45 min or more'])
})

test('the hours are two digits, from 00 to 23', () => {
  expect(HOURS).toHaveLength(24)
  expect(HOURS[0]).toBe('00')
  expect(HOURS[9]).toBe('09')
  expect(HOURS[23]).toBe('23')
})

test('the cells go column by column, an hour at a time from Monday to Sunday', () => {
  const cells = hourCells(play((weekday, hour) => weekday * 100 + hour))
  expect(cells).toHaveLength(168)
  expect(cells.slice(0, 8).map((cell) => [cell.weekday, cell.hour])).toEqual([
    [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [0, 1],
  ])
  expect(cells[8]).toEqual({ weekday: 1, hour: 1, minutes: 101, level: 4, tip: hourTip(1, 1, 101) })
  expect(cells[167].weekday).toBe(6)
  expect(cells[167].hour).toBe(23)
})

test('a weekday that was not tracked has cells that say so', () => {
  const week = play(() => 10, [4, 4, 0, 4, 4, 4, 4])
  const wednesday = hourCells(week).filter((cell) => cell.weekday === 2)
  expect(wednesday).toHaveLength(24)
  expect(wednesday.every((cell) => cell.minutes === null && cell.level === 0)).toBe(true)
  expect(wednesday[20].tip).toBe('Wednesdays, 20:00 to 21:00: not tracked')
  expect(notTracked(week)).toBe(true)
  expect(notTracked(play())).toBe(false)
})

test('the table has a row per weekday and a column per hour', () => {
  const rows = hourRows(play((weekday, hour) => (weekday === 1 && hour === 20 ? 32.4 : weekday === 1 && hour === 21 ? 0.2 : 0)))
  expect(rows).toHaveLength(7)
  expect(rows.map((row) => row[0])).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
  expect(rows.every((row) => row.length === 25)).toBe(true)
  expect(rows[1][1 + 20]).toBe('32')
  expect(rows[1][1 + 21]).toBe('<1')
  expect(rows[1][1 + 19]).toBe('–')
})

test('a weekday that was not tracked is a row with empty cells', () => {
  const rows = hourRows(play(() => 10, [4, 0, 4, 4, 4, 4, 4]))
  expect(rows[1]).toEqual(['Tuesday', ...Array(24).fill('')])
  expect(rows[0][1]).toBe('10')
})

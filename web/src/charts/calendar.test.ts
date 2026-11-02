import { expect, test } from 'vitest'
import { type Cell, cellTip, monthMarks, weekRows } from './calendar.ts'

/** `count` days from `first`, each with the minutes that `minutes` gives for its position. */
function days(first: string, count: number, minutes: (index: number) => number | null = () => 0): Cell[] {
  const start = Date.parse(`${first}T00:00:00Z`)
  return Array.from({ length: count }, (_, index) => ({
    day: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    minutes: minutes(index),
    level: null,
  }))
}

test('a month is named over the week in which it begins', () => {
  expect(monthMarks(days('2026-07-27', 84))).toEqual(['', 'Aug', '', '', '', '', 'Sep', '', '', '', 'Oct', ''])
})

test('the first week is named only when the name has room', () => {
  expect(monthMarks(days('2026-08-03', 28))).toEqual(['Aug', '', '', ''])
  expect(monthMarks(days('2026-10-12', 7))).toEqual([''])
})

test('a cell says its day and the time played', () => {
  expect(cellTip({ day: '2026-10-12', minutes: 93, level: 3 })).toBe('Mon 12 Oct: 1 h 33 min')
  expect(cellTip({ day: '2026-10-13', minutes: 0, level: 0 })).toBe('Tue 13 Oct: none recorded')
  expect(cellTip({ day: '2026-10-14', minutes: null, level: null })).toBe('Wed 14 Oct: no data')
})

test('the table has one row per week', () => {
  const cells = days('2026-10-05', 14, (index) => (index === 0 ? 28 : index === 1 ? 137 : index > 8 ? null : 0))
  expect(weekRows(cells)).toEqual([
    ['5 Oct', '28 min', '2 h 17 min', '–', '–', '–', '–', '–'],
    ['12 Oct', '–', '–', '', '', '', '', ''],
  ])
})

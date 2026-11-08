import { expect, test } from 'vitest'
import { type Cell, cellSize, cellTip, lastWeeks, monthMarks, runText, weekRows, weeksThatFit } from './calendar.ts'

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

test('weeksThatFit never cuts a column', () => {
  expect(weeksThatFit(520, 17, 3, 34)).toBe(24) // (520 - 34 + 3) / 20 = 24.45
  expect(weeksThatFit(100, 17, 3, 34)).toBe(4) // never fewer than 4
})

test('cellSize grows to fill the height, within bounds', () => {
  expect(cellSize(220, 3, 14, 17, 24)).toBe(24)
  expect(cellSize(120, 3, 14, 17, 24)).toBe(17)
  expect(cellSize(160, 3, 14, 17, 24)).toBe(18) // (160 - 14 - 18) / 7 = 18.28
})

test('lastWeeks keeps the newest weeks', () => {
  const cells = days('2026-10-05', 21)
  expect(lastWeeks(cells, 2)).toEqual(cells.slice(7))
  expect(lastWeeks(cells, 9)).toEqual(cells)
})

test('runText', () => {
  expect(runText({ current: 6, best: 9 })).toBe('6 days in a row · Best 9 days')
  expect(runText({ current: 0, best: 9 })).toBe('Best 9 days')
  expect(runText({ current: 1, best: 1 })).toBe('1 day in a row · Best 1 day')
  expect(runText({ current: 0, best: 0 })).toBe('')
})

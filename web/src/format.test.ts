import { expect, test } from 'vitest'
import {
  ago, change, countdown, dayMonth, duration, left, localDay, localTime, monthName, num, pct, period, plural, weekday,
} from './format.ts'

test('large numbers get separators', () => {
  expect(num(4812)).toBe('4,812')
  expect(num(1234567)).toBe('1,234,567')
  expect(num(0)).toBe('0')
  expect(num(96.4)).toBe('96')
})

test('whole percentages are rounded down', () => {
  expect(pct(36.8)).toBe('36%')
  expect(pct(99.6)).toBe('99%') // never "100%" before it is true
  expect(pct(100)).toBe('100%')
  expect(pct(36.8, 1)).toBe('36.8%')
  expect(pct(41, 1)).toBe('41%')
})

test('what is left keeps one decimal while it is small', () => {
  expect(left(0.9)).toBe('0.9% left')
  expect(left(4)).toBe('4% left')
  expect(left(12.4)).toBe('12% left')
})

test('durations', () => {
  expect(duration(45)).toBe('45 min')
  expect(duration(72)).toBe('1 h 12 min')
  expect(duration(125)).toBe('2 h 05 min')
  expect(duration(1880)).toBe('31 h 20 min')
  expect(duration(0)).toBe('0 min')
  expect(duration(-3)).toBe('0 min')
})

test('calendar dates', () => {
  expect(dayMonth('2026-09-14')).toBe('14 Sep')
  expect(weekday('2026-10-13')).toBe('Tue')
  expect(monthName('2026-09-14')).toBe('Sep')
  expect(period('2026-09-14', '2026-10-13')).toBe('14 Sep to 13 Oct')
  expect(period('2026-10-13', '2026-10-13')).toBe('13 Oct')
})

test("relative time is measured against the core's clock", () => {
  const now = new Date('2026-10-13T08:10:00Z')
  expect(ago('2026-10-13T08:09:30+00:00', now)).toBe('just now')
  expect(ago('2026-10-13T08:06:00+00:00', now)).toBe('4 min ago')
  expect(ago('2026-10-13T05:10:00+00:00', now)).toBe('3 h ago')
  expect(ago('2026-10-10T12:00:00+00:00', now)).toBe('on 10 Oct')
  expect(ago('2026-10-13T09:00:00+00:00', now)).toBe('just now') // an instant "in the future" means the clocks differ
})

test('an instant in the time of this PC', () => {
  expect(localTime('2026-10-13T08:02:00+00:00')).toMatch(/^1[34] Oct, \d\d:\d\d$/)
})

test("the day of an instant in this PC's time", () => {
  // Built from the PC's own clock, as the page reads an instant: month 9 is October, 10 is November.
  expect(localDay(new Date(2026, 9, 15, 18, 0).toISOString())).toBe('15 Oct')
  expect(localDay(new Date(2026, 9, 15, 0, 5).toISOString())).toBe('15 Oct')
  expect(localDay(new Date(2026, 10, 2, 23, 55).toISOString())).toBe('2 Nov')
})

test('plurals, the countdown and changes', () => {
  expect(plural(1, 'area')).toBe('1 area')
  expect(plural(3, 'area')).toBe('3 areas')
  expect(plural(2, 'day')).toBe('2 days')
  expect(plural(1200, 'entry', 'entries')).toBe('1,200 entries')
  expect(countdown(252)).toBe('4:12')
  expect(countdown(0)).toBe('0:00')
  expect(countdown(59.2)).toBe('1:00')
  expect(change(21)).toBe('▲ 21')
  expect(change(-5)).toBe('▼ 5')
  expect(change(0)).toBe('no change')
  expect(change(-125, duration)).toBe('▼ 2 h 05 min')
})

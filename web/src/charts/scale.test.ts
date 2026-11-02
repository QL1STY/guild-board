import { expect, test } from 'vitest'
import { axis, labelEvery } from './scale.ts'

test('the axis ends just above the largest value', () => {
  expect(axis(14)).toEqual({ top: 15, ticks: [0, 5, 10, 15] })
  expect(axis(17)).toEqual({ top: 20, ticks: [0, 5, 10, 15, 20] })
  expect(axis(37)).toEqual({ top: 40, ticks: [0, 10, 20, 30, 40] })
  expect(axis(73)).toEqual({ top: 80, ticks: [0, 20, 40, 60, 80] })
  expect(axis(129)).toEqual({ top: 150, ticks: [0, 50, 100, 150] })
  expect(axis(9)).toEqual({ top: 10, ticks: [0, 5, 10] })
})

test('small and empty charts still get whole-number ticks', () => {
  expect(axis(0)).toEqual({ top: 2, ticks: [0, 1, 2] })
  expect(axis(3)).toEqual({ top: 3, ticks: [0, 1, 2, 3] })
  expect(axis(5)).toEqual({ top: 6, ticks: [0, 2, 4, 6] })
})

test('the largest value never rises above the axis, and the axis is never much taller', () => {
  for (let max = 1; max <= 5000; max += 1) {
    const { top, ticks } = axis(max)
    expect(top).toBeGreaterThanOrEqual(max)
    expect(top).toBeLessThanOrEqual(max * 2)
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    expect(ticks.length).toBeLessThanOrEqual(5)
    expect(ticks[ticks.length - 1]).toBe(top)
  }
})

test('x-axis labels thin out as the columns multiply', () => {
  expect(labelEvery(7, 'day')).toBe(1)
  expect(labelEvery(30, 'day')).toBe(7)
  expect(labelEvery(45, 'day')).toBe(7)
  expect(labelEvery(8, 'week')).toBe(1)
  expect(labelEvery(14, 'week')).toBe(2)
  expect(labelEvery(104, 'week')).toBe(15)
})

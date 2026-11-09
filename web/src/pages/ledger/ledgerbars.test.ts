import { describe, expect, test } from 'vitest'

import { BAR_BOX, BAR_MARGINS, type BarDay, barAt, barScale, barsGeometry, niceStep } from './ledgerbars.ts'

const day = (up: number[], down: number[] = []): BarDay => ({
  day: '2026-10-01',
  known: true,
  up: up.map((value) => ({ value, color: 'var(--fill)' })),
  down: down.map((value) => ({ value, color: 'var(--src-other)' })),
})

describe('niceStep', () => {
  test('is 1, 2 or 5 times a power of ten that fits three steps', () => {
    expect(niceStep(1090)).toBe(500)
    expect(niceStep(198)).toBe(100)
    expect(niceStep(3.3)).toBe(2)
    expect(niceStep(9)).toBe(5)
    expect(niceStep(0)).toBe(1)
  })
})

describe('barScale', () => {
  test('crystals: room above and below, grid on whole steps and none on zero or at the top', () => {
    const scale = barScale([day([300], [300]), day([1090], [1090]), day([0], [60])])
    expect(scale.hi).toBeCloseTo(1199, 0)
    expect(scale.lo).toBeCloseTo(-1199, 0)
    expect(scale.grid.map((line) => line.label)).toEqual(['−1,000', '−500', '500', '1,000'])
  })

  test('with nothing going down the line is the floor', () => {
    const scale = barScale([day([2]), day([3])], { minHi: 4 })
    expect(scale.lo).toBe(0)
    expect(scale.hi).toBe(4)
    expect(scale.grid.map((line) => line.value)).toEqual([2])
  })

  test('a reference line is always inside', () => {
    const scale = barScale([day([100]), day([120])], { ref: 180 })
    expect(scale.hi).toBeGreaterThanOrEqual(180)
    expect(scale.grid.map((line) => line.value)).toEqual([100])
  })

  test('with no bars there is still a scale', () => {
    const scale = barScale([], { minHi: 4 })
    expect(scale.hi).toBe(4)
    expect(Number.isFinite(scale.step)).toBe(true)
  })
})

describe('barsGeometry', () => {
  const bars = [day([100]), day([50, 30], [20]), day([])]
  const scale = barScale(bars, { minHi: 100 })
  const drawing = barsGeometry(bars, scale, null)

  test('a bar a day in its slot, 60% of it wide', () => {
    const slot = (BAR_BOX.w - BAR_MARGINS.left - BAR_MARGINS.right) / 3
    expect(drawing.slot).toBeCloseTo(slot, 1)
    expect(drawing.width).toBe(24) // 60% of a slot is wider than 24
    expect(drawing.centers[1]).toBeCloseTo(BAR_MARGINS.left + 1.5 * slot, 1)
  })

  test('up parts stack above the zero line and down parts hang under it; a day of nothing has no bar', () => {
    const second = drawing.rects.filter((rect) => rect.index === 1)
    expect(second).toHaveLength(3)
    const [first, upper, below] = second
    expect(first.y + first.h).toBeLessThanOrEqual(drawing.zero + 0.01)
    expect(upper.y + upper.h).toBeLessThanOrEqual(first.y + 0.01)
    expect(below.y).toBeGreaterThanOrEqual(drawing.zero - 0.01)
    expect(drawing.rects.filter((rect) => rect.index === 2)).toHaveLength(0)
  })

  test('a part is at least 3 tall', () => {
    const tiny = barsGeometry([day([1])], barScale([day([1]), day([5000])]), null)
    expect(tiny.rects[0].h).toBeGreaterThanOrEqual(3)
  })

  test('the reference line has its y, the grid its labels', () => {
    const withRef = barsGeometry(bars, barScale(bars, { ref: 180 }), 180)
    expect(withRef.ref).not.toBeNull()
    expect(withRef.ref!).toBeLessThan(withRef.zero)
  })
})

describe('barAt', () => {
  test('the slot under a pointer, held to the first and last day', () => {
    expect(barAt(4, 0)).toBe(0)
    expect(barAt(4, BAR_BOX.w)).toBe(3)
    expect(barAt(4, 400)).toBe(2)
    expect(barAt(0, 400)).toBe(-1)
  })
})

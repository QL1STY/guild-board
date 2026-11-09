import { describe, expect, test } from 'vitest'

import { LEDGER_FIXTURE, type LedgerDay } from '../../ledgertypes.ts'
import { chartGeometry, dayAt, headline, rangeDays } from './ledgerchart.ts'

/** The fixture's October: the 31st ends at 10,255 (64 wishes), from 4,200: 7,815 earned, 1,760 spent. */
const OCT: LedgerDay[] = LEDGER_FIXTURE.days
const OCT_NO_HELD: LedgerDay[] = LEDGER_FIXTURE.days.map((day) => ({ ...day, held: null }))

/** The y of points along every cubic of a path "M x,y C x1,y1 x2,y2 x,y ...", with the two days' y the cubic runs between. */
function sampled(path: string): { y: number; from: number; to: number }[] {
  const numbers = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((found) => Number(found[0]))
  const out: { y: number; from: number; to: number }[] = []
  let y0 = numbers[1]
  for (let at = 2; at + 5 < numbers.length; at += 6) {
    const [, c1y, , c2y, , y3] = numbers.slice(at, at + 6)
    for (let step = 0; step <= 20; step += 1) {
      const t = step / 20
      const u = 1 - t
      out.push({ y: u ** 3 * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * y3, from: y0, to: y3 })
    }
    y0 = y3
  }
  return out
}

describe('rangeDays', () => {
  const six = Array.from({ length: 200 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 3, 12 + index)) // 12 April 2026 on
    return { day: date.toISOString().slice(0, 10), earned: 0, spent: 0, held: null, known: true, moments: [] } as LedgerDay
  }).filter((day) => day.day <= '2026-10-27')

  test('a week is the last seven days, today with them', () => {
    const week = rangeDays(six, 'week', '2026-10-27')
    expect(week.map((day) => day.day)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'])
  })

  test('a month is the calendar month so far', () => {
    const month = rangeDays(six, 'month', '2026-10-27')
    expect(month[0].day).toBe('2026-10-01')
    expect(month.at(-1)?.day).toBe('2026-10-27')
    expect(month).toHaveLength(27)
  })

  test('3 and 6 months are the last calendar months with this one', () => {
    expect(rangeDays(six, 'month3', '2026-10-27')[0].day).toBe('2026-08-01')
    expect(rangeDays(six, 'month6', '2026-10-27')[0].day).toBe('2026-05-01')
  })

  test('across a year end', () => {
    const days = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04'].map(
      (day): LedgerDay => ({ day, earned: 0, spent: 0, held: null, known: true, moments: [] }),
    )
    const week = rangeDays(days, 'week', '2027-01-03')
    expect(week).toHaveLength(7)
    expect(week[0].day).toBe('2026-12-28')
    // the days after today are never in a range
    expect(rangeDays(days, 'month3', '2027-01-03')).toHaveLength(7)
    expect(rangeDays(days, 'month', '2027-01-03').map((day) => day.day)).toEqual(['2027-01-01', '2027-01-02', '2027-01-03'])
  })
})

describe('chartGeometry', () => {
  const box = { w: 760, h: 230 }

  test('the chart never overshoots a day', () => {
    const { line } = chartGeometry(OCT, box)
    const samples = sampled(line)
    expect(samples.length).toBeGreaterThan(30 * 20)
    for (const sample of samples) {
      expect(sample.y).toBeGreaterThanOrEqual(Math.min(sample.from, sample.to) - 0.01)
      expect(sample.y).toBeLessThanOrEqual(Math.max(sample.from, sample.to) + 0.01)
    }
  })

  test('a flat stretch stays flat and a peak is the highest point drawn', () => {
    const flat = [100, 100, 100, 500, 100, 100].map((held, index): LedgerDay => ({ day: `2026-10-0${index + 1}`, earned: 0, spent: 0, held, known: true, moments: [] }))
    const geometry = chartGeometry(flat, box)
    const samples = sampled(geometry.line)
    // the first two segments are level (21 samples each)
    expect(samples.slice(0, 42).every((sample) => Math.abs(sample.y - geometry.points[0].y) < 0.01)).toBe(true)
    expect(Math.min(...samples.map((sample) => sample.y))).toBeCloseTo(geometry.points[3].y, 1)
  })

  test('the points run from the left edge to the right, a day each, with the day', () => {
    const { points } = chartGeometry(OCT, box)
    expect(points).toHaveLength(31)
    expect(points[0].day).toBe('2026-10-01')
    expect(points[0].x).toBeCloseTo(2, 6)
    expect(points[30].x).toBeCloseTo(758, 6)
    expect(points.every((point) => point.y >= 10 && point.y <= 202)).toBe(true)
  })

  test('a higher balance is higher on the chart: a smaller y', () => {
    const { points } = chartGeometry(OCT, box)
    const highest = OCT.reduce((best, day, index) => ((day.held ?? 0) > (OCT[best].held ?? 0) ? index : best), 0)
    expect(points[highest].y).toBe(Math.min(...points.map((point) => point.y)))
  })

  test('the dashed line is where the period started: the balance before its first day', () => {
    const { start, points } = chartGeometry(OCT, box)
    const first = OCT[0]
    expect(start.value).toBe((first.held ?? 0) - first.earned + first.spent)
    // 1 October earned 965 and spent nothing, so the balance rose from the start
    expect(points[0].y).toBeLessThan(start.y)
  })

  test('with no balance the line is the running net from 0, and starts at 0', () => {
    const { start, points } = chartGeometry(OCT_NO_HELD, box)
    expect(start.value).toBe(0)
    expect(points[0].y).toBeLessThan(start.y)
    // the dashed line is at the floor of the data's range or above; the last day's net is the month's, 6,055
    const levelled = chartGeometry(OCT_NO_HELD.map((day) => ({ ...day, spent: 0, earned: 100 })), box)
    expect(levelled.points[30].y).toBeLessThan(levelled.points[0].y)
  })

  test('the area closes along the floor of the chart', () => {
    const { line, area } = chartGeometry(OCT, box)
    expect(area.startsWith(line)).toBe(true)
    expect(area.endsWith('L758,202L2,202Z')).toBe(true)
  })

  test('a day with a big moment has a dot at its point', () => {
    const { moments, points } = chartGeometry(OCT, box)
    const expected = OCT.flatMap((day, index) => (day.moments.length > 0 ? [{ x: points[index].x, y: points[index].y }] : []))
    expect(moments).toEqual(expected)
    expect(moments.length).toBeGreaterThan(3)
  })

  test('no days, one day and a level balance draw without dividing by zero', () => {
    expect(chartGeometry([], box)).toMatchObject({ line: '', area: '', points: [], moments: [] })
    const one = chartGeometry(OCT.slice(0, 1), box)
    expect(one.points).toHaveLength(1)
    expect(Number.isFinite(one.points[0].x) && Number.isFinite(one.points[0].y)).toBe(true)
    const level = chartGeometry(
      OCT.map((day) => ({ ...day, held: 500, earned: 0, spent: 0 })),
      box,
    )
    expect(level.points.every((point) => Number.isFinite(point.y))).toBe(true)
  })
})

describe('dayAt', () => {
  const { points } = chartGeometry(OCT, { w: 760, h: 230 })

  test('the nearest day to a pointer', () => {
    expect(dayAt(points, -50)).toBe(0)
    expect(dayAt(points, 2)).toBe(0)
    expect(dayAt(points, points[10].x + 3)).toBe(10)
    expect(dayAt(points, points[10].x + 14)).toBe(11)
    expect(dayAt(points, 5000)).toBe(30)
  })

  test('with no points there is nothing to point at', () => {
    expect(dayAt([], 10)).toBe(-1)
  })
})

describe('headline', () => {
  test('headline names the held balance and the month', () => {
    expect(headline(OCT, null, 'month', 'October')).toEqual({
      label: 'Primogems held',
      amount: '10,255',
      wishes: '64 wishes',
      line: '+7,815 earned and −1,760 spent in October',
    })
  })

  test('without a balance the headline is the net', () => {
    const net = headline(OCT_NO_HELD, null, 'month', 'October')
    expect(net.label).toBe('Net in October')
    expect(net.amount).toBe('+6,055')
    expect(net.wishes).toBe('')
    expect(net.line).toBe('+7,815 earned and −1,760 spent in October')
  })

  test('another range words its own period but keeps the balance now', () => {
    const week = headline(OCT.slice(24), null, 'week', 'October')
    expect(week.label).toBe('Primogems held')
    expect(week.amount).toBe('10,255')
    expect(week.line).toMatch(/ in the last 7 days$/)
    expect(headline(OCT, null, 'month3', 'October').line).toMatch(/ in the last 3 months$/)
    expect(headline(OCT, null, 'month6', 'October').line).toMatch(/ in the last 6 months$/)
    expect(headline(OCT_NO_HELD, null, 'week', 'October').label).toBe('Net over the last 7 days')
  })

  test('nothing spent leaves the spending out', () => {
    const days = OCT.map((day) => ({ ...day, spent: 0 }))
    expect(headline(days, null, 'month', 'October').line).toBe('+7,815 earned in October')
  })

  test("a day under the pointer is that day's: its date, its balance, its moments", () => {
    const at = OCT.findIndex((day) => day.day === '2026-10-20')
    const day = headline(OCT, at, 'month', 'October')
    expect(day.label).toBe('Tuesday, 20 October')
    expect(day.amount).toBe((OCT[at].held ?? 0).toLocaleString('en-US'))
    expect(day.wishes).toBe(`${Math.floor((OCT[at].held ?? 0) / 160)} wishes`)
    expect(day.line).toBe(`+${OCT[at].earned} earned that day · Event reward +300`)
  })

  test("a day's spending and a spent moment are both named", () => {
    const at = OCT.findIndex((day) => day.day === '2026-10-22')
    expect(headline(OCT, at, 'month', 'October').line).toBe(`+${OCT[at].earned} earned and −1,600 spent that day · Shop purchase −1,600`)
  })

  test('without a balance a pointed day shows its net', () => {
    const at = OCT_NO_HELD.findIndex((day) => day.day === '2026-10-22')
    const day = headline(OCT_NO_HELD, at, 'month', 'October')
    expect(day.amount).toBe(`−${(1600 - OCT_NO_HELD[at].earned).toLocaleString('en-US')}`)
    expect(day.wishes).toBe('')
  })

  test('a day the game has no record of says so', () => {
    const days: LedgerDay[] = [{ day: '2026-10-05', earned: 0, spent: 0, held: 3000, known: false, moments: [] }]
    expect(headline(days, 0, 'month', 'October').line).toBe('No record of this day')
  })

  test('no days at all is unknown, not 0', () => {
    expect(headline([], null, 'month', 'October')).toEqual({ label: 'Net in October', amount: '—', wishes: '', line: 'No record of these days' })
  })

  test('a day the logs do not cover reads — with the pointer on it, with or without a balance, never 0 or a carried balance', () => {
    const gap = (held: number | null): LedgerDay[] => [
      { day: '2026-10-01', earned: 0, spent: 0, held, known: false, moments: [] },
      { day: '2026-10-02', earned: 90, spent: 0, held, known: true, moments: [] },
    ]
    for (const held of [null, 10_255]) {
      expect(headline(gap(held), 0, 'month', 'October')).toEqual({ label: 'Thursday, 1 October', amount: '—', wishes: '', line: 'No record of this day' })
    }
    expect(headline(gap(10_255), 1, 'month', 'October').amount).toBe('10,255')
    // A range of no known day: the net is unknown; a balance now is Pulls' own and stays.
    expect(headline(gap(null).slice(0, 1), null, 'month', 'October')).toMatchObject({ amount: '—', line: 'No record of these days' })
    expect(headline(gap(10_255).slice(0, 1), null, 'month', 'October')).toMatchObject({ label: 'Primogems held', amount: '10,255' })
  })
})

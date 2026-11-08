import { describe, expect, test } from 'vitest'
import year from '../../styles/year.css?raw'
import { contrast, over } from '../../styles/contrast.ts'
import type { YearCard } from '../../types.ts'
import { countUp, faceList, monthBars, packCards, resinShare, yearOptions } from './yearview.ts'

const card = (kind: string, numbers: Record<string, unknown> = {}, faces: string[] = []): YearCard => ({
  kind,
  heading: kind,
  big: kind,
  line: '',
  faces,
  numbers,
})

describe('countUp', () => {
  test('eases to the value', () => {
    expect(countUp(1003, 0)).toBe(0)
    expect(countUp(1003, 1)).toBe(1003)
    expect(countUp(1003, 0.5)).toBe(878) // rounded
  })
  test('stays between nothing and the value whatever t is', () => {
    expect(countUp(40, -1)).toBe(0)
    expect(countUp(40, 7)).toBe(40)
  })
  test('a new value counts from the value shown, never from nothing again', () => {
    // A read that changes 1,003 to 1,100: the counter goes on from 1,003.
    expect(countUp(1100, 0, 1003)).toBe(1003)
    expect(countUp(1100, 1, 1003)).toBe(1100)
    const steps = [0.1, 0.3, 0.5, 0.8].map((t) => countUp(1100, t, 1003))
    expect(steps.every((value) => value >= 1003 && value <= 1100)).toBe(true)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
    // A smaller one counts down to it.
    expect(countUp(900, 0, 1003)).toBe(1003)
    expect(countUp(900, 1, 1003)).toBe(900)
  })
})

describe('the aurora', () => {
  const plain = year.replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = /(?:^|\})\s*\.yr-aurora\s*\{([^}]*)\}/.exec(plain)?.[1] ?? ''
  test('is the size of the stage seen, never 160% of the whole tall stage', () => {
    // It turns for as long as the tab is open, so its layer is kept to what the window shows of the stage.
    expect(rule).not.toBe('')
    expect(rule).not.toMatch(/inset\s*:/)
    expect(rule).toMatch(/position:\s*sticky/)
    expect(rule).toMatch(/height:\s*min\(100%,\s*100vh\)/)
    expect(rule).toMatch(/animation:\s*yr-spin\b/)
  })
})

describe('packCards', () => {
  const kinds = ['character', 'luckiest', 'biggest_month', 'resin', 'artifacts', 'longest_session', 'welkin', 'abyss', 'theater']
  /** The rows as the grid lays them out: each is the spans of its cards. */
  const rowsOf = (spans: number[]): number[][] => {
    const rows: number[][] = [[]]
    for (const span of spans) {
      if (rows[rows.length - 1].reduce((sum, one) => sum + one, 0) === 3) rows.push([])
      rows[rows.length - 1].push(span)
    }
    return rows
  }
  test('every row of three columns is full, and none but a single card stands alone across it', () => {
    const wides = [[], ['character'], ['biggest_month'], ['character', 'biggest_month']]
    for (let count = 1; count <= 12; count += 1) {
      for (const wide of wides) {
        const plain = kinds.filter((kind) => kind !== 'character' && kind !== 'biggest_month')
        for (const order of [plain, [...plain].reverse()]) {
          const names = Array.from({ length: count }, (_, at) => wide[at] ?? order[at % order.length])
          const packed = packCards(names.map((kind) => card(kind)))
          const rows = rowsOf(packed.map((one) => one.span))
          const label = `${count} cards, wide ${wide.join('+') || 'none'}`
          expect(packed, label).toHaveLength(count)
          for (const row of rows) expect(row.reduce((sum, one) => sum + one, 0), label).toBe(3)
          if (count > 1) for (const row of rows) expect(row.length === 1 && row[0] === 3, `${label}: ${JSON.stringify(rows)}`).toBe(false)
        }
      }
    }
  })
  test('the character and the biggest month take two columns where there is room', () => {
    const packed = packCards(kinds.slice(0, 7).map((kind) => card(kind)))
    expect(packed.find((one) => one.kind === 'character')?.span).toBe(2)
    expect(packed.find((one) => one.kind === 'biggest_month')?.span).toBe(2)
  })
  test('keeps every card', () => {
    const packed = packCards(kinds.map((kind) => card(kind)))
    expect(packed.map((one) => one.kind).sort()).toEqual([...kinds].sort())
  })
})

describe('monthBars', () => {
  test('the biggest month is full height and the peak, and a month without wishes is a sliver', () => {
    const bars = monthBars({ month: 7, months: [267, 140, null, 0, 6, 12, 300, 198, 21, 51, 12, 3] })
    expect(bars).toHaveLength(12)
    expect(bars[6]).toMatchObject({ height: 100, peak: true, label: 'J', state: 'kept' })
    expect(bars[0].height).toBeCloseTo(89, 0)
    expect(bars[3]).toMatchObject({ height: 2, state: 'kept' }) // known to be none: the baseline
    expect(bars.filter((bar) => bar.peak)).toHaveLength(1)
  })
  test('a past month the history does not reach is a full-height ghost, and a month after today is nothing', () => {
    // The core's today is in October: November and December have not come.
    const bars = monthBars({ month: 8, through: 10, months: [null, null, 0, 12, 40, 30, 50, 90, 20, 10, null, null] })
    expect(bars.map((bar) => bar.state)).toEqual([
      'untracked', 'untracked', 'kept', 'kept', 'kept', 'kept', 'kept', 'kept', 'kept', 'kept', 'later', 'later',
    ])
    expect(bars[0]).toMatchObject({ height: 100, peak: false })
    expect(bars[2]).toMatchObject({ height: 2 }) // a real zero keeps its baseline
    expect(bars[11]).toMatchObject({ height: 0 })
    // A past year has no month to come: every month without a number is one the history does not reach.
    expect(monthBars({ month: 3, months: [...Array(11).fill(1), null] })[11].state).toBe('untracked')
  })
  test('twelve names for the months, a letter each', () => {
    expect(monthBars({ month: 1, months: Array(12).fill(1) }).map((bar) => bar.name)).toEqual([
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ])
  })
  test('numbers that are not there give no bars', () => {
    expect(monthBars({})).toEqual([])
    expect(monthBars({ month: 3, months: [1, 2] })).toEqual([])
  })
})

describe('resinShare', () => {
  test('the share that went into Condensed Resin, in percent, or none', () => {
    expect(resinShare({ total: 31350, crafted: 12840 })).toBe(41)
    expect(resinShare({ total: 100, crafted: 0 })).toBeNull()
    expect(resinShare({ total: 0, crafted: 0 })).toBeNull()
    expect(resinShare({})).toBeNull()
  })
})

describe('faceList', () => {
  test('at most eight faces, and one more says how many are left', () => {
    const faces = Array.from({ length: 11 }, (_, at) => `/api/art/${at}`)
    expect(faceList(faces)).toEqual({ shown: faces.slice(0, 8), more: 3 })
    expect(faceList(faces.slice(0, 2))).toEqual({ shown: faces.slice(0, 2), more: 0 })
  })
})

describe('yearOptions', () => {
  test('the switch is there only for more than one year, and the current one is so far', () => {
    expect(yearOptions([2026], 2026, 2026)).toEqual([])
    expect(yearOptions([2025, 2026], 2026, 2026)).toEqual([
      { year: 2025, label: '2025', on: false },
      { year: 2026, label: '2026 so far', on: true },
    ])
    expect(yearOptions([2025, 2026], 2025, 2026).map((one) => one.on)).toEqual([true, false])
  })
})

describe('the stage palette', () => {
  const stage = /\.yr-stage\s*\{([^}]*)\}/.exec(year.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1] ?? ''
  const token = (name: string) => new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(stage)?.[1] ?? ''
  test('small text reads at 4.5:1 or better on the night, its two glows and a card with the sheen over it', () => {
    const deep = token('--yr-deep')
    const deep2 = token('--yr-deep2')
    expect(deep).not.toBe('')
    for (const ground of [deep, deep2, over('#FFFFFF', 0.12, deep2), '#5A2D6E', '#3A2F78']) {
      for (const name of ['--yr-ink', '--yr-muted', '--yr-gold', '--yr-gold2']) {
        expect(contrast(token(name), ground), `${name} on ${ground}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  test('the button text reads on its gold', () => {
    expect(contrast(token('--yr-button-text'), token('--yr-gold'))).toBeGreaterThanOrEqual(4.5)
  })
})

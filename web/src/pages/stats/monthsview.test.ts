import { describe, expect, test } from 'vitest'
import type { MonthChip } from '../../types.ts'
import {
  CELL_ALONE,
  CELL_MAX,
  CELL_MIN,
  PART_GAP,
  calendarHeight,
  calendarWidth,
  deltaParts,
  deltaText,
  fiveWords,
  layoutParts,
  leadingBlanks,
  type MonthPart,
  noCompareText,
  partRange,
  type PartRow,
  recordText,
  stripYears,
  tileFigure,
} from './monthsview.ts'

const chip = (ym: string, over: Partial<MonthChip> = {}): MonthChip => {
  const [year, month] = ym.split('-').map(Number)
  const label = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]
  return { ym, label, year, thin: false, current: false, ...over }
}

describe('deltaText', () => {
  test('a gain of time reads in hours, the month it is compared with after it', () => {
    expect(deltaText(540, 'minutes', 'vs September')).toBe('▲ 9 h vs September')
    expect(deltaText(475, 'minutes', 'vs September')).toBe('▲ 7 h 55 min vs September')
    expect(deltaText(-25, 'minutes', 'vs September')).toBe('▼ 25 min vs September')
  })
  test('a loss of primogems is a plain number with its arrow', () => {
    expect(deltaText(-707, 'primogems', 'vs September')).toBe('▼ 707 vs September')
    expect(deltaText(1200, 'primogems', 'vs September')).toBe('▲ 1,200 vs September')
  })
  test('no change says so, and the partial month names the days it is compared over', () => {
    expect(deltaText(0, 'wishes', 'vs 1–6 Oct')).toBe('No change vs 1–6 Oct')
    expect(deltaText(0, 'minutes', 'vs September')).toBe('No change vs September')
  })
  test('a delta that cannot be made says nothing', () => {
    expect(deltaText(null, 'minutes', 'vs September')).toBe('')
  })
})

describe('noCompareText', () => {
  test('says what it was not compared with', () => {
    expect(noCompareText('vs July')).toBe('Not compared with July')
    expect(noCompareText('vs 1–6 Oct')).toBe('Not compared with 1–6 Oct')
  })
})

describe('stripYears', () => {
  test('groups the months by year, in order', () => {
    const groups = stripYears([chip('2025-11'), chip('2025-12'), chip('2026-01'), chip('2026-02', { thin: true })])
    expect(groups.map((group) => group.year)).toEqual([2025, 2026])
    expect(groups[0].months.map((month) => month.ym)).toEqual(['2025-11', '2025-12'])
    expect(groups[1].months.map((month) => month.ym)).toEqual(['2026-01', '2026-02'])
  })
  test('no months, no groups', () => {
    expect(stripYears([])).toEqual([])
  })
})

describe('tileFigure', () => {
  test('time is hours and minutes with the unit words small', () => {
    expect(tileFigure({ id: 'time', value: 2530, unit: 'minutes' }, null)).toEqual([
      { text: '42' },
      { text: 'h', small: true },
      { text: '10' },
      { text: 'min', small: true },
    ])
  })
  test('days played say of how many days the month has been tracked', () => {
    expect(tileFigure({ id: 'days', value: 13, unit: 'days' }, 31)).toEqual([{ text: '13' }, { text: 'of 31', small: true }])
    expect(tileFigure({ id: 'days', value: 13, unit: 'days' }, null)).toEqual([{ text: '13' }])
  })
  test('the rest are numbers', () => {
    expect(tileFigure({ id: 'primogems', value: 7529, unit: 'primogems' }, null)).toEqual([{ text: '7,529' }])
  })
})

describe('recordText', () => {
  test('writes each record with its unit and its day', () => {
    expect(recordText({ id: 'longest_session', label: '', value: 252, unit: 'minutes', when: '26 Oct' })).toBe('4 h 12 min · 26 Oct')
    expect(recordText({ id: 'best_primogem_day', label: '', value: 1320, unit: 'primogems', when: '16 Oct' })).toBe('1,320 · 16 Oct')
    expect(recordText({ id: 'longest_run', label: '', value: 9, unit: 'days', when: '5–13 Oct' })).toBe('9 days · 5–13 Oct')
    expect(recordText({ id: 'longest_run', label: '', value: 1, unit: 'days', when: '5 Oct' })).toBe('1 day · 5 Oct')
    expect(recordText({ id: 'luckiest', label: '', value: 12, unit: 'pulls', when: '15 Aug', name: 'Furina', icon: null })).toBe(
      'Furina · 12 pulls · 15 Aug',
    )
  })
})

describe('fiveWords', () => {
  test('says how a 5-star fell in the words of the Pulls page, and nothing more when it is not known', () => {
    expect(fiveWords(76, 'lost', 'character')).toBe('76 pulls, lost the 50/50')
    expect(fiveWords(1, 'won', 'character')).toBe('1 pull, won the 50/50')
    expect(fiveWords(40, 'lost', 'weapon')).toBe('40 pulls, lost the 75/25')
    expect(fiveWords(12, null, 'standard')).toBe('12 pulls')
    expect(fiveWords(12, 'lost', 'standard')).toBe('12 pulls')
    expect(fiveWords(null, null, 'character')).toBe('pity not known')
  })
})

describe('deltaParts', () => {
  test('gives the change and the month it is compared with apart', () => {
    expect(deltaParts(540, 'minutes', 'vs September')).toEqual({ change: '▲ 9 h', gain: true, rest: 'vs September' })
    expect(deltaParts(-707, 'primogems', 'vs September')).toEqual({ change: '▼ 707', gain: false, rest: 'vs September' })
    expect(deltaParts(0, 'wishes', 'vs 1–6 Oct')).toEqual({ change: 'No change', gain: false, rest: 'vs 1–6 Oct' })
    expect(deltaParts(null, 'wishes', 'vs July')).toBeNull()
  })
})

describe('leadingBlanks', () => {
  test('counts the days of the week before the first, a week beginning on Monday', () => {
    expect(leadingBlanks('2026-10-01')).toBe(3) // a Thursday
    expect(leadingBlanks('2026-06-01')).toBe(0) // a Monday
    expect(leadingBlanks('2026-02-01')).toBe(6) // a Sunday
  })
})

describe('the layout of the month', () => {
  const records = (rows: number): MonthPart => ({ id: 'records', wide: false, shape: { kind: 'rows', chrome: 74, rows } })
  const endgame = (rows: number): MonthPart => ({ id: 'endgame', wide: false, shape: { kind: 'rows', chrome: 74, rows } })
  const days = (weeks: number): MonthPart => ({ id: 'days', wide: false, shape: { kind: 'calendar', weeks } })
  const flow = (...counts: number[]): MonthPart => ({
    id: 'flow', wide: counts.length > 1, shape: { kind: 'lists', lists: counts.map((count) => ({ fives: false, count })) },
  })
  const pulls = (banners: number, fives: number): MonthPart => ({
    id: 'pulls',
    wide: fives > 0,
    shape: { kind: 'lists', lists: [{ fives: false, count: banners }, ...(fives > 0 ? [{ fives: true, count: fives }] : [])] },
  })
  /** The demo's months as their parts are (the demo of the Months and Wrapped design, section 7). */
  const DEMO: Record<string, MonthPart[]> = {
    january: [pulls(1, 0)],
    february: [records(1), pulls(1, 1)],
    march: [records(3), days(6), flow(5)],
    april: [records(3), days(5), flow(5)],
    may: [records(3), days(5), flow(5), pulls(3, 0)],
    june: [records(4), days(5), flow(5, 5), pulls(2, 1)],
    july: [records(3), days(5), flow(5, 5), pulls(3, 0)],
    august: [records(4), days(6), flow(5, 5), endgame(3), pulls(2, 2)],
    september: [records(3), days(5), flow(5, 5), endgame(3), pulls(2, 0)],
    october: [records(4), days(3), flow(5, 5), pulls(3, 1)],
  }

  /**
   * What is wrong with a layout, in words: a row of two parts or more that does not fill the width, a part alone wider than
   * two columns, a card that would end more than the page's 12 pixels short of its row or that its row cannot hold, a
   * calendar whose cells would not be square within a quarter, and a part missing or twice.
   */
  function faults(parts: MonthPart[], rows: PartRow[], width: number): string[] {
    const found: string[] = []
    const column = (width - 2 * PART_GAP) / 3
    const placed = rows.flatMap((row) => row.parts.map((part) => part.id))
    if ([...placed].sort().join() !== parts.map((part) => part.id).sort().join()) found.push(`parts ${placed.join()}`)
    for (const row of rows) {
      const used = row.parts.reduce((sum, part) => sum + part.width, 0) + PART_GAP * (row.parts.length - 1)
      if (row.alone !== (row.parts.length === 1)) found.push(`${row.parts[0].id}: alone is ${row.alone}`)
      if (!row.alone && Math.abs(used - width) > 0.5) found.push(`row of ${row.parts[0].id}: ${used} of ${width}`)
      if (row.alone && row.parts[0].width > 2 * column + PART_GAP) found.push(`${row.parts[0].id} alone is ${row.parts[0].width} wide`)
      for (const one of row.parts) {
        const part = parts.find((other) => other.id === one.id)!
        if (part.shape.kind === 'calendar') {
          const cell = one.cell!
          if (cell < CELL_MIN || cell > CELL_MAX) found.push(`cell ${cell}`)
          if (one.width !== calendarWidth(cell)) found.push(`calendar ${one.width} wide at ${cell}`)
          const natural = calendarHeight(part.shape.weeks, cell)
          const grown = (row.height - natural) / part.shape.weeks
          if (natural > row.height + 0.5 || (cell + grown) / cell > 1.25) found.push(`calendar ${natural} in a row of ${row.height}`)
        } else {
          const range = partRange(part.shape, one.width)
          if (range.min > row.height + 0.5) found.push(`${one.id} ${range.min} in a row of ${row.height}`)
          if (row.height - range.max > 12) found.push(`${one.id} ends ${row.height - range.max} short`)
        }
      }
    }
    return found
  }

  test('a card is as tall as its lines at their least, and at most as tall as its lines at their most', () => {
    // Three records in one column; in a wide card two columns, so two lines.
    expect(partRange(records(3).shape, 472)).toEqual({ min: 74 + 3 * 34, max: 74 + 3 * 76 })
    expect(partRange(records(3).shape, 956)).toEqual({ min: 74 + 2 * 34, max: 74 + 2 * 76 })
    // Two lists side by side grow together: the shorter's most is the card's.
    expect(partRange(pulls(1, 1).shape, 956)).toEqual({ min: 75 + 20 + 52, max: 75 + 20 + 48 })
    // One above the other, they share the room equally: the one that can grow least decides.
    expect(partRange(pulls(2, 1).shape, 472)).toEqual({ min: 75 + 72 + 12 + 72, max: 75 + 72 + 12 + 72 + 2 * 24 })
    // A lone list of bars in a wide card spreads in columns of 190 pixels at least: five bars in four columns are two lines.
    expect(partRange(flow(5).shape, 956)).toEqual({ min: 75 + 20 + 44 * 2 + 8, max: 75 + 20 + 48 * 2 + 8 })
    expect(calendarHeight(5, 32)).toBe(118 + 5 * 32 + 4 * 3)
    expect(calendarWidth(32)).toBe(7 * 32 + 6 * 3 + 30)
  })

  for (const width of [1440, 1000]) {
    test(`every month of the demo is laid out with nothing blank and square cells, ${width} pixels wide`, () => {
      for (const [name, parts] of Object.entries(DEMO)) {
        expect(faults(parts, layoutParts(parts, width), width), name).toEqual([])
      }
    })
  }

  test('a part alone in its month keeps its own width at the left, never the whole page', () => {
    const [row] = layoutParts(DEMO.january, 1440)
    expect(row.alone).toBe(true)
    expect(row.parts).toEqual([{ id: 'pulls', width: 472, cell: null }])
    const [wide] = layoutParts([pulls(2, 1)], 1440)
    expect(wide.parts[0].width).toBe(2 * 472 + 12)
    const [calendar] = layoutParts([days(5)], 1440)
    expect(calendar.parts).toEqual([{ id: 'days', width: calendarWidth(CELL_ALONE), cell: CELL_ALONE }])
  })

  test("February's one record stands beside its Pulls, in one row that holds both", () => {
    const rows = layoutParts(DEMO.february, 1440)
    expect(rows.map((row) => row.parts.map((part) => [part.id, part.width]))).toEqual([
      [
        ['records', 472],
        ['pulls', 956],
      ],
    ])
  })

  test('the calendar is as wide as its cells make it, and its row as tall as its weeks', () => {
    for (const parts of [DEMO.august, DEMO.october, DEMO.march]) {
      const row = layoutParts(parts, 1440).find((one) => one.parts.some((part) => part.id === 'days'))!
      const calendar = row.parts.find((part) => part.id === 'days')!
      expect(row.parts.length).toBeGreaterThan(1)
      expect(calendar.width).toBe(calendarWidth(calendar.cell!))
    }
  })

  test('the records come first, and a full month leaves no part alone', () => {
    for (const name of ['march', 'april', 'june', 'july', 'august', 'september', 'october']) {
      const rows = layoutParts(DEMO[name], 1440)
      expect(rows[0].parts[0].id, name).toBe('records')
      expect(rows.some((row) => row.alone), name).toBe(false)
    }
  })

  test('a part that fits beside no other stands alone rather than leave a blank', () => {
    // May: its Pulls (three short bars) is far shorter than a calendar of five weeks, and a list of five bars wide is too.
    const rows = layoutParts(DEMO.may, 1440)
    expect(faults(DEMO.may, rows, 1440)).toEqual([])
    expect(rows.filter((row) => row.alone).map((row) => row.parts[0].id)).toEqual(['pulls'])
    expect(layoutParts([], 1440)).toEqual([])
  })
})

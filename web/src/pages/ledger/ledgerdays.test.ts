import { describe, expect, test } from 'vitest'

import type { LedgerEntry, LedgerKind } from '../../ledgertypes.ts'
import { calendarCells, groupByDay, longDate } from './ledgerdays.ts'

const TODAY = '2026-10-27'

function entry(time: string, amount: number, title = 'Event reward', source: LedgerEntry['source'] = 'events', id = `${time}-${amount}-${title}`): LedgerEntry {
  return { id, time, reason: title, name: '', rarity: 0, amount, title, source, detail: '' }
}

describe('longDate', () => {
  test('the weekday and the day as the page writes them', () => {
    expect(longDate('2026-10-20')).toBe('Tuesday, 20 October')
    expect(longDate('2026-01-01')).toBe('Thursday, 1 January')
  })
})

describe('groupByDay', () => {
  test('days are Today, Yesterday, then the date, each with its net and rows', () => {
    const groups = groupByDay(
      [
        entry('2026-10-27 05:12:00', 60, 'Daily commissions', 'commissions'),
        entry('2026-10-27 04:01:00', 90, 'Blessing of the Welkin Moon', 'welkin'),
        entry('2026-10-26 22:47:00', -1600, 'Shop purchase', 'shop'),
        entry('2026-10-26 04:03:00', 90, 'Blessing of the Welkin Moon', 'welkin'),
        entry('2026-10-20 20:15:00', 300),
      ],
      TODAY,
    )
    expect(groups.map((group) => group.label)).toEqual(['Today', 'Yesterday', 'Tuesday, 20 October'])
    expect(groups.map((group) => group.day)).toEqual(['2026-10-27', '2026-10-26', '2026-10-20'])
    expect(groups.map((group) => group.net)).toEqual([150, -1510, 300])
    expect(groups[0].rows.map((row) => row.title)).toEqual(['Daily commissions', 'Blessing of the Welkin Moon'])
    expect(groups[0].rows[0]).toMatchObject({ time: '05:12', amount: 60, source: 'commissions', wishes: null })
  })

  test('groupByDay puts 02:30 on the day before', () => {
    const groups = groupByDay([entry('2026-10-12 04:00:00', 5), entry('2026-10-12 03:59:59', 7), entry('2026-10-12 02:30:00', 40)], TODAY)
    expect(groups.map((group) => group.label)).toEqual(['Monday, 12 October', 'Sunday, 11 October'])
    expect(groups[1].rows.map((row) => row.amount)).toEqual([7, 40])
    expect(groups[0].rows.map((row) => row.amount)).toEqual([5])
    // the row still shows the time the game wrote
    expect(groups[1].rows[1].time).toBe('02:30')
  })

  test('the 1st of a month before 04:00 belongs to the last day of the one before', () => {
    expect(groupByDay([entry('2026-11-01 01:00:00', 5)], TODAY)[0].day).toBe('2026-10-31')
    expect(groupByDay([entry('2027-01-01 00:10:00', 5)], TODAY)[0].day).toBe('2026-12-31')
  })

  test('groupByDay folds a day of chests', () => {
    const chests = [
      entry('2026-10-27 14:20:00', 20, 'Opened treasure chest', 'other', 'c4'),
      entry('2026-10-27 14:11:00', 10, 'Opened treasure chest', 'other', 'c3'),
      entry('2026-10-27 14:05:00', 10, 'Opened treasure chest', 'other', 'c2'),
      entry('2026-10-27 14:02:00', 5, 'Opened treasure chest', 'other', 'c1'),
    ]
    const groups = groupByDay([entry('2026-10-27 20:15:00', 160), ...chests, entry('2026-10-27 04:30:00', 90, 'Blessing of the Welkin Moon', 'welkin')], TODAY)
    expect(groups[0].rows.map((row) => row.title)).toEqual(['Event reward', '4 treasure chests', 'Blessing of the Welkin Moon'])
    const folded = groups[0].rows[1]
    expect(folded).toMatchObject({ title: '4 treasure chests', time: '14:02–14:20', amount: 45, source: 'other' })
    expect(folded.folded?.map((one) => one.id)).toEqual(['c4', 'c3', 'c2', 'c1'])
    expect(groups[0].net).toBe(160 + 45 + 90)
  })

  test("a day's chests across midnight run from the evening to the small hours", () => {
    const groups = groupByDay(
      [
        entry('2026-10-27 01:10:00', 5, 'Opened treasure chest', 'other', 'late'),
        entry('2026-10-26 23:50:00', 10, 'Opened treasure chest', 'other', 'early'),
      ],
      TODAY,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].rows[0]).toMatchObject({ title: '2 treasure chests', time: '23:50–01:10' })
  })

  test('one chest stays a row of its own, and each day folds its own', () => {
    const groups = groupByDay(
      [
        entry('2026-10-27 14:00:00', 10, 'Opened treasure chest', 'other'),
        entry('2026-10-26 14:01:00', 5, 'Opened treasure chest', 'other'),
        entry('2026-10-26 14:00:00', 10, 'Opened treasure chest', 'other'),
      ],
      TODAY,
    )
    expect(groups[0].rows[0].folded).toBeUndefined()
    expect(groups[0].rows[0].title).toBe('Opened treasure chest')
    expect(groups[1].rows).toHaveLength(1)
    expect(groups[1].rows[0].title).toBe('2 treasure chests')
  })

  test('a Fate purchase says how many wishes it made', () => {
    const rows = groupByDay([entry('2026-10-27 12:00:00', -1600, 'Shop purchase', 'shop'), entry('2026-10-27 11:00:00', -100, 'Shop purchase', 'shop')], TODAY)[0].rows
    expect(rows[0].wishes).toBe(10)
    expect(rows[1].wishes).toBeNull()
  })

  test("each row says where it came from, in the page's words", () => {
    const rows = groupByDay([entry('2026-10-27 12:00:00', 5, 'Claimed reward', 'other'), entry('2026-10-27 11:00:00', 800, 'Imaginarium Theater', 'endgame')], TODAY)[0].rows
    expect(rows.map((row) => row.sourceLabel)).toEqual(['Chests and other', 'Abyss and Theater'])
  })

  test('nothing is nothing', () => {
    expect(groupByDay([], TODAY)).toEqual([])
  })
})

function logged(
  kind: LedgerKind,
  time: string,
  amount: number,
  title: string,
  source: LedgerEntry['source'],
  more: Partial<LedgerEntry> = {},
): LedgerEntry {
  return { id: `${time}-${title}-${amount}-${Math.abs(amount)}`, time, reason: title, name: '', rarity: kind === 'artifact' ? 5 : 0, amount, title, source, detail: '', ...more }
}

describe('groupByDay for the other logs', () => {
  test('a refill of resin with primogems says Resin, with the shop’s bag', () => {
    const [row] = groupByDay([logged('primogem', '2026-10-27 22:30:00', -50, 'Original Resin replenishment', 'resin')], TODAY)[0].rows
    expect(row).toMatchObject({ second: 'Resin · 22:30', icon: 'shop', wishes: null })
  })

  test('crystals: the pack beside the shop, the exchange with its wishes, the day as what came and went', () => {
    const groups = groupByDay(
      [
        logged('crystal', '2026-10-09 19:48:00', -1090, 'Exchanged Genesis Crystals for Primogems', 'exchange'),
        logged('crystal', '2026-10-09 19:42:00', 1090, 'Obtained via purchase', 'bought', { detail: '980 + 110 Genesis Crystals' }),
        logged('crystal', '2026-10-09 04:10:00', 300, 'Purchased Blessing of the Welkin Moon', 'bought'),
        logged('crystal', '2026-10-09 04:20:00', -60, 'Purchased Fragile Resin', 'shop'),
      ],
      TODAY,
      'crystal',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].summary).toBe('+1,390 · −1,150')
    const [exchange, pack, welkin, shop] = groups[0].rows
    expect(exchange).toMatchObject({ second: 'Exchange · 19:48', icon: 'swap', wishes: 6 })
    expect(pack).toMatchObject({ second: 'Shop · 980 + 110 Genesis Crystals · 19:42', icon: 'gem', wishes: null })
    expect(welkin).toMatchObject({ second: 'Shop · 04:10', icon: 'welkin' })
    expect(shop).toMatchObject({ second: 'Shop · 04:20', icon: 'shop' })
  })

  test('resin: a run of one domain folds into one row with its span, and opens on its entries', () => {
    const tree = (time: string) => logged('resin', time, -20, 'Valley of Remembrance', 'domain')
    const groups = groupByDay(
      [logged('resin', '2026-10-27 19:40:00', -20, 'Ley Line Blossom challenge reward', 'ley'), tree('2026-10-27 19:31:00'), tree('2026-10-27 19:15:00'), tree('2026-10-27 19:02:00'), logged('resin', '2026-10-27 18:50:00', -30, 'Stormterror (Weekly Boss)', 'weekly')],
      TODAY,
      'resin',
    )
    expect(groups[0].summary).toBe('−110')
    expect(groups[0].rows.map((row) => row.title)).toEqual(['Ley Line Blossom challenge reward', 'Valley of Remembrance ×3', 'Stormterror (Weekly Boss)'])
    expect(groups[0].rows[1]).toMatchObject({ amount: -60, second: 'Domains · 19:02–19:31', icon: 'dom' })
    expect(groups[0].rows[1].folded).toHaveLength(3)
    expect(groups[0].rows.map((row) => row.icon)).toEqual(['ley', 'dom', 'week'])
  })

  test('artifacts: five-stars with their domain, those fed together folded, the day as how many came and went', () => {
    const groups = groupByDay(
      [
        logged('artifact', '2026-10-27 21:41:00', -1, 'Artifact enhancement material', 'fed', { name: 'Goblet' }),
        logged('artifact', '2026-10-27 21:40:00', -1, 'Artifact enhancement material', 'fed', { name: 'Plume' }),
        logged('artifact', '2026-10-27 20:00:00', 1, 'Obtained from Mystic Offering', 'elsewhere', { name: 'Sands', reason: 'Obtained from Mystic Offering' }),
        logged('artifact', '2026-10-27 19:05:00', 1, 'Sanctum of Rainbow Spirits', 'domain', { name: 'Flower of Life' }),
        logged('artifact', '2026-10-27 18:00:00', -1, 'Artifact decomposition', 'salvaged', { name: 'Circlet' }),
      ],
      TODAY,
      'artifact',
    )
    expect(groups[0].summary).toBe('+2 · −3')
    const rows = groups[0].rows
    expect(rows.map((row) => row.title)).toEqual(['Fed 2 artifacts', 'Sands', 'Flower of Life', 'Salvaged Circlet'])
    expect(rows[0]).toMatchObject({ second: '5★ · Fed to enhance · 21:40–21:41', amount: -2, icon: 'fed' })
    expect(rows[1].second).toBe('5★ · Obtained from Mystic Offering · 20:00')
    expect(rows[2]).toMatchObject({ second: '5★ · Sanctum of Rainbow Spirits · 19:05', icon: 'dom' })
    expect(rows[3]).toMatchObject({ second: '5★ · Salvaged · 18:00', icon: 'salv' })
  })

  test('no entries are no days', () => {
    expect(groupByDay([], TODAY, 'crystal')).toEqual([])
  })

  test('a long domain name stays a title of its row (the row’s title is the whole name)', () => {
    const name = `${'Domain of the Never-Ending Names '.repeat(2)}Court`.slice(0, 60)
    const [row] = groupByDay([logged('resin', '2026-10-27 19:02:00', -20, name, 'domain')], TODAY, 'resin')[0].rows
    expect(row.title).toBe(name)
    expect(name).toHaveLength(60)
  })
})

const OCT_COMMISSIONS = {
  month: '2026-10',
  days: Array.from({ length: 31 }, (_, index) => ({
    day: `2026-10-${String(index + 1).padStart(2, '0')}`,
    state: (index + 1 === 9 ? 'missed' : index + 1 === 14 ? 'unknown' : 'done') as 'done' | 'missed' | 'unknown',
  })),
  streak_now: 6,
  longest: 15,
  missed: 1,
}

describe('calendarCells', () => {
  test('calendarCells starts on Monday', () => {
    expect(calendarCells(OCT_COMMISSIONS).pad).toBe(3) // 1 October 2026 is a Thursday
    const monday = { ...OCT_COMMISSIONS, month: '2026-06', days: [{ day: '2026-06-01', state: 'done' as const }] } // a Monday
    expect(calendarCells(monday).pad).toBe(0)
    const sunday = { ...OCT_COMMISSIONS, month: '2026-11', days: [{ day: '2026-11-01', state: 'done' as const }] }
    expect(calendarCells(sunday).pad).toBe(6)
  })

  test('calendarCells marks uncovered days unknown', () => {
    const { cells } = calendarCells(OCT_COMMISSIONS)
    expect(cells[13]).toEqual({ day: '2026-10-14', state: 'unknown', today: false })
    expect(cells[8].state).toBe('missed')
    expect(cells[0].state).toBe('done')
  })

  test('today is the last day that has come', () => {
    const early = {
      ...OCT_COMMISSIONS,
      days: OCT_COMMISSIONS.days.map((cell, index) => (index >= 27 ? { ...cell, state: 'future' as const } : cell)),
    }
    const { cells } = calendarCells(early)
    expect(cells.filter((cell) => cell.today).map((cell) => cell.day)).toEqual(['2026-10-27'])
    expect(cells[27].state).toBe('future')
    expect(calendarCells(OCT_COMMISSIONS).cells.filter((cell) => cell.today).map((cell) => cell.day)).toEqual(['2026-10-31'])
  })

  test('a month with nothing in it is empty', () => {
    expect(calendarCells({ ...OCT_COMMISSIONS, days: [] })).toEqual({ pad: 0, cells: [] })
  })
})

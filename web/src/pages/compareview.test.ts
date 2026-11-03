import { describe, expect, test } from 'vitest'
import type { CompareModel, Friend, StatKey, Stats } from '../onlinetypes.ts'
import {
  columnTip, groupsOf, monthColumns, monthsTable, scoreLine, scoreOf, tickText, weekColumns, weeksTable, type Group, type Row,
} from './compareview.ts'

/*
 * Compare (the online plan, Task B8; the online design, section 9, mockup 3). The two players below are the mockup's: the
 * player leads in seven of its twelve rows, Riley in four, and one is tied.
 */

const months =(...earned: (number | null)[]) =>
  earned.map((value, at) => ({ month: `2026-${String(at + 6).padStart(2, '0')}`, earned: value }))

const MINE: Stats = {
  primogems: { now: 16040, months: months(7100, 6900, 8000, 8240, 9880) },
  playtime: { week_hours: 18, days30_hours: 64, weeks: [12, 14, 18, 11, 16, 18], week_start: '2026-10-12', longest_run: 41 },
  endgame: { abyss_stars: 36, theater_act: 10, stygian: 5 },
  account: { days_active: 812, characters: 94, chests: 1820 },
}

const THEIRS: Stats = {
  primogems: { now: 14320, months: months(6500, 6700, 7600, 7100, 11460) },
  playtime: { week_hours: 21, days30_hours: 71, weeks: [16, 13, 15, 20, 17, 21], week_start: '2026-10-12', longest_run: 26 },
  endgame: { abyss_stars: 36, theater_act: 8, stygian: 4 },
  account: { days_active: 624, characters: 97, chests: 1640 },
}

const KEYS: StatKey[] = ['primogems', 'playtime', 'endgame', 'account']

function friend(over: Partial<Friend> = {}): Friend {
  return {
    user_id: '00000000-0000-4000-8000-000000007687', name: 'Riley', tag: '7687', has_picture: false, ar: 58, uid: 712345312,
    status: 'in_game', since: '2026-10-13T07:18:00Z', last_seen: '2026-10-13T07:59:48Z', stats: THEIRS, pills: [], compare: true,
    ...over,
  }
}

function model(over: { mine?: Stats; theirs?: Stats; keys?: StatKey[]; name?: string } = {}): CompareModel {
  return {
    me: { user_id: 'me', name: 'Traveler', tag: '2048', has_picture: false, ar: 59, status: 'not_in_game', since: null },
    friend: friend({ name: over.name ?? 'Riley', stats: over.theirs ?? THEIRS }),
    keys: over.keys ?? KEYS,
    mine: over.mine ?? MINE,
    week_start: '2026-10-12', // the core's: Tuesday 13 October 2026 is the demo's day, and its week began on Monday the 12th
    read_at: '2026-10-13T08:00:00Z',
    stale: false,
  }
}

const rows = (groups: Group[]): Row[] => groups.flatMap((group) => group.rows)
const rowOf = (groups: Group[], id: string): Row => {
  const found = rows(groups).find((row) => row.id === id)
  if (found === undefined) throw new Error(`no row ${id}`)
  return found
}

describe('the rows of each group', () => {
  const groups = groupsOf(model())

  test('are the four groups of the mockup, in its order, with the rows it has', () => {
    expect(groups.map((group) => group.title)).toEqual(['Primogems', 'Play time', 'Endgame', 'Account'])
    expect(groups.map((group) => group.rows.map((row) => row.label))).toEqual([
      ['Now', 'Earned in October', 'Earned in September'],
      ['This week', 'Last 30 days', 'Longest run of days'],
      ['Spiral Abyss', 'Imaginarium Theater', 'Stygian Onslaught'],
      ['Days active', 'Characters', 'Chests opened'],
    ])
  })

  test('say who leads and by how much, as the mockup does', () => {
    const verdicts = Object.fromEntries(rows(groups).map((row) => [row.id, row.verdict]))
    expect(verdicts).toMatchObject({
      'primogems.now': 'You +1,720',
      'primogems.this-month': 'Riley +1,580',
      'primogems.last-month': 'You +1,140',
      'playtime.week': 'Riley +3 h',
      'playtime.days30': 'Riley +7 h',
      'playtime.run': 'You +15',
      'endgame.abyss': 'Tied',
      'endgame.theater': 'You +2 acts',
      'endgame.stygian': 'You +1',
      'account.days': 'You +188',
      'account.characters': 'Riley +3',
      'account.chests': 'You +180',
    })
  })

  test('write each value as the page shows it, and the leader is told apart', () => {
    expect(rowOf(groups, 'primogems.now')).toMatchObject({ me: { text: '16,040' }, friend: { text: '14,320' }, lead: 'me' })
    expect(rowOf(groups, 'playtime.week')).toMatchObject({ me: { text: '18 h' }, friend: { text: '21 h' }, lead: 'friend' })
    expect(rowOf(groups, 'endgame.theater')).toMatchObject({ me: { text: 'Act 10' }, friend: { text: 'Act 8' } })
    expect(rowOf(groups, 'endgame.abyss')).toMatchObject({ me: { text: '36' }, friend: { text: '36' }, lead: 'tied' })
  })

  test('split the bar in proportion, and in half where it is a tie', () => {
    expect(rowOf(groups, 'primogems.now').share).toBeCloseTo(0.528, 3)
    expect(rowOf(groups, 'primogems.this-month').share).toBeCloseTo(0.463, 3)
    expect(rowOf(groups, 'playtime.run').share).toBeCloseTo(0.612, 3)
    expect(rowOf(groups, 'endgame.abyss').share).toBe(0.5)
  })

  test('count every lead: the player in seven, Riley in four, and one tied', () => {
    expect(scoreOf(groups)).toEqual({ me: 7, friend: 4, tied: 1 })
    expect(scoreLine({ me: 7, friend: 4, tied: 1 })).toBe('stats where each of you leads, 1 tied')
    expect(scoreLine({ me: 7, friend: 5, tied: 0 })).toBe('stats where each of you leads')
    expect(scoreLine({ me: 3, friend: 3, tied: 6 })).toBe('stats where each of you leads, 6 tied')
  })

  test('name the friend in the verdict, whatever the name, and give its parts', () => {
    expect(rowOf(groupsOf(model({ name: 'Milo' })), 'playtime.week')).toMatchObject({ verdict: 'Milo +3 h', who: 'Milo', by: '3 h' })
    expect(rowOf(groups, 'primogems.now')).toMatchObject({ who: 'You', by: '1,720' })
    expect(rowOf(groups, 'endgame.abyss')).toMatchObject({ verdict: 'Tied', who: '', by: '' })
  })

  test('is a tenth of an hour where it is one, and a tie where the figures only differ below it', () => {
    const mine: Stats = { ...MINE, playtime: { ...MINE.playtime!, week_hours: 18.04, days30_hours: 61.5 } }
    const theirs: Stats = { ...THEIRS, playtime: { ...THEIRS.playtime!, week_hours: 18, days30_hours: 58 } }
    const found = groupsOf(model({ mine, theirs }))
    expect(rowOf(found, 'playtime.week')).toMatchObject({ lead: 'tied', verdict: 'Tied' })
    expect(rowOf(found, 'playtime.days30')).toMatchObject({ verdict: 'You +3.5 h', me: { text: '61.5 h' } })
  })

  test('is one act or one star in the singular', () => {
    const mine: Stats = { ...MINE, endgame: { abyss_stars: 36, theater_act: 9, stygian: 5 } }
    const theirs: Stats = { ...THEIRS, endgame: { abyss_stars: 36, theater_act: 8, stygian: 4 } }
    expect(rowOf(groupsOf(model({ mine, theirs })), 'endgame.theater').verdict).toBe('You +1 act')
  })

  test('has a bar of no width for a side that has none, and no divide by zero when both are none', () => {
    const mine: Stats = { ...MINE, account: { days_active: 0, characters: 0, chests: 5 } }
    const theirs: Stats = { ...THEIRS, account: { days_active: 0, characters: 3, chests: 0 } }
    const found = groupsOf(model({ mine, theirs }))
    expect(rowOf(found, 'account.days')).toMatchObject({ share: 0.5, lead: 'tied', verdict: 'Tied' })
    expect(rowOf(found, 'account.characters')).toMatchObject({ share: 0, lead: 'friend' })
    expect(rowOf(found, 'account.chests')).toMatchObject({ share: 1, lead: 'me' })
  })
})

describe('what is left out', () => {
  test('a group with no rows is gone, and so is a stat that the two of you do not both share', () => {
    const found = groupsOf(model({ keys: ['primogems', 'account'] }))
    expect(found.map((group) => group.title)).toEqual(['Primogems', 'Account'])
    expect(groupsOf(model({ keys: [] }))).toEqual([])
  })

  test('last month is found across a new year', () => {
    const january: Stats = {
      primogems: { now: 1, months: [{ month: '2026-12', earned: 500 }, { month: '2027-01', earned: 100 }] },
    }
    const groups = groupsOf(model({ mine: january, theirs: january, keys: ['primogems'] }))
    expect(rowOf(groups, 'primogems.last-month')).toMatchObject({ label: 'Earned in December', me: { value: 500 } })
  })

  test('a stat that both hold is still not compared where the server does not name it', () => {
    expect(groupsOf(model({ keys: ['playtime'] })).map((group) => group.title)).toEqual(['Play time'])
  })

  test('a row is gone where either side does not know its figure, and a group where none is left', () => {
    const mine: Stats = { ...MINE, endgame: { abyss_stars: null, theater_act: 10, stygian: null } }
    const found = groupsOf(model({ mine }))
    expect(rowOf(found, 'endgame.theater')).toBeDefined()
    expect(rows(found).some((row) => row.id === 'endgame.abyss')).toBe(false)
    expect(rows(found).some((row) => row.id === 'endgame.stygian')).toBe(false)
    const none: Stats = { ...MINE, endgame: { abyss_stars: null, theater_act: null, stygian: null } }
    expect(groupsOf(model({ mine: none })).map((group) => group.title)).toEqual(['Primogems', 'Play time', 'Account'])
  })

  test('the months are matched by their names, so a friend whose months are one behind has no row for the missing one', () => {
    const theirs: Stats = { ...THEIRS, primogems: { now: 14320, months: [{ month: '2026-09', earned: 7100 }] } }
    const found = groupsOf(model({ theirs }))
    expect(rows(found).some((row) => row.id === 'primogems.this-month')).toBe(false)
    expect(rowOf(found, 'primogems.last-month')).toMatchObject({ label: 'Earned in September', verdict: 'You +1,140' })
  })
})

describe('the stats that are not for leading', () => {
  const extra: StatKey[] = [...KEYS, 'achievements', 'wishes', 'spending']
  const mine: Stats = {
    ...MINE,
    achievements: { ticked: 1402, total: 1558 },
    wishes: { pity: 62, five_stars_90d: 3 },
    spending: { month_total: 412, month: '2026-10', currency: 'PLN' },
  }
  const theirs: Stats = {
    ...THEIRS,
    achievements: { ticked: 1402, total: 1558 },
    wishes: { pity: 20, five_stars_90d: 5 },
    spending: { month_total: 120, month: '2026-10', currency: 'PLN' },
  }

  test('achievements and wishes are compared once both share them, and pity and spending have no leader', () => {
    const found = groupsOf(model({ mine, theirs, keys: extra }))
    expect(found.map((group) => group.title)).toEqual(['Primogems', 'Play time', 'Endgame', 'Account', 'Achievements', 'Wishes', 'Spending'])
    expect(rowOf(found, 'achievements.ticked')).toMatchObject({ lead: 'tied', verdict: 'Tied' })
    expect(rowOf(found, 'wishes.five-stars')).toMatchObject({ lead: 'friend', verdict: 'Riley +2' })
    expect(rowOf(found, 'wishes.pity')).toMatchObject({ lead: null, share: null, verdict: '', me: { text: '62' }, friend: { text: '20' } })
    expect(rowOf(found, 'spending.month')).toMatchObject({ lead: null, share: null, verdict: '', me: { text: '412 zł' }, friend: { text: '120 zł' } })
  })

  test('a row with no leader is not in the score', () => {
    const found = groupsOf(model({ mine, theirs, keys: extra }))
    expect(scoreOf(found)).toEqual({ me: 7, friend: 5, tied: 2 })
  })

  test('spending in two currencies is not compared', () => {
    const other: Stats = { ...theirs, spending: { month_total: 30, month: '2026-10', currency: 'EUR' } }
    const found = groupsOf(model({ mine, theirs: other, keys: extra }))
    expect(found.map((group) => group.title)).not.toContain('Spending')
  })
})

describe('what comes from another PC', () => {
  test('a stat of the wrong shape leaves out its rows, and nothing throws', () => {
    const odd: unknown[] = [
      null, 7, 'x', [], {}, { now: 'lots' }, { now: -1 }, { now: Infinity }, { months: 5 }, { months: [null, 3, { month: 5 }] },
      { week_hours: {} }, { weeks: 'x' }, { weeks: [null, 'a', {}] }, { abyss_stars: '36' }, { days_active: NaN },
      { pity: [] }, { month_total: 4, currency: 5 },
    ]
    const keys: StatKey[] = ['primogems', 'playtime', 'achievements', 'endgame', 'account', 'wishes', 'spending']
    for (const value of odd) {
      for (const key of keys) {
        const theirs = { [key]: value } as unknown as Stats
        const mine = { [key]: value } as unknown as Stats
        expect(() => groupsOf(model({ mine, theirs, keys })), `${key}: ${JSON.stringify(value)}`).not.toThrow()
        expect(rows(groupsOf(model({ mine: MINE, theirs, keys }))).every((row) => Number.isFinite(row.me.value)), key).toBe(true)
        expect(() => weekColumns(model({ theirs, keys }))).not.toThrow()
        expect(() => monthColumns(model({ theirs, keys }))).not.toThrow()
      }
    }
  })

  test('a model that is not a model gives nothing, and does not throw', () => {
    for (const broken of [
      { ...model(), keys: null },
      { ...model(), keys: 'primogems' },
      { ...model(), mine: null },
      { ...model(), friend: { ...friend(), stats: null } },
      { ...model(), keys: ['primogems', 'status', 4, null, '__proto__'] },
    ]) {
      expect(() => groupsOf(broken as unknown as CompareModel)).not.toThrow()
      expect(() => weekColumns(broken as unknown as CompareModel)).not.toThrow()
      expect(() => monthColumns(broken as unknown as CompareModel)).not.toThrow()
    }
    expect(groupsOf({ ...model(), keys: null } as unknown as CompareModel)).toEqual([])
    expect(groupsOf({ ...model(), mine: null } as unknown as CompareModel)).toEqual([])
  })
})

describe('a friend whose Guild Board last uploaded two weeks ago', () => {
  // What the core gives (cloud/models.py): the weeks moved along to end with this one, the two since not known, and nothing
  // for this week or the last 30 days. THEIRS has the weeks [16, 13, 15, 20, 17, 21], so this is them two weeks on.
  const old: Stats = {
    ...THEIRS,
    playtime: { week_hours: null, days30_hours: null, weeks: [15, 20, 17, 21, null, null], week_start: '2026-10-12', longest_run: 26 },
  }

  test('has no row for this week or the last 30 days, and keeps the rest of the group', () => {
    const found = groupsOf(model({ theirs: old }))
    expect(rows(found).filter((row) => row.id.startsWith('playtime.')).map((row) => row.id)).toEqual(['playtime.run'])
    expect(found.map((group) => group.title)).toEqual(['Primogems', 'Play time', 'Endgame', 'Account'])
  })

  test('a group whose only rows were this week and the last 30 days is gone', () => {
    const mine: Stats = { ...MINE, playtime: { ...MINE.playtime!, longest_run: null } }
    const theirs: Stats = { ...old, playtime: { ...old.playtime!, longest_run: null } }
    expect(groupsOf(model({ mine, theirs })).map((group) => group.title)).toEqual(['Primogems', 'Endgame', 'Account'])
  })

  test('has its weeks in the columns of their dates, and none for the two since', () => {
    const columns = weekColumns(model({ theirs: old }))
    expect(columns.map((column) => column.label)).toEqual(['7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct'])
    expect(columns.map((column) => column.friend)).toEqual([15, 20, 17, 21, null, null])
    expect(columns.map((column) => column.me)).toEqual([12, 14, 18, 11, 16, 18])
    expect(columnTip(columns[5], 'Riley', (value) => `${value} h`).lines).toEqual([['You', '18 h'], ['Riley', 'no data']])
    expect(weeksTable(columns, 'Riley').rows[5]).toEqual(['Week of 12 Oct', '18 h', '–'])
  })

  test('has a gap in this week, and not the week before standing in its place', () => {
    // The 21 hours were made in the week of 28 Sep. Without the core's move they would stand under 12 Oct.
    const unmoved = weekColumns(model({ theirs: THEIRS }))
    expect(unmoved[5].friend).toBe(21)
    expect(weekColumns(model({ theirs: old }))[5].friend).toBeNull()
    expect(weekColumns(model({ theirs: old }))[3].friend).toBe(21)
  })

  test('with no week left at all shows only the weeks of the player, and no chart where neither has one', () => {
    const none: Stats = {
      ...THEIRS,
      playtime: { week_hours: null, days30_hours: null, weeks: [null, null, null, null, null, null], week_start: '2026-10-12', longest_run: 26 },
    }
    expect(weekColumns(model({ theirs: none })).map((column) => column.friend)).toEqual([null, null, null, null, null, null])
    const nobody: Stats = { ...MINE, playtime: { ...none.playtime! } }
    expect(weekColumns(model({ mine: nobody, theirs: none }))).toEqual([])
  })
})

describe('the two charts', () => {
  test('play time each week has a column for each of six weeks, named by the day it began', () => {
    const columns = weekColumns(model())
    expect(columns).toHaveLength(6)
    expect(columns.map((column) => column.label)).toEqual(['7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct'])
    expect(columns[5]).toMatchObject({ title: 'Week of 12 Oct', me: 18, friend: 21 })
    expect(columns[0]).toMatchObject({ title: 'Week of 7 Sep', me: 12, friend: 16 })
  })

  test('a week that is not known is a gap in the column, and a chart with nothing at all is none', () => {
    const mine: Stats = { ...MINE, playtime: { ...MINE.playtime!, weeks: [null, 14, 18, 11, 16, 18] } }
    expect(weekColumns(model({ mine }))[0]).toMatchObject({ me: null, friend: 16 })
    const none: Stats = { ...MINE, playtime: { ...MINE.playtime!, weeks: [null, null, null, null, null, null] } }
    const gone: Stats = { ...THEIRS, playtime: { ...THEIRS.playtime!, weeks: [null, null, null, null, null, null] } }
    expect(weekColumns(model({ mine: none, theirs: gone }))).toEqual([])
  })

  test('two lists of different lengths are matched from their ends, the last being this week', () => {
    const theirs: Stats = { ...THEIRS, playtime: { ...THEIRS.playtime!, weeks: [17, 21] } }
    const columns = weekColumns(model({ theirs }))
    expect(columns.map((column) => column.friend)).toEqual([null, null, null, null, 17, 21])
    expect(columns.map((column) => column.me)).toEqual([12, 14, 18, 11, 16, 18])
    const mine: Stats = { ...MINE, playtime: { ...MINE.playtime!, weeks: [18] } }
    expect(weekColumns(model({ mine })).map((column) => column.me)).toEqual([null, null, null, null, null, 18])
  })

  test('are none where the two of you do not both share the stat', () => {
    expect(weekColumns(model({ keys: ['primogems'] }))).toEqual([])
    expect(monthColumns(model({ keys: ['playtime'] }))).toEqual([])
  })

  test('the weeks are named from the week the core gives, whatever the day: before the reset on a Monday it is last week', () => {
    const columns = weekColumns({ ...model(), week_start: '2026-10-05' })
    expect(columns.map((column) => column.label)).toEqual(['31 Aug', '7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct'])
  })

  test('the names go across a month, a year and a change of the clocks', () => {
    const year = weekColumns({ ...model(), week_start: '2026-12-28' })
    expect(year.map((column) => column.label)).toEqual(['23 Nov', '30 Nov', '7 Dec', '14 Dec', '21 Dec', '28 Dec'])
    const clocks = weekColumns({ ...model(), week_start: '2026-11-02' }) // Europe's clocks go back on 25 October
    expect(clocks.map((column) => column.label)).toEqual(['28 Sep', '5 Oct', '12 Oct', '19 Oct', '26 Oct', '2 Nov'])
  })

  test('no week from the core is no chart', () => {
    for (const odd of ['', 'soon', '2026-10', null, undefined, 7]) {
      expect(weekColumns({ ...model(), week_start: odd } as unknown as CompareModel), String(odd)).toEqual([])
    }
  })

  test('primogems each month has a column for each of the last five months', () => {
    const columns = monthColumns(model())
    expect(columns.map((column) => column.label)).toEqual(['Jun', 'Jul', 'Aug', 'Sep', 'Oct'])
    expect(columns[4]).toMatchObject({ title: 'October 2026', me: 9880, friend: 11460 })
    expect(columns[0]).toMatchObject({ title: 'June 2026', me: 7100, friend: 6500 })
  })

  test('a month the friend has no figure for is a gap', () => {
    const theirs: Stats = { ...THEIRS, primogems: { now: 1, months: [{ month: '2026-10', earned: 11460 }] } }
    const columns = monthColumns(model({ theirs }))
    expect(columns[4]).toMatchObject({ me: 9880, friend: 11460 })
    expect(columns[3]).toMatchObject({ me: 8240, friend: null })
  })

  test('a tooltip names the week and says each side\'s figure, or that there is none', () => {
    const [column] = weekColumns(model()).slice(-1)
    expect(columnTip(column, 'Riley', (value) => `${value} h`)).toEqual({
      title: 'Week of 12 Oct',
      lines: [['You', '18 h'], ['Riley', '21 h']],
    })
    expect(columnTip({ ...column, friend: null }, 'Riley', (value) => `${value} h`).lines[1]).toEqual(['Riley', 'no data'])
  })

  test('each chart is a table as well, with a heading for each side', () => {
    const weeks = weeksTable(weekColumns(model()), 'Riley')
    expect(weeks.head).toEqual(['Week', 'You', 'Riley'])
    expect(weeks.rows[5]).toEqual(['Week of 12 Oct', '18 h', '21 h'])
    expect(weeks.numeric).toEqual([1, 2])
    const months = monthsTable(monthColumns(model()), 'Riley')
    expect(months.head).toEqual(['Month', 'You', 'Riley'])
    expect(months.rows[4]).toEqual(['October 2026', '9,880', '11,460'])
    const gap = weekColumns(model({ mine: { ...MINE, playtime: { ...MINE.playtime!, weeks: [null, 14, 18, 11, 16, 18] } } }))
    expect(weeksTable(gap, 'Riley').rows[0]).toEqual(['Week of 7 Sep', '–', '16 h'])
  })

  test('the axis reads in thousands from a thousand up', () => {
    expect(tickText(0)).toBe('0')
    expect(tickText(5)).toBe('5')
    expect(tickText(4000)).toBe('4k')
    expect(tickText(12000)).toBe('12k')
    expect(tickText(2500)).toBe('2,500')
  })
})

import { describe, expect, test } from 'vitest'
import type { Stats, YourProfile } from '../onlinetypes.ts'
import { SHARE_KEYS } from './friendsview.ts'
import {
  detailOf, headerLine, ONLY_YOU, pinsAfter, pinsKept, previewOf, sharingAfter, TILE_NAMES, tileOf, tilesOfFriend, type TileContext,
} from './profileview.ts'

const STATS: Stats = {
  primogems: {
    now: 16040,
    months: [
      { month: '2026-09', earned: 7700 },
      { month: '2026-10', earned: 9880 },
    ],
  },
  playtime: { week_hours: 18, days30_hours: 61.5, weeks: [12, 9.5, 14, 11.5, 16, 18], week_start: '2026-10-12', longest_run: 14 },
  achievements: { ticked: 1402, total: 1558 },
  endgame: { abyss_stars: 36, theater_act: 10, stygian: 5 },
  account: { days_active: 812, characters: 94, chests: 3021 },
  wishes: { pity: 62, five_stars_90d: 3 },
  spending: { month_total: 412, month: '2026-10', currency: 'PLN' },
}

function context(over: Partial<TileContext> = {}): TileContext {
  return { stats: STATS, status: 'in_game', own: true, ...over }
}

describe('each tile says what a friend sees, in words', () => {
  test('Primogems: the balance, and what came this month, named by the month', () => {
    expect(tileOf('primogems', context())).toMatchObject({
      name: 'Primogems', value: '16,040', unit: '', detail: 'now, and 9,880 earned in October', known: true,
    })
  })

  test('Play time: the hours this week, from this PC for the player and plain for a friend', () => {
    expect(tileOf('playtime', context())).toMatchObject({ name: 'Play time', value: '18', unit: 'h', detail: 'this week, from this PC' })
    expect(tileOf('playtime', context({ own: false }))).toMatchObject({ value: '18', unit: 'h', detail: 'this week' })
    expect(tileOf('playtime', context({ stats: { playtime: { ...STATS.playtime!, week_hours: 9.5 } } }))).toMatchObject({ value: '9.5' })
  })

  test('Achievements: ticked, and of how many', () => {
    expect(tileOf('achievements', context())).toMatchObject({
      name: 'Achievements', value: '1,402', unit: 'of 1,558', detail: 'ticked in Guild Board',
    })
    expect(tileOf('achievements', context({ stats: { achievements: { ticked: 4, total: null } } }))).toMatchObject({ value: '4', unit: '' })
  })

  test('Endgame: the Abyss stars, and the Theater and Stygian beside them', () => {
    expect(tileOf('endgame', context())).toMatchObject({
      name: 'Endgame', value: '36', unit: 'stars', detail: 'Abyss, Theater Act 10, Stygian 5',
    })
    const one: Stats = { endgame: { abyss_stars: 1, theater_act: null, stygian: null } }
    expect(tileOf('endgame', context({ stats: one }))).toMatchObject({ value: '1', unit: 'star' })
  })

  test('Endgame: what is not known is left out of the line, and without the Abyss the figure is a dash', () => {
    const stats: Stats = { endgame: { abyss_stars: 36, theater_act: null, stygian: 5 } }
    expect(tileOf('endgame', context({ stats }))).toMatchObject({ value: '36', detail: 'Abyss, Stygian 5' })
    const noAbyss: Stats = { endgame: { abyss_stars: null, theater_act: 10, stygian: null } }
    expect(tileOf('endgame', context({ stats: noAbyss }))).toMatchObject({ value: '—', unit: '', detail: 'Theater Act 10', known: false })
  })

  test('Account: the days active, and the characters', () => {
    expect(tileOf('account', context())).toMatchObject({
      name: 'Account', value: '812', unit: 'days', detail: 'active, with 94 characters',
    })
    expect(tileOf('account', context({ stats: { account: { days_active: 1, characters: 1, chests: null } } }))).toMatchObject({
      value: '1', unit: 'day', detail: 'active, with 1 character',
    })
    expect(tileOf('account', context({ stats: { account: { days_active: 812, characters: null, chests: 3 } } }))).toMatchObject({ detail: 'active' })
  })

  test('Wishes: the pity on the character banner, and the five-stars of the last 90 days', () => {
    expect(tileOf('wishes', context())).toMatchObject({
      name: 'Wishes', value: '62', unit: 'pity', detail: 'on the character banner, 3 five-stars in 90 days',
    })
    expect(tileOf('wishes', context({ stats: { wishes: { pity: 0, five_stars_90d: 1 } } }))).toMatchObject({
      value: '0', detail: 'on the character banner, 1 five-star in 90 days',
    })
    expect(tileOf('wishes', context({ stats: { wishes: { pity: 3, five_stars_90d: null } } }))).toMatchObject({ detail: 'on the character banner' })
  })

  test('Spending: the money of this month, in the currency it was counted in', () => {
    expect(tileOf('spending', context())).toMatchObject({ name: 'Spending', value: '412', unit: 'zł', detail: 'spent this month, estimated' })
    expect(tileOf('spending', context({ stats: { spending: { month_total: 450, month: '2026-10', currency: 'EUR' } } }))).toMatchObject({ value: '€450', unit: '' })
    expect(tileOf('spending', context({ stats: { spending: { month_total: 30, month: '2026-10', currency: 'USD' } } }))).toMatchObject({ value: '$30', unit: '' })
  })

  test('Status: what the player is doing, and that friends see when they were last seen', () => {
    expect(tileOf('status', context())).toMatchObject({ name: 'Status', value: 'In game', unit: '', detail: 'and when you were last seen', known: true })
    expect(tileOf('status', context({ status: 'open' }))).toMatchObject({ value: 'Guild Board open' })
    expect(tileOf('status', context({ status: null }))).toMatchObject({ value: '—', known: false })
  })

  test('the tiles have a name for each key, in the order of the switches', () => {
    expect(SHARE_KEYS.map((key) => TILE_NAMES[key])).toEqual([
      'Status', 'Primogems', 'Play time', 'Achievements', 'Endgame', 'Account', 'Wishes', 'Spending',
    ])
  })

  test('a figure that is not known is a dash, and the tile says so', () => {
    expect(tileOf('primogems', context({ stats: {} }))).toMatchObject({ value: '—', unit: '', detail: 'Not known yet', known: false })
    expect(tileOf('primogems', context({ stats: { primogems: { now: null, months: [] } } }))).toMatchObject({ value: '—', known: false })
    expect(tileOf('primogems', context({ stats: { primogems: { now: 5, months: [] } } }))).toMatchObject({ value: '5', detail: 'now' })
    expect(
      tileOf('primogems', context({ stats: { primogems: { now: 5, months: [{ month: '2026-10', earned: null }] } } })),
    ).toMatchObject({ detail: 'now' })
  })
})

describe('a tile that is off', () => {
  test('says Only you in place of what a friend would read', () => {
    const tile = tileOf('wishes', context())
    expect(ONLY_YOU).toBe('Only you')
    expect(detailOf(tile, false)).toBe('Only you')
    expect(detailOf(tile, true)).toBe('on the character banner, 3 five-stars in 90 days')
  })
})

describe('pinning', () => {
  const shared = SHARE_KEYS.filter((key) => key !== 'wishes' && key !== 'spending')

  test('pins a stat that is shared, after those pinned before it', () => {
    expect(pinsAfter(['primogems'], 'endgame', shared)).toEqual({ pins: ['primogems', 'endgame'] })
    expect(pinsAfter([], 'playtime', shared)).toEqual({ pins: ['playtime'] })
  })

  test('takes a pin back, also from three', () => {
    expect(pinsAfter(['primogems', 'endgame'], 'primogems', shared)).toEqual({ pins: ['endgame'] })
    expect(pinsAfter(['primogems', 'playtime', 'endgame'], 'playtime', shared)).toEqual({ pins: ['primogems', 'endgame'] })
  })

  test('refuses a fourth with a sentence, and changes nothing', () => {
    expect(pinsAfter(['primogems', 'playtime', 'endgame'], 'achievements', shared)).toEqual({ refused: 'You can pin three stats at most.' })
  })

  test('Status has no pin, and a stat that is off cannot be pinned', () => {
    expect(pinsAfter([], 'status', shared)).toEqual({ refused: 'Status always shows beside your name, so it has no pin.' })
    expect(pinsAfter([], 'wishes', shared)).toEqual({ refused: 'Only a stat you share can be pinned.' })
  })

  test('a switch that goes off takes its pin with it', () => {
    expect(pinsKept(['primogems', 'wishes', 'endgame'], ['status', 'primogems', 'endgame'])).toEqual(['primogems', 'endgame'])
    expect(pinsKept(['wishes'], ['status'])).toEqual([])
  })
})

describe('switching', () => {
  test('turns a key on or off, and keeps the order of the switches', () => {
    expect(sharingAfter(['status', 'primogems'], 'endgame')).toEqual(['status', 'primogems', 'endgame'])
    expect(sharingAfter(['status', 'endgame'], 'primogems')).toEqual(['status', 'primogems', 'endgame'])
    expect(sharingAfter(['status', 'primogems', 'endgame'], 'primogems')).toEqual(['status', 'endgame'])
    expect(sharingAfter([], 'status')).toEqual(['status'])
  })
})

describe('the preview beside the name', () => {
  const profile = (over: Partial<YourProfile>): Pick<YourProfile, 'sharing' | 'pins' | 'stats'> => ({
    sharing: ['status', 'primogems', 'playtime', 'achievements', 'endgame', 'account'],
    pins: ['primogems', 'endgame', 'achievements'],
    stats: STATS,
    ...over,
  })

  test('is the pinned chips, as friends see them and in the order pinned', () => {
    expect(previewOf(profile({})).map((chip) => chip.title)).toEqual(['16,040 primogems', '36 Abyss', '1,402 achievements'])
  })

  test('is the first three shared by the pin order while nothing is pinned', () => {
    expect(previewOf(profile({ pins: [] })).map((chip) => chip.key)).toEqual(['primogems', 'playtime', 'endgame'])
  })

  test('is never a stat that is off, whatever is pinned', () => {
    expect(previewOf(profile({ sharing: ['status', 'primogems'], pins: ['wishes', 'primogems'] })).map((chip) => chip.key)).toEqual(['primogems'])
  })

  test('is empty while nothing is shared, and Status is no chip', () => {
    expect(previewOf(profile({ sharing: ['status'], pins: [] }))).toEqual([])
    expect(previewOf(profile({ sharing: [], pins: [] }))).toEqual([])
  })
})

describe('the header under the name', () => {
  test('says the server and the UID, and that the UID was checked with the HoYoLAB login, and nothing stronger', () => {
    expect(headerLine('os_euro', 712345312)).toBe('Europe. UID 712345312, checked with your HoYoLAB login.')
    expect(headerLine('os_usa', 700000001)).toBe('America. UID 700000001, checked with your HoYoLAB login.')
  })

  test('says so when the UID is not known, and keeps a server it does not know as it is', () => {
    expect(headerLine('os_euro', null)).toBe('Europe. UID not known yet.')
    expect(headerLine('', 712345312)).toBe('UID 712345312, checked with your HoYoLAB login.')
    expect(headerLine('', null)).toBe('UID not known yet.')
    expect(headerLine('somewhere', 712345312)).toBe('somewhere. UID 712345312, checked with your HoYoLAB login.')
  })
})

describe('what a friend shares, as tiles', () => {
  test('are the stats they share, in the order of the switches, each with its words', () => {
    const tiles = tilesOfFriend({ endgame: STATS.endgame, primogems: STATS.primogems })
    expect(tiles.map((tile) => tile.name)).toEqual(['Primogems', 'Endgame'])
    expect(tiles[1]).toMatchObject({ value: '36', unit: 'stars', detail: 'Abyss, Theater Act 10, Stygian 5' })
    expect(tilesOfFriend({ playtime: STATS.playtime })[0].detail).toBe('this week')
  })

  test('leave out a week or a month that is old, and keep the rest (the core gives their figures as null)', () => {
    const stats: Stats = {
      ...STATS,
      playtime: { week_hours: null, days30_hours: null, weeks: [9.5, 14, 11.5, 16, 18, null], week_start: '2026-10-12', longest_run: 14 },
      spending: { month_total: null, month: '2026-10', currency: 'PLN' },
    }
    expect(tilesOfFriend(stats).map((tile) => tile.name)).toEqual(['Primogems', 'Achievements', 'Endgame', 'Account', 'Wishes'])
  })

  test('are none for a friend who shares nothing, and leave out what cannot be shown', () => {
    expect(tilesOfFriend({})).toEqual([])
    const odd = { primogems: { now: null, months: [] }, wishes: { pity: 62, five_stars_90d: 3 }, account: 7, spending: null } as unknown as Stats
    expect(tilesOfFriend(odd).map((tile) => tile.name)).toEqual(['Wishes'])
  })

  test('nothing of another PC\'s breaks a tile', () => {
    const odd: unknown[] = [null, 7, 'x', [], {}, { now: 'lots' }, { now: -1 }, { months: 5 }, { week_hours: {} }, { ticked: [] }, { pity: NaN }]
    for (const value of odd) {
      for (const key of SHARE_KEYS.filter((one) => one !== 'status')) {
        const stats = { [key]: value } as unknown as Stats
        expect(() => tileOf(key, context({ stats, own: false })), `${key}: ${JSON.stringify(value)}`).not.toThrow()
        expect(() => tilesOfFriend(stats)).not.toThrow()
      }
    }
    expect(tilesOfFriend(null as never)).toEqual([])
  })
})

import { describe, expect, test } from 'vitest'
import type { Friend, Stats } from '../onlinetypes.ts'
import {
  agoText, arText, chipsOf, clockOf, compareState, gateText, isStatKey, nameText, PIN_ORDER, pillKeys, SHARES_NOTHING, showsFriends,
  sortedFriends, staleText, STAT_KEYS, statusLine, statusText, summaryOf, uidText,
} from './friendsview.ts'

/** The core's clock in these tests: a Tuesday morning, as the demo's is. */
const NOW = new Date('2026-10-13T08:00:00Z')

const STATS: Stats = {
  primogems: { now: 14320, months: [{ month: '2026-10', earned: 8160 }] },
  playtime: { week_hours: 9, days30_hours: 40.5, weeks: [6, 7.5, 8, 5.5, 9.5, 9], week_start: '2026-10-12', longest_run: 6 },
  achievements: { ticked: 1402, total: 1558 },
  endgame: { abyss_stars: 36, theater_act: 8, stygian: 6 },
  account: { days_active: 790, characters: 88, chests: 2950 },
  wishes: { pity: 62, five_stars_90d: 3 },
  spending: { month_total: 412, month: '2026-10', currency: 'PLN' },
}

function friend(over: Partial<Friend> = {}): Friend {
  return {
    user_id: '00000000-0000-4000-8000-000000007687',
    name: 'Riley',
    tag: '7687',
    has_picture: false,
    ar: 58,
    uid: 712345312,
    status: 'in_game',
    since: '2026-10-13T07:18:00Z',
    last_seen: '2026-10-13T07:59:48Z',
    stats: {},
    pills: [],
    compare: true,
    ...over,
  }
}

describe('the order of the list', () => {
  test('friends sort in game, then the rest, and those who hide their status go with the offline', () => {
    const list = [
      friend({ name: 'Milo', status: 'offline' }),
      friend({ name: 'Kira', status: 'offline' }),
      friend({ name: 'Zed', status: null }),
      friend({ name: 'Riley', status: 'in_game' }),
      friend({ name: 'Nova', status: 'in_game' }),
      friend({ name: 'anna', status: 'offline' }),
    ]
    expect(sortedFriends(list).map((one) => one.name)).toEqual(['Nova', 'Riley', 'anna', 'Kira', 'Milo', 'Zed'])
  })

  test('a list is sorted without being changed, and a name that is no text cannot break it', () => {
    const list = [friend({ name: 'B', status: 'offline' }), friend({ name: 'A', status: 'in_game' })]
    const names = list.map((one) => one.name)
    sortedFriends(list)
    expect(list.map((one) => one.name)).toEqual(names)
    const odd = [friend({ name: undefined as unknown as string }), friend({ name: 'A' })]
    expect(() => sortedFriends(odd)).not.toThrow()
  })
})

describe('the status line', () => {
  test('says what a friend is doing, from the core\'s clock', () => {
    const game = friend({ status: 'in_game', since: '2026-10-13T07:18:00Z' })
    expect(statusLine(game, NOW)).toEqual({ tone: 'game', text: 'In game', when: 'for 42 min' })
    expect(statusText(statusLine(game, NOW))).toBe('In game for 42 min')
    const own = friend({ status: 'not_in_game', since: null })
    expect(statusLine(own, NOW)).toEqual({ tone: 'off', text: 'Not in game', when: '' })
    const away = friend({ status: 'offline', since: null, last_seen: '2026-10-11T08:00:00Z' })
    expect(statusLine(away, NOW)).toEqual({ tone: 'off', text: 'Offline', when: '2 days ago' })
    expect(statusText(statusLine(away, NOW))).toBe('Offline 2 days ago')
  })

  test('no line says that Guild Board is open, whatever a row holds', () => {
    for (const status of ['in_game', 'not_in_game', 'offline', null, 'open'] as const) {
      const line = statusLine(friend({ status: status as never, since: '2026-10-13T06:00:00Z' }), NOW)
      expect(statusText(line)).not.toMatch(/guild board/i)
      expect(line.tone).not.toBe('open')
    }
  })

  test('counts the minutes down, not up: a friend 42 minutes in is not 43 at the half minute', () => {
    const game = friend({ since: '2026-10-13T07:17:31Z' })
    expect(statusText(statusLine(game, NOW))).toBe('In game for 42 min')
    expect(statusText(statusLine(friend({ since: '2026-10-13T06:55:00Z' }), NOW))).toBe('In game for 1 h 05 min')
  })

  test('a friend who hides their status shows nothing in its place, and is not called offline', () => {
    expect(statusLine(friend({ status: null, since: null, last_seen: null }), NOW)).toEqual({ tone: 'none', text: '', when: '' })
    expect(statusText(statusLine(friend({ status: null }), NOW))).toBe('')
  })

  test.each(['infinity', '-infinity', 'soon', '', '9999-12-31T00:00:00Z', '2026-10-14T08:00:00Z', '1970-01-01T00:00:00Z'])(
    'a start of "%s" is left out of the line and is not a time',
    (since) => {
      expect(statusText(statusLine(friend({ since }), NOW))).toBe('In game')
      expect(statusText(statusLine(friend({ since: since as never, status: 'not_in_game' }), NOW))).toBe('Not in game')
    },
  )

  test('a start a little ahead of the core\'s clock is now, not a mistake', () => {
    expect(statusText(statusLine(friend({ since: '2026-10-13T08:02:00Z' }), NOW))).toBe('In game for 0 min')
  })

  test.each([null, '', 'infinity', 'never', '2030-01-01T00:00:00Z'])('a last seen of %s leaves "Offline" without a time', (last) => {
    expect(statusText(statusLine(friend({ status: 'offline', last_seen: last }), NOW))).toBe('Offline')
  })

  test('anything else in the status is a friend whose status is not shown', () => {
    expect(statusLine(friend({ status: 'dancing' as never }), NOW).tone).toBe('none')
  })
})

describe('how long ago', () => {
  test('is in the words of the list', () => {
    expect(agoText(30)).toBe('just now')
    expect(agoText(181)).toBe('3 min ago')
    expect(agoText(59 * 60)).toBe('59 min ago')
    expect(agoText(3600)).toBe('1 h ago')
    expect(agoText(90 * 60)).toBe('1 h ago')
    expect(agoText(23 * 3600 + 59 * 60)).toBe('23 h ago')
    expect(agoText(86_400)).toBe('1 day ago')
    expect(agoText(2 * 86_400 + 5)).toBe('2 days ago')
    expect(agoText(400 * 86_400)).toBe('400 days ago')
  })
})

describe('the chips beside a friend', () => {
  const chip = (key: (typeof PIN_ORDER)[number], stats: Stats = STATS) => chipsOf({ pills: [key], stats })[0]

  test('each stat has its chip, as the mockup has it', () => {
    expect(chip('primogems')).toMatchObject({ key: 'primogems', sign: 'gem', picture: '/api/icon/static.primogem', value: '14,320', label: '' })
    expect(chip('playtime')).toMatchObject({ key: 'playtime', sign: 'clock', picture: null, value: '9 h', label: 'this week' })
    expect(chip('endgame')).toMatchObject({ key: 'endgame', sign: 'star', value: '36', label: 'Abyss' })
    expect(chip('achievements')).toMatchObject({ key: 'achievements', sign: 'cup', value: '1,402', label: 'achievements' })
    expect(chip('account')).toMatchObject({ key: 'account', value: '790', label: 'days active' })
    expect(chip('wishes')).toMatchObject({ key: 'wishes', value: '62', label: 'pity' })
    expect(chip('spending')).toMatchObject({ key: 'spending', value: '412 zł', label: 'this month' })
  })

  test('a chip says all of it in its title, for the pointer and the screen reader', () => {
    expect(chip('primogems')?.title).toBe('14,320 primogems')
    expect(chip('playtime')?.title).toBe('9 h this week')
    expect(chip('endgame')?.title).toBe('36 Abyss')
    expect(chip('spending')?.title).toBe('412 zł this month')
  })

  test('the chips follow the friend\'s pills, in their order, and three at most', () => {
    const keys = chipsOf({ pills: ['achievements', 'primogems', 'endgame', 'playtime'], stats: STATS }).map((one) => one.key)
    expect(keys).toEqual(['achievements', 'primogems', 'endgame'])
  })

  test('shares nothing yet is what a friend with no chip says', () => {
    expect(SHARES_NOTHING).toBe('Shares nothing yet')
    expect(chipsOf({ pills: [], stats: {} })).toEqual([])
    expect(chipsOf({ pills: ['primogems'], stats: {} })).toEqual([])
  })

  test('a friend\'s own pills are shown, a stat they pin that they do not share is not', () => {
    expect(chipsOf({ pills: ['wishes'], stats: { primogems: STATS.primogems } })).toEqual([])
  })

  test('a week or a month that is old has no chip, and the others stay (the core gives their figures as null)', () => {
    const stats: Stats = {
      ...STATS,
      playtime: { week_hours: null, days30_hours: null, weeks: [7.5, 8, 5.5, 9.5, 9, null], week_start: '2026-10-12', longest_run: 6 },
      spending: { month_total: null, month: '2026-10', currency: 'PLN' },
    }
    expect(chipsOf({ pills: ['playtime'], stats })).toEqual([])
    expect(chipsOf({ pills: ['spending'], stats })).toEqual([])
    expect(chipsOf({ pills: ['playtime', 'primogems', 'spending', 'endgame'], stats }).map((one) => one.key)).toEqual(['primogems', 'endgame'])
  })
})

describe('the pills when a player pins nothing', () => {
  test('are the first three shared, by the pin order', () => {
    expect(PIN_ORDER).toEqual(['primogems', 'playtime', 'endgame', 'achievements', 'account', 'wishes', 'spending'])
    expect(pillKeys([], ['wishes', 'achievements', 'playtime', 'account'])).toEqual(['playtime', 'achievements', 'account'])
    expect(pillKeys([], ['spending'])).toEqual(['spending'])
    expect(pillKeys([], [])).toEqual([])
  })

  test('are the pins, in the order they were pinned, when there are any that are shared', () => {
    expect(pillKeys(['endgame', 'primogems'], ['primogems', 'playtime', 'endgame'])).toEqual(['endgame', 'primogems'])
  })

  test('leave out a pin that is not shared, and fall back when none is left', () => {
    expect(pillKeys(['wishes', 'primogems'], ['primogems', 'playtime'])).toEqual(['primogems'])
    expect(pillKeys(['wishes'], ['achievements', 'playtime'])).toEqual(['playtime', 'achievements'])
  })

  test('are three at most, and each once', () => {
    expect(pillKeys(['primogems', 'primogems', 'playtime', 'endgame', 'account'], [...STAT_KEYS])).toEqual(['primogems', 'playtime', 'endgame'])
    expect(pillKeys([], [...STAT_KEYS])).toEqual(['primogems', 'playtime', 'endgame'])
  })
})

describe('Compare on a friend', () => {
  test('is on while the two of you share a stat', () => {
    expect(compareState(friend({ compare: true }))).toEqual({ enabled: true, tip: null })
  })

  test('is off, with its reason, while you share none', () => {
    expect(compareState(friend({ compare: false, name: 'Milo' }))).toEqual({
      enabled: false,
      tip: 'You and Milo share no stat in common yet.',
    })
  })

  test('is off for anything that is not a plain yes', () => {
    expect(compareState(friend({ compare: undefined as never })).enabled).toBe(false)
    expect(compareState(friend({ compare: 'yes' as never })).enabled).toBe(false)
  })
})

describe('the count in the top bar', () => {
  test('counts those in game, and nothing else', () => {
    const list = [
      friend({ status: 'in_game' }),
      friend({ status: 'offline' }),
      friend({ status: 'offline' }),
      friend({ status: null }),
    ]
    expect(summaryOf(list)).toEqual({ inGame: 1 })
    expect(summaryOf([])).toEqual({ inGame: 0 })
  })
})

describe('friends that could not be updated', () => {
  test('say when they were read', () => {
    expect(staleText({ stale: true, read_at: '2026-10-13T07:56:00Z' }, NOW)).toBe(
      'Friends could not be updated. This is their last known state, read 4 min ago.',
    )
    expect(staleText({ stale: true, read_at: '2026-10-13T07:59:50Z' }, NOW)).toBe(
      'Friends could not be updated. This is their last known state, read just now.',
    )
    expect(staleText({ stale: true, read_at: '2026-10-13T03:00:00Z' }, NOW)).toBe(
      'Friends could not be updated. This is their last known state, read 5 h ago.',
    )
  })

  test('say so when nothing was read yet', () => {
    expect(staleText({ stale: true, read_at: null }, NOW)).toBe('Friends could not be read yet. Guild Board tries again in a few minutes.')
  })

  test('say nothing about a list that is new', () => {
    expect(staleText({ stale: false, read_at: '2026-10-13T07:56:00Z' }, NOW)).toBeNull()
  })

  test('do not trip on a time they cannot read', () => {
    expect(staleText({ stale: true, read_at: 'infinity' }, NOW)).toBe('Friends could not be updated.')
  })

  test('after a lost session say that, since nothing is tried again until the player signs in', () => {
    expect(staleText({ stale: true, read_at: '2026-10-13T07:56:00Z' }, NOW, true)).toBe(
      "Your online session has ended. This is your friends' last known state, read 4 min ago.",
    )
    expect(staleText({ stale: true, read_at: null }, NOW, true)).toBe('Your online session has ended, so your friends could not be read.')
    expect(staleText({ stale: true, read_at: 'infinity' }, NOW, true)).toBe('Your online session has ended, so your friends could not be read.')
  })

  test('tell their times as they stood when they were read, so that an old "In game" does not go on counting', () => {
    const old = { stale: true, read_at: '2026-10-13T05:00:00Z' }
    const riley = friend({ since: '2026-10-13T04:18:00Z' })
    expect(statusText(statusLine(riley, clockOf(old, NOW)))).toBe('In game for 42 min')
    expect(clockOf({ ...old, stale: false }, NOW)).toBe(NOW)
    expect(clockOf({ ...old, read_at: null }, NOW)).toBe(NOW)
    expect(clockOf({ ...old, read_at: 'infinity' }, NOW)).toBe(NOW)
  })
})

describe('a page of Friends while the player is not signed in', () => {
  test('says so in a sentence for each state, and nothing while they are signed in', () => {
    expect(gateText({ state: 'signed_out' })).toBe('Sign in with Discord to add friends and compare your stats with theirs.')
    expect(gateText({ state: 'waiting' })).toBe('Finish signing in in your browser, then come back.')
    expect(gateText({ state: 'sign_in_again' })).toBe('Your online session has ended. Sign in again in Settings.')
    expect(gateText({ state: 'signed_in' })).toBeNull()
  })

  test('friends stay through a lost session, and go with a sign-out or a new sign-in (the online design, section 5)', () => {
    expect(showsFriends({ state: 'signed_in' })).toBe(true)
    expect(showsFriends({ state: 'sign_in_again' })).toBe(true)
    expect(showsFriends({ state: 'signed_out' })).toBe(false)
    expect(showsFriends({ state: 'waiting' })).toBe(false)
  })
})

describe('what comes from another PC', () => {
  test('an Adventure Rank is a whole number from 1 to 99, and anything else shows no tab', () => {
    expect(arText(58)).toBe('AR 58')
    expect(arText(1)).toBe('AR 1')
    expect(arText(99)).toBe('AR 99')
    for (const odd of [-5, 0, 100, 1.5, NaN, Infinity, '58', null, undefined, {}, []]) expect(arText(odd), String(odd)).toBeNull()
  })

  test('a UID is a plain whole number, and anything else is not shown', () => {
    expect(uidText(712345312)).toBe('712345312')
    for (const odd of [-1, 0, 1.5, 1e13, NaN, '712345312', null, undefined]) expect(uidText(odd), String(odd)).toBeNull()
  })

  test('a stat key is one of the seven', () => {
    for (const key of STAT_KEYS) expect(isStatKey(key)).toBe(true)
    for (const odd of ['status', 'Primogems', '', null, 3, {}, '__proto__', 'constructor']) expect(isStatKey(odd)).toBe(false)
  })

  test('a stat of the wrong shape gives no chip, and nothing throws', () => {
    const odd: unknown[] = [
      null, 7, 'x', true, [], [1, 2], {}, { now: 'lots' }, { now: -1 }, { now: Infinity }, { now: 1e300 }, { now: null },
      { months: 5 }, { week_hours: {} }, { ticked: [] }, { abyss_stars: '36' }, { days_active: -3 }, { pity: NaN },
      { month_total: 4, currency: 5 }, { month_total: 4, currency: '<img src=x>' }, { month_total: 'a', currency: 'PLN' },
    ]
    for (const value of odd) {
      for (const key of PIN_ORDER) {
        const stats = { [key]: value } as unknown as Stats
        expect(() => chipsOf({ pills: [key], stats }), `${key}: ${JSON.stringify(value)}`).not.toThrow()
        expect(chipsOf({ pills: [key], stats }), `${key}: ${JSON.stringify(value)}`).toEqual([])
      }
    }
  })

  test('a chip is left out for what cannot be shown, and the others stay', () => {
    const stats = {
      primogems: { now: null, months: [] },
      playtime: { week_hours: 'nine', weeks: [], days30_hours: 3, longest_run: 1 },
      endgame: { abyss_stars: 36, theater_act: null, stygian: null },
    } as unknown as Stats
    expect(chipsOf({ pills: ['primogems', 'playtime', 'endgame'], stats }).map((one) => one.key)).toEqual(['endgame'])
  })

  test('a list of pills or stats that is no list or object does not break the row', () => {
    for (const pills of [null, undefined, 5, 'primogems', {}]) {
      expect(() => chipsOf({ pills: pills as never, stats: STATS })).not.toThrow()
      expect(chipsOf({ pills: pills as never, stats: STATS })).toEqual([])
    }
    for (const stats of [null, undefined, 5, 'x', []]) {
      expect(() => chipsOf({ pills: ['primogems'], stats: stats as never })).not.toThrow()
      expect(chipsOf({ pills: ['primogems'], stats: stats as never })).toEqual([])
    }
  })

  test('pills that name no stat are skipped, and a key a stat object inherits is not one', () => {
    expect(chipsOf({ pills: ['status', '__proto__', 'constructor', 'nothing', 4, null] as never, stats: STATS })).toEqual([])
  })

  test('a pill named twice is one chip', () => {
    expect(chipsOf({ pills: ['endgame', 'endgame', 'wishes'], stats: STATS }).map((one) => one.key)).toEqual(['endgame', 'wishes'])
  })

  test('a very large figure is not drawn, so that it cannot break the row', () => {
    const stats = { primogems: { now: 1e300, months: [] } } as unknown as Stats
    expect(chipsOf({ pills: ['primogems'], stats })).toEqual([])
  })
})

describe('names and tags from the online server', () => {
  test('a name that is not text is empty, and bidi controls go', () => {
    for (const value of [{}, [], null, undefined, 7, true]) expect(nameText(value)).toBe('')
    expect(nameText('Riley')).toBe('Riley')
    // An unterminated right-to-left override would turn the words after the name around; it goes, with every format character.
    expect(nameText('Riley‮yelir')).toBe('Rileyyelir')
    expect(nameText('⁦Nova⁩​‏﻿')).toBe('Nova')
    expect(nameText('Kira')).toBe('Kira')
  })

  test('a name is cut to the twenty characters the server allows, a character of two code units counted as one', () => {
    expect(nameText('A'.repeat(64))).toBe('A'.repeat(20))
    expect(nameText('\u{1F431}'.repeat(25))).toBe('\u{1F431}'.repeat(20))
  })

  test("Compare's tip names a friend by the same reading", () => {
    expect(compareState(friend({ compare: false, name: { evil: true } as never })).tip).toBe('You and  share no stat in common yet.')
    expect(compareState(friend({ compare: false, name: 'Mi‮lo' })).tip).toBe('You and Milo share no stat in common yet.')
  })
})

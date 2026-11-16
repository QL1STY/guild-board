import { describe, expect, it } from 'vitest'
import type { ResetMode } from '../types.ts'
import {
  DEFAULT_STYLE, ENDGAME_STYLES, artIcon, cycleDates, linePlaces, metaOf, modeIcon, resultOf, rowValue, shareLeft, styleOf, timeSeconds, timeWords,
} from './endgameview.ts'

const NOW = new Date('2026-11-11T12:00:00+00:00')
const DAY = 86_400_000
const at = (ms: number): string => new Date(NOW.getTime() + ms).toISOString()

const mode = (over: Partial<ResetMode> = {}): ResetMode => ({
  mode: 'abyss', label: 'Spiral Abyss', short: 'Abyss', played: true, stars: 36, acts: null, acts_of: null, difficulty: null,
  ends_at: at(5 * DAY + 2 * 3_600_000), next_starts_at: null, stale: false, starts_at: at(-25 * DAY), medals: null,
  header: { icon: null, picture: null, crop: null }, medal: null, ...over,
})
const theater = (over: Partial<ResetMode> = {}): ResetMode =>
  mode({ mode: 'theater', label: 'Imaginarium Theater', short: 'Theater', stars: null, acts: 8, ends_at: at(18 * DAY), ...over })
const stygian = (over: Partial<ResetMode> = {}): ResetMode =>
  mode({ mode: 'stygian', label: 'Stygian Onslaught', short: 'Stygian', stars: null, difficulty: 5, ends_at: at(9 * DAY), ...over })

describe("a mode's result", () => {
  it('is the stars of the Abyss out of 36, the act of the Theater and the difficulty of the Stygian', () => {
    expect(resultOf(mode())).toEqual({ kind: 'stars', stars: 36, of: 36 })
    expect(resultOf(mode({ stars: 33 }))).toEqual({ kind: 'stars', stars: 33, of: 36 })
    expect(resultOf(theater())).toEqual({ kind: 'act', act: 8, of: null, medals: null })
    expect(resultOf(stygian())).toEqual({ kind: 'difficulty', level: 5, medal: null })
  })

  it('carries the Theater acts of the season and its medals only where the read has them', () => {
    expect(resultOf(theater({ acts_of: 10, medals: 6 }))).toEqual({ kind: 'act', act: 8, of: 10, medals: 6 })
  })

  it("carries the Stygian's official medal, the picture the Stats card draws, where the core gives one, and never takes the Theater's mark for it", () => {
    expect(resultOf(stygian({ medal: '/api/art/0123456789abcdef0123456789abcdef' }))).toEqual({
      kind: 'difficulty', level: 5, medal: '/api/art/0123456789abcdef0123456789abcdef',
    })
    expect(resultOf(stygian({ medal: 'https://example.com/medal.png' }))).toEqual({ kind: 'difficulty', level: 5, medal: null })
    expect(resultOf(theater({ medal: '/api/art/0123456789abcdef0123456789abcdef' }))).toEqual({ kind: 'act', act: 8, of: null, medals: null })
  })

  it('says "Not played yet" for a mode not played, and "Not read since the reset" for a cycle that was not read', () => {
    expect(resultOf(stygian({ played: false, difficulty: null }))).toEqual({ kind: 'none', note: 'Not played yet', stale: false })
    expect(resultOf(stygian({ stale: true, played: false, ends_at: null }))).toEqual({
      kind: 'none', note: 'Not read since the reset', stale: true,
    })
  })

  it('never says a count the read did not give', () => {
    expect(resultOf(mode({ stars: null }))).toEqual({ kind: 'none', note: 'Not played yet', stale: false })
    expect(resultOf(theater({ acts: null }))).toEqual({ kind: 'none', note: 'Not played yet', stale: false })
    expect(resultOf(stygian({ difficulty: null }))).toEqual({ kind: 'none', note: 'Not played yet', stale: false })
  })
})

describe("a result in words, as the Calendar says it", () => {
  it('says the stars of the Abyss, the act of the Theater with its count where the read has it, and the Stygian difficulty', () => {
    expect(rowValue(mode())).toEqual({ main: '36', unit: ' of 36 stars', note: null })
    expect(rowValue(theater())).toEqual({ main: 'Act 8', unit: '', note: null })
    expect(rowValue(theater({ acts_of: 10 }))).toEqual({ main: 'Act 8', unit: ' of 10', note: null })
    expect(rowValue(stygian())).toEqual({ main: 'Difficulty 5', unit: '', note: null })
  })

  it('says why there is none', () => {
    expect(rowValue(stygian({ played: false, difficulty: null }))).toEqual({ main: null, unit: '', note: 'Not played yet' })
    expect(rowValue(stygian({ stale: true, played: false, ends_at: null }))).toEqual({
      main: null, unit: '', note: 'Not read since the reset',
    })
  })
})

describe('the time words', () => {
  it('say "resets in" for the Abyss and the Theater, and "ends in" for the Stygian, with the first unit of the time', () => {
    expect(timeWords(mode(), NOW)).toEqual({ lead: 'resets in', time: '5 d', tail: 'to reset' })
    expect(timeWords(theater(), NOW)).toEqual({ lead: 'resets in', time: '18 d', tail: 'to reset' })
    expect(timeWords(stygian(), NOW)).toEqual({ lead: 'ends in', time: '9 d', tail: 'left' })
  })

  it('give the time in full where it is asked for', () => {
    expect(timeWords(mode(), NOW, true)).toEqual({ lead: 'resets in', time: '5 d 2 h', tail: 'to reset' })
    expect(timeWords(mode({ ends_at: at(18 * 3_600_000 + 52 * 60_000) }), NOW, true)?.time).toBe('18 h 52 min')
  })

  it('count hours and minutes where less than a day is left', () => {
    expect(timeWords(mode({ ends_at: at(5 * 3_600_000 + 20 * 60_000) }), NOW)?.time).toBe('5 h')
    expect(timeWords(mode({ ends_at: at(42 * 60_000) }), NOW)?.time).toBe('42 min')
  })

  it('say "starts in" for a Stygian between seasons', () => {
    expect(timeWords(stygian({ stale: true, played: false, ends_at: null, next_starts_at: at(3 * DAY) }), NOW)).toEqual({
      lead: 'starts in', time: '3 d', tail: 'to start',
    })
  })

  it('are nothing where there is no end, or the end has come', () => {
    expect(timeWords(mode({ stale: true, played: false, ends_at: null }), NOW)).toBeNull()
    expect(timeWords(mode({ ends_at: at(-60_000) }), NOW)).toBeNull()
    expect(timeWords(mode({ ends_at: 'soon' }), NOW)).toBeNull()
  })
})

describe('the seconds to the time words', () => {
  it('are those to the end, or to the next start between seasons, and null where there is none', () => {
    expect(timeSeconds(mode(), NOW)).toBe(5 * 86_400 + 2 * 3_600)
    expect(timeSeconds(stygian({ stale: true, played: false, ends_at: null, next_starts_at: at(3 * DAY) }), NOW)).toBe(3 * 86_400)
    expect(timeSeconds(mode({ ends_at: null }), NOW)).toBeNull()
    expect(timeSeconds(mode({ ends_at: at(-1000) }), NOW)).toBeNull()
  })
})

describe("a mode's icon", () => {
  const ICON = `/api/art/${'a'.repeat(32)}`

  it("is the Stats card's icon where the header has one, and none where it has not, so that the drawn sign shows", () => {
    expect(modeIcon(mode({ header: { icon: ICON, picture: null, crop: null } }))).toBe(ICON)
    expect(modeIcon(mode())).toBeNull()
  })

  it('is only ever an address of the art cache: nothing else is drawn as a picture', () => {
    expect(artIcon(ICON)).toBe(ICON)
    expect(artIcon('https://act-upload.hoyoverse.com/a.png')).toBeNull()
    expect(artIcon('')).toBeNull()
    expect(artIcon(null)).toBeNull()
  })
})

describe('the share of a cycle still to come', () => {
  it('is the time left over the cycle the read gives', () => {
    expect(shareLeft(mode({ starts_at: at(-5 * DAY), ends_at: at(5 * DAY) }), NOW)).toBeCloseTo(0.5, 5)
    expect(shareLeft(mode({ starts_at: at(-29 * DAY), ends_at: at(DAY) }), NOW)).toBeCloseTo(1 / 30, 5)
  })

  it('stays between none and all, and is null where the cycle is not known', () => {
    expect(shareLeft(mode({ starts_at: at(DAY), ends_at: at(5 * DAY) }), NOW)).toBe(1)
    expect(shareLeft(mode({ starts_at: at(-5 * DAY), ends_at: at(-1000) }), NOW)).toBe(0)
    expect(shareLeft(mode({ starts_at: null }), NOW)).toBeNull()
    expect(shareLeft(mode({ ends_at: null }), NOW)).toBeNull()
    expect(shareLeft(mode({ starts_at: at(5 * DAY), ends_at: at(2 * DAY) }), NOW)).toBeNull()
  })
})

describe("a cycle's dates", () => {
  it('are the day it began and the day it resets, the end taken from the last second before it', () => {
    const dates = cycleDates(
      mode({ starts_at: new Date(2026, 9, 16, 4, 0, 0).toISOString(), ends_at: new Date(2026, 10, 16, 3, 59, 59).toISOString() }),
    )
    expect(dates).toEqual({ from: 'Fri 16 Oct', to: 'Mon 16 Nov' })
  })

  it('are nothing where the read gives no cycle', () => {
    expect(cycleDates(mode({ starts_at: null }))).toBeNull()
    expect(cycleDates(mode({ ends_at: null }))).toBeNull()
  })
})

describe('the order on the line', () => {
  const modes = (): ResetMode[] => [mode({ ends_at: at(DAY) }), theater({ ends_at: at(16 * DAY) }), stygian({ ends_at: at(10 * DAY) })]

  it('is the time to reset, the soonest first, with the first at the left and the last at the right', () => {
    const places = linePlaces(modes(), NOW)
    expect(places.map((place) => place.mode.mode)).toEqual(['abyss', 'stygian', 'theater'])
    expect(places.map((place) => place.side)).toEqual(['l', 'c', 'r'])
  })

  it('sets the middle one by its time, kept clear of the two ends', () => {
    const places = linePlaces(modes(), NOW)
    expect(places[1].at).toBeCloseTo((10 / 17) * 100, 1)
    const close = linePlaces([mode({ ends_at: at(DAY) }), stygian({ ends_at: at(1.2 * DAY) }), theater({ ends_at: at(16 * DAY) })], NOW)
    expect(close[1].at).toBe(38)
    const late = linePlaces([mode({ ends_at: at(DAY) }), stygian({ ends_at: at(15 * DAY) }), theater({ ends_at: at(16 * DAY) })], NOW)
    expect(late[1].at).toBe(62)
  })

  it('puts a mode with no time last, in the middle if it is not the last', () => {
    const none = linePlaces([mode({ stale: true, played: false, ends_at: null }), theater(), stygian()], NOW)
    expect(none.map((place) => place.mode.mode)).toEqual(['stygian', 'theater', 'abyss'])
    expect(none.map((place) => place.side)).toEqual(['l', 'c', 'r'])
    const two = linePlaces([mode({ ends_at: at(DAY) }), theater({ stale: true, played: false, ends_at: null }), stygian({ stale: true, played: false, ends_at: null })], NOW)
    expect(two[1].at).toBe(50)
  })
})

describe('the style', () => {
  it('is With pictures where none is chosen, and the one chosen where it is known', () => {
    expect(DEFAULT_STYLE).toBe('pictures')
    expect(styleOf({})).toBe('pictures')
    expect(styleOf({ style: 'bars' })).toBe('bars')
    expect(styleOf({ style: 'medallions' })).toBe('medallions')
    expect(styleOf({ style: 'order' })).toBe('order')
  })

  it('falls back to the default for a style this version does not know', () => {
    expect(styleOf({ style: 'rings' })).toBe('pictures')
    expect(styleOf({ style: 3 })).toBe('pictures')
  })

  it('names four styles, each with a line to say what it draws', () => {
    expect(ENDGAME_STYLES.map((style) => style.value)).toEqual(['pictures', 'medallions', 'bars', 'order'])
    expect(ENDGAME_STYLES.map((style) => style.name)).toEqual(['Pictures', 'Medallions', 'Season bars', 'In order'])
    expect(ENDGAME_STYLES.every((style) => style.about.length > 10)).toBe(true)
  })
})

describe('the meta', () => {
  it('counts the modes not played, from 2 × 2, and is nothing at 2 × 1 or where none is', () => {
    expect(metaOf(1, false)).toBe('1 not played')
    expect(metaOf(2, false)).toBe('2 not played')
    expect(metaOf(0, false)).toBeNull()
    expect(metaOf(1, true)).toBeNull()
  })
})

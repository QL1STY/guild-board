import { describe, expect, it } from 'vitest'
import type { CalendarBanner, CalendarEvent, CalendarModel, ResetMode } from '../types.ts'
import {
  calendarFoot, calendarFrame, calendarGrid, calendarList, calendarMeta, eventWords, modeFinished, modeWords, spanOf, timeParts, windowDays,
} from './calendarview.ts'

// Local times, so that the day a bar falls on does not depend on the PC the test runs on.
const NOW = new Date(2026, 9, 13, 10, 0) // Tue 13 Oct 2026, 10:00
const at = (days: number, hours = 10, minutes = 0): string => new Date(2026, 9, 13 + days, hours, minutes).toISOString()

const banner = (over: Partial<CalendarBanner> = {}): CalendarBanner => ({
  id: 'character:a', kind: 'character', name: 'Furina · Zhongli', starts: at(-8), ends: at(3, 18),
  faces: [
    { name: 'Bennett', rarity: 4, icon: null }, { name: 'Furina', rarity: 5, icon: '/api/icon/calendar.face.aa' },
    { name: 'Zhongli', rarity: 5, icon: null },
  ],
  ...over,
})
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 1, name: 'Feast of the Autumn Winds', starts: at(-8), ends: at(6), finished: false, primogems: 1000, explored: null,
  double: null, soon: false, status: 2, source: 'hoyolab', ...over,
})
const soon = (name: string, over: Partial<CalendarEvent> = {}): CalendarEvent =>
  event({ id: null, name, starts: null, ends: null, primogems: null, soon: true, status: 1, ...over })
const mode = (over: Partial<ResetMode> = {}): ResetMode => ({
  mode: 'abyss', label: 'Spiral Abyss', short: 'Abyss', played: true, stars: 36, acts: null, acts_of: null, difficulty: null,
  ends_at: at(5, 10), next_starts_at: null, stale: false, starts_at: null, medals: null,
  header: { icon: null, picture: null, crop: null }, medal: null, ...over,
})
const theater = (over: Partial<ResetMode> = {}): ResetMode =>
  mode({ mode: 'theater', label: 'Imaginarium Theater', short: 'Theater', stars: null, acts: 8, acts_of: 10, ends_at: at(18, 10), ...over })
const stygian = (over: Partial<ResetMode> = {}): ResetMode =>
  mode({
    mode: 'stygian', label: 'Stygian Onslaught', short: 'Stygian', stars: null, played: false, ends_at: at(9, 10), ...over,
  })
const model = (over: Partial<CalendarModel> = {}): CalendarModel => ({
  read_at: at(0, 9, 0), read: true, banners: [banner()], events: [event()], endgame: [mode(), theater(), stygian()], left: 2,
  upcoming_from: null, ...over,
})

describe('the window', () => {
  it('is fourteen local days, two before today to eleven after, with today marked', () => {
    const days = windowDays(NOW)
    expect(days).toHaveLength(14)
    expect(days[0]).toMatchObject({ weekday: 'Sun', date: 11, today: false })
    expect(days[2]).toMatchObject({ weekday: 'Tue', date: 13, today: true })
    expect(days[13]).toMatchObject({ weekday: 'Sat', date: 24, today: false })
    expect(days.filter((day) => day.today)).toHaveLength(1)
  })
})

describe("a bar's columns", () => {
  it('start on the day it starts and end after the day it ends, in the window columns 1 to 15', () => {
    expect(spanOf(at(-8), at(6), NOW)).toEqual({ col: 1, end: 10, from: true, to: false })
    expect(spanOf(at(1), at(5), NOW)).toEqual({ col: 4, end: 9, from: false, to: false })
    expect(spanOf(at(0, 8), at(0, 20), NOW)).toEqual({ col: 3, end: 4, from: false, to: false })
  })

  it('has a flat start where it began before the window and a flat end where it runs past it', () => {
    expect(spanOf(at(-30), at(3), NOW)).toMatchObject({ col: 1, from: true, to: false })
    expect(spanOf(at(1), at(15), NOW)).toEqual({ col: 4, end: 15, from: false, to: true })
    expect(spanOf(at(-30), at(40), NOW)).toEqual({ col: 1, end: 15, from: true, to: true })
  })

  it('is none for a thing that ended before the window or starts after it, or has no dates', () => {
    expect(spanOf(at(-20), at(-3), NOW)).toBeNull()
    expect(spanOf(at(12), at(20), NOW)).toBeNull()
    expect(spanOf(null, null, NOW)).toBeNull()
  })
})

describe('the lanes', () => {
  it('are Wishes, Events and Endgame, and a lane with nothing in it is left out', () => {
    expect(calendarGrid(model(), NOW).lanes.map((lane) => lane.label)).toEqual(['Wishes', 'Events', 'Endgame'])
    expect(calendarGrid(model({ banners: [] }), NOW).lanes.map((lane) => lane.label)).toEqual(['Events', 'Endgame'])
    expect(calendarGrid(model({ endgame: [] }), NOW).lanes.map((lane) => lane.lane)).toEqual(['wish', 'event'])
  })

  it('put each bar on the first free row of its lane, those that meet end to end on one row', () => {
    const grid = calendarGrid(
      model({
        banners: [
          banner({ id: 'a', name: 'First', starts: at(-8), ends: at(3, 18) }),
          banner({ id: 'b', name: 'Second', kind: 'weapon', starts: at(-8), ends: at(3, 18) }),
          banner({ id: 'c', name: 'Third', starts: at(4, 11), ends: at(20) }),
        ],
        events: [],
        endgame: [],
      }),
      NOW,
    )
    const bars = grid.lanes[0]!.bars
    expect(bars.map((bar) => [bar.name, bar.row - grid.lanes[0]!.head])).toEqual([['First', 1], ['Second', 2], ['Third', 1]])
    expect(bars[2]).toMatchObject({ col: 7, from: false, to: true })
  })

  it('keep the Wishes lane to the rows it is given, and say how many bars the rest are on the last bar of its last row', () => {
    const banners = [
      banner({ id: 'a', name: 'First', starts: at(-8), ends: at(8, 18) }),
      banner({ id: 'b', name: 'Second', kind: 'weapon', starts: at(-8), ends: at(8, 18) }),
      banner({ id: 'c', name: 'Third', starts: at(6, 11), ends: at(20) }),
      banner({ id: 'd', name: 'Fourth', kind: 'weapon', starts: at(6, 11), ends: at(20) }),
      banner({ id: 'e', name: 'Fifth', kind: 'weapon', starts: at(7, 11), ends: at(20) }),
    ]
    const grid = calendarGrid(model({ banners }), NOW, 2)
    const wishes = grid.lanes[0]!
    expect(wishes.bars.map((bar) => bar.name)).toEqual(['First', 'Second'])
    expect(wishes.bars.map((bar) => bar.more)).toEqual([0, 3])
    expect(wishes.bars[1]!.hidden).toEqual(['Third', 'Fourth', 'Fifth'])
    // The Events lane starts right under the two rows: a heading, two rows, then the next heading.
    expect(grid.lanes.map((lane) => lane.head)).toEqual([1, 4, 6])
  })

  it('keep every bar where the rows are enough, and never cap the other lanes', () => {
    const banners = [
      banner({ id: 'a', name: 'First', starts: at(-8), ends: at(3, 18) }),
      banner({ id: 'b', name: 'Second', kind: 'weapon', starts: at(-8), ends: at(3, 18) }),
    ]
    const events = [event(), event({ id: 2, name: 'Two', starts: at(-2), ends: at(4) }), event({ id: 3, name: 'Three', starts: at(-1), ends: at(5) })]
    const grid = calendarGrid(model({ banners, events }), NOW, 2)
    expect(grid.lanes[0]!.bars.map((bar) => [bar.name, bar.more])).toEqual([['First', 0], ['Second', 0]])
    expect(grid.lanes[1]!.bars).toHaveLength(3)
  })

  it("number their grid rows through the lanes: a heading, then its rows, then the next lane's heading", () => {
    const grid = calendarGrid(model({ events: [event(), event({ id: 2, name: 'Overlap', starts: at(-2), ends: at(4) })] }), NOW)
    expect(grid.lanes.map((lane) => lane.head)).toEqual([1, 3, 6])
    const events = grid.lanes[1]!
    expect(events.bars.map((bar) => bar.row)).toEqual([4, 5])
  })

  it('give the endgame bars a flat start, the result of each, and the mode they are', () => {
    const lane = calendarGrid(model(), NOW).lanes[2]!
    expect(lane.bars.map((bar) => [bar.name, bar.mode, bar.from, bar.col, bar.end])).toEqual([
      ['Spiral Abyss', 'abyss', true, 1, 9],
      ['Imaginarium Theater', 'theater', true, 1, 15],
      ['Stygian Onslaught', 'stygian', true, 1, 13],
    ])
    expect(lane.bars[1]).toMatchObject({ to: true })
  })

  it('draw a mode between seasons from its next start, and a mode with no time over the whole window', () => {
    const lane = calendarGrid(
      model({
        endgame: [
          stygian({ ends_at: null, next_starts_at: at(4, 10), played: false }),
          theater({ ends_at: null, stale: true, played: false, acts: null }),
        ],
      }),
      NOW,
    ).lanes[2]!
    expect(lane.bars[0]).toMatchObject({ name: 'Stygian Onslaught', col: 7, end: 15, from: false, to: true })
    expect(lane.bars[0]!.time).toEqual({ lead: 'starts in', time: '4 d', tail: 'to start' })
    expect(lane.bars[1]).toMatchObject({ name: 'Imaginarium Theater', col: 1, end: 15, from: true, to: true, time: null })
  })

  it('take the faces of a banner with the 5-stars first', () => {
    const faces = calendarGrid(model(), NOW).lanes[0]!.bars[0]!.faces
    expect(faces.map((face) => [face.name, face.rarity])).toEqual([['Furina', 5], ['Zhongli', 5], ['Bennett', 4]])
    expect(faces[0]!.icon).toBe('/api/icon/calendar.face.aa')
  })

  it('draw a finished event faded and say Done', () => {
    const bar = calendarGrid(model({ events: [event({ finished: true })] }), NOW).lanes[1]!.bars[0]!
    expect(bar).toMatchObject({ done: true, words: { text: 'Done', tone: 'ok' } })
  })

  it('leave out an event that is not dated and list it as coming soon', () => {
    const grid = calendarGrid(model({ events: [event(), soon('Stress Block'), soon('Frames of Fierce Splendor')] }), NOW)
    expect(grid.lanes[1]!.bars.map((bar) => bar.name)).toEqual(['Feast of the Autumn Winds'])
    expect(grid.soon).toEqual(['Stress Block', 'Frames of Fierce Splendor'])
  })

  it('draw an event of the wiki like the others', () => {
    const bar = calendarGrid(model({ events: [event({ source: 'fandom', starts: at(14), ends: at(24), primogems: null })] }), NOW)
    expect(bar.lanes.map((lane) => lane.label)).not.toContain('Events')
    const near = calendarGrid(model({ events: [event({ source: 'fandom', starts: at(5), ends: at(10), primogems: null })] }), NOW)
    expect(near.lanes[1]!.bars[0]).toMatchObject({ name: 'Feast of the Autumn Winds', col: 8, end: 14 })
  })

  it('are empty where nothing falls in the window and nothing is coming soon', () => {
    const grid = calendarGrid(model({ banners: [], events: [], endgame: [] }), NOW)
    expect(grid.lanes).toEqual([])
    expect(grid.empty).toBe(true)
    expect(calendarGrid(model({ banners: [], events: [soon('Stress Block')], endgame: [] }), NOW).empty).toBe(false)
  })
})

describe("a bar's words", () => {
  it("say an event's reward as the answer gives it, never what is left of it", () => {
    expect(eventWords(event(), false)).toEqual({ text: '1,000 · not finished', tone: 'gold', gem: true })
    expect(eventWords(event(), true)).toEqual({ text: '1,000 primogems · not finished', tone: 'gold', gem: false })
    expect(eventWords(event({ primogems: null, double: { left: 3, total: 3 } }), false)).toEqual({
      text: 'Double rewards · 3 of 3 left', tone: 'gold', gem: false,
    })
    expect(eventWords(event({ primogems: null, explored: 64 }), false)).toEqual({ text: '64% explored', tone: 'gold', gem: false })
    expect(eventWords(event({ primogems: null }), false)).toBeNull()
  })

  it('say Done for a finished event and nothing of its reward', () => {
    expect(eventWords(event({ finished: true }), false)).toEqual({ text: 'Done', tone: 'ok', gem: false })
  })

  it("say a mode's result from the endgame rows, and when it was not played", () => {
    expect(modeWords(mode())).toEqual({ text: '36 of 36 stars', tone: 'ok', gem: false })
    expect(modeWords(mode({ stars: 30 }))).toEqual({ text: '30 of 36 stars', tone: 'gold', gem: false })
    expect(modeWords(theater())).toEqual({ text: 'Act 8 of 10', tone: 'gold', gem: false })
    expect(modeWords(theater({ acts: 10 }))).toMatchObject({ tone: 'ok' })
    expect(modeWords(stygian())).toEqual({ text: 'Not played yet', tone: 'plain', gem: false })
    expect(modeWords(stygian({ stale: true, ends_at: null }))).toEqual({ text: 'Not read since the reset', tone: 'plain', gem: false })
    expect(modeWords(stygian({ played: true, difficulty: 5 }))).toEqual({ text: 'Difficulty 5', tone: 'ok', gem: false })
  })

  it('count a mode finished when its result is complete', () => {
    expect(modeFinished(mode())).toBe(true)
    expect(modeFinished(mode({ stars: 35 }))).toBe(false)
    expect(modeFinished(theater())).toBe(false)
    expect(modeFinished(theater({ acts_of: null }))).toBe(false)
    expect(modeFinished(stygian())).toBe(false)
    expect(modeFinished(stygian({ played: true, difficulty: 3 }))).toBe(true)
  })

  it('say the time: ends in, starts on a day, ended on a day', () => {
    expect(timeParts(at(-8), at(3, 18), NOW)).toEqual({ lead: 'ends in', time: '3 d 8 h', tail: 'left' })
    expect(timeParts(at(3), at(8), NOW)).toEqual({ lead: 'starts', time: 'Fri 16 Oct', tail: '' })
    expect(timeParts(at(-5), at(-1), NOW)).toEqual({ lead: 'ended', time: 'Mon 12 Oct', tail: '' })
    expect(timeParts(null, null, NOW)).toBeNull()
  })
})

describe('the list', () => {
  const rows = (over: Partial<CalendarModel>, place: 'board' | 'overlay' = 'board') =>
    calendarList(model(over), NOW, place).rows.map((row) => row.name)

  it('runs ending soonest first, with what is still to start after what is running', () => {
    expect(rows({})).toEqual([
      'Furina · Zhongli', 'Spiral Abyss', 'Feast of the Autumn Winds', 'Stygian Onslaught', 'Imaginarium Theater',
    ])
    expect(
      rows({ events: [event(), event({ id: 2, name: 'Later one', starts: at(2), ends: at(9) })], banners: [], endgame: [] }),
    ).toEqual(['Feast of the Autumn Winds', 'Later one'])
  })

  it('leaves out what ended and what starts beyond the window', () => {
    expect(rows({ banners: [], endgame: [], events: [event({ ends: at(-1) }), event({ id: 3, name: 'Far', starts: at(20), ends: at(30) })] })).toEqual([])
  })

  it('puts a mode between seasons and a mode with no time after the rest, and what is coming soon last', () => {
    const list = calendarList(
      model({
        endgame: [stygian({ ends_at: null, next_starts_at: at(4, 10) }), theater({ ends_at: null, stale: true, played: false })],
        events: [soon('Stress Block'), event()],
      }),
      NOW,
      'board',
    ).rows
    expect(list.map((row) => row.name)).toEqual([
      'Furina · Zhongli', 'Feast of the Autumn Winds', 'Stygian Onslaught', 'Imaginarium Theater', 'Stress Block',
    ])
    expect(list.at(-1)).toMatchObject({ soon: true, big: 'Coming soon', small: '' })
  })

  it('says the words of each row and the time at its right', () => {
    const [furina, abyss, feast, stygianRow] = calendarList(model(), NOW, 'board').rows
    expect(furina).toMatchObject({ lane: 'wish', sub: 'Character wishes', big: '3 d 8 h', small: 'left', ok: false })
    expect(abyss).toMatchObject({ lane: 'endgame', mode: 'abyss', sub: '36 of 36 stars', ok: true, big: '5 d', small: 'to reset' })
    expect(feast).toMatchObject({ lane: 'event', sub: '1,000 primogems · not finished', big: '6 d', small: 'left' })
    expect(stygianRow).toMatchObject({ sub: 'Not played yet', big: '9 d', small: 'left' })
  })

  it('names a banner by its kind', () => {
    const kinds = calendarList(
      model({ banners: [banner({ kind: 'weapon' }), banner({ id: 'x', kind: 'chronicled', ends: at(4) })], events: [], endgame: [] }),
      NOW,
      'board',
    ).rows.map((row) => row.sub)
    expect(kinds).toEqual(['Weapon wishes', 'Chronicled Wish'])
  })

  it('shows a finished event faded on the Board, and on the overlay only what is not finished', () => {
    const over = { events: [event({ finished: true }), event({ id: 2, name: 'Open', ends: at(4) })] }
    const board = calendarList(model(over), NOW, 'board').rows
    expect(board.find((row) => row.name === 'Feast of the Autumn Winds')).toMatchObject({ done: true, sub: 'Done' })
    const overlay = rows(over, 'overlay')
    expect(overlay).not.toContain('Feast of the Autumn Winds')
    expect(overlay).not.toContain('Spiral Abyss') // 36 of 36: finished
    expect(overlay).toContain('Open')
    expect(overlay).toContain('Stygian Onslaught')
    expect(overlay).toContain('Imaginarium Theater') // Act 8 of 10 is not finished
  })
})

describe('the meta and the foot', () => {
  it('says the events left to finish and when the calendar was read', () => {
    expect(calendarMeta(model(), NOW, 'board')).toBe('2 events left to finish · read at 09:00')
    expect(calendarMeta(model({ left: 1 }), NOW, 'board')).toBe('1 event left to finish · read at 09:00')
    expect(calendarMeta(model({ left: 0 }), NOW, 'board')).toBe('Read at 09:00')
  })

  it('is shorter on the overlay, and before the first read says so', () => {
    expect(calendarMeta(model(), NOW, 'overlay')).toBe('2 left to finish')
    expect(calendarMeta(model({ left: 0 }), NOW, 'overlay')).toBeNull()
    expect(calendarMeta(model({ read: false, read_at: null }), NOW, 'board')).toBe('Not read yet')
    expect(calendarMeta(model({ read: false, read_at: null }), NOW, 'overlay')).toBe('Not read yet')
  })

  it("names the wiki only where a date drawn is the wiki's", () => {
    const wiki = model({ events: [event({ source: 'fandom' })], upcoming_from: 'Genshin Impact Wiki (Fandom)' })
    expect(calendarFoot(wiki, NOW, 'board')).toBe('Upcoming dates: Genshin Impact Wiki (Fandom)')
    expect(calendarFoot(model({ upcoming_from: null }), NOW, 'board')).toBeNull()
    const far = model({
      events: [event({ source: 'fandom', starts: at(20), ends: at(30) })], upcoming_from: 'Genshin Impact Wiki (Fandom)',
    })
    expect(calendarFoot(far, NOW, 'board')).toBeNull() // outside the window: not drawn
    expect(calendarFoot(wiki, NOW, 'overlay')).toBe('Upcoming dates: Genshin Impact Wiki (Fandom)')
  })
})

describe('calendarFrame', () => {
  it('is the wide drawing only on the Board, five cells across and three down or more', () => {
    expect(calendarFrame(886, 300, 'board').wide).toBe(true)
    expect(calendarFrame(885, 300, 'board').wide).toBe(false)
    expect(calendarFrame(886, 299, 'board').wide).toBe(false)
    expect(calendarFrame(1200, 600, 'overlay').wide).toBe(false)
  })

  it('shows one Wishes row under 380 pixels tall, two from 380 and every row from 470, at five cells across or more', () => {
    expect(calendarFrame(886, 379, 'board').wishRows).toBe(1)
    expect(calendarFrame(886, 380, 'board').wishRows).toBe(2)
    expect(calendarFrame(886, 469, 'board').wishRows).toBe(2)
    expect(calendarFrame(886, 470, 'board').wishRows).toBe(Number.POSITIVE_INFINITY)
    expect(calendarFrame(885, 470, 'board').wishRows).toBe(1) // narrower than five cells: the list, which has no lanes
  })
})

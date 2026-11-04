import { describe, expect, it } from 'vitest'
import { readyTime } from '../pages/timersview.ts'
import weekFixture from '../fixtures/characters/week.json'
import { tickBody } from '../pages/characters/weekview.ts'
import type { BoardModel, HistoryRow, PityCard, Pulls, Timer, Week } from '../types.ts'
import {
  clockText, commissionsMeta, dailyNotesView, dayLine, expeditionSlots, faceTitle, fiftyRecord, forecastShort, lapRows,
  lapSplits, lastFive, LUCK_WHAT, nearTime, nextBack, periodProgress, playColumns, playFigure, playSession,
  QUICK_PRESETS, quickCountdown, quickProgress, readAt, readySince, savingsBy, savingsSet, SERVER_NAMES, serverClock,
  stopwatchText, tickedPercent, timeLead, timerSign, timersMeta, timersShown, todayLayout, todayTick, todayView, wishShort,
} from './widgetview.ts'

describe('the clock', () => {
  it('shows the local time, with seconds when asked', () => {
    const at = new Date(2026, 9, 13, 9, 5, 7)
    expect(clockText(at, false)).toBe('09:05')
    expect(clockText(at, true)).toBe('09:05:07')
  })

  it("shows the server's time at its fixed offset, across midnight", () => {
    expect(serverClock(new Date('2026-10-13T03:30:00Z'), -5, false)).toBe('22:30')
    expect(serverClock(new Date('2026-10-13T08:00:00Z'), 1, true)).toBe('09:00:00')
  })

  it('names the day and the server', () => {
    expect(dayLine(new Date(2026, 9, 13, 9, 0))).toBe('Tue 13 Oct')
    expect(SERVER_NAMES.get('os_euro')).toBe('Europe')
  })
})

describe('when HoYoLAB was read', () => {
  const now = new Date(2026, 9, 13, 12, 0)

  it('says the time on the same day', () => {
    expect(readAt(new Date(2026, 9, 13, 11, 30).toISOString(), now)).toBe('Read at 11:30')
  })

  it('says the weekday within six days', () => {
    expect(readAt(new Date(2026, 9, 11, 23, 10).toISOString(), now)).toBe('Read Sun 23:10')
  })

  it('says the date for an older read', () => {
    expect(readAt(new Date(2026, 9, 3, 23, 10).toISOString(), now)).toBe('Read 3 Oct, 23:10')
  })
})

describe('the stopwatch and the quick timers', () => {
  it('counts the stopwatch in minutes and seconds, with hours once it has them, and tenths when asked', () => {
    expect(stopwatchText(65_000, false)).toBe('1:05')
    expect(stopwatchText(3_723_000, false)).toBe('1:02:03')
    expect(stopwatchText(65_340, true)).toBe('1:05.3')
    expect(stopwatchText(0, true)).toBe('0:00.0')
  })

  it('counts a quick timer down in minutes and seconds, with hours once it has them', () => {
    expect(quickCountdown(252)).toBe('4:12')
    expect(quickCountdown(3723)).toBe('1:02:03')
    expect(quickCountdown(0.2)).toBe('0:01') // a part of a second still to wait counts as a second
    expect(quickCountdown(-5)).toBe('0:00')
  })

  it('offers the presets of spec 13.3', () => {
    expect(QUICK_PRESETS.map((preset) => [preset.seconds, preset.label])).toEqual([
      [60, '1 min'], [300, '5 min'], [600, '10 min'], [1800, '30 min'], [3600, '1 h'],
    ])
  })
})

describe("the stopwatch's laps", () => {
  it('each have their own length, and the fastest is marked', () => {
    expect(lapSplits([65_000, 125_000, 170_000])).toEqual([
      { split: 65_000, fastest: false }, { split: 60_000, fastest: false }, { split: 45_000, fastest: true },
    ])
  })

  it('mark the first of the shortest when several are as short', () => {
    expect(lapSplits([30_000, 60_000, 90_000, 125_000]).map((lap) => lap.fastest)).toEqual([true, false, false, false])
    expect(lapSplits([50_000, 80_000, 130_000]).map((lap) => lap.fastest)).toEqual([false, true, false]) // 50, 30, 50
  })

  it('are none for none, and a lap that stands no later than the one before it is no time long', () => {
    expect(lapSplits([])).toEqual([])
    expect(lapSplits([60_000, 50_000])).toEqual([{ split: 60_000, fastest: false }, { split: 0, fastest: true }])
  })

  it('are drawn against the longest, with their number, their own length and the time they were taken at', () => {
    const rows = lapRows([65_000, 125_000, 170_000])
    expect(rows.map((row) => [row.number, row.split, row.total, row.fastest])).toEqual([
      [1, 65_000, 65_000, false], [2, 60_000, 125_000, false], [3, 45_000, 170_000, true],
    ])
    expect(rows[0].share).toBe(1) // the longest fills its bar
    expect(rows[1].share).toBeCloseTo(60 / 65)
    expect(rows[2].share).toBeCloseTo(45 / 65)
  })

  it('name a fastest only among several, and draw a lap of no length as an empty bar', () => {
    expect(lapRows([31_200])).toEqual([{ number: 1, split: 31_200, total: 31_200, share: 1, fastest: false }])
    expect(lapRows([])).toEqual([])
    expect(lapRows([0, 0]).map((row) => row.share)).toEqual([0, 0]) // nothing to measure against
  })
})

describe('the Playtime widget', () => {
  const now = new Date('2026-10-13T08:00:00Z')
  const play = (over: Partial<BoardModel['playtime']> = {}): BoardModel['playtime'] => ({
    running: false, session_started_at: null, today_minutes: 0, week: [], ...over,
  })

  it('measures the session while the game runs, from when it started on the core\'s clock', () => {
    expect(playSession(play({ running: true, session_started_at: '2026-10-13T06:48:00Z' }), 93, now)).toEqual({
      playing: true, minutes: 72,
    })
    // A start the clock has not reached yet is no time played.
    expect(playSession(play({ running: true, session_started_at: '2026-10-13T08:00:30Z' }), 93, now)).toEqual({
      playing: true, minutes: 0,
    })
  })

  it('gives the last session when the game does not run, and none before the first', () => {
    expect(playSession(play(), 93, now)).toEqual({ playing: false, minutes: 93 })
    expect(playSession(play(), null, now)).toEqual({ playing: false, minutes: null })
    // A running game with no start time is not taken for a session.
    expect(playSession(play({ running: true }), 93, now)).toEqual({ playing: false, minutes: 93 })
  })

  it('sets a length of play as hours and minutes, rounded as a duration is', () => {
    expect(playFigure(72)).toEqual({ hours: 1, minutes: 12 })
    expect(playFigure(45)).toEqual({ hours: 0, minutes: 45 })
    expect(playFigure(59.6)).toEqual({ hours: 1, minutes: 0 })
    expect(playFigure(-3)).toEqual({ hours: 0, minutes: 0 })
  })

  describe('the columns of the last seven days', () => {
    // Wednesday 7 October to Tuesday 13 October, the game day of the clock above.
    const week = [0, 95, 0, 179, 92, 93, 45].map((minutes, index) => ({
      day: `2026-10-${String(7 + index).padStart(2, '0')}`, minutes,
    }))

    it('are one for each game day, today the last and the only one that is today', () => {
      const columns = playColumns(week)
      expect(columns.map((column) => column.label)).toEqual(['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Today'])
      expect(columns.map((column) => column.today)).toEqual([false, false, false, false, false, false, true])
      expect(columns.map((column) => column.day)).toEqual(week.map((day) => day.day))
    })

    it('say their minutes as the playtime calendar does, in words a screen reader can read', () => {
      expect(playColumns(week).map((column) => column.tip)).toEqual([
        'Wed 7 Oct: none recorded', 'Thu 8 Oct: 1 h 35 min', 'Fri 9 Oct: none recorded', 'Sat 10 Oct: 2 h 59 min',
        'Sun 11 Oct: 1 h 32 min', 'Mon 12 Oct: 1 h 33 min', 'Tue 13 Oct: 45 min',
      ])
    })

    it('are as tall as their share of the longest day, and a day with no play is marked as such', () => {
      const columns = playColumns(week)
      expect(columns[3].share).toBe(1) // the longest day, 179 minutes
      expect(columns[1].share).toBeCloseTo(95 / 179)
      expect(columns.map((column) => column.none)).toEqual([true, false, true, false, false, false, false])
      expect(columns[0].share).toBe(0)
    })

    it('are measured against an hour at least, so that a short week is not drawn as a long one', () => {
      const short = playColumns(week.map((day, index) => ({ ...day, minutes: index === 6 ? 15 : 0 })))
      expect(short[6].share).toBeCloseTo(15 / 60)
      const none = playColumns(week.map((day) => ({ ...day, minutes: 0 })))
      expect(none.every((column) => column.share === 0 && column.none)).toBe(true)
    })

    it('are none where the model has no week', () => {
      expect(playColumns([])).toEqual([])
    })
  })
})

describe('a quick timer', () => {
  const quick = { started_at: '2026-10-13T08:00:00Z', ready_at: '2026-10-13T08:05:00Z', state: 'running' as const }

  it('has gone the share of its time that has passed, from its start and ready times', () => {
    expect(quickProgress(quick, new Date('2026-10-13T08:01:15Z'))).toBeCloseTo(0.25)
    expect(quickProgress(quick, new Date('2026-10-13T08:04:30Z'))).toBeCloseTo(0.9)
  })

  it('keeps its progress from 0 to 1, whatever the clock says', () => {
    expect(quickProgress(quick, new Date('2026-10-13T07:59:00Z'))).toBe(0)
    expect(quickProgress(quick, new Date('2026-10-13T08:06:00Z'))).toBe(1)
  })

  it('is full once the core says it is ready, before the page sees the time come', () => {
    expect(quickProgress({ ...quick, state: 'ready' }, new Date('2026-10-13T08:04:59Z'))).toBe(1)
  })

  it('has no progress where its times make no span', () => {
    expect(quickProgress({ ...quick, ready_at: quick.started_at }, new Date('2026-10-13T08:00:00Z'))).toBeNull()
    expect(quickProgress({ ...quick, ready_at: 'not a time' }, new Date('2026-10-13T08:00:00Z'))).toBeNull()
  })
})

/** A timer as the core gives it, with what a test names changed. */
const aTimer = (over: Partial<Timer> = {}): Timer => ({
  id: 1, preset: null, own: true, name: 'Walk the dog', place: '', rule: { kind: 'hours', hours: 12 }, about: null,
  state: 'running', ready_at: null, started_at: null, cleared_at: null, visits: null, bell: true, icon: null,
  achievement: null, pinned: false, ...over,
})

describe('the Timers widget', () => {
  const timer = (id: number, state: Timer['state'], own = false): Timer =>
    aTimer({ id, preset: own ? null : `preset-${id}`, own, name: `Timer ${id}`, state })
  const timers = [timer(1, 'running'), timer(2, 'ready'), timer(3, 'running', true), timer(4, 'ready', true), timer(5, 'running')]
  const ids = (shown: readonly Timer[]) => shown.map((one) => one.id)

  it('lists the ready ones first, then the others as the core gives them, soonest first, the player\'s own among them', () => {
    expect(ids(timersShown(timers, { show: 'all', chosen: [] }))).toEqual([2, 4, 1, 3, 5])
  })

  it('keeps the ready ones, or the ones chosen, in that order', () => {
    expect(ids(timersShown(timers, { show: 'ready', chosen: [] }))).toEqual([2, 4])
    expect(ids(timersShown(timers, { show: 'chosen', chosen: [3, 1, 9] }))).toEqual([1, 3])
  })

  it('counts the ready ones and the running ones for the heading, and says nothing of what is not shown', () => {
    const shown = timersShown([...timers, timer(6, 'finished', true)], { show: 'all', chosen: [] })
    expect(timersMeta(shown)).toBe('2 ready · 3 running') // a timer that has done all its visits is neither
    expect(timersMeta(timersShown(timers, { show: 'ready', chosen: [] }))).toBe('2 ready')
    expect(timersMeta([timer(1, 'running'), timer(5, 'running')])).toBe('2 running')
    expect(timersMeta([])).toBeNull()
  })
})

describe('a timer in the Timers widget and in One timer', () => {
  it('is drawn with the sign of its kind where it has no picture: a fish, a teapot, a mask, an hourglass', () => {
    expect(timerSign(aTimer({ preset: 'fishing.luhua_pool', own: false, rule: { kind: 'fishing' } }))).toBe('fish')
    expect(timerSign(aTimer({ preset: 'teapot.jade_field', own: false }))).toBe('teapot')
    expect(timerSign(aTimer({ preset: 'hilichurl', own: false }))).toBe('mask')
    expect(timerSign(aTimer({ preset: null }))).toBe('hourglass') // one of the player's own
    expect(timerSign(aTimer({ preset: 'some.later.preset', own: false }))).toBe('hourglass') // and one this version has no sign for
  })

  describe('while it runs', () => {
    const running = aTimer({ state: 'running', ready_at: '2026-10-13T21:16:00Z', started_at: '2026-10-13T09:16:00Z' })

    it('gives the time left first and the clock time after it', () => {
      const now = new Date('2026-10-13T11:17:00Z')
      expect(timeLead(running, now)).toEqual({ lead: 'in 9 h 59 min', at: readyTime(running.ready_at!, now) })
    })

    it('reads now once the time has come, until the core says the timer is ready', () => {
      const now = new Date('2026-10-13T21:16:30Z')
      expect(timeLead(running, now)).toEqual({ lead: 'now', at: readyTime(running.ready_at!, now) })
    })

    it('has no time left when it does not run, or no time is known', () => {
      const now = new Date('2026-10-13T11:17:00Z')
      expect(timeLead({ ...running, state: 'ready' }, now)).toBeNull()
      expect(timeLead({ ...running, state: 'finished' }, now)).toBeNull()
      expect(timeLead({ ...running, ready_at: null }, now)).toBeNull()
    })
  })

  describe('once it is ready', () => {
    // Tuesday 13 October 2026, 10:00, in this PC's own time.
    const now = new Date(2026, 9, 13, 10, 0)
    const ready = (at: Date | null) => aTimer({ state: 'ready', ready_at: at === null ? null : at.toISOString() })

    it('says since when, by the weekday and the time', () => {
      expect(readySince(ready(new Date(2026, 9, 12, 9, 40)), now)).toBe('since Mon 09:40')
      expect(readySince(ready(new Date(2026, 9, 13, 5, 0)), now)).toBe('since Tue 05:00')
    })

    it('names the date too once the weekday alone would be taken for a day of this week', () => {
      expect(readySince(ready(new Date(2026, 9, 7, 9, 40)), now)).toBe('since Wed 09:40') // six days ago
      expect(readySince(ready(new Date(2026, 9, 6, 9, 40)), now)).toBe('since 6 Oct, 09:40') // seven
    })

    it('says nothing where the ready time is not known, as for a timer never cleared, or the timer does not wait', () => {
      expect(readySince(ready(null), now)).toBeNull()
      expect(readySince(aTimer({ state: 'running', ready_at: new Date(2026, 9, 14, 9, 40).toISOString() }), now)).toBeNull()
      expect(readySince(aTimer({ state: 'finished', ready_at: new Date(2026, 9, 12, 9, 40).toISOString() }), now)).toBeNull()
    })
  })
})

describe("the widgets of HoYoLAB's notes", () => {
  const now = new Date(2026, 9, 13, 10, 0) // Tuesday, in this PC's time
  const at = (date: number, hours: number, minutes = 0) => new Date(2026, 9, date, hours, minutes).toISOString()
  const notes: NonNullable<BoardModel['notes']> = {
    read_at: at(13, 9, 30), read_today: true, read_this_week: true, resin_full_at: null, expeditions: [],
    expeditions_max: 5, transformer: { ready_at: at(16, 14) }, realm_currency: 1800, realm_currency_max: 2400,
    realm_currency_full_at: at(13, 18), commissions_done: 3, commissions_max: 4, boss_discounts_left: 1,
    boss_discounts_max: 3,
  }

  describe('the Daily notes', () => {
    it('count the commissions done and the boss discounts left as they were read', () => {
      const view = dailyNotesView(notes, now)
      expect(view.commissions).toEqual({ done: 3, of: 4, known: true })
      expect(view.discounts).toEqual({ left: 1, of: 3, known: true })
    })

    it('do not know the commissions read before the daily reset, nor the discounts read before the weekly one', () => {
      const yesterday = dailyNotesView({ ...notes, read_today: false }, now)
      expect(yesterday.commissions).toEqual({ done: 0, of: 4, known: false }) // yesterday's count is not today's
      expect(yesterday.discounts.known).toBe(true) // Monday's reset has not come since
      const lastWeek = dailyNotesView({ ...notes, read_today: false, read_this_week: false }, now)
      expect(lastWeek.discounts).toEqual({ left: 0, of: 3, known: false })
    })

    it('put the realm currency against its maximum and say when it will be full', () => {
      expect(dailyNotesView(notes, now).realm).toEqual({ now: 1800, max: 2400, full: 'Tue 18:00', isFull: false })
      // A time HoYoLAB did not give, in notes read before plan 2A-3, is left out.
      expect(dailyNotesView({ ...notes, realm_currency_full_at: null }, now).realm).toEqual({
        now: 1800, max: 2400, full: null, isFull: false,
      })
    })

    it('say the realm currency is full once it is, by its count or by the time that has come', () => {
      expect(dailyNotesView({ ...notes, realm_currency: 2400, realm_currency_full_at: null }, now).realm).toEqual({
        now: 2400, max: 2400, full: null, isFull: true,
      })
      // The count is the one read; a full time that has come says it has filled since.
      expect(dailyNotesView({ ...notes, realm_currency_full_at: at(13, 9) }, now).realm).toEqual({
        now: 2400, max: 2400, full: null, isFull: true,
      })
      // No maximum is no judgement: notes without one are not full.
      expect(
        dailyNotesView({ ...notes, realm_currency: 0, realm_currency_max: 0, realm_currency_full_at: null }, now).realm.isFull,
      ).toBe(false)
    })

    it('say whether the Parametric Transformer is waiting, ready, or not obtained', () => {
      expect(dailyNotesView(notes, now).transformer).toEqual({ state: 'waiting', at: 'Fri 14:00', left: 'in 3 d 4 h' })
      // A ready time that has passed, or none, is ready.
      expect(dailyNotesView({ ...notes, transformer: { ready_at: at(13, 9) } }, now).transformer).toEqual({ state: 'ready' })
      expect(dailyNotesView({ ...notes, transformer: { ready_at: null } }, now).transformer).toEqual({ state: 'ready' })
      expect(dailyNotesView({ ...notes, transformer: null }, now).transformer).toEqual({ state: 'none' })
    })
  })

  describe('the Expeditions', () => {
    const expedition = (back_at: string | null, icon: string | null = null) => ({ icon, back_at })
    // Two are back (one with no time, one whose time has passed) and two are out.
    const sent = [
      expedition(null, '/api/icon/character.1'), expedition(at(13, 9)), expedition(at(13, 11, 59)), expedition(at(13, 15, 30)),
    ]

    it('give each one sent its face, whether it is back, and when it will be', () => {
      expect(expeditionSlots({ ...notes, expeditions: sent, expeditions_max: 4 }, now)).toEqual([
        { icon: '/api/icon/character.1', back: true, at: null, left: null },
        { icon: null, back: true, at: null, left: null },
        { icon: null, back: false, at: '11:59', left: 'in 1 h 59 min' },
        { icon: null, back: false, at: '15:30', left: 'in 5 h 30 min' },
      ])
      // An expedition whose time is now is back.
      expect(expeditionSlots({ ...notes, expeditions: [expedition(at(13, 10))] }, now)[0]).toMatchObject({ back: true })
    })

    it('add an empty slot for each that could still be sent', () => {
      const slots = expeditionSlots({ ...notes, expeditions: sent, expeditions_max: 5 }, now)
      expect(slots).toHaveLength(5)
      expect(slots[3]).toMatchObject({ back: false })
      expect(slots[4]).toEqual({ empty: true })
      expect(expeditionSlots({ ...notes, expeditions: [], expeditions_max: 3 }, now)).toEqual([
        { empty: true }, { empty: true }, { empty: true },
      ])
    })

    it('have no empty slot when as many are out as there can be, or more', () => {
      expect(expeditionSlots({ ...notes, expeditions: sent, expeditions_max: 4 }, now)).toHaveLength(4)
      expect(expeditionSlots({ ...notes, expeditions: sent, expeditions_max: 2 }, now)).toHaveLength(4)
    })

    it('have no slots in notes read before they kept the expeditions', () => {
      expect(expeditionSlots({ ...notes, expeditions: null }, now)).toEqual([])
    })

    it('name the soonest return for the heading', () => {
      expect(nextBack({ ...notes, expeditions: sent }, now)).toBe('11:59')
      // The soonest, not the first.
      expect(nextBack({ ...notes, expeditions: [expedition(at(13, 15, 30)), expedition(at(13, 11, 59))] }, now)).toBe('11:59')
      // A day away, the weekday too, as a time of day alone would read as an earlier one.
      expect(nextBack({ ...notes, expeditions: [expedition(at(14, 10, 30))] }, now)).toBe('Wed 10:30')
    })

    it('name none when every expedition is back, none are out, or they are not kept', () => {
      expect(nextBack({ ...notes, expeditions: [expedition(null), expedition(at(13, 9))] }, now)).toBeNull()
      expect(nextBack({ ...notes, expeditions: [] }, now)).toBeNull()
      expect(nextBack({ ...notes, expeditions: null }, now)).toBeNull()
    })
  })
})

describe('the resets', () => {
  const now = new Date('2026-10-13T08:00:00Z')
  const DAY = 86_400_000

  it('measures the progress through a period that ends at the next reset', () => {
    expect(periodProgress('2026-10-14T03:00:00Z', DAY, now)).toBeCloseTo(5 / 24)
    expect(periodProgress('2026-10-13T08:00:00Z', DAY, now)).toBe(1)
  })

  it('measures a week from one Monday 04:00 to the next', () => {
    // 08:00 UTC on Tuesday is 29 hours after Monday's 03:00 UTC, which is 04:00 on the Europe server.
    expect(periodProgress('2026-10-19T03:00:00Z', 7 * DAY, now)).toBeCloseTo(29 / 168)
  })

  it('keeps the progress from 0 to 1, whatever the time', () => {
    expect(periodProgress('2026-10-13T07:00:00Z', DAY, now)).toBe(1) // the reset has passed, the next not read yet
    expect(periodProgress('2026-10-20T08:00:00Z', DAY, now)).toBe(0) // further off than one period
  })

  it('has no progress where the period or the time is not known', () => {
    expect(periodProgress('2026-10-14T03:00:00Z', 0, now)).toBe(0)
    expect(periodProgress('not a time', DAY, now)).toBe(0)
  })
})

describe('the achievements ticked', () => {
  it('say their share in whole percent', () => {
    expect(tickedPercent(1219, 1854)).toBe(66) // 65.75
    expect(tickedPercent(0, 1854)).toBe(0)
    expect(tickedPercent(0, 0)).toBe(0)
  })

  it('read 100 only when every one is ticked', () => {
    expect(tickedPercent(1853, 1854)).toBe(99)
    expect(tickedPercent(1854, 1854)).toBe(100)
  })
})

describe('the Commissions to look for widget', () => {
  it('counts the names to look for in its heading, and says nothing when there are none', () => {
    expect(commissionsMeta(3)).toBe('3 to look for')
    expect(commissionsMeta(1)).toBe('1 to look for')
    expect(commissionsMeta(0)).toBeNull() // the sentence in the body says so
  })
})

describe('a time as short as it can be', () => {
  const now = new Date(2026, 9, 13, 10, 0) // Tuesday, in this PC's time
  const at = (date: number, hours: number, minutes = 0) => new Date(2026, 9, date, hours, minutes).toISOString()

  it('is the time of day when it comes within a day, since that reads as the next one', () => {
    expect(nearTime(at(13, 18, 5), now)).toBe('18:05')
    expect(nearTime(at(14, 2, 20), now)).toBe('02:20')
  })

  it('names the day from a day on, when the time of day alone would read as an earlier one', () => {
    expect(nearTime(at(14, 10), now)).toBe('Wed 10:00')
    expect(nearTime(at(14, 15, 40), now)).toBe('Wed 15:40')
  })
})

describe('the Pulls widgets (the Pulls plan, Task 12)', () => {
  /** An instant given in this PC's own time: month 9 is October. */
  const local = (month: number, date: number, hours = 12, minutes = 0) => new Date(2026, month, date, hours, minutes)
  const now = local(9, 24, 8, 0)

  const card = (over: Partial<PityCard> = {}): PityCard => ({
    pool: 'character', pity: 61, known: true, hard: 90, soft: 74, four: 7, four_known: true, guarantee: 'guaranteed',
    path: null,
    last_five: { name: 'Qiqi', pity: 81, at: local(8, 2, 20).toISOString() }, wishes: 219, correction: null,
    from: local(3, 16, 10).toISOString(), ...over,
  })
  const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
    id: '1', name: 'Skirk', kind: 'character', rank: 5, pool: 'character', pool_label: 'Character event', pity: 77,
    result: 'won', at: local(5, 24).toISOString(), icon: null, ...over,
  })
  const history = (rows: HistoryRow[]): Pulls['history'] => ({
    count: 387, fives: 3, average_pity: 78, won: 1, lost: 1, luckier_than: 0.58, typical_average: 62.3, months: [], rows,
    more: true,
  })

  it('say when the balance was set, and the forecast in short', () => {
    expect(savingsSet({ primogems: 9840, fates: 14, set_at: local(9, 24, 7, 30).toISOString() }, now)).toBe('set today')
    expect(savingsSet({ primogems: 9840, fates: 14, set_at: local(9, 20, 21).toISOString() }, now)).toBe('set 20 Oct')
    expect(forecastShort({ by: '2026-11-03', pulls: 86, default_by: true, days: 10 })).toBe('86 by 3 Nov')
  })

  it("say the pulls by the next version's end under the Savings widget's pulls, as the ledger's total says them", () => {
    const savings = (byNextEnd: number | null) => ({
      by_next_end: byNextEnd,
      next: { ends_on: '2026-12-16' },
      forecast: { by: '2026-11-03', pulls: 86, default_by: true, days: 10 },
    })
    expect(savingsBy(savings(172))).toBe('172 by 16 Dec')
    expect(savingsBy(savings(1234))).toBe('1,234 by 16 Dec')
    // With no total, which is with no balance, today's line: the forecast by its day.
    expect(savingsBy(savings(null))).toBe('86 by 3 Nov')
  })

  it("name the Luck widget's figure as the history's first tile does: the character event's", () => {
    expect(LUCK_WHAT).toBe('average 5★ pity, character event')
  })

  it("say a wishlist entry in short: certain, or the chance", () => {
    const wish = (over: Partial<Pulls['wishlist'][number]>): Pulls['wishlist'][number] => ({
      id: 1, name: 'Citlali', kind: 'character', rank: 5, pool: 'character', about: '2026-11-11', copies: 1, icon: null,
      chance: 0.74, certain_within: 209, pulls_by_then: 112, soon: false, ...over,
    })
    expect(wishShort(wish({}))).toBe('about 11 Nov, 74%')
    expect(wishShort(wish({ chance: 1, certain_within: 29, pulls_by_then: 154 }))).toBe('about 11 Nov, certain')
    expect(wishShort(wish({ rank: 4, chance: 0, certain_within: null }))).toBe('about 11 Nov')
  })

  it("title a face with its name and its pity, a 3★'s with its name alone", () => {
    expect(faceTitle(row())).toBe('Skirk, pity 77')
    expect(faceTitle(row({ name: 'Bennett', rank: 4, pity: 9, result: null }))).toBe('Bennett, pity 9')
    expect(faceTitle(row({ name: 'Cool Steel', kind: 'weapon', rank: 3, pity: null, result: null }))).toBe('Cool Steel')
  })

  it('name the newest 5★ under the faces, with how it fell', () => {
    const rows = [row({ id: '3', name: 'Cool Steel', rank: 3, pity: null, result: null }), row({ id: '2' }), row({ id: '1', name: 'Qiqi' })]
    expect(lastFive({ history: history(rows), pity: [card()] })).toBe('Skirk at 77, won the 50/50')
    // A standard 5★ has no 50/50; a first 5★ whose pity the history cannot tell has no count.
    expect(lastFive({ history: history([row({ name: "Wolf's Gravestone", kind: 'weapon', pool: 'standard', pity: 76, result: null })]), pity: [] }))
      .toBe("Wolf's Gravestone at 76")
    expect(lastFive({ history: history([row({ pity: null, result: 'featured' })]), pity: [] })).toBe('Skirk, the featured one')
    // In the words of its own wish: a weapon's 75/25.
    const azurelight = row({ name: 'Azurelight', kind: 'weapon', pool: 'weapon', pool_label: 'Weapon event', pity: 40 })
    expect(lastFive({ history: history([azurelight]), pity: [] })).toBe('Azurelight at 40, won the 75/25')
  })

  it("take the cards' last 5★s when the rows read hold none, the newest of them, without how it fell", () => {
    const standard = card({ pool: 'standard', last_five: { name: "Wolf's Gravestone", pity: 76, at: local(7, 15, 19).toISOString() } })
    const rows = [row({ name: 'Cool Steel', rank: 3, pity: null, result: null })]
    expect(lastFive({ history: history(rows), pity: [card(), standard] })).toBe('Qiqi at 81')
    expect(lastFive({ history: history(rows), pity: [card({ last_five: null })] })).toBeNull()
  })

  it('give the 50/50 record in short, won then lost', () => {
    expect(fiftyRecord(history([]))).toBe('1–1')
    expect(fiftyRecord({ ...history([]), won: 4, lost: 2 })).toBe('4–2')
  })
})

describe('the Today widget', () => {
  const week = weekFixture as unknown as Week

  it("lists today's steps that cost resin, then those on the way, as the week page does, each with who it is for and its cost", () => {
    const view = todayView(week)
    expect(view.rows.map((row) => row.kind)).toEqual(['weekly', 'books', 'weekly', 'books', 'flowers', 'level'])
    expect(view.rows.map((row) => row.cost)).toEqual(['30 resin', '120 resin', '30 resin', '20 resin', 'No resin', 'Ready'])
    expect(view.rows[0]).toMatchObject({ title: 'The Doctor, weekly boss', who: ['sandrone'], done: false })
    expect(view.line).toBeNull()
  })

  it("says today's resin, and how many steps are done in the heading", () => {
    const view = todayView(week)
    expect(view.resin).toBe('200 of 200 resin')
    expect(view.meta).toBe('0 of 6 done')
    const ticked = { ...week, today: { ...week.today, tasks: week.today.tasks.map((task, index) => (index < 2 ? { ...task, done: true } : task)) } }
    expect(todayView(ticked).meta).toBe('2 of 6 done')
    expect(todayView(ticked).bar.slice(0, 2).map((segment) => segment.done)).toEqual([true, true])
  })

  it('shares its ticks with the week: the same body goes to the same route, for the same task of the same day', () => {
    const task = week.today.tasks[1]
    expect(todayTick(week, task, true)).toEqual(tickBody(week.days[0], task, true))
    expect(todayTick(week, task, true)).toEqual({ day: '2026-10-25', task: task.key, done: true })
  })

  it('says to choose a character when there is no focus, and not an empty list', () => {
    const view = todayView({ ...week, focus: [], today: { ...week.today, tasks: [], spare: null } })
    expect(view.rows).toEqual([])
    expect(view.line).toBe('Choose up to four characters to plan for.')
  })

  it('says that resin carries over when nothing needs it today', () => {
    const quiet = { ...week, today: { ...week.today, tasks: [], spent: 0, start: 180, spare: null } }
    expect(todayView(quiet).line).toBe('Nothing to farm with resin today: 180 resin carry over.')
    const said = { ...quiet, today: { ...quiet.today, spare: 'Nothing left to farm: 180 resin carry over.' } }
    expect(todayView(said).line).toBe('Nothing left to farm: 180 resin carry over.')
  })

  it('shows more of itself as it grows: faces from 4 cells wide, the reasons from 5, the resin bar from 3 cells tall', () => {
    expect(todayLayout({ w: 3, h: 2 })).toEqual({ faces: false, why: false, bar: false })
    expect(todayLayout({ w: 3, h: 3 })).toEqual({ faces: false, why: false, bar: true })
    expect(todayLayout({ w: 4, h: 3 })).toEqual({ faces: true, why: false, bar: true })
    expect(todayLayout({ w: 6, h: 5 })).toEqual({ faces: true, why: true, bar: true })
  })
})

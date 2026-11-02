import { describe, expect, it } from 'vitest'
import {
  groupTimers, offerGroups, progressOf, readyTime, ruleLine, ruleText, stateLine, timeLeft, visitsText,
} from './timersview.ts'
import type { PresetOffer, Timer } from '../types.ts'

const timer = (over: Partial<Timer>): Timer => ({
  id: 1, preset: null, own: true, name: 'Walk the dog', place: '', rule: { kind: 'hours', hours: 12 }, about: null,
  state: 'ready', ready_at: null, started_at: null, cleared_at: null, visits: null, bell: true, icon: null,
  achievement: null, pinned: false, ...over,
})

/** An instant given in this PC's own time, as the page shows times: month 9 is October. */
const local = (month: number, date: number, hours: number, minutes: number): Date =>
  new Date(2026, month, date, hours, minutes)

describe('the time left', () => {
  it('reads in days and hours, hours and minutes, or minutes, and in seconds only under one minute', () => {
    expect(timeLeft(34 * 3600 + 120)).toBe('in 1 d 10 h')
    expect(timeLeft(10 * 3600 + 5 * 60)).toBe('in 10 h 5 min')
    expect(timeLeft(5 * 60)).toBe('in 5 min')
    expect(timeLeft(42)).toBe('in 42 s')
  })

  it('counts whole minutes down, and a part of a second still to wait as a second', () => {
    expect(timeLeft(119)).toBe('in 1 min')
    expect(timeLeft(60)).toBe('in 1 min')
    expect(timeLeft(59)).toBe('in 59 s')
    expect(timeLeft(0.4)).toBe('in 1 s')
    expect(timeLeft(24 * 3600)).toBe('in 1 d 0 h')
  })

  it('says now at 0 or below', () => {
    expect(timeLeft(0)).toBe('now')
    expect(timeLeft(-90)).toBe('now')
  })
})

describe('the ready time', () => {
  // Monday 12 October 2026, 11:40, in this PC's own time. No clock change falls in the week after it.
  const now = local(9, 12, 11, 40)

  it('reads as the weekday and the time in this PC\'s time', () => {
    expect(readyTime(local(9, 13, 21, 42).toISOString(), now)).toBe('Tue 21:42')
    expect(readyTime(local(9, 12, 9, 5).toISOString(), now)).toBe('Mon 09:05')
  })

  it('gives the date too a week ahead or more', () => {
    expect(readyTime(local(10, 3, 21, 42).toISOString(), now)).toBe('Tue 3 Nov, 21:42')
    expect(readyTime(local(9, 19, 11, 40).toISOString(), now)).toBe('Mon 19 Oct, 11:40') // a week exactly
    expect(readyTime(local(9, 19, 11, 39).toISOString(), now)).toBe('Mon 11:39')
  })
})

describe('the state line', () => {
  const now = local(9, 12, 11, 40)

  it('says Ready, when a running timer is ready and how long that is, or that every visit is done', () => {
    expect(stateLine(timer({ state: 'ready' }), now)).toBe('Ready')
    const running = timer({ state: 'running', ready_at: local(9, 13, 21, 42).toISOString() })
    expect(stateLine(running, now)).toBe('Tue 21:42 · in 1 d 10 h')
    expect(stateLine(timer({ state: 'finished', visits: { done: 3, of: 3 } }), now)).toBe('All 3 visits done')
  })

  it('counts down to now while the model still has the timer running', () => {
    const due = timer({ state: 'running', ready_at: local(9, 12, 11, 39).toISOString() })
    expect(stateLine(due, now)).toBe('Mon 11:39 · now')
  })
})

describe("the rule of the player's own timer", () => {
  it('counts hours, and whole days from 48 hours on', () => {
    expect(ruleText({ kind: 'hours', hours: 1 })).toBe('Every hour')
    expect(ruleText({ kind: 'hours', hours: 166 })).toBe('Every 166 hours')
    expect(ruleText({ kind: 'hours', hours: 72 })).toBe('Every 3 days')
    expect(ruleText({ kind: 'hours', hours: 48 })).toBe('Every 2 days')
    expect(ruleText({ kind: 'hours', hours: 24 })).toBe('Every 24 hours')
    expect(ruleText({ kind: 'hours', hours: 60 })).toBe('Every 60 hours')
  })

  it('names the daily and the weekly reset with their server time', () => {
    expect(ruleText({ kind: 'resets', resets: 1 })).toBe('At the next daily reset (04:00 server time)')
    expect(ruleText({ kind: 'resets', resets: 3 })).toBe('After 3 daily resets (04:00 server time)')
    expect(ruleText({ kind: 'weekly' })).toBe('At the weekly reset (Monday 04:00 server time)')
  })
})

describe("a card's rule line", () => {
  it("is a pre-set's own sentence, or the rule of a timer the player made", () => {
    const teapot = timer({ own: false, preset: 'teapot.jade_field', about: 'Crops ripen 70 hours after planting' })
    expect(ruleLine(teapot)).toBe('Crops ripen 70 hours after planting')
    expect(ruleLine(timer({ rule: { kind: 'hours', hours: 166 } }))).toBe('Every 166 hours · made by you')
    expect(ruleLine(timer({ rule: { kind: 'resets', resets: 1 } })))
      .toBe('At the next daily reset (04:00 server time) · made by you')
  })

  it('says for a fishing spot that guides disagree, and where to change it', () => {
    const spot = timer({
      own: false, preset: 'fishing.luhua_pool', rule: { kind: 'fishing' },
      about: 'Fish come back 3 days after the spot is emptied',
    })
    expect(ruleLine(spot)).toBe(
      'Fish come back 3 days after the spot is emptied. Guides disagree, so Settings → Achievements can change this for ' +
        'every fishing spot.',
    )
  })

  it('reads the rule for a pre-set that a later file no longer holds, which has no sentence and was not made by the player', () => {
    expect(ruleLine(timer({ own: false, preset: 'teapot.gone', rule: { kind: 'hours', hours: 24 } }))).toBe('Every 24 hours')
  })
})

describe('the groups', () => {
  it('puts the ready timers of every kind first, then the running pre-sets, then the own timers that run or are done', () => {
    const jade = timer({ id: 1, own: false, preset: 'teapot.jade_field', state: 'ready' })
    const dog = timer({ id: 2, own: true, state: 'ready' })
    const hilichurl = timer({ id: 3, own: false, preset: 'hilichurl', state: 'running' })
    const shrines = timer({ id: 4, own: true, state: 'running' })
    const glebe = timer({ id: 5, own: false, preset: 'teapot.luxuriant_glebe', state: 'running' })
    const done = timer({ id: 6, own: true, state: 'finished', visits: { done: 3, of: 3 } })
    // In the model's order, which each group keeps: ready, then running soonest first, then finished.
    expect(groupTimers([jade, dog, hilichurl, shrines, glebe, done])).toEqual({
      ready: [jade, dog],
      running: [hilichurl, glebe],
      own: [shrines, done],
    })
    expect(groupTimers([])).toEqual({ ready: [], running: [], own: [] })
  })
})

describe('the visits and the progress', () => {
  it('counts the visits done', () => {
    expect(visitsText({ done: 2, of: 4 })).toBe('2 of 4 visits')
    expect(visitsText({ done: 0, of: 3 })).toBe('0 of 3 visits')
  })

  const running = timer({
    state: 'running', started_at: '2026-10-13T06:00:00+00:00', ready_at: '2026-10-13T18:00:00+00:00',
  })

  it('goes from 0 to 1 between the start and the ready time while the timer runs', () => {
    expect(progressOf(running, new Date('2026-10-13T08:00:00Z'))).toBeCloseTo(1 / 6)
    expect(progressOf(running, new Date('2026-10-13T06:00:00Z'))).toBe(0)
    expect(progressOf(running, new Date('2026-10-13T18:00:00Z'))).toBe(1)
    // Until the model is read again, and when the clocks differ, it stays within the bar.
    expect(progressOf(running, new Date('2026-10-13T19:00:00Z'))).toBe(1)
    expect(progressOf(running, new Date('2026-10-13T05:00:00Z'))).toBe(0)
  })

  it('has none for a timer that does not run, or whose start is unknown', () => {
    const now = new Date('2026-10-13T08:00:00Z')
    expect(progressOf({ ...running, state: 'ready' }, now)).toBeNull()
    expect(progressOf({ ...running, state: 'finished', visits: { done: 3, of: 3 } }, now)).toBeNull()
    // Set ready time on a timer that waits for a reset gives no start.
    expect(progressOf({ ...running, started_at: null }, now)).toBeNull()
  })
})

describe('the pre-sets that can be added', () => {
  const offer = (key: string, group: string, region: PresetOffer['region'] = null): PresetOffer => ({
    key, name: `Name of ${key}`, group, region,
  })

  it('come under their group, and the fishing spots under their region, in the order the core gives them', () => {
    const hilichurl = offer('hilichurl', 'Unusual Hilichurl')
    const windrise = offer('fishing.windrise', 'Fishing spots', 'mondstadt')
    const cider = offer('fishing.cider_lake_2', 'Fishing spots', 'mondstadt')
    const wangshu = offer('fishing.wangshu_inn', 'Fishing spots', 'liyue')
    expect(offerGroups([hilichurl, windrise, cider, wangshu])).toEqual([
      { group: 'Unusual Hilichurl', regions: [{ region: null, name: null, offers: [hilichurl] }] },
      {
        group: 'Fishing spots',
        regions: [
          { region: 'mondstadt', name: 'Mondstadt', offers: [windrise, cider] },
          { region: 'liyue', name: 'Liyue', offers: [wangshu] },
        ],
      },
    ])
    expect(offerGroups([])).toEqual([])
  })
})

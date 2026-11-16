import { describe, expect, it } from 'vitest'
import type { NextUpItem, NextUpModel } from '../types.ts'
import {
  keptItems, NEXT_UP_DEFAULTS, NEXT_UP_STYLES, nextUpGroups, nextUpMeta, nextUpProgress, nextUpSettings, strandedHeadings,
} from './nextupview.ts'

// Local times, so that the day a row falls on does not depend on the PC the test runs on.
const NOW = new Date(2026, 9, 13, 10, 0) // Tue 13 Oct 2026, 10:00
const at = (days: number, hours: number, minutes = 0): string => new Date(2026, 9, 13 + days, hours, minutes).toISOString()

function item(
  kind: NextUpItem['kind'], name: string, when: string | null, ready = false, count = 1, started: string | null = null,
  mode: NextUpItem['mode'] = null, icon: string | null = null,
): NextUpItem {
  return { kind, name, at: when, ready, count, mode, icon, started_at: started }
}

const MODEL: NextUpModel = {
  ready: 4,
  items: [
    item('expedition', '3 expeditions are back', at(0, 6), true, 3),
    item('timer', 'Fishing spot', at(-1, 20), true),
    item('expedition', 'Expedition back', at(0, 11, 59)),
    item('transformer', 'Transformer ready', at(0, 17, 10)),
    item('resin', 'Resin full', at(1, 2, 24)),
    item('daily', 'Daily reset', at(1, 5, 0)),
    item('banner', "Furina's banner ends", at(3, 6)),
    item('weekly', 'Weekly reset', at(6, 5)),
  ],
}

describe('the groups', () => {
  it('puts ready things under Now, then the rest by the local day of the core clock', () => {
    const groups = nextUpGroups(MODEL, NEXT_UP_DEFAULTS, NOW)
    expect(groups.map((group) => [group.heading, group.rows.map((row) => row.name)])).toEqual([
      ['Now', ['3 expeditions are back', 'Fishing spot']],
      ['Today', ['Expedition back', 'Transformer ready']],
      ['Tomorrow', ['Resin full', 'Daily reset']],
      ['Later', ["Furina's banner ends", 'Weekly reset']],
    ])
  })

  it('leaves out a group with no row and keeps the core order inside one', () => {
    const only = { ready: 0, items: [item('banner', 'A banner ends', at(5, 6)), item('daily', 'Daily reset', at(5, 7))] }
    expect(nextUpGroups(only, NEXT_UP_DEFAULTS, NOW).map((group) => group.heading)).toEqual(['Later'])
    expect(nextUpGroups({ ready: 0, items: [] }, NEXT_UP_DEFAULTS, NOW)).toEqual([])
  })

  it('counts the day by the core clock, so that a time just after midnight is tomorrow', () => {
    const late = new Date(2026, 9, 13, 23, 30)
    const model = { ready: 0, items: [item('daily', 'Daily reset', at(1, 0, 15))] }
    expect(nextUpGroups(model, NEXT_UP_DEFAULTS, late)[0].heading).toBe('Tomorrow')
  })
})

describe('a row', () => {
  const rows = nextUpGroups(MODEL, NEXT_UP_DEFAULTS, NOW).flatMap((group) => group.rows)
  const row = (name: string) => rows.find((one) => one.name === name)!

  it('says Ready for a ready thing, with what it is at the right', () => {
    expect(row('3 expeditions are back')).toMatchObject({ left: 'Ready', right: 'Expeditions', ready: true })
    expect(row('Fishing spot')).toMatchObject({ left: 'Ready', right: 'Timer' })
  })

  it('says the time left, and at the right the clock time today and tomorrow and the date after that', () => {
    expect(row('Expedition back')).toMatchObject({ left: 'in 1 h 59 min', right: '11:59', ready: false })
    expect(row('Transformer ready')).toMatchObject({ left: 'in 7 h 10 min', right: '17:10' })
    expect(row('Resin full')).toMatchObject({ left: 'in 16 h 24 min', right: '02:24' })
    expect(row("Furina's banner ends")).toMatchObject({ left: 'in 2 d 20 h', right: 'Fri 16 Oct' })
    expect(row('Weekly reset')).toMatchObject({ left: 'in 5 d 19 h', right: 'Mon 19 Oct' })
  })

  it('gives each row its own key', () => {
    expect(new Set(rows.map((one) => one.key)).size).toBe(rows.length)
  })

  it('says "now" for a time that has come since the model was read, and nothing for an item with no time', () => {
    const model = { ready: 0, items: [item('event', 'Gone ends', at(0, 9)), item('timer', 'Odd', null)] }
    const found = nextUpGroups(model, NEXT_UP_DEFAULTS, NOW).flatMap((group) => group.rows)
    expect(found[0]).toMatchObject({ left: 'now', right: '09:00' })
    expect(found[1]).toMatchObject({ left: '', right: null })
  })
})

describe('the styles', () => {
  it('are the rail, the gauges and the cards, and a saved widget with no style is the rail', () => {
    expect(NEXT_UP_STYLES.map((one) => one.style)).toEqual(['rail', 'gauges', 'cards'])
    expect(NEXT_UP_DEFAULTS.style).toBe('rail')
    expect(nextUpSettings({}).style).toBe('rail')
  })

  it('keep the style that is one of them, and a value that is not is the rail', () => {
    expect(nextUpSettings({ style: 'gauges' }).style).toBe('gauges')
    expect(nextUpSettings({ style: 'cards', resin: false })).toEqual({ ...NEXT_UP_DEFAULTS, style: 'cards', resin: false })
    for (const bad of ['rings', '', 3, null, true]) expect(nextUpSettings({ style: bad }).style, String(bad)).toBe('rail')
  })

  it('do not change which rows there are or their order', () => {
    const rail = nextUpGroups(MODEL, nextUpSettings({}), NOW)
    expect(nextUpGroups(MODEL, nextUpSettings({ style: 'gauges' }), NOW)).toEqual(rail)
    expect(nextUpGroups(MODEL, nextUpSettings({ style: 'cards' }), NOW)).toEqual(rail)
  })
})

describe('what a row draws with', () => {
  const rows = nextUpGroups(MODEL, NEXT_UP_DEFAULTS, NOW).flatMap((group) => group.rows)
  const row = (name: string) => rows.find((one) => one.name === name)!

  it('has a sign for each kind, the Abyss, the Theater and the Stygian each their own', () => {
    expect(row('Fishing spot').sign).toBe('stopwatch')
    expect(row('Resin full').sign).toBe('moon')
    expect(row('Expedition back').sign).toBe('compass')
    expect(row('Transformer ready').sign).toBe('transformer')
    expect(row('Daily reset').sign).toBe('cycle')
    expect(row('Weekly reset').sign).toBe('cycle')
    expect(row("Furina's banner ends").sign).toBe('star')
    const more = [
      item('realm', 'Realm currency full', at(1, 3)), item('event', 'Moonlit Trials ends', at(2, 3)),
      item('endgame', 'Spiral Abyss resets', at(1, 4), false, 1, null, 'abyss'),
      item('endgame', 'Imaginarium Theater resets', at(1, 5), false, 1, null, 'theater'),
      item('endgame', 'Stygian Onslaught ends', at(1, 6), false, 1, null, 'stygian'),
      item('endgame', 'Odd', at(1, 7), false, 1, null, null),
    ]
    const found = nextUpGroups({ ready: 0, items: more }, NEXT_UP_DEFAULTS, NOW).flatMap((group) => group.rows)
    expect(found.map((one) => [one.sign, one.mode])).toEqual([
      ['teapot', null], ['abyss', 'abyss'], ['theater', 'theater'], ['stygian', 'stygian'], ['tower', null], ['flag', null],
    ])
  })

  it("carries an endgame row's mode icon, and no icon where the item has none or it is not the art cache's", () => {
    const icon = `/api/art/${'b'.repeat(32)}`
    const more = [
      item('endgame', 'Spiral Abyss resets', at(1, 4), false, 1, null, 'abyss', icon),
      item('endgame', 'Imaginarium Theater resets', at(1, 5), false, 1, null, 'theater'),
      item('endgame', 'Stygian Onslaught ends', at(1, 6), false, 1, null, 'stygian', 'https://example.com/x.png'),
      item('timer', 'Fishing spot', at(1, 7)),
    ]
    const found = nextUpGroups({ ready: 0, items: more }, NEXT_UP_DEFAULTS, NOW).flatMap((group) => group.rows)
    expect(found.map((one) => [one.sign, one.icon])).toEqual([['abyss', icon], ['theater', null], ['stygian', null], ['stopwatch', null]])
  })

  it('says what kind it is in words, and the time left without its "in"', () => {
    expect(row('Fishing spot')).toMatchObject({ kindLabel: 'Timer', time: 'Ready' })
    expect(row('3 expeditions are back').kindLabel).toBe('Expedition')
    expect(row('Expedition back')).toMatchObject({ kindLabel: 'Expedition', time: '1 h 59 min' })
    expect(row('Daily reset').kindLabel).toBe('Reset')
    expect(row("Furina's banner ends")).toMatchObject({ kindLabel: 'Banner', time: '2 d 20 h' })
    expect(nextUpGroups({ ready: 0, items: [item('timer', 'Odd', null)] }, NEXT_UP_DEFAULTS, NOW)[0].rows[0].time).toBe('')
    expect(nextUpGroups({ ready: 0, items: [item('event', 'Gone ends', at(0, 9))] }, NEXT_UP_DEFAULTS, NOW)[0].rows[0].time).toBe('now')
  })
})

describe('how far along a row is', () => {
  const ago = (hours: number): string => new Date(NOW.getTime() - hours * 3_600_000).toISOString()
  const ahead = (hours: number): string => new Date(NOW.getTime() + hours * 3_600_000).toISOString()

  it('is the share of the wait that has passed, from when it began to when it comes', () => {
    expect(nextUpProgress(item('banner', 'A', ahead(6), false, 1, ago(18)), NOW)).toBeCloseTo(0.75)
    expect(nextUpProgress(item('daily', 'D', ahead(12), false, 1, ago(12)), NOW)).toBeCloseTo(0.5)
  })

  it('is whole for a ready thing, and held between 0 and 1', () => {
    expect(nextUpProgress(item('timer', 'T', ago(1), true, 1, ago(5)), NOW)).toBe(1)
    expect(nextUpProgress(item('timer', 'T', ahead(2), false, 1, ahead(1)), NOW)).toBe(0)
    expect(nextUpProgress(item('timer', 'T', ago(1), false, 1, ago(5)), NOW)).toBe(1)
  })

  it('is null where the start is not known, the time is not, or the wait has no length', () => {
    expect(nextUpProgress(item('expedition', 'E', ahead(2)), NOW)).toBeNull()
    expect(nextUpProgress(item('timer', 'T', null, false, 1, ago(1)), NOW)).toBeNull()
    expect(nextUpProgress(item('timer', 'T', ahead(1), false, 1, ahead(1)), NOW)).toBeNull()
    expect(nextUpProgress(item('timer', 'T', 'nonsense', false, 1, ago(1)), NOW)).toBeNull()
  })

  it('goes with each row, so that a style draws it', () => {
    const model = { ready: 0, items: [item('banner', 'A', ahead(6), false, 1, ago(18)), item('expedition', 'E', ahead(2))] }
    const rows = nextUpGroups(model, NEXT_UP_DEFAULTS, NOW).flatMap((group) => group.rows)
    expect(rows[0].progress).toBeCloseTo(0.75)
    expect(rows[1].progress).toBeNull()
  })
})

describe('the settings', () => {
  it('start with every kind on, and a value that is not true or false is the default', () => {
    expect(nextUpSettings({})).toEqual(NEXT_UP_DEFAULTS)
    expect(nextUpSettings({ resin: false, banners: 'no', timers: 0 })).toEqual({ ...NEXT_UP_DEFAULTS, resin: false })
  })

  it('keep the kinds that are on: resets hold the daily and the weekly, expeditions the row of those back', () => {
    const kinds = (settings: Record<string, boolean>) =>
      keptItems(MODEL, nextUpSettings(settings)).map((one) => one.kind)
    expect(kinds({ resets: false })).not.toContain('daily')
    expect(kinds({ resets: false })).not.toContain('weekly')
    expect(kinds({ expeditions: false }).filter((kind) => kind === 'expedition')).toEqual([])
    expect(kinds({ banners: false })).not.toContain('banner')
    expect(kinds({})).toHaveLength(MODEL.items.length)
  })

  it('take a kind off the groups, and its heading with it', () => {
    const settings = nextUpSettings({ resin: false, resets: false })
    expect(nextUpGroups(MODEL, settings, NOW).map((group) => group.heading)).toEqual(['Now', 'Today', 'Later'])
  })
})

describe('the meta', () => {
  it('counts what is ready, each expedition back counting', () => {
    expect(nextUpMeta(MODEL, NEXT_UP_DEFAULTS)).toBe('4 ready')
  })

  it('counts only the kinds that are on, and is null when nothing is ready', () => {
    expect(nextUpMeta(MODEL, nextUpSettings({ expeditions: false }))).toBe('1 ready')
    expect(nextUpMeta(MODEL, nextUpSettings({ expeditions: false, timers: false }))).toBeNull()
    expect(nextUpMeta({ ready: 0, items: [] }, NEXT_UP_DEFAULTS)).toBeNull()
  })
})

describe('a heading at the fold', () => {
  // The list's lines as boxes, in its own pixels: a heading of 20 and rows of 26, the view 0 to 100 tall.
  const lines = (list: ('g' | 'r')[]): { heading: boolean; top: number; bottom: number }[] => {
    let top = 0
    return list.map((kind) => {
      const height = kind === 'g' ? 20 : 26
      const line = { heading: kind === 'g', top, bottom: top + height }
      top += height
      return line
    })
  }

  it('is hidden while the first row under it is not wholly in view, so that a heading is never the last line', () => {
    // g r r r (20, 46, 72, 98) then a heading at 98-118 and a row at 118-144, both under 100.
    expect(strandedHeadings(lines(['g', 'r', 'r', 'r', 'g', 'r']), 0, 100)).toEqual([4])
    // The heading and its row both in view: shown.
    expect(strandedHeadings(lines(['g', 'r', 'g', 'r']), 0, 100)).toEqual([])
    // The row half in view: the heading goes with it.
    expect(strandedHeadings(lines(['g', 'r', 'r', 'g', 'r']), 0, 100)).toEqual([3])
  })

  it('leaves alone a heading wholly out of view, above it or below it, and one with no row under it', () => {
    expect(strandedHeadings(lines(['g', 'r', 'r', 'r', 'r', 'g', 'r']), 0, 100)).toEqual([])
    expect(strandedHeadings(lines(['r', 'r', 'g', 'r']), 40, 140)).toEqual([])
    expect(strandedHeadings(lines(['g', 'r', 'g']), 0, 50)).toEqual([])
  })
})

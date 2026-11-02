import { expect, test } from 'vitest'
import type { Stats, Tile } from '../types.ts'
import { countValue } from '../ui/motion.tsx'
import { countedValue, coverageNote, figureOf, inPeriod, periodTitle, type Scope, startLabel, tileView } from './statsview.ts'

const COVERED: Stats['coverage'] = {
  tracking_since: '2026-07-15', tracked_days: 30, full: true, partial: false, compare: true,
}
const MONTH: Scope = { range: '30', period: { first: '2026-09-14', last: '2026-10-13', days: 30 }, coverage: COVERED }
const ALL: Scope = {
  range: 'all',
  period: { first: '2026-07-15', last: '2026-10-13', days: 91 },
  coverage: { ...COVERED, tracked_days: 91, full: false, compare: false },
}
/** Tracking began inside the period. */
const LATE: Scope = {
  ...MONTH,
  coverage: { tracking_since: '2026-10-01', tracked_days: 13, full: false, partial: true, compare: false },
}

test('a tile compares with the previous period', () => {
  const tile: Tile = { id: 'chests', label: 'Chests opened', value: 1211, delta: 28, trend: [13, 23, 9] }
  expect(tileView(tile, MONTH)).toEqual({
    id: 'chests',
    label: 'Chests opened',
    figure: [{ text: '1,211' }],
    line: { strong: '▲ 28', gain: true, rest: 'vs previous 30 days' },
    trend: { values: [13, 23, 9], tip: 'Lowest 9, highest 23' },
    meter: null,
  })
})

test('a fall and no change are not shown as gains', () => {
  const fall = tileView({ id: 'chests', label: 'Chests opened', value: 36, delta: -8, trend: [] }, MONTH)
  expect(fall.line).toEqual({ strong: '▼ 8', gain: false, rest: 'vs previous 30 days' })
  expect(fall.trend).toBeNull()
  const same = tileView({ id: 'achievements', label: 'Achievements earned', value: 11, delta: 0, trend: [1] }, MONTH)
  expect(same.line).toEqual({ strong: 'no change', gain: false, rest: 'vs previous 30 days' })
})

test('without an earlier period the line says so instead of comparing', () => {
  const tile: Tile = { id: 'primogems', label: 'Primogems earned', value: 17148, delta: null, trend: [740, 1140] }
  expect(tileView(tile, LATE).line).toEqual({ strong: null, gain: false, rest: 'No earlier period to compare' })
  expect(tileView(tile, ALL).line).toEqual({ strong: null, gain: false, rest: 'Since 15 Jul' })
})

test('playtime is written in hours and minutes', () => {
  const tile: Tile = { id: 'playtime', label: 'Playtime', minutes: 2295, delta_minutes: 475, trend: [103, 333] }
  const view = tileView(tile, MONTH)
  expect(view.figure).toEqual([{ text: '38' }, { text: 'h', small: true }, { text: '15' }, { text: 'min', small: true }])
  expect(view.line).toEqual({ strong: '▲ 7 h 55 min', gain: true, rest: 'vs previous 30 days' })
  expect(view.trend?.tip).toBe('Lowest 1 h 43 min, highest 5 h 33 min')
  const short = tileView({ id: 'playtime', label: 'Playtime', minutes: 45, delta_minutes: null, trend: [] }, MONTH)
  expect(short.figure).toEqual([{ text: '45' }, { text: 'min', small: true }])
})

test('days played shows its share of the period', () => {
  expect(tileView({ id: 'days', label: 'Days played', value: 27, of: 30, longest_run: 9 }, MONTH)).toEqual({
    id: 'days',
    label: 'Days played',
    figure: [{ text: '27' }, { text: 'of 30', small: true }],
    line: { strong: null, gain: false, rest: 'Longest run 9 days' },
    trend: null,
    meter: 0.9,
  })
  const one = tileView({ id: 'days', label: 'Days played', value: 1, of: 1, longest_run: 1 }, ALL)
  expect(one.line.rest).toBe('Longest run 1 day')
})

test('a tile counts up to one number, and its figure is worded for the number on the way', () => {
  const chests: Tile = { id: 'chests', label: 'Chests opened', value: 1211, delta: 28, trend: [] }
  const playtime: Tile = { id: 'playtime', label: 'Playtime', minutes: 2295, delta_minutes: null, trend: [] }
  const days: Tile = { id: 'days', label: 'Days played', value: 27, of: 30, longest_run: 9 }
  expect([chests, playtime, days].map(countedValue)).toEqual([1211, 2295, 27])
  expect(figureOf(chests, 640)).toEqual([{ text: '640' }])
  expect(figureOf(playtime, 125)).toEqual([{ text: '2' }, { text: 'h', small: true }, { text: '05' }, { text: 'min', small: true }])
  expect(figureOf(playtime, 0)).toEqual([{ text: '0' }, { text: 'min', small: true }])
  expect(figureOf(days, 12)).toEqual([{ text: '12' }, { text: 'of 30', small: true }]) // the page opens on its length
  expect(figureOf(days, 12, 19)).toEqual([{ text: '12' }, { text: 'of 19', small: true }]) // a length on the way
  // At the end of the count it is the figure the tile ends on.
  for (const tile of [chests, playtime, days]) {
    expect(figureOf(tile, countedValue(tile))).toEqual(tileView(tile, MONTH).figure)
  }
})

test('Days played never shows more days played than days while it counts from one period to another', () => {
  const month: Extract<Tile, { id: 'days' }> = { id: 'days', label: 'Days played', value: 27, of: 30, longest_run: 9 }
  const week: Extract<Tile, { id: 'days' }> = { id: 'days', label: 'Days played', value: 5, of: 7, longest_run: 3 }
  // The number and the period's length count together, each from the figure on the screen, frame by frame.
  for (const [from, to] of [[month, week], [week, month]]) {
    for (let frame = 0; frame <= 48; frame += 1) {
      const t = frame / 48
      const figure = figureOf(to, countValue(from.value, to.value, t), countValue(from.of, to.of, t))
      const played = Number(figure[0].text)
      const days = Number(figure[1].text.replace('of ', ''))
      expect(played, `${from.of} to ${to.of} days, frame ${frame}`).toBeLessThanOrEqual(days)
    }
  }
  expect(figureOf(week, 27, 30)).toEqual([{ text: '27' }, { text: 'of 30', small: true }]) // where the count begins
  // A length that falls behind the number on the way, as two counts a moment apart can, shows as the number.
  expect(figureOf(week, 8, 7)).toEqual([{ text: '8' }, { text: 'of 8', small: true }])
})

test('the period is worded for a sentence and for a heading', () => {
  expect(inPeriod(MONTH)).toBe('in the last 30 days')
  expect(periodTitle(MONTH)).toBe('Last 30 days')
  expect(inPeriod(ALL)).toBe('since 15 Jul')
  expect(periodTitle(ALL)).toBe('Since 15 Jul')
})

test('the page names the day tracking began when the period reaches back further', () => {
  expect(coverageNote(COVERED)).toBeNull()
  expect(coverageNote(LATE.coverage)).toBe('Tracking since 1 Oct')
  expect(coverageNote({ ...LATE.coverage, tracking_since: null, tracked_days: 0 })).toBe('No history yet')
  expect(startLabel(MONTH)).toBe('30 days ago')
  expect(startLabel(LATE)).toBe('On 1 Oct')
  expect(startLabel(ALL)).toBe('On 15 Jul')
})

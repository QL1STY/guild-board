import { expect, test } from 'vitest'
import type { Group, PrimogemColumn, PrimogemColumns } from '../ledgertypes.ts'
import charts from '../styles/charts.css?raw'
import { contrast, tokenValues } from '../styles/contrast.ts'
import tokens from '../styles/tokens.css?raw'
import { ESTIMATE, GROUP_COLOURS, columnTip, columnsTable, segmentsOf, stacked, stripeOf, type Stack } from './stack.ts'

const ORDER: Group[] = ['commissions', 'welkin', 'events', 'endgame', 'other']
const LABELS: Record<Group, string> = {
  commissions: 'Daily commissions',
  welkin: 'Blessing of the Welkin Moon',
  events: 'Events',
  endgame: 'Spiral Abyss and Theater',
  other: 'Other',
}
const STACK: Stack = { order: ORDER, labels: LABELS, colours: GROUP_COLOURS }
const groups = (part: Partial<Record<Group, number>>): Record<Group, number> => ({
  commissions: 0, welkin: 0, events: 0, endgame: 0, other: 0, ...part,
})

const welkinDay: PrimogemColumn = {
  label: '2026-10-20', value: 150, no_data: false, after_gap: false, groups: groups({ commissions: 60, welkin: 90 }),
}
const busyDay: PrimogemColumn = {
  label: '2026-10-21', value: 1015, no_data: false, after_gap: false,
  groups: groups({ commissions: 60, welkin: 90, events: 420, endgame: 400, other: 45 }),
}
const diaryDay: PrimogemColumn = { label: '2026-09-25', value: 120, no_data: false, after_gap: false, estimate: true }
const gapDay: PrimogemColumn = { label: '2026-09-20', value: 120, no_data: false, after_gap: true }
const unsynced: PrimogemColumn = { label: '2026-09-19', value: 0, no_data: true, after_gap: false }

const data = (columns: PrimogemColumn[]): PrimogemColumns => ({
  unit: 'day', columns, total: columns.reduce((sum, column) => sum + column.value, 0), max_index: 0,
  groups_order: ORDER, group_labels: LABELS,
})

test('stacked segments sum to the column, in the order, from the bottom, leaving out empty groups', () => {
  const segments = segmentsOf(busyDay, ORDER)
  expect(segments.map((segment) => segment.group)).toEqual(['commissions', 'welkin', 'events', 'endgame', 'other'])
  expect(segments.reduce((sum, segment) => sum + segment.value, 0)).toBe(busyDay.value)
  expect(segments.reduce((sum, segment) => sum + segment.share, 0)).toBeCloseTo(1)
  expect(segmentsOf(welkinDay, ORDER)).toEqual([
    { group: 'commissions', value: 60, share: 0.4 },
    { group: 'welkin', value: 90, share: 0.6 },
  ])
  // A day before the ledger, and a day with nothing, have none.
  expect(segmentsOf(diaryDay, ORDER)).toEqual([])
  expect(segmentsOf({ ...welkinDay, value: 0, groups: groups({}) }, ORDER)).toEqual([])
})

test('estimate and after_gap stripes differ', () => {
  expect(stripeOf(diaryDay)).toBe('est')
  expect(stripeOf(gapDay)).toBe('gap')
  expect(stripeOf(welkinDay)).toBeNull()
  // A diary day after a gap is drawn as the estimate, which it is first.
  expect(stripeOf({ ...diaryDay, after_gap: true })).toBe('est')
  const plain = charts.replace(/\/\*[\s\S]*?\*\//g, '')
  const background = (selector: string) =>
    new RegExp(`${selector.replace(/[.]/g, '\\.')}[^{]*\\{[^}]*background:\\s*([^;]+);`).exec(plain)?.[1]
  expect(background('.col-item i.est')).toBeDefined()
  expect(background('.col-item i.gap')).toBeDefined()
  expect(background('.col-item i.est')).not.toBe(background('.col-item i.gap'))
})

test('the table lists each group, with the note of an estimate', () => {
  const table = columnsTable(data([unsynced, gapDay, diaryDay, welkinDay]), 'Primogems', STACK)
  expect(table.head).toEqual([
    'Day', 'Primogems', 'Daily commissions', 'Blessing of the Welkin Moon', 'Events', 'Spiral Abyss and Theater', 'Other',
    'Note',
  ])
  expect(table.rows).toEqual([
    ['Sat 19 Sep', '–', '–', '–', '–', '–', '–', 'No sync'],
    ['Sun 20 Sep', '120', '–', '–', '–', '–', '–', 'Includes days without a sync'],
    ['Fri 25 Sep', '120', '–', '–', '–', '–', '–', ESTIMATE],
    ['Tue 20 Oct', '150', '60', '90', '0', '0', '0', ''],
  ])
  expect(table.numeric).toEqual([1, 2, 3, 4, 5, 6])
})

test('without a stack the table is as it was', () => {
  const table = columnsTable(data([unsynced, gapDay]), 'Chests')
  expect(table.head).toEqual(['Day', 'Chests', 'Note'])
  expect(table.rows[1]).toEqual(['Sun 20 Sep', '120', 'Includes days without a sync'])
})

test("a stacked column's tip names the day and total, then each group it holds", () => {
  expect(columnTip(welkinDay, 'day', 'Primogems', STACK)).toEqual([
    'Tue 20 Oct · 150 primogems',
    'Daily commissions 60',
    'Blessing of the Welkin Moon 90',
  ])
  expect(columnTip(diaryDay, 'day', 'Primogems', STACK)).toEqual(['Fri 25 Sep · 120 primogems', ESTIMATE])
  expect(columnTip(unsynced, 'day', 'Primogems', STACK)).toEqual(['Sat 19 Sep: no sync'])
  // Without a stack, the tip is as it was.
  expect(columnTip(gapDay, 'day', 'Chests')).toEqual(['Sun 20 Sep: 120, includes days without a sync'])
  expect(columnTip({ ...welkinDay, groups: undefined }, 'week', 'Chests')).toEqual(['Week of 20 Oct: 150'])
})

test('stacked is true only when the core sends groups', () => {
  expect(stacked(data([welkinDay, diaryDay]))).toBe(true)
  expect(stacked({ ...data([gapDay]), groups_order: undefined })).toBe(false)
  expect(stacked(data([gapDay, diaryDay]))).toBe(false)
})

test('the groups have the plan\'s colours, and Other its own token', () => {
  const t = tokenValues(tokens)
  expect(t['--other']).toBe('#B9AD92')
  expect(GROUP_COLOURS).toEqual({
    commissions: 'var(--fill)',
    welkin: 'var(--series)',
    events: 'var(--wish-standard)',
    endgame: 'var(--wish-chronicled)',
    other: 'var(--other)',
  })
  // The four named sources are marks that reach 3:1 on the card; Other is the quiet rest.
  for (const token of ['--fill', '--series', '--wish-standard', '--wish-chronicled']) {
    expect(contrast(t[token], t['--surface'])).toBeGreaterThanOrEqual(3)
  }
})

import { MONTHS, WEEKDAYS } from '../format.ts'
import { timeLeft } from '../pages/timersview.ts'
import type { NextUpItem, NextUpModel } from '../types.ts'
import type { SignName } from '../ui/Sign.tsx'
import { artIcon } from './endgameview.ts'
import { clockText } from './widgetview.ts'

/*
 * The words and the order of the Next up widget (the widgets and Friends design, 2.1), apart from its drawing. The core puts
 * the timeline together (views/nextup.py), ready things first and the rest soonest first; this groups it by the local day of the
 * core's clock, says the time left and the right column, and keeps the kinds the settings switch on.
 */

/** The kinds of things the widget can list, as its switches name them. */
export type NextUpKind = 'timers' | 'resin' | 'expeditions' | 'realm' | 'transformer' | 'resets' | 'banners' | 'endgame' | 'events'


/** The ways the timeline can be drawn (the widgets polish, 2026-11-15): a rail with a sign for each kind, gauges, and cards by day. */
export type NextUpStyle = 'rail' | 'gauges' | 'cards'

/** The styles, in the order the picker draws them: each one's name and the line under it. */
export const NEXT_UP_STYLES: readonly { style: NextUpStyle; name: string; about: string }[] = [
  { style: 'rail', name: 'Rail', about: 'What is ready on top, the rest on a rail' },
  { style: 'gauges', name: 'Gauges', about: 'A ring that fills as each thing comes' },
  { style: 'cards', name: 'Cards', about: 'Cards by day, in their kind’s colour' },
]

export type NextUpSettings = Record<NextUpKind, boolean> & { style: NextUpStyle }

/** Every kind on and the rail, as a widget added in Edit starts. A saved widget with no style is drawn as the rail. */
export const NEXT_UP_DEFAULTS: NextUpSettings = {
  timers: true, resin: true, expeditions: true, realm: true, transformer: true, resets: true, banners: true, endgame: true, events: true,
  style: 'rail',
}

/** The switches, in the order they are drawn: each one's name, the line under it and the items it keeps. */
export const NEXT_UP_SWITCHES: readonly { kind: NextUpKind; name: string; about: string; items: readonly NextUpItem['kind'][] }[] = [
  { kind: 'timers', name: 'Timers', about: 'Those ready and those running', items: ['timer'] },
  { kind: 'resin', name: 'Resin', about: 'When it is full', items: ['resin'] },
  { kind: 'expeditions', name: 'Expeditions', about: 'When each one is back', items: ['expedition'] },
  { kind: 'realm', name: 'Realm currency', about: 'When it is full', items: ['realm'] },
  { kind: 'transformer', name: 'Transformer', about: 'When it is ready', items: ['transformer'] },
  { kind: 'resets', name: 'Resets', about: 'The daily and the weekly reset', items: ['daily', 'weekly'] },
  { kind: 'banners', name: 'Banners', about: 'When each running banner ends', items: ['banner'] },
  { kind: 'endgame', name: 'Endgame', about: 'When the Abyss, Theater and Stygian reset', items: ['endgame'] },
  { kind: 'events', name: 'Events', about: 'When each event you have not finished ends', items: ['event'] },
]

/** The settings a widget keeps, with the defaults under them; a switch that is not true or false, or a style that is none of the three, is the default's. */
export function nextUpSettings(settings: Record<string, unknown>): NextUpSettings {
  const kept = { ...NEXT_UP_DEFAULTS }
  for (const { kind } of NEXT_UP_SWITCHES) {
    const value = settings[kind]
    if (typeof value === 'boolean') kept[kind] = value
  }
  const style = NEXT_UP_STYLES.find((one) => one.style === settings.style)
  if (style !== undefined) kept.style = style.style
  return kept
}

export type NextUpGroup = 'Now' | 'Today' | 'Tomorrow' | 'Later'

/** One row: its words, the time left (or "Ready"), and the right column's text. */
export type NextUpRow = {
  key: string
  kind: NextUpItem['kind']
  name: string
  ready: boolean
  /** "Ready", or "in 1 h 59 min", or "" for an item with no time. */
  left: string
  /** The clock time within today and tomorrow, the date after that ("Fri 16 Oct"), and what a ready thing is ("Timer"). */
  right: string | null
  /** The time left without its "in": "Ready", "1 h 59 min", "now", or "" for an item with no time. */
  time: string
  /** What kind of thing it is, in a word: "Timer", "Expedition", "Reset". */
  kindLabel: string
  /** The sign it is drawn with, and the endgame mode that sets its colour. */
  sign: SignName
  mode: NextUpItem['mode']
  /** An endgame row's own icon, the Stats card's, drawn in place of its sign; null where there is none yet. */
  icon: string | null
  /** How far along it is, 0 to 1, from when it began; null where that is not known. */
  progress: number | null
}

export type NextUpGroups = { heading: NextUpGroup; rows: NextUpRow[] }[]

/** What a ready row says at the right, where a row still to come says its time. */
const KIND_WORDS: Record<NextUpItem['kind'], string> = {
  timer: 'Timer', resin: 'Resin', expedition: 'Expeditions', realm: 'Realm', transformer: 'Transformer', daily: 'Reset', weekly: 'Reset',
  banner: 'Banner', endgame: 'Endgame', event: 'Event',
}

/** The word for each kind, as the rail says it under a name. */
const KIND_LABELS: Record<NextUpItem['kind'], string> = {
  timer: 'Timer', resin: 'Resin', expedition: 'Expedition', realm: 'Realm currency', transformer: 'Transformer', daily: 'Reset',
  weekly: 'Reset', banner: 'Banner', endgame: 'Endgame', event: 'Event',
}

/** The sign of each kind: the timers' stopwatch, Resin's crescent, the expeditions' compass, the realm's teapot and so on. */
const KIND_SIGNS: Record<NextUpItem['kind'], SignName> = {
  timer: 'stopwatch', resin: 'moon', expedition: 'compass', realm: 'teapot', transformer: 'transformer', daily: 'cycle', weekly: 'cycle',
  banner: 'star', endgame: 'tower', event: 'flag',
}

/** An endgame row's sign by its mode; with no mode it is the tower of the Endgame resets widget. */
function signOf(item: NextUpItem): SignName {
  if (item.kind === 'endgame' && item.mode !== null) return item.mode
  return KIND_SIGNS[item.kind]
}

/**
 * How far along an item is: the share of its wait that has passed, from `started_at` to `at`, between 0 and 1; 1 for a ready
 * thing; null where the start or the time is not known, or the wait has no length.
 */
export function nextUpProgress(item: NextUpItem, now: Date): number | null {
  if (item.ready) return 1
  if (item.started_at === null || item.at === null) return null
  const start = Date.parse(item.started_at)
  const end = Date.parse(item.at)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)))
}

/** Midnight of the local day `at` falls on, in this PC's time, as a day count that two dates can be subtracted by. */
function dayNumber(at: Date): number {
  return Math.round(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / 86_400_000)
}

/** The group a row stands in: ready things are "Now", the rest by how many local days off they are. */
function groupOf(item: NextUpItem, now: Date): NextUpGroup {
  if (item.ready) return 'Now'
  if (item.at === null) return 'Later'
  const at = new Date(item.at)
  if (Number.isNaN(at.getTime())) return 'Later'
  const days = dayNumber(at) - dayNumber(now)
  return days <= 0 ? 'Today' : days === 1 ? 'Tomorrow' : 'Later'
}

/** "Fri 16 Oct", in this PC's time. */
function dateText(at: Date): string {
  return `${WEEKDAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`
}

function rowOf(item: NextUpItem, index: number, group: NextUpGroup, now: Date): NextUpRow {
  const at = item.at === null ? null : new Date(item.at)
  const known = at !== null && !Number.isNaN(at.getTime())
  let right: string | null = null
  if (item.ready) right = KIND_WORDS[item.kind]
  else if (known) right = group === 'Later' ? dateText(at) : clockText(at, false)
  const left = item.ready ? 'Ready' : known ? timeLeft((at.getTime() - now.getTime()) / 1000) : ''
  return {
    key: `${item.kind}-${index}`,
    kind: item.kind,
    name: item.name,
    ready: item.ready,
    left,
    right,
    time: left.startsWith('in ') ? left.slice(3) : left,
    kindLabel: KIND_LABELS[item.kind],
    sign: signOf(item),
    mode: item.mode,
    icon: artIcon(item.icon),
    progress: nextUpProgress(item, now),
  }
}

/** The items the settings keep, in the core's order. */
export function keptItems(model: NextUpModel, settings: NextUpSettings): NextUpItem[] {
  const on = new Set(NEXT_UP_SWITCHES.filter(({ kind }) => settings[kind]).flatMap(({ items }) => items))
  return model.items.filter((item) => on.has(item.kind))
}

/**
 * The timeline in its groups, "Now", "Today", "Tomorrow" and "Later", by the local day of `now`, the core's time. A group with
 * no row is left out; the order inside a group is the core's.
 */
export function nextUpGroups(model: NextUpModel, settings: NextUpSettings, now: Date): NextUpGroups {
  const groups: NextUpGroups = []
  keptItems(model, settings).forEach((item, index) => {
    const heading = groupOf(item, now)
    let group = groups.find((one) => one.heading === heading)
    if (group === undefined) {
      group = { heading, rows: [] }
      groups.push(group)
    }
    group.rows.push(rowOf(item, index, heading, now))
  })
  const order: NextUpGroup[] = ['Now', 'Today', 'Tomorrow', 'Later']
  return groups.sort((a, b) => order.indexOf(a.heading) - order.indexOf(b.heading))
}

/** The heading's meta: "4 ready" for what the kept kinds hold that is ready (3 expeditions back count 3), or null. */
export function nextUpMeta(model: NextUpModel, settings: NextUpSettings): string | null {
  const ready = keptItems(model, settings).reduce((sum, item) => sum + (item.ready ? item.count : 0), 0)
  return ready > 0 ? `${ready} ready` : null
}

/** A line of the list in its scrolling box's own pixels: its top and bottom, and whether it is a day's heading. */
export type ListLine = { heading: boolean; top: number; bottom: number }

/**
 * The indexes of the headings to hide at this scroll position: a heading whose first row is not wholly in the view
 * (`viewTop` to `viewBottom`) while the heading itself is, or is cut by the bottom edge. So a heading is never the last
 * line of the list, with its rows below the fold; as the list scrolls on, the heading is shown again with its row. A heading
 * wholly above or below the view, or with no row under it, is left alone.
 */
export function strandedHeadings(lines: ListLine[], viewTop: number, viewBottom: number): number[] {
  const stranded: number[] = []
  lines.forEach((line, index) => {
    const row = lines[index + 1]
    if (!line.heading || row === undefined || row.heading) return
    if (line.bottom <= viewTop || line.top >= viewBottom) return
    if (row.bottom > viewBottom) stranded.push(index)
  })
  return stranded
}

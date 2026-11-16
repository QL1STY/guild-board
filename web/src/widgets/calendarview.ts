import { MONTHS, WEEKDAYS } from '../format.ts'
import { timeLeft } from '../pages/timersview.ts'
import type { CalendarBanner, CalendarEvent, CalendarFace, CalendarModel, Place, ResetMode } from '../types.ts'
import { rowValue, timeWords as modeTime, type TimeWords } from './endgameview.ts'
import { FIVE_CELLS_ACROSS, THREE_CELLS_DOWN } from './widget.ts'
import { readAt } from './widgetview.ts'

/*
 * The words, the places and the order of the Calendar widget (the widgets and Friends design, 2.3), apart from its drawing. The
 * core gives the banners, the events and the endgame modes (views/calendar.py); this lays them over a window of fourteen local
 * days, two before today to eleven after, in three lanes, or in a list. Days are the local days of this PC, counted from `now`,
 * the core's time. It says only what the read holds: an event's reward and whether it is finished, never what is left of the
 * reward; an event with no dates is "Coming soon", with no bar and no time.
 */

export const WINDOW_DAYS = 14
/** The frame's height from which the Wishes lane shows every row, and from which it shows two (under that, one). */
export const WISHES_ALL = 470
export const WISHES_TWO = 380

/**
 * What the Calendar draws in a frame of this size: the wide grid (on the Board, five cells across and three down or more) and
 * how many rows the Wishes lane keeps to, so that the other two lanes stay in view. Under five cells across the lane has one
 * row, as the wide drawing is not used there.
 */
export function calendarFrame(width: number, height: number, place: Place): { wide: boolean; wishRows: number } {
  const across = width >= FIVE_CELLS_ACROSS
  return {
    wide: place === 'board' && across && height >= THREE_CELLS_DOWN,
    wishRows: across && height >= WISHES_ALL ? Number.POSITIVE_INFINITY : across && height >= WISHES_TWO ? 2 : 1,
  }
}
const DAYS_BEFORE = 2
const DAY_MS = 86_400_000
const SOON = 'Coming soon'

export type Lane = 'wish' | 'event' | 'endgame'

const LANE_LABELS: Record<Lane, string> = { wish: 'Wishes', event: 'Events', endgame: 'Endgame' }
const LANES: readonly Lane[] = ['wish', 'event', 'endgame']

const BANNER_WORDS: Record<string, string> = {
  character: 'Character wishes', weapon: 'Weapon wishes', chronicled: 'Chronicled Wish',
}

/** A day number that two local dates can be subtracted by, with no hour of the day in it. */
function dayNumber(at: Date): number {
  return Math.round(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) / DAY_MS)
}

function dateOf(text: string | null): Date | null {
  if (text === null) return null
  const at = new Date(text)
  return Number.isNaN(at.getTime()) ? null : at
}

/** "Fri 16 Oct", in this PC's time. */
function dateText(at: Date): string {
  return `${WEEKDAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`
}

export type DayHead = { key: string; label: string; weekday: string; date: number; today: boolean }

/** The fourteen days of the window, the third of them today. */
export function windowDays(now: Date): DayHead[] {
  return Array.from({ length: WINDOW_DAYS }, (_, index) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + index - DAYS_BEFORE)
    const today = index === DAYS_BEFORE
    const weekday = WEEKDAYS[day.getDay()]!
    return { key: `${day.getMonth()}-${day.getDate()}`, label: today ? 'Today' : weekday, weekday, date: day.getDate(), today }
  })
}

/** The window's column of the local day `at` falls on, from 0; negative before the window and past 13 after it. */
function columnOf(at: Date, now: Date): number {
  return dayNumber(at) - dayNumber(now) + DAYS_BEFORE
}

/** A bar's grid columns (1-based, the end exclusive), and whether its start or its end runs past the window, so is flat. */
export type Span = { col: number; end: number; from: boolean; to: boolean }

/** The columns of something that starts and ends at these instants; null where it lies outside the window or has no dates. */
export function spanOf(starts: string | null, ends: string | null, now: Date): Span | null {
  const first = dateOf(starts) ?? dateOf(ends)
  const last = dateOf(ends) ?? first
  if (first === null || last === null) return null
  const start = columnOf(first, now)
  const end = columnOf(last, now)
  if (end < 0 || start > WINDOW_DAYS - 1) return null
  const col = Math.max(start, 0) + 1
  return { col, end: Math.max(Math.min(end, WINDOW_DAYS - 1) + 2, col + 1), from: start < 0, to: end > WINDOW_DAYS - 1 }
}

/** "ends in 3 d 8 h" (lead, time, tail "left"); "starts Fri 16 Oct"; "ended Mon 12 Oct". Null for a thing with no dates. */
export function timeParts(starts: string | null, ends: string | null, now: Date): TimeWords | null {
  const begin = dateOf(starts)
  const finish = dateOf(ends)
  if (begin !== null && begin.getTime() > now.getTime()) return { lead: 'starts', time: dateText(begin), tail: '' }
  if (finish === null) return null
  const seconds = (finish.getTime() - now.getTime()) / 1000
  if (seconds <= 0) return { lead: 'ended', time: dateText(finish), tail: '' }
  return { lead: 'ends in', time: timeLeft(seconds).replace(/^in /, '').replace(/ 0 h$/, ''), tail: 'left' }
}

export type Tone = 'ok' | 'gold' | 'plain'
/** The words on a bar or under a name in the list, and how they are drawn: a tick in green, in gold (with a gem), or plain. */
export type Words = { text: string; tone: Tone; gem: boolean }

/**
 * What an event says: "Done" where the player finished it (HoYoLAB's `is_finished` is the player's own completion), else its
 * reward as the answer gives it ("1,000 · not finished" on a bar, "1,000 primogems · not finished" in the list), the double
 * rewards left, and the part explored. Never what is left of a reward. Null where the answer gives nothing of these.
 */
export function eventWords(event: CalendarEvent, long: boolean): Words | null {
  if (event.finished) return { text: 'Done', tone: 'ok', gem: false }
  const parts: string[] = []
  let gem = false
  if (event.primogems !== null) {
    const amount = event.primogems.toLocaleString('en-US')
    parts.push(long ? `${amount} primogems · not finished` : `${amount} · not finished`)
    gem = !long
  }
  if (event.double !== null) parts.push(`Double rewards · ${event.double.left} of ${event.double.total} left`)
  if (event.explored !== null) parts.push(`${Math.round(event.explored)}% explored`)
  return parts.length === 0 ? null : { text: parts.join(' · '), tone: 'gold', gem }
}

/** Whether the result of a mode is complete: all 36 stars, every act of the season, a Stygian difficulty played. */
export function modeFinished(mode: ResetMode): boolean {
  if (!mode.played) return false
  if (mode.mode === 'abyss') return mode.stars !== null && mode.stars >= 36
  if (mode.mode === 'theater') return mode.acts !== null && mode.acts_of !== null && mode.acts >= mode.acts_of
  return mode.difficulty !== null
}

/** A mode's result from the endgame rows: "36 of 36 stars", "Act 8 of 10", "Difficulty 5", "Not played yet". */
export function modeWords(mode: ResetMode): Words {
  const value = rowValue(mode)
  if (value.main === null) return { text: value.note ?? '', tone: 'plain', gem: false }
  return { text: `${value.main}${value.unit}`, tone: modeFinished(mode) ? 'ok' : 'gold', gem: false }
}

export type BarFace = { name: string; rarity: number; icon: string | null }

/** One bar of the wide drawing. `row` is its grid row; `col` and `end` its grid columns, `from` and `to` a flat start and end. */
export type CalendarBar = Span & {
  key: string
  lane: Lane
  mode: ResetMode['mode'] | null
  source: string | null
  name: string
  faces: BarFace[]
  words: Words | null
  time: TimeWords | null
  /** A finished event: drawn faded. */
  done: boolean
  row: number
  /** On the last bar of a lane's last row when the lane is held to fewer rows: how many bars are left out below it, and their names. */
  more: number
  hidden: string[]
}

export type CalendarLane = { lane: Lane; label: string; /** The grid row of the lane's heading. */ head: number; bars: CalendarBar[] }

export type CalendarGrid = {
  days: DayHead[]
  lanes: CalendarLane[]
  /** The names of the events HoYoLAB announced with no dates. */
  soon: string[]
  /** Nothing in the window and nothing coming soon. */
  empty: boolean
}

function facesOf(faces: CalendarFace[]): BarFace[] {
  return faces
    .map((face, index) => ({ face, index }))
    .sort((a, b) => b.face.rarity - a.face.rarity || a.index - b.index)
    .map(({ face }) => ({ name: face.name, rarity: face.rarity, icon: face.icon }))
}

function bannerBar(banner: CalendarBanner, now: Date): Omit<CalendarBar, 'row' | 'more' | 'hidden'> | null {
  const span = spanOf(banner.starts, banner.ends, now)
  if (span === null) return null
  return {
    ...span, key: banner.id, lane: 'wish', mode: null, source: null, name: banner.name, faces: facesOf(banner.faces),
    words: null, time: timeParts(banner.starts, banner.ends, now), done: false,
  }
}

function eventBar(event: CalendarEvent, index: number, now: Date): Omit<CalendarBar, 'row' | 'more' | 'hidden'> | null {
  if (event.soon) return null
  const span = spanOf(event.starts, event.ends, now)
  if (span === null) return null
  return {
    ...span, key: `event-${event.id ?? index}`, lane: 'event', mode: null, source: event.source, name: event.name, faces: [],
    words: eventWords(event, false), time: timeParts(event.starts, event.ends, now), done: event.finished,
  }
}

/**
 * A mode's bar. The read does not know when the cycle began, so a mode with an end runs from the window's first day, flat
 * there; a mode between seasons starts at its next start and runs past the window; with no time at all it spans the window.
 */
function modeBar(mode: ResetMode, now: Date): Omit<CalendarBar, 'row' | 'more' | 'hidden'> | null {
  const ends = dateOf(mode.ends_at)
  const next = dateOf(mode.next_starts_at)
  let span: Span
  if (ends !== null) {
    const end = columnOf(ends, now)
    if (end < 0) return null
    span = { col: 1, end: Math.min(end, WINDOW_DAYS - 1) + 2, from: true, to: end > WINDOW_DAYS - 1 }
  } else if (next !== null) {
    const start = columnOf(next, now)
    if (start > WINDOW_DAYS - 1) return null
    span = { col: Math.max(start, 0) + 1, end: WINDOW_DAYS + 1, from: start < 0, to: true }
  } else {
    span = { col: 1, end: WINDOW_DAYS + 1, from: true, to: true }
  }
  return {
    ...span, key: `mode-${mode.mode}`, lane: 'endgame', mode: mode.mode, source: null, name: mode.label, faces: [],
    words: modeWords(mode), time: ends !== null || next !== null ? modeTime(mode, now) : null, done: false,
  }
}

/**
 * Each bar on the first row of its lane that is free over its columns, the earliest start first (the modes keep their order, the
 * Abyss, the Theater, the Stygian); the lane's rows are numbered from `first`.
 */
function placed(bars: Omit<CalendarBar, 'row' | 'more' | 'hidden'>[], first: number, keepOrder: boolean): { bars: CalendarBar[]; rows: number } {
  const rowEnds: number[] = []
  const out = [...bars]
    .map((bar, index) => ({ bar, index }))
    .sort((a, b) => (keepOrder ? 0 : a.bar.col - b.bar.col || b.bar.end - a.bar.end) || a.index - b.index)
    .map(({ bar }) => {
      let row = rowEnds.findIndex((end) => end <= bar.col)
      if (row < 0) row = rowEnds.length
      rowEnds[row] = bar.end
      return { ...bar, row: first + row, more: 0, hidden: [] }
    })
  return { bars: out, rows: rowEnds.length }
}

/**
 * The wide drawing: the days, and each lane that has a bar with its heading and rows. The Wishes lane keeps at most `wishRows`
 * rows (where the frame has no room for more, so that the Events and the Endgame lanes stay in view); the bars that would be
 * below are left out, and the last bar of its last row says how many ("+2 more") and, as its title, which.
 */
export function calendarGrid(model: CalendarModel, now: Date, wishRows = Number.POSITIVE_INFINITY): CalendarGrid {
  const candidates: Record<Lane, Omit<CalendarBar, 'row' | 'more' | 'hidden'>[]> = {
    wish: model.banners.flatMap((banner) => bannerBar(banner, now) ?? []),
    event: model.events.flatMap((event, index) => eventBar(event, index, now) ?? []),
    endgame: model.endgame.flatMap((mode) => modeBar(mode, now) ?? []),
  }
  const lanes: CalendarLane[] = []
  let row = 1
  for (const lane of LANES) {
    if (candidates[lane].length === 0) continue
    const all = placed(candidates[lane], row + 1, lane === 'endgame')
    const rows = lane === 'wish' ? Math.min(all.rows, wishRows) : all.rows
    const bars = all.bars.filter((bar) => bar.row - row <= rows)
    const left = all.bars.filter((bar) => bar.row - row > rows)
    if (left.length > 0) {
      const last = bars.filter((bar) => bar.row - row === rows).at(-1)!
      last.more = left.length
      last.hidden = left.map((bar) => bar.name)
    }
    lanes.push({ lane, label: LANE_LABELS[lane], head: row, bars })
    row += 1 + rows
  }
  const soon = model.events.filter((event) => event.soon).map((event) => event.name)
  return { days: windowDays(now), lanes, soon, empty: lanes.length === 0 && soon.length === 0 }
}

/** One row of the list. `big` and `small` are the time at the right: "3 d 8 h" over "left". */
export type CalendarRow = {
  key: string
  lane: Lane
  mode: ResetMode['mode'] | null
  source: string | null
  name: string
  /** The line under the name: the kind of banner, the reward, the result. */
  sub: string | null
  /** The result is complete, or the event is done: the line is green. */
  ok: boolean
  /** A finished event, drawn faded. */
  done: boolean
  soon: boolean
  big: string
  small: string
}

type Sortable = { row: CalendarRow; group: number; at: number }

const NO_TIME = Number.POSITIVE_INFINITY

/** What the list says at a row's right: the time, and its small word ("left", "to reset", or "starts" for what is to come). */
function rightOf(time: TimeWords | null): { big: string; small: string } {
  return time === null ? { big: '', small: '' } : { big: time.time, small: time.tail || time.lead }
}

/**
 * The list: what is running now, ending soonest first, then what starts within the window (soonest start first), then the
 * modes with no time, then what is coming soon. A finished event stays on the Board, faded; on the overlay only what is not
 * finished is listed.
 */
export function calendarList(model: CalendarModel, now: Date, place: Place): { rows: CalendarRow[]; empty: boolean } {
  const overlay = place === 'overlay'
  const items: Sortable[] = []
  const add = (row: CalendarRow, starts: string | null, ends: string | null) => {
    const begin = dateOf(starts)
    const finish = dateOf(ends)
    if (finish !== null && finish.getTime() <= now.getTime()) return
    const upcoming = begin !== null && begin.getTime() > now.getTime()
    if (upcoming && spanOf(starts, ends, now) === null) return
    items.push(
      upcoming ? { row, group: 1, at: begin.getTime() } : { row, group: 0, at: finish === null ? NO_TIME : finish.getTime() },
    )
  }
  for (const banner of model.banners) {
    const time = timeParts(banner.starts, banner.ends, now)
    add(
      {
        key: banner.id, lane: 'wish', mode: null, source: null, name: banner.name, sub: BANNER_WORDS[banner.kind] ?? null, ok: false,
        done: false, soon: false, ...rightOf(time),
      },
      banner.starts,
      banner.ends,
    )
  }
  model.events.forEach((event, index) => {
    if (event.soon) {
      items.push({
        row: {
          key: `event-${event.id ?? index}`, lane: 'event', mode: null, source: event.source, name: event.name, sub: null, ok: false,
          done: false, soon: true, big: SOON, small: '',
        },
        group: 3,
        at: index,
      })
      return
    }
    if (overlay && event.finished) return
    const words = eventWords(event, true)
    add(
      {
        key: `event-${event.id ?? index}`, lane: 'event', mode: null, source: event.source, name: event.name, sub: words?.text ?? null,
        ok: words?.tone === 'ok', done: event.finished, soon: false, ...rightOf(timeParts(event.starts, event.ends, now)),
      },
      event.starts,
      event.ends,
    )
  })
  for (const mode of model.endgame) {
    if (overlay && modeFinished(mode)) continue
    const words = modeWords(mode)
    const row: CalendarRow = {
      key: `mode-${mode.mode}`, lane: 'endgame', mode: mode.mode, source: null, name: mode.label, sub: words.text,
      ok: words.tone === 'ok', done: false, soon: false, ...rightOf(modeTime(mode, now)),
    }
    const ends = dateOf(mode.ends_at)
    const next = dateOf(mode.next_starts_at)
    if (ends !== null && ends.getTime() > now.getTime()) items.push({ row, group: 0, at: ends.getTime() })
    else if (next !== null && next.getTime() > now.getTime()) {
      if (columnOf(next, now) <= WINDOW_DAYS - 1) items.push({ row, group: 1, at: next.getTime() })
    } else items.push({ row, group: 2, at: NO_TIME })
  }
  const rows = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.group - b.item.group || a.item.at - b.item.at || a.index - b.index)
    .map(({ item }) => item.row)
  return { rows, empty: rows.length === 0 }
}

/** The heading's meta: the events left to finish and when it was read; on the overlay the count alone; "Not read yet" before a read. */
export function calendarMeta(model: CalendarModel, now: Date, place: Place): string | null {
  if (!model.read) return 'Not read yet'
  const left = model.left > 0 ? `${model.left} ${place === 'overlay' ? '' : model.left === 1 ? 'event ' : 'events '}left to finish` : null
  if (place === 'overlay') return left
  if (model.read_at === null) return left
  const read = readAt(model.read_at, now)
  return left === null ? read : `${left} · ${read.charAt(0).toLowerCase()}${read.slice(1)}`
}

/** The wiki's line, where an event drawn has its dates from the wiki: the model says which wiki. */
export function calendarFoot(model: CalendarModel, now: Date, place: Place): string | null {
  if (model.upcoming_from === null) return null
  const drawn = model.events.some(
    (event) =>
      event.source === 'fandom' && !event.soon && spanOf(event.starts, event.ends, now) !== null && !(place === 'overlay' && event.finished),
  )
  return drawn ? `Upcoming dates: ${model.upcoming_from}` : null
}

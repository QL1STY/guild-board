import { timeLeft } from '../pages/timersview.ts'
import type { ResetMode } from '../types.ts'
import { dayLine } from './widgetview.ts'

/*
 * The words and figures of the Endgame resets widget (the widgets and Friends design, 2.4; the polish pass's four drawings),
 * apart from its drawing. It says only what the read holds: a mode not played is "Not played yet", a cycle that ended since
 * the read is "Not read since the reset", and the count of acts is given only where the read carries it.
 */

const ABYSS_STARS = 36

/** The four drawings. The player's choice among them is the widget's setting `style`; With pictures is what a widget with none shows. */
export type EndgameStyle = 'pictures' | 'medallions' | 'bars' | 'order'
export const DEFAULT_STYLE: EndgameStyle = 'pictures'
export const ENDGAME_STYLES: readonly { value: EndgameStyle; name: string; about: string }[] = [
  { value: 'pictures', name: 'Pictures', about: "The Stats page's headers in small, the time to reset over each" },
  { value: 'medallions', name: 'Medallions', about: 'A ring for the time left in each cycle, and the result beside it' },
  { value: 'bars', name: 'Season bars', about: 'A bar for each mode that fills as its cycle goes, with a mark at now' },
  { value: 'order', name: 'In order', about: 'The resets one after another, the soonest first' },
]

/** The style a widget's settings choose; one this version does not know is the default. */
export function styleOf(settings: Record<string, unknown>): EndgameStyle {
  const found = ENDGAME_STYLES.find((style) => style.value === settings.style)
  return found === undefined ? DEFAULT_STYLE : found.value
}

/** What a mode has to show. A "none" says why in the words the drawings use, and whether it is a cycle that was not read since its reset. */
export type Result =
  | { kind: 'none'; note: string; stale: boolean }
  | { kind: 'stars'; stars: number; of: number }
  | { kind: 'act'; act: number; of: number | null; medals: number | null }
  | { kind: 'difficulty'; level: number; medal: string | null }

/**
 * A difficulty carries the Stygian's official medal, HoYoLAB's picture of it, which the Stats card draws (the core's `medal` of the
 * mode: an address of the art cache, null until the cache is asked and where the wiki has none); the drawings put it where they
 * drew a shield, and draw the shield only where there is none or it does not load.
 */
export function resultOf(mode: ResetMode): Result {
  const none: Result = { kind: 'none', note: mode.stale ? 'Not read since the reset' : 'Not played yet', stale: mode.stale }
  if (!mode.played) return none
  if (mode.mode === 'abyss') return mode.stars === null ? none : { kind: 'stars', stars: mode.stars, of: ABYSS_STARS }
  if (mode.mode === 'theater') return mode.acts === null ? none : { kind: 'act', act: mode.acts, of: mode.acts_of, medals: mode.medals }
  return mode.difficulty === null ? none : { kind: 'difficulty', level: mode.difficulty, medal: artIcon(mode.medal) }
}

export type Value = {
  /** The big part, or null where the mode has no result to show. */
  main: string | null
  /** The small part after it, with its space: " of 36 stars". */
  unit: string
}

/** A result in words, as the Calendar's Endgame lane says it: the result with its small part, or a note where there is none. */
export function rowValue(mode: ResetMode): Value & { note: string | null } {
  const result = resultOf(mode)
  if (result.kind === 'none') return { main: null, unit: '', note: result.note }
  if (result.kind === 'stars') return { main: String(result.stars), unit: ` of ${result.of} stars`, note: null }
  if (result.kind === 'act') return { main: `Act ${result.act}`, unit: result.of === null ? '' : ` of ${result.of}`, note: null }
  return { main: `Difficulty ${result.level}`, unit: '', note: null }
}

/** An address of the art cache (`/api/art/<key>`) as a picture to draw, and null for anything else, which is never drawn as one. */
export function artIcon(address: string | null): string | null {
  return address !== null && address.startsWith('/api/art/') ? address : null
}

/** The icon of a mode's Tutorial entry, as the Stats card draws it; null until the core has one, where the widget draws the mode's sign. */
export function modeIcon(mode: ResetMode): string | null {
  return artIcon(mode.header.icon)
}

/** The first unit of a time left ("5 d 3 h" is "5 d"), or all of it where `long`: a small drawing is narrow. Null once the time has come. */
function units(seconds: number, long: boolean): string | null {
  const words = timeLeft(seconds)
  if (words === 'now') return null
  return words.replace(/^in /, '').split(' ').slice(0, long ? 4 : 2).join(' ')
}

export type TimeWords = {
  /** "resets in", "ends in" or "starts in", before the time. */
  lead: string
  time: string
  /** "to reset", "left" or "to start", after the time. */
  tail: string
}

function secondsTo(instant: string | null, now: Date): number | null {
  if (instant === null) return null
  const at = Date.parse(instant)
  return Number.isNaN(at) ? null : (at - now.getTime()) / 1000
}

/**
 * The seconds to the mode's reset (the Abyss and the Theater), to its end (the Stygian), or to its next season where this one
 * ended and the read knows when the next starts. Null where there is no time to tell, or it has come.
 */
export function timeSeconds(mode: ResetMode, now: Date): number | null {
  const seconds = secondsTo(mode.ends_at !== null ? mode.ends_at : mode.next_starts_at, now)
  return seconds !== null && seconds > 0 ? seconds : null
}

/**
 * The time to the mode's reset, to its end, or to its next season, in the first unit of it, or in full (up to four units, "5 d 3 h"
 * is two) for a drawing that has room. Null where there is no time to tell, or it has come.
 */
export function timeWords(mode: ResetMode, now: Date, long = false): TimeWords | null {
  const seconds = timeSeconds(mode, now)
  const time = seconds === null ? null : units(seconds, long)
  if (time === null) return null
  if (mode.ends_at !== null) {
    return mode.mode === 'stygian'
      ? { lead: 'ends in', time, tail: 'left' }
      : { lead: 'resets in', time, tail: 'to reset' }
  }
  return { lead: 'starts in', time, tail: 'to start' }
}

/**
 * The share of the cycle still to come, from 1 at its start to 0 at its end (a ring and a bar draw it); null where the read
 * gives no start or end, or they are not in order.
 */
export function shareLeft(mode: ResetMode, now: Date): number | null {
  if (mode.starts_at === null || mode.ends_at === null) return null
  const start = Date.parse(mode.starts_at)
  const end = Date.parse(mode.ends_at)
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null
  return Math.min(1, Math.max(0, (end - now.getTime()) / (end - start)))
}

/** The days a cycle began and resets, "Fri 16 Oct" and "Mon 16 Nov"; the end is a second before the reset, so the day is that of the reset. Null where the read gives no cycle. */
export function cycleDates(mode: ResetMode): { from: string; to: string } | null {
  if (mode.starts_at === null || mode.ends_at === null) return null
  const start = Date.parse(mode.starts_at)
  const end = Date.parse(mode.ends_at)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return { from: dayLine(new Date(start)), to: dayLine(new Date(end + 1000)) }
}

/** The days the line of "In order" spans: a mode resets further on than this at the line's right end. */
const LINE_DAYS = 17
/** Where the middle one's mark may be (per cent along the line), so that its words clear those of the first and the last. */
const MIDDLE_FROM = 38
const MIDDLE_TO = 62

export type LinePlace = {
  mode: ResetMode
  /** The side its words keep: the first at the left, the last at the right, the other centred on its mark. */
  side: 'l' | 'c' | 'r'
  /** Where the mark is, per cent along the line (a middle one's). */
  at: number
}

/**
 * The modes in the order they reset, the soonest first, those with no time to tell after them in the read's order, and where each
 * sits on a line of `LINE_DAYS` days.
 */
export function linePlaces(modes: readonly ResetMode[], now: Date): LinePlace[] {
  const timed = modes
    .map((mode) => ({ mode, seconds: timeSeconds(mode, now) }))
    .filter((one): one is { mode: ResetMode; seconds: number } => one.seconds !== null)
    .sort((one, other) => one.seconds - other.seconds)
  const waiting = modes.filter((mode) => timeSeconds(mode, now) === null)
  const ordered = [...timed.map((one) => one.mode), ...waiting]
  return ordered.map((mode, index) => {
    const seconds = timeSeconds(mode, now)
    const side = index === 0 ? 'l' : index === ordered.length - 1 ? 'r' : 'c'
    const along = seconds === null ? 50 : Math.min(seconds / 86_400 / LINE_DAYS, 1) * 100
    return { mode, side, at: side === 'c' ? Math.min(MIDDLE_TO, Math.max(MIDDLE_FROM, along)) : along }
  })
}

/** The heading's meta: "1 not played", from 2 × 2; nothing at 2 × 1 and where every mode was played or is stale. */
export function metaOf(notPlayed: number, short: boolean): string | null {
  return short || notPlayed === 0 ? null : `${notPlayed} not played`
}

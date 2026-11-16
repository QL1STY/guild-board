import { periodProgress } from './widgetview.ts'

/*
 * The Clock's styles and options (the widgets polish mockup, `2026-11-15-widgets-polish-mockup`, section 4): what it says
 * is worked out here, from the core's clock, and drawn by Clock.tsx. Nothing here reads the browser's own clock.
 */

export type ClockStyle = 'istaroth' | 'digital' | 'flip' | 'astro' | 'reset' | 'words'

/** The six styles in the order the picker shows them, each with the line under its name. */
export const CLOCK_STYLES: readonly { id: ClockStyle; name: string; about: string }[] = [
  { id: 'istaroth', name: 'Istaroth', about: "Today's dial" },
  { id: 'digital', name: 'Figures', about: 'Large and plain' },
  { id: 'flip', name: 'Flip', about: 'Tiles like a board' },
  { id: 'astro', name: 'Astrolabe', about: 'A day on one dial' },
  { id: 'reset', name: 'Time and reset', about: 'With the daily reset' },
  { id: 'words', name: 'Words', about: 'Ten past ten' },
]

export type ClockSettings = {
  style: ClockStyle
  /** 12 hours with AM and PM; off is 24 hours. */
  twelve: boolean
  /** A second hand, or the seconds beside the minutes; only where the style has them. */
  seconds: boolean
  /** The day, under or beside the time. */
  date: boolean
  /** The server's time with its name; in the heading when narrow. */
  server: boolean
  /** The time to the daily reset (always on in the two styles that draw it). */
  reset: boolean
}

/** What a clock saved with no settings is: the dial it has always been. */
export const CLOCK_DEFAULTS: ClockSettings = { style: 'istaroth', twelve: false, seconds: false, date: true, server: true, reset: false }

/** A clock's settings from what its widget keeps: each one it has not got, or has of the wrong kind, is its default. */
export function clockSettings(raw: Record<string, unknown>): ClockSettings {
  const flag = (key: 'twelve' | 'seconds' | 'date' | 'server' | 'reset') => (typeof raw[key] === 'boolean' ? raw[key] : CLOCK_DEFAULTS[key])
  const style = CLOCK_STYLES.find((one) => one.id === raw.style)?.id ?? CLOCK_DEFAULTS.style
  return {
    style,
    twelve: flag('twelve'),
    seconds: flag('seconds'),
    date: flag('date'),
    server: flag('server'),
    reset: flag('reset'),
  }
}

/** For each option, null where the style takes it, and else why it does not (the row is greyed, with the reason under it). */
export type OptionReasons = { twelve: string | null; seconds: string | null; date: string | null; server: string | null; reset: string | null }

export function optionsOf(style: ClockStyle): OptionReasons {
  const all: OptionReasons = { twelve: null, seconds: null, date: null, server: null, reset: null }
  if (style === 'words') {
    return {
      ...all,
      twelve: 'Words are always said in 12 hours',
      seconds: 'Words go by five minutes, with a dot for each minute after',
    }
  }
  if (style === 'reset') return { ...all, reset: 'Always on in Time and reset' }
  if (style === 'astro') return { ...all, reset: 'The Astrolabe marks it as a diamond' }
  return all
}

/** Whether the clock shows seconds: they are on, and the style has them. It ticks each second then, and each minute otherwise. */
export function showsSeconds(settings: ClockSettings): boolean {
  return settings.seconds && optionsOf(settings.style).seconds === null
}

const two = (value: number) => String(value).padStart(2, '0')

export type TimeParts = { hours: string; minutes: string; seconds: string | null; ampm: 'AM' | 'PM' | null }

/** A time of day as it is written: 24 hours, or 12 with AM and PM (midnight and noon are 12), with the seconds if asked. */
export function formatTime(hours: number, minutes: number, seconds: number, how: { twelve: boolean; seconds: boolean }): TimeParts {
  const shown = how.twelve ? hours % 12 || 12 : hours
  return {
    hours: two(shown),
    minutes: two(minutes),
    seconds: how.seconds ? two(seconds) : null,
    ampm: how.twelve ? (hours < 12 ? 'AM' : 'PM') : null,
  }
}

/** The words of a time: "09:05", "09:05:07", "03:40 PM". */
function written(parts: TimeParts): string {
  const time = `${parts.hours}:${parts.minutes}${parts.seconds === null ? '' : `:${parts.seconds}`}`
  return parts.ampm === null ? time : `${time} ${parts.ampm}`
}

/** This PC's time, as the clock writes it. */
export function timeText(at: Date, how: { twelve: boolean; seconds: boolean }): string {
  return written(formatTime(at.getHours(), at.getMinutes(), at.getSeconds(), how))
}

/** The server's time, at its fixed offset from UTC (gameday.py), written in the same way. */
export function serverTime(now: Date, offsetHours: number, how: { twelve: boolean; seconds: boolean }): string {
  const at = new Date(now.getTime() + offsetHours * 3_600_000)
  return written(formatTime(at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), how))
}

/** The part of the day the Astrolabe names under its time. */
export function periodOfDay(hour: number): 'Night' | 'Morning' | 'Afternoon' | 'Evening' {
  if (hour < 5) return 'Night'
  if (hour < 12) return 'Morning'
  if (hour < 17) return 'Afternoon'
  if (hour < 21) return 'Evening'
  return 'Night'
}

/**
 * The milliseconds to the next time the clock's words change: the next second while seconds are shown, the next minute
 * otherwise, so that a minute turns on the minute and not up to a minute late.
 */
export function msToNextTick(now: Date, seconds: boolean): number {
  const into = seconds ? now.getMilliseconds() : now.getSeconds() * 1000 + now.getMilliseconds()
  return (seconds ? 1000 : 60_000) - into
}

const DAY_MS = 86_400_000

export type ResetLeft = {
  hours: number
  minutes: number
  /** How much of the game day has gone, from 0 to 1. */
  share: number
  /** The hour of this PC's day the reset falls on, with the minutes as a fraction: 5.5 is half past five. */
  localHour: number
}

/** The time to the next daily reset in whole minutes (never negative), and where it stands in the day. */
export function resetLeft(dailyAt: string, now: Date): ResetLeft {
  const total = Math.max(0, Math.floor((Date.parse(dailyAt) - now.getTime()) / 60_000))
  const at = new Date(dailyAt)
  return {
    hours: Math.floor(total / 60),
    minutes: total % 60,
    share: periodProgress(dailyAt, DAY_MS, now),
    localHour: at.getHours() + at.getMinutes() / 60,
  }
}

/** "14 h 50 min" */
export function resetText(left: ResetLeft): string {
  return `${left.hours} h ${left.minutes} min`
}

/** When the weekly reset is, by the days of this PC: "today", "tomorrow" or "in 3 days". */
export function weeklyWords(weeklyAt: string, now: Date): string {
  const day = (at: Date) => Date.UTC(at.getFullYear(), at.getMonth(), at.getDate())
  const days = Math.round((day(new Date(weeklyAt)) - day(now)) / DAY_MS)
  if (days <= 0) return 'today'
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

/** Where the Astrolabe puts an hour of the day, as a turn from the top: midnight at the bottom, noon at the top. */
export function astroTurn(hours: number): number {
  return (hours / 24 + 0.5) % 1
}

/** The Astrolabe shows the sun from six to eighteen, and the moon otherwise. */
export function astroDay(hours: number): boolean {
  return hours >= 6 && hours < 18
}

/** What the heading says: at one cell wide the server's time, else the time to the reset, else nothing; wider, nothing. */
export function clockMeta({ narrow, server, reset }: { narrow: boolean; server: string | null; reset: string | null }): string | null {
  if (!narrow) return null
  if (server !== null) return server
  return reset === null ? null : `Reset in ${reset}`
}

/* ------------------------------------------------------------------ Words */

const WORD_ROWS = ['ITLISASAMPM', 'ACQUARTERDC', 'TWENTYFIVEX', 'HALFSTENFTO', 'PASTERUNINE', 'ONESIXTHREE', 'FOURFIVETWO', 'EIGHTELEVEN', 'SEVENTWELVE', 'TENSEOCLOCK']
const COLUMNS = 11

/** Where each word stands: its row, then its first and last column. */
const WORDS: Record<string, readonly [row: number, from: number, to: number]> = {
  IT: [0, 0, 1], IS: [0, 3, 4], A: [1, 0, 0], QUARTER: [1, 2, 8], TWENTY: [2, 0, 5], FIVE: [2, 6, 9], HALF: [3, 0, 3], TEN: [3, 5, 7],
  TO: [3, 9, 10], PAST: [4, 0, 3], H9: [4, 7, 10], H1: [5, 0, 2], H6: [5, 3, 5], H3: [5, 6, 10], H4: [6, 0, 3], H5: [6, 4, 7],
  H2: [6, 8, 10], H8: [7, 0, 4], H11: [7, 5, 10], H7: [8, 0, 4], H12: [8, 5, 10], H10: [9, 0, 2], OCLOCK: [9, 5, 10],
}

const HOUR_NAMES = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven']
const MINUTE_NAMES: Record<number, { words: readonly string[]; said: string }> = {
  5: { words: ['FIVE'], said: 'five' },
  10: { words: ['TEN'], said: 'ten' },
  15: { words: ['A', 'QUARTER'], said: 'quarter' },
  20: { words: ['TWENTY'], said: 'twenty' },
  25: { words: ['TWENTY', 'FIVE'], said: 'twenty-five' },
  30: { words: ['HALF'], said: 'half' },
}

export type WordCell = { ch: string; on: boolean; gold: boolean }

export type WordsState = {
  /** The 110 letters, row by row, each lit or not; the hour's are gold. */
  cells: WordCell[]
  /** The minutes after the last five, one dot each. */
  extra: number
  /** The time as a sentence, with the hour apart: "five past " + "ten" + "". */
  phrase: { lead: string; hour: string; tail: string }
}

/** The time in words, to the five minutes ("it is ten past ten"), as the letters to light and as a sentence. */
export function wordsState(at: Date): WordsState {
  const five = Math.floor(at.getMinutes() / 5) * 5
  const to = five > 30
  const hour = (at.getHours() % 12 + (to ? 1 : 0)) % 12
  const away = to ? 60 - five : five
  const lit = ['IT', 'IS', ...(five === 0 ? [] : [...MINUTE_NAMES[away].words, to ? 'TO' : 'PAST']), `H${hour === 0 ? 12 : hour}`, ...(five === 0 ? ['OCLOCK'] : [])]
  const on = new Set<number>()
  const gold = new Set<number>()
  for (const word of lit) {
    const [row, from, last] = WORDS[word]
    for (let column = from; column <= last; column += 1) {
      on.add(row * COLUMNS + column)
      if (word.startsWith('H')) gold.add(row * COLUMNS + column)
    }
  }
  const cells = WORD_ROWS.flatMap((row, r) => [...row].map((ch, c) => ({ ch, on: on.has(r * COLUMNS + c), gold: gold.has(r * COLUMNS + c) })))
  const phrase =
    five === 0
      ? { lead: '', hour: HOUR_NAMES[hour], tail: " o'clock" }
      : { lead: `${MINUTE_NAMES[away].said} ${to ? 'to' : 'past'} `, hour: HOUR_NAMES[hour], tail: '' }
  return { cells, extra: at.getMinutes() % 5, phrase }
}

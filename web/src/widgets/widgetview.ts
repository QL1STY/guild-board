import { dayMonth, duration, localDay, localTime, MONTHS, num, weekday, WEEKDAYS } from '../format.ts'
import { dayOf, isCertain, percent, resultWords } from '../pages/pullsview.ts'
import { resinBar, spareLine, type Segment, tickBody } from '../pages/characters/weekview.ts'
import { EMPTY_WEEK } from '../pages/characters/words.ts'
import { readyTime, timeLeft } from '../pages/timersview.ts'
import type { BoardModel, HistoryRow, Pulls, QuickTimer, Timer, Week, WeekTask } from '../types.ts'
import type { SignName } from '../ui/Sign.tsx'

/** The servers' names, as Settings and the Clock widget say them. */
export const SERVER_NAMES: ReadonlyMap<string, string> = new Map([
  ['os_euro', 'Europe'],
  ['os_usa', 'America'],
  ['os_asia', 'Asia'],
  ['os_cht', 'TW, HK, MO'],
  ['cn_gf01', 'China'],
  ['cn_qd01', 'China'],
])

const two = (value: number) => String(value).padStart(2, '0')
const DAY_MS = 86_400_000

/** "21:42", or "21:42:05" with seconds, in this PC's time. */
export function clockText(at: Date, seconds: boolean): string {
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`
  return seconds ? `${time}:${two(at.getSeconds())}` : time
}

/** The server's time, at its fixed offset from UTC (gameday.py): Europe's is UTC+1 all year. */
export function serverClock(now: Date, offsetHours: number, seconds: boolean): string {
  const at = new Date(now.getTime() + offsetHours * 3_600_000)
  const time = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}`
  return seconds ? `${time}:${two(at.getUTCSeconds())}` : time
}

/** "Tue 13 Oct" */
export function dayLine(at: Date): string {
  return `${WEEKDAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`
}

/** Midnight of the day `at` falls on, in this PC's time. */
function dayStart(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate())
}

/**
 * When something is full or ready, as short as it can be (look pass spec 9.6): the time of day when it comes within a
 * day, which reads as the next such time, and with its weekday from a day on, when the time of day alone would read as
 * an earlier one. In this PC's time; `now` is the core's.
 */
export function nearTime(at: string, now: Date): string {
  return Date.parse(at) - now.getTime() < DAY_MS ? clockText(new Date(at), false) : readyTime(at, now)
}

/**
 * How far the period that ends at the next reset has gone, from 0 at its start to 1 at its end (look pass spec 9.9).
 * The resets are exact: the game day runs from one 04:00 server time to the next, the week from one Monday 04:00 to the
 * next, so the start is `periodMs` before `nextAt`. A period or a time that is not known has gone nowhere.
 */
export function periodProgress(nextAt: string, periodMs: number, now: Date): number {
  const left = Date.parse(nextAt) - now.getTime()
  if (!(periodMs > 0) || Number.isNaN(left)) return 0
  return Math.min(1, Math.max(0, 1 - left / periodMs))
}

/** The share of the achievements ticked, in whole percent. It reads 100 only when every one is ticked. */
export function tickedPercent(done: number, stages: number): number {
  if (!(stages > 0)) return 0
  if (done >= stages) return 100
  return Math.min(99, Math.round((done / stages) * 100))
}

/**
 * When HoYoLAB's data was read (spec 13.5): "Read at 11:30" the same day, "Read Mon 23:10" within six days before,
 * else "Read 13 Oct, 23:10".
 */
export function readAt(at: string, now: Date): string {
  const then = new Date(at)
  const days = Math.round((dayStart(now).getTime() - dayStart(then).getTime()) / DAY_MS)
  if (days <= 0) return `Read at ${clockText(then, false)}`
  if (days <= 6) return `Read ${WEEKDAYS[then.getDay()]} ${clockText(then, false)}`
  return `Read ${localTime(at)}`
}

/** "1:05", "1:02:03" once there are hours, and "1:05.3" with tenths. */
export function stopwatchText(ms: number, tenths: boolean): string {
  const whole = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const seconds = two(whole % 60)
  const text = hours > 0 ? `${hours}:${two(minutes)}:${seconds}` : `${minutes}:${seconds}`
  return tenths ? `${text}.${Math.floor((Math.max(0, ms) % 1000) / 100)}` : text
}

/**
 * Each lap's own length, and which is the fastest (look pass spec 9.12). The stopwatch keeps its time at each lap, so a lap
 * is as long as the time since the lap before it, the first lap as its own time. The shortest is marked, the first of
 * them when several are as short. A lap that stands no later than the one before it cannot be, unless what is kept was
 * altered: it is no time long.
 */
export function lapSplits(laps: readonly number[]): { split: number; fastest: boolean }[] {
  const splits = laps.map((lap, index) => Math.max(0, lap - (index === 0 ? 0 : laps[index - 1])))
  const fastest = splits.indexOf(Math.min(...splits)) // the first of the shortest; -1 for no laps
  return splits.map((split, index) => ({ split, fastest: index === fastest }))
}

/** A lap as the Stopwatch widget draws it. */
export type LapRow = {
  /** The lap's place in the order they were taken, from 1. */
  number: number
  /** Its own length, and the time of the stopwatch when it was taken, in milliseconds. */
  split: number
  total: number
  /** Its length as a share of the longest lap's, from 0 to 1: the length of its bar. */
  share: number
  fastest: boolean
}

/**
 * The Stopwatch's laps as rows, in the order they were taken. A fastest lap is named only among several: a lone lap is
 * the fastest of nothing. With every lap no time long there is nothing to measure a bar against, so the bars are empty.
 */
export function lapRows(laps: readonly number[]): LapRow[] {
  const splits = lapSplits(laps)
  const longest = Math.max(0, ...splits.map((lap) => lap.split))
  return splits.map(({ split, fastest }, index) => ({
    number: index + 1,
    split,
    total: laps[index],
    share: longest > 0 ? split / longest : 0,
    fastest: fastest && splits.length > 1,
  }))
}

/** The game's session as the Playtime widget says it: whether the game is being played, and for how many minutes. */
export type PlaySession = { playing: boolean; minutes: number | null }

/**
 * The length of play the Playtime widget sets in large figures (look pass spec 9.10): the session so far while the game
 * runs, counted from when it began on the core's clock, and the last session's length when it does not, which the status
 * gives and which is null before the first. A running game that has no start time is not taken for a session.
 */
export function playSession(playtime: BoardModel['playtime'], lastMinutes: number | null, now: Date): PlaySession {
  if (playtime.running && playtime.session_started_at !== null) {
    return { playing: true, minutes: Math.max(0, (now.getTime() - Date.parse(playtime.session_started_at)) / 60_000) }
  }
  return { playing: false, minutes: lastMinutes }
}

/** A length of play as hours and minutes, rounded to the minute as `duration` is, for the figure that sets the units small. */
export function playFigure(minutes: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.round(minutes))
  return { hours: Math.floor(total / 60), minutes: total % 60 }
}

/** The columns are measured against an hour at least, so that a week of short sessions is not drawn as a long one. */
const PLAY_SCALE_FLOOR = 60

/** A column of the Playtime widget: a game day's play, as the widget draws it and says it. */
export type PlayColumn = {
  day: string
  /** What stands under the column: the weekday, and "Today" for the last. */
  label: string
  /** What the column says on hover and to a screen reader, as the playtime calendar's cells do: "Sat 10 Oct: 2 h 59 min". */
  tip: string
  /** The day's minutes as a share of the longest day's, from 0 to 1: the height of the column. */
  share: number
  /** A day with no play recorded. */
  none: boolean
  today: boolean
}

/** The Playtime widget's columns, one for each game day of the Board model's week, which ends with today. */
export function playColumns(week: BoardModel['playtime']['week']): PlayColumn[] {
  const top = Math.max(PLAY_SCALE_FLOOR, ...week.map((day) => day.minutes))
  return week.map(({ day, minutes }, index) => {
    const today = index === week.length - 1
    return {
      day,
      label: today ? 'Today' : weekday(day),
      tip: `${weekday(day)} ${dayMonth(day)}: ${minutes > 0 ? duration(minutes) : 'none recorded'}`,
      share: Math.min(1, Math.max(0, minutes) / top),
      none: !(minutes > 0),
      today,
    }
  })
}

/**
 * How much of its time a quick timer has run, from 0 to 1, from its start and ready times (the dial in its row); full
 * once the core says it is ready. Null where the times make no span to measure.
 */
export function quickProgress(quick: Pick<QuickTimer, 'started_at' | 'ready_at' | 'state'>, now: Date): number | null {
  if (quick.state === 'ready') return 1
  const started = Date.parse(quick.started_at)
  const span = Date.parse(quick.ready_at) - started
  if (!(span > 0)) return null
  return Math.min(1, Math.max(0, (now.getTime() - started) / span))
}

/** A quick timer's time left: "4:12", or "1:02:03" once there are hours. A part of a second still to wait counts. */
export function quickCountdown(seconds: number): string {
  return stopwatchText(Math.max(0, Math.ceil(seconds)) * 1000, false)
}

/** The quick timers one click starts (spec 13.3). */
export const QUICK_PRESETS: readonly { seconds: number; label: string }[] = [
  { seconds: 60, label: '1 min' },
  { seconds: 300, label: '5 min' },
  { seconds: 600, label: '10 min' },
  { seconds: 1800, label: '30 min' },
  { seconds: 3600, label: '1 h' },
]

/** What the Timers widget shows: all of them, the ready ones, or the ones chosen (spec 13.3). */
export type TimersSettings = { show: 'all' | 'ready' | 'chosen'; chosen: number[] }

/**
 * The timers in the Timers widget's order (look pass spec 9.1), kept by the settings: the ready ones first, then the
 * others in the order the core gives them, soonest first, the player's own among them, as the accepted mockup lists them.
 */
export function timersShown(timers: readonly Timer[], settings: TimersSettings): Timer[] {
  const ordered = [...timers.filter((timer) => timer.state === 'ready'), ...timers.filter((timer) => timer.state !== 'ready')]
  if (settings.show === 'ready') return ordered.filter((timer) => timer.state === 'ready')
  if (settings.show === 'chosen') return ordered.filter((timer) => settings.chosen.includes(timer.id))
  return ordered
}

/**
 * What the Timers widget's heading says (spec 9.1): "2 ready · 6 running" for the timers it shows, only the kinds there
 * are; none when it shows none. A timer that has done all its visits is neither.
 */
export function timersMeta(shown: readonly Timer[]): string | null {
  const ready = shown.filter((timer) => timer.state === 'ready').length
  const running = shown.filter((timer) => timer.state === 'running').length
  const parts: string[] = []
  if (ready > 0) parts.push(`${ready} ready`)
  if (running > 0) parts.push(`${running} running`)
  return parts.length === 0 ? null : parts.join(' · ')
}

/**
 * What the Commissions to look for widget's heading says (look pass spec 9.4): "3 to look for", the names it lists. None
 * when there are none: the sentence in its body says so.
 */
export function commissionsMeta(count: number): string | null {
  return count > 0 ? `${num(count)} to look for` : null
}

/**
 * The drawn sign of a timer that has no picture of the game's, or whose picture did not load (look pass spec 7.2): a
 * fishing spot's fish, a teapot field's teapot, the Unusual Hilichurl's mask, and the hourglass for every other, the
 * player's own included.
 */
export function timerSign(timer: Timer): SignName {
  if (timer.rule.kind === 'fishing') return 'fish'
  if (timer.preset?.startsWith('teapot.')) return 'teapot'
  if (timer.preset === 'hilichurl') return 'mask'
  return 'hourglass'
}

/**
 * A running timer's time left, first, and the clock time it comes back at (spec 9.1): "in 9 h 59 min" and "Thu 23:16",
 * in this PC's time on the core's clock. A time that has come reads "now" until the model is read again, as the state
 * line does. A timer that does not run, or whose time is not known, has none: a ready timer says since when
 * (readySince).
 */
export function timeLead(timer: Timer, now: Date): { lead: string; at: string } | null {
  if (timer.state !== 'running' || timer.ready_at === null) return null
  return { lead: timeLeft((Date.parse(timer.ready_at) - now.getTime()) / 1000), at: readyTime(timer.ready_at, now) }
}

/**
 * How long a ready timer has been ready, as "since Wed 09:40": the weekday and the time within the six days before now,
 * which the weekday alone names right, and the date from a week on, "since 6 Oct, 09:40". None where the time is not
 * known, as for a timer never cleared, and for a timer that is not ready.
 */
export function readySince(timer: Timer, now: Date): string | null {
  if (timer.state !== 'ready' || timer.ready_at === null) return null
  const days = Math.round((dayStart(now).getTime() - dayStart(new Date(timer.ready_at)).getTime()) / DAY_MS)
  return `since ${days <= 6 ? readyTime(timer.ready_at, now) : localTime(timer.ready_at)}`
}

/** The seconds still to wait for `at`; 0 when there is no time, or the time has come. */
function secondsUntil(at: string | null, now: Date): number {
  if (at === null) return 0
  const seconds = (Date.parse(at) - now.getTime()) / 1000
  return seconds > 0 ? seconds : 0
}

/** What the Daily notes widget shows (look pass spec 9.8): its four rows, as the notes were read. */
export type DailyNotesView = {
  /** Four commissions a day. A count read before the daily reset is yesterday's: it is not known, and 0 here. */
  commissions: { done: number; of: number; known: boolean }
  /** Three boss discounts a week. A count read before Monday's reset is last week's: not known, and 0 here. */
  discounts: { left: number; of: number; known: boolean }
  /** The realm currency now and at most, when it will be full as a time ("Sat 09:10"), and whether it is. */
  realm: { now: number; max: number; full: string | null; isFull: boolean }
  /** Not obtained, ready to use, or when it can be: "Sat 19:00" and how long that is, "in 2 d 6 h". */
  transformer: { state: 'none' } | { state: 'ready' } | { state: 'waiting'; at: string; left: string }
}

/**
 * The Daily notes widget's rows (spec 9.8 and 13.3): the commissions only as read since the daily reset, the boss
 * discounts only as read since the weekly one, the realm currency against its maximum with when it is full, and the
 * Parametric Transformer. Realm currency whose full time has come is full, as the count read is the one before it.
 */
export function dailyNotesView(notes: NonNullable<BoardModel['notes']>, now: Date): DailyNotesView {
  const read = notes.realm_currency
  const max = notes.realm_currency_max
  const fullAt = notes.realm_currency_full_at
  // No maximum is no judgement: notes without one are not full.
  const isFull = max > 0 && (read >= max || (fullAt !== null && Date.parse(fullAt) <= now.getTime()))
  let transformer: DailyNotesView['transformer'] = { state: 'none' }
  if (notes.transformer !== null) {
    const ready = notes.transformer.ready_at
    const wait = secondsUntil(ready, now)
    transformer = ready === null || wait === 0 ? { state: 'ready' } : { state: 'waiting', at: readyTime(ready, now), left: timeLeft(wait) }
  }
  return {
    commissions: { done: notes.read_today ? notes.commissions_done : 0, of: notes.commissions_max, known: notes.read_today },
    discounts: { left: notes.read_this_week ? notes.boss_discounts_left : 0, of: notes.boss_discounts_max, known: notes.read_this_week },
    // A time HoYoLAB did not give, in notes read before plan 2A-3, is left out.
    realm: { now: isFull ? Math.max(read, max) : read, max, full: isFull || fullAt === null ? null : readyTime(fullAt, now), isFull },
    transformer,
  }
}

/** An expedition sent: its character's picture, and whether it is back or when it will be and how long that is. */
export type SentExpedition = { icon: string | null; back: boolean; at: string | null; left: string | null }

/** A place for an expedition: one sent, or one that could still be sent. */
export type ExpeditionSlot = SentExpedition | { empty: true }

/**
 * The Expeditions widget's slots (look pass spec 9.7): one for each expedition sent, in the order HoYoLAB gives them,
 * then an empty one for each that could still be sent, up to the most there can be. An expedition with no time, or whose
 * time has come, is back; one out says when it returns, as a time of day within a day ("15:16"), and how long to wait
 * ("in 1 h 59 min"). Notes read before plan 2A-3 kept the expeditions have none.
 */
export function expeditionSlots(notes: NonNullable<BoardModel['notes']>, now: Date): ExpeditionSlot[] {
  if (notes.expeditions === null) return []
  const slots: ExpeditionSlot[] = notes.expeditions.map((expedition) => {
    const wait = secondsUntil(expedition.back_at, now)
    return expedition.back_at === null || wait === 0
      ? { icon: expedition.icon, back: true, at: null, left: null }
      : { icon: expedition.icon, back: false, at: nearTime(expedition.back_at, now), left: timeLeft(wait) }
  })
  for (let index = notes.expeditions.length; index < notes.expeditions_max; index += 1) slots.push({ empty: true })
  return slots
}

/** When the soonest expedition still out returns, as the slots say it ("15:16"); null when none is out. */
export function nextBack(notes: NonNullable<BoardModel['notes']>, now: Date): string | null {
  let soonest: string | null = null
  for (const { back_at: at } of notes.expeditions ?? []) {
    if (at === null || secondsUntil(at, now) === 0) continue
    if (soonest === null || Date.parse(at) < Date.parse(soonest)) soonest = at
  }
  return soonest === null ? null : nearTime(soonest, now)
}

// ---------------------------------------------------------------- the Pulls widgets (the Pulls plan, Task 12)

/** When a Savings widget's balance was set, for its heading: "set today", or "set 20 Oct". `now` is the core's time. */
export function savingsSet(set: NonNullable<Pulls['savings']['set']>, now: Date): string {
  return dayOf(new Date(set.set_at)) === dayOf(now) ? 'set today' : `set ${localDay(set.set_at)}`
}

/** The forecast in short, under the pulls: "86 by 3 Nov". */
export function forecastShort(forecast: Pulls['savings']['forecast']): string {
  return `${num(forecast.pulls)} by ${dayMonth(forecast.by)}`
}

/**
 * The Savings widget's second line (the second pass, spec 7): the card's total, the pulls by the next version's end,
 * "172 by 16 Dec". With no total, which is with no balance, today's line: the forecast by its day.
 */
export function savingsBy(savings: {
  by_next_end: number | null
  next: Pick<Pulls['savings']['next'], 'ends_on'>
  forecast: Pulls['savings']['forecast']
}): string {
  return savings.by_next_end === null
    ? forecastShort(savings.forecast)
    : `${num(savings.by_next_end)} by ${dayMonth(savings.next.ends_on)}`
}

/** The Luck widget's label under its figure: the first tile of the Pulls history counts the character event's 5★ alone. */
export const LUCK_WHAT = 'average 5★ pity, character event'

/** A wishlist entry in the Wishlist widget: "about 11 Nov, 74%", "about 11 Nov, certain", or its day alone for a 4★. */
export function wishShort(entry: Pulls['wishlist'][number]): string {
  const about = `about ${dayMonth(entry.about)}`
  if (entry.rank < 5) return about
  return `${about}, ${isCertain(entry) ? 'certain' : percent(entry.chance)}`
}

/** A face's title in Last pulls: "Skirk, pity 77"; the name alone for a 3★. */
export function faceTitle(row: HistoryRow): string {
  return row.pity === null ? row.name : `${row.name}, pity ${num(row.pity)}`
}

/**
 * The newest 5★, under the faces of Last pulls: the newest of the rows read, "Skirk at 77, won the 50/50", its count left
 * out where the history cannot tell it and how it fell where it has none to say; else, when the rows read hold none, the
 * newest of the cards' last 5★s, "Qiqi at 81", whose fall the cards do not say. Null with none.
 */
export function lastFive(model: Pick<Pulls, 'history' | 'pity'>): string | null {
  const row = model.history.rows.find((one) => one.rank === 5)
  if (row !== undefined) {
    const result = resultWords(row.result, row.pool)
    return `${row.name}${row.pity === null ? '' : ` at ${num(row.pity)}`}${result === '' ? '' : `, ${result}`}`
  }
  const fives = model.pity.flatMap((card) => (card.last_five === null ? [] : [card.last_five]))
  if (fives.length === 0) return null
  const newest = fives.reduce((last, five) => (Date.parse(five.at) > Date.parse(last.at) ? five : last))
  return `${newest.name}${newest.pity === null ? '' : ` at ${num(newest.pity)}`}`
}

/** The 50/50 record in short, won then lost: "1–1". */
export function fiftyRecord(history: Pulls['history']): string {
  return `${num(history.won)}–${num(history.lost)}`
}

// ----------------------------------------------------------------------------------------------------- The Today widget

/** One step of today in the widget: the week page's own task, with its cost said as the widget says it. */
export type TodayRow = { key: string; kind: WeekTask['kind']; title: string; why: string; who: string[]; cost: string; done: boolean; free: boolean }

export type TodayView = {
  rows: TodayRow[]
  /** The one line that stands where the rows would: no focus, or nothing to farm with resin today; null when there are rows. */
  line: string | null
  resin: string
  meta: string | null
  bar: Segment[]
}

/**
 * Today's steps from the week's model (its `today` part, which is the first day of the week page): those that cost resin
 * first, then those on the way, with how many are done for the heading. The words are the week page's.
 */
export function todayView(week: Week): TodayView {
  const day = week.today
  const spend = day.tasks.filter((task) => !task.free)
  const rows = [...spend, ...day.tasks.filter((task) => task.free)].map((task) => ({
    key: task.key,
    kind: task.kind,
    title: task.title,
    why: task.why,
    who: task.who,
    cost: task.free ? (task.kind === 'level' ? 'Ready' : 'No resin') : `${task.resin} resin`,
    done: task.done,
    free: task.free,
  }))
  const line = week.focus.length === 0 ? EMPTY_WEEK : rows.length === 0 ? spareLine(day, spend) : null
  const done = rows.filter((row) => row.done).length
  return {
    rows: week.focus.length === 0 ? [] : rows,
    line,
    resin: `${day.spent} of ${day.start} resin`,
    meta: rows.length === 0 || week.focus.length === 0 ? null : `${done} of ${rows.length} done`,
    bar: resinBar(day),
  }
}

/** What the widget draws at its size in cells: a face for each step from 4 wide, the reasons from 5, today's resin bar from 3 tall. */
export function todayLayout(size: { w: number; h: number }): { faces: boolean; why: boolean; bar: boolean } {
  return { faces: size.w >= 4, why: size.w >= 5, bar: size.h >= 3 }
}

/** The body of a tick in the widget: the week page's, for the same task of today. */
export function todayTick(week: Week, task: WeekTask, done: boolean): { day: string; task: string; done: boolean } {
  return tickBody(week.today, task, done)
}

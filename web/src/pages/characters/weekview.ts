import { MONTHS, num, weekday } from '../../format.ts'
import type { Week, WeekDay, WeekTask } from '../../types.ts'
import type { SignName } from '../../ui/Sign.tsx'
import { EMPTY_WEEK, NOTHING_YET } from './words.ts'

/*
 * Your week (the Characters plan, Task U5; the design's section 6.4), as pure functions of the core's `Week`. Days arrive as
 * calendar dates in the game's own day ("2026-10-25"); the page only does calendar sums on them (no clock), so the
 * weekly reset and the game day are still the core's.
 */

/** The resin a day gives back by itself; a day that starts with more has what carried over in it. */
const RESIN_PER_DAY = 180

// ----------------------------------------------------------------------------------------------------------------- dates

const parts = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return { year, month, date }
}

/** A day some days on, by calendar arithmetic in UTC: "2026-10-25" and 7 are "2026-11-01". */
export function addDays(day: string, count: number): string {
  const { year, month, date } = parts(day)
  const moved = new Date(Date.UTC(year, month - 1, date + count))
  const two = (n: number) => String(n).padStart(2, '0')
  return `${moved.getUTCFullYear()}-${two(moved.getUTCMonth() + 1)}-${two(moved.getUTCDate())}`
}

/** "Sun 25" */
export function shortDay(day: string): string {
  return `${weekday(day)} ${parts(day).date}`
}

/** "Wed 11 Nov" */
export function dateLabel(day: string): string {
  return `${shortDay(day)} ${MONTHS[parts(day).month - 1]}`
}

// ---------------------------------------------------------------------------------------------------------------- agenda

/**
 * The list behind "Add a character": the characters the player has first, then the rest (to pre-farm), each group by name,
 * narrowed by what was typed (any part of the name, in any case). The ones in the focus stay in the list, marked.
 */
export function pickRows(week: Week, query: string): Week['characters'] {
  const typed = query.trim().toLowerCase()
  return week.characters
    .filter((one) => typed === '' || one.name.toLowerCase().includes(typed))
    .sort((a, b) => Number(b.owned) - Number(a.owned) || a.name.localeCompare(b.name))
}

/** What the empty places of the page say, or null when there is a focus: the focus strip says one line, and so does the agenda; nothing else of the page shows without a focus. */
export function emptyLines(week: Week): { strip: string; agenda: string } | null {
  return week.focus.length === 0 ? { strip: EMPTY_WEEK, agenda: NOTHING_YET } : null
}

/** One day of the agenda: its head, its alert, its steps that cost resin and those on the way. */
export type Section = {
  day: string
  /** "Today," in front of the label on the first day, or null. */
  lead: string | null
  label: string
  sub: string
  resin: string
  note: string
  on: boolean
  alert: WeekDay['alert']
  steps: WeekTask[]
  free: WeekTask[]
  spare: string | null
  today: boolean
}

const count = (n: number, empty: string) => (n === 0 ? empty : String(n))

/** The line of a day in which nothing needs resin: the model's own, or the plan's plain sentence. */
export function spareLine(day: WeekDay, spend: WeekTask[]): string | null {
  if (day.spare !== null) return day.spare
  if (spend.length > 0 || day.tasks.some((task) => !task.free)) return null
  return `Nothing to farm with resin today: ${num(Math.max(0, day.start - day.spent))} resin carry over.`
}

/** The agenda's sections in order, today first; none while there is no focus, since the page says one line then. */
export function agendaSections(week: Week, selected = 0): Section[] {
  if (week.focus.length === 0) return []
  return week.days.map((day, index) => {
    const steps = day.tasks.filter((task) => !task.free)
    const free = day.tasks.filter((task) => task.free)
    return {
      day: day.day,
      lead: day.today ? 'Today,' : null,
      label: day.label,
      sub: `${count(steps.length, 'Nothing')} with resin, ${count(free.length, 'nothing')} on the way`,
      resin: `${day.spent} of ${day.start}`,
      note: day.today ? 'resin you have now' : day.start > RESIN_PER_DAY ? 'resin, with what carried over' : "resin, one day's worth",
      on: index === selected,
      alert: day.alert,
      steps,
      free,
      spare: spareLine(day, steps),
      today: day.today,
    }
  })
}

/** One segment of a day's resin bar: a step, wide as its resin, or what is left over. */
export type Segment = { key: string; who: string; resin: number; done: boolean; left: boolean; text: string }

export function resinBar(day: WeekDay): Segment[] {
  const segments: Segment[] = day.tasks
    .filter((task) => !task.free)
    .map((task) => ({ key: task.key, who: task.who[0], resin: task.resin, done: task.done, left: false, text: String(task.resin) }))
  const left = day.start - day.spent
  if (left > 0) segments.push({ key: `${day.day}:left`, who: '', resin: left, done: false, left: true, text: `${left} left` })
  return segments
}

/** Whether a step can be ticked: only on today (the core keeps today's task keys; the design's section 7.7). */
export function canTick(day: WeekDay): boolean {
  return day.today
}

/** The body of `PUT /api/week/ticks`. */
export function tickBody(day: WeekDay, task: WeekTask, done: boolean): { day: string; task: string; done: boolean } {
  return { day: day.day, task: task.key, done }
}

/** Whether a step is dimmed while the pointer is on a character: it is when it is not hers. */
export function dimmed(task: Pick<WeekTask, 'who'>, hot: string | null): boolean {
  return hot !== null && !task.who.includes(hot)
}

/** The focus after a card moved one place (-1 earlier, 1 later); the same order at either end. */
export function moveFocus(keys: readonly string[], index: number, delta: -1 | 1): string[] {
  const to = index + delta
  if (to < 0 || to >= keys.length) return [...keys]
  const next = [...keys]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

// ----------------------------------------------------------------------------------------------------------------- scroll

/** How far a section's top may be below the agenda's top and still be the one it is at, in pixels. */
const AT_TOP = 60
/** How far above a section the agenda stops when it opens a day, in pixels. */
const ABOVE = 20

/** The section the agenda is at: the last one whose top has come within 60 px of the agenda's top. */
export function sectionAt(tops: readonly number[], scrollTop: number): number {
  let at = 0
  tops.forEach((top, index) => {
    if (top <= scrollTop + AT_TOP) at = index
  })
  return at
}

/** Where the agenda scrolls to, to show a section whose top is at `top`. */
export function scrollTarget(top: number): number {
  return Math.max(0, top - ABOVE)
}

// ------------------------------------------------------------------------------------------------------------------ grid

export type DayHead = { day: string; short: string; note: string; fill: number; reset: boolean }

/** The grid's columns. The weekly reset is Monday 04:00, so the line before a Monday after today is the reset. */
export function dayHeads(week: Week): DayHead[] {
  return week.days.map((day, index) => {
    const monday = weekday(day.day) === 'Mon'
    return {
      day: day.day,
      short: shortDay(day.day),
      note: day.today ? 'Today' : monday ? 'Weekly reset' : '',
      fill: day.start > 0 ? (day.spent / day.start) * 100 : 0,
      reset: monday && index > 0,
    }
  })
}

/** What a task is called in a grid cell: "Books, 6 runs", "Boss, 3 runs", the weekly boss's name, "Artifacts, 7", "Pick 14", or "Ready". */
export function shortCell(task: Pick<WeekTask, 'kind' | 'title'>): string {
  const runs = /, (\d+ runs?)$/.exec(task.title)?.[1]
  switch (task.kind) {
    case 'books':
      return runs === undefined ? task.title : `Books, ${runs}`
    case 'boss':
      return runs === undefined ? task.title : `Boss, ${runs}`
    case 'weekly':
      return task.title.replace(/, weekly boss$/, '')
    case 'artifacts':
      return runs === undefined ? task.title : `Artifacts, ${parseInt(runs, 10)}`
    case 'flowers': {
      const picked = /^Pick (\d+)/.exec(task.title)?.[1]
      return picked === undefined ? task.title : `Pick ${picked}`
    }
    case 'level':
      return 'Ready'
    default:
      return task.title
  }
}

/** One thing in a grid cell: a task, short, with its resin, or the "Ready" chip of the day everything is in. */
export type CellItem = { task: WeekTask; label: string; sub: string; free: boolean; ready: boolean }

/** The cells of one character's row, a list for each day: her tasks of that day, in the day's order. */
export function cellsFor(week: Week, key: string): CellItem[][] {
  return week.days.map((day) =>
    day.tasks
      .filter((task) => task.who.includes(key))
      .map((task) => ({
        task,
        label: shortCell(task),
        sub: task.kind === 'level' ? '' : task.free ? 'no resin' : `${task.resin} resin`,
        free: task.free,
        ready: task.kind === 'level',
      })),
  )
}

// ------------------------------------------------------------------------------------------------------------------ side

/** The days the "when each is ready" chart spans. */
const GANTT_SPAN = 21
const place = (days: number) => Math.max(1.5, Math.min(100, (days / GANTT_SPAN) * 100))

export type GanttRow = {
  key: string
  /** The solid bar's width, in percent. */
  solid: number
  /** Whether a bar that fades out follows it: for luck, and for one that is not ready within the weeks. */
  fades: boolean
  fade: { left: number; width: number }
  /** The half-chance mark's place in percent, or null. */
  mark: number | null
  left: string
  right: { at: number; text: string } | null
}

export function ganttRows(week: Week): GanttRow[] {
  const today = week.days[0]?.day
  return week.ready.map((entry) => {
    const until = entry.until
    const solid = until === null ? 0 : place(until)
    if (entry.luck === null && until !== null) {
      return { key: entry.key, solid, fades: false, fade: { left: 0, width: 0 }, mark: null, left: entry.text, right: null }
    }
    if (entry.luck === null) {
      return { key: entry.key, solid: 0, fades: true, fade: { left: 0, width: 100 }, mark: null, left: entry.text, right: null }
    }
    const half = entry.luck.half
    const at = half === null ? GANTT_SPAN : half
    const talents =
      until === null || today === undefined ? '' : until === 0 ? 'Talents today' : `Talents ${dateLabel(addDays(today, until))}`
    const start = until === null ? 0 : place(until)
    return {
      key: entry.key,
      solid: start,
      fades: true,
      fade: { left: start + 1, width: 100 - start - 1 },
      mark: half !== null && half <= GANTT_SPAN ? place(half) : null,
      left: talents,
      right: { at: place(at), text: entry.luck.label },
    }
  })
}

/** The chart's axis: today and each seven days on. */
export function ganttAxis(week: Week): { at: number; text: string }[] {
  const today = week.days[0]?.day
  if (today === undefined) return []
  return [0, 7, 14, 21].map((days) => ({ at: (days / GANTT_SPAN) * 100, text: shortDay(addDays(today, days)) }))
}

export type SplitRow = { key: string; resin: number; share: number }

/** Where the week's resin goes: the most first, each bar as a share of the most, and the total of the week. */
export function splitRows(week: Week): { rows: SplitRow[]; total: string } {
  const top = Math.max(1, ...week.resin_by.map((row) => row.resin))
  const rows = [...week.resin_by].sort((a, b) => b.resin - a.resin).map((row) => ({ key: row.key, resin: row.resin, share: (row.resin / top) * 100 }))
  return { rows, total: `${num(week.resin_week)} of ${num(week.resin_week_max)}` }
}

const HOW_SIGNS: SignName[] = ['boss', 'book', 'flower', 'tick']

/** The plan's lines, each with its first clause apart (to put in bold) and a sign. */
export function howLines(lines: readonly string[]): { lead: string; rest: string; sign: SignName }[] {
  return lines.map((line, index) => {
    const lead = /^[^:,.]+/.exec(line)?.[0] ?? line
    return { lead, rest: line.slice(lead.length), sign: HOW_SIGNS[index % HOW_SIGNS.length] }
  })
}

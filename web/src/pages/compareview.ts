import type { TableData } from '../charts/ChartCard.tsx'
import { dayMonth, MONTHS, num, plural } from '../format.ts'
import type { CompareModel, StatKey } from '../onlinetypes.ts'
import { isStatKey, nameText } from './friendsview.ts'
import { field, figure, FULL_MONTHS, hoursText, isRecord, monthParts, monthsOf, priceLine, weeksOf } from './statvalues.ts'

/*
 * The words and sums of Compare (the online plan, Task B8; the online design, section 9, mockup 3), apart from its drawing:
 * the rows of each group with who leads and by how much, the score, and the two charts' columns, tooltips and tables. The
 * friend's stats come from another player's PC, so each figure is read through statvalues.ts: a row is left out where either
 * side has no figure for it, a group where no row is left, and nothing here throws.
 */

/** One side of a row: its figure, and as the page writes it. */
export type Side = { value: number; text: string }

export type Row = {
  id: string
  label: string
  me: Side
  friend: Side
  /** Who leads; null on a row with no better side, such as the money spent. */
  lead: 'me' | 'friend' | 'tied' | null
  /** The player's part of the bar, 0 to 1; null on a row with no bar. */
  share: number | null
  /** "You +1,720", "Riley +3 h", "Tied"; empty on a row with no leader. */
  verdict: string
  /** Who leads, "You" or the friend's name, and by how much, "1,720": the parts of the verdict, empty where there is none. */
  who: string
  by: string
}

export type Group = { key: StatKey; title: string; rows: Row[] }

/** How a figure is read, written, and told as a difference. */
type Format = { read: (value: number) => number; show: (value: number) => string; gap: (value: number) => string }

const tenth = (value: number) => Math.round(value * 10) / 10
const COUNT: Format = { read: Math.round, show: num, gap: num }
const HOURS: Format = { read: tenth, show: hoursText, gap: hoursText }
const ACTS: Format = { read: Math.round, show: (value) => `Act ${num(value)}`, gap: (value) => plural(value, 'act') }

/** One row, or null where either side has no figure. */
function row(
  id: string,
  label: string,
  mine: number | null,
  theirs: number | null,
  format: Format,
  name: string,
  leads = true,
): Row | null {
  if (mine === null || theirs === null) return null
  const a = format.read(mine)
  const b = format.read(theirs)
  const sides = { me: { value: a, text: format.show(a) }, friend: { value: b, text: format.show(b) } }
  if (!leads) return { id, label, ...sides, lead: null, share: null, verdict: '', who: '', by: '' }
  if (a === b) return { id, label, ...sides, lead: 'tied', share: 0.5, verdict: 'Tied', who: '', by: '' }
  const lead = a > b ? 'me' : 'friend'
  const by = format.gap(Math.abs(format.read(a - b)))
  const who = lead === 'me' ? 'You' : name
  return { id, label, ...sides, lead, share: a / (a + b), verdict: `${who} +${by}`, who, by }
}

const present = <T,>(rows: readonly (T | null)[]): T[] => rows.filter((one): one is T => one !== null)

/** The month before a month key: "2026-01" is "2025-12". */
function monthBefore(key: string): string | null {
  const parts = monthParts(key)
  if (parts === null) return null
  const [year, month] = parts.month === 1 ? [parts.year - 1, 12] : [parts.year, parts.month - 1]
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

const monthName = (key: string | null): string | null => {
  const parts = key === null ? null : monthParts(key)
  return parts === null ? null : FULL_MONTHS[parts.month - 1]
}

/** Primogems: now, and what came this month and last, the months matched by their names and not by their places. */
function primogemRows(mine: unknown, theirs: unknown, name: string): Row[] {
  const months = monthsOf(mine)
  const current = months.at(-1)?.month ?? null
  const previous = current === null ? null : monthBefore(current)
  const earned = (stat: unknown, key: string | null) => (key === null ? null : (monthsOf(stat).find((one) => one.month === key)?.earned ?? null))
  const rows = [row('primogems.now', 'Now', figure(mine, 'now'), figure(theirs, 'now'), COUNT, name)]
  const named = monthName(current)
  if (current !== null && named !== null) {
    rows.push(row('primogems.this-month', `Earned in ${named}`, earned(mine, current), earned(theirs, current), COUNT, name))
  }
  const before = monthName(previous)
  if (previous !== null && before !== null) {
    rows.push(row('primogems.last-month', `Earned in ${before}`, earned(mine, previous), earned(theirs, previous), COUNT, name))
  }
  return present(rows)
}

type Builder = (mine: unknown, theirs: unknown, name: string) => Row[]

const GROUPS: { key: StatKey; title: string; rows: Builder }[] = [
  { key: 'primogems', title: 'Primogems', rows: primogemRows },
  {
    key: 'playtime',
    title: 'Play time',
    rows: (m, t, name) =>
      present([
        row('playtime.week', 'This week', figure(m, 'week_hours'), figure(t, 'week_hours'), HOURS, name),
        row('playtime.days30', 'Last 30 days', figure(m, 'days30_hours'), figure(t, 'days30_hours'), HOURS, name),
        row('playtime.run', 'Longest run of days', figure(m, 'longest_run'), figure(t, 'longest_run'), COUNT, name),
      ]),
  },
  {
    key: 'endgame',
    title: 'Endgame',
    rows: (m, t, name) =>
      present([
        row('endgame.abyss', 'Spiral Abyss', figure(m, 'abyss_stars'), figure(t, 'abyss_stars'), COUNT, name),
        row('endgame.theater', 'Imaginarium Theater', figure(m, 'theater_act'), figure(t, 'theater_act'), ACTS, name),
        row('endgame.stygian', 'Stygian Onslaught', figure(m, 'stygian'), figure(t, 'stygian'), COUNT, name),
      ]),
  },
  {
    key: 'account',
    title: 'Account',
    rows: (m, t, name) =>
      present([
        row('account.days', 'Days active', figure(m, 'days_active'), figure(t, 'days_active'), COUNT, name),
        row('account.characters', 'Characters', figure(m, 'characters'), figure(t, 'characters'), COUNT, name),
        row('account.chests', 'Chests opened', figure(m, 'chests'), figure(t, 'chests'), COUNT, name),
      ]),
  },
  {
    key: 'achievements',
    title: 'Achievements',
    rows: (m, t, name) => present([row('achievements.ticked', 'Ticked', figure(m, 'ticked'), figure(t, 'ticked'), COUNT, name)]),
  },
  {
    key: 'wishes',
    title: 'Wishes',
    rows: (m, t, name) =>
      present([
        row('wishes.five-stars', 'Five-stars in 90 days', figure(m, 'five_stars_90d'), figure(t, 'five_stars_90d'), COUNT, name),
        // Neither side is better off with more pity: both are shown, and neither leads.
        row('wishes.pity', 'Pity on the character banner', figure(m, 'pity'), figure(t, 'pity'), COUNT, name, false),
      ]),
  },
  {
    key: 'spending',
    title: 'Spending',
    rows: (m, t, name) => {
      // Money in two currencies is not compared, and more spent is no lead.
      const [mine, theirs] = [field(m, 'currency'), field(t, 'currency')]
      if (typeof mine !== 'string' || typeof theirs !== 'string' || mine.toUpperCase() !== theirs.toUpperCase()) return []
      const money: Format = { read: Math.round, show: (value) => priceLine(value, mine) ?? '', gap: num }
      return present([row('spending.month', 'Spent this month', figure(m, 'month_total'), figure(t, 'month_total'), money, name, false)])
    },
  },
]

/**
 * The groups of rows, in the order of the mockup. A row is there only when the server names its key as one both of you share
 * and both sides have its figure; a group with no row is not there.
 */
export function groupsOf(model: Pick<CompareModel, 'keys' | 'mine' | 'friend'>): Group[] {
  const keys: readonly unknown[] = Array.isArray(model.keys) ? model.keys.filter(isStatKey) : []
  const name = nameText(model.friend?.name) || 'Your friend'
  const theirs = isRecord(model.friend?.stats) ? model.friend.stats : null
  return GROUPS.filter((group) => keys.includes(group.key))
    .map((group) => ({ key: group.key, title: group.title, rows: group.rows(field(model.mine, group.key), field(theirs, group.key), name) }))
    .filter((group) => group.rows.length > 0)
}

/** How many rows each side leads, and how many are tied: the score between the two heads. Rows with no leader do not count. */
export function scoreOf(groups: readonly Group[]): { me: number; friend: number; tied: number } {
  const all = groups.flatMap((group) => group.rows)
  return {
    me: all.filter((one) => one.lead === 'me').length,
    friend: all.filter((one) => one.lead === 'friend').length,
    tied: all.filter((one) => one.lead === 'tied').length,
  }
}

/** The small line under the score. */
export function scoreLine(score: ReturnType<typeof scoreOf>): string {
  return score.tied > 0 ? `stats where each of you leads, ${score.tied} tied` : 'stats where each of you leads'
}

/** One column group of a chart: the player's figure and the friend's, either of which may be unknown. */
export type Column = { label: string; title: string; me: number | null; friend: number | null }

const compared = (model: Pick<CompareModel, 'keys'>, key: StatKey): boolean => Array.isArray(model.keys) && model.keys.includes(key)

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** The days a run of weeks began on, oldest first, as "2026-10-12", the last being `last`. None for a day that cannot be read. */
function weekStarts(last: unknown, count: number): string[] {
  const found = typeof last === 'string' ? DAY.exec(last) : null
  if (found === null) return []
  const [year, month, date] = found.slice(1).map(Number)
  return Array.from({ length: count }, (_, at) =>
    new Date(Date.UTC(year, month - 1, date - 7 * (count - 1 - at))).toISOString().slice(0, 10),
  )
}

/**
 * Play time each week: a column for each of the last six weeks, named from the Monday the core says this week began on, which
 * follows the server's reset and not the page's clock. The two lists are matched from their ends. None where the two of you do
 * not share play time or no week is known.
 */
export function weekColumns(model: Pick<CompareModel, 'keys' | 'mine' | 'friend' | 'week_start'>): Column[] {
  if (!compared(model, 'playtime')) return []
  const mine = weeksOf(field(model.mine, 'playtime'))
  const theirs = weeksOf(field(model.friend?.stats, 'playtime'))
  const count = Math.max(mine.length, theirs.length)
  const fromEnd = (list: (number | null)[], back: number) => list[list.length - 1 - back] ?? null
  const columns = weekStarts(model.week_start, count).map((start, at) => ({
    label: dayMonth(start),
    title: `Week of ${dayMonth(start)}`,
    me: fromEnd(mine, count - 1 - at),
    friend: fromEnd(theirs, count - 1 - at),
  }))
  return columns.every((one) => one.me === null && one.friend === null) ? [] : columns
}

/** Primogems each month: a column for each of the last five months the player has, the friend's matched by month name. */
export function monthColumns(model: Pick<CompareModel, 'keys' | 'mine' | 'friend'>): Column[] {
  if (!compared(model, 'primogems')) return []
  const theirs = monthsOf(field(model.friend?.stats, 'primogems'))
  const columns = monthsOf(field(model.mine, 'primogems'))
    .slice(-5)
    .map((one) => {
      const parts = monthParts(one.month)
      return {
        label: parts === null ? one.month : MONTHS[parts.month - 1],
        title: parts === null ? one.month : `${FULL_MONTHS[parts.month - 1]} ${parts.year}`,
        me: one.earned,
        friend: theirs.find((other) => other.month === one.month)?.earned ?? null,
      }
    })
  return columns.every((one) => one.me === null && one.friend === null) ? [] : columns
}

/** What a column's tooltip says: its name, and each side's figure or that there is none. */
export function columnTip(
  column: Column,
  name: string,
  show: (value: number) => string,
): { title: string; lines: [string, string][] } {
  const say = (value: number | null) => (value === null ? 'no data' : show(value))
  return { title: column.title, lines: [['You', say(column.me)], [name, say(column.friend)]] }
}

const GAP = '–'

/** The weeks as a table, for Show as table. */
export function weeksTable(columns: readonly Column[], name: string): TableData {
  const say = (value: number | null) => (value === null ? GAP : hoursText(value))
  return { head: ['Week', 'You', name], rows: columns.map((one) => [one.title, say(one.me), say(one.friend)]), numeric: [1, 2] }
}

/** The months as a table, for Show as table. */
export function monthsTable(columns: readonly Column[], name: string): TableData {
  const say = (value: number | null) => (value === null ? GAP : num(value))
  return { head: ['Month', 'You', name], rows: columns.map((one) => [one.title, say(one.me), say(one.friend)]), numeric: [1, 2] }
}

/** A tick of the axis: thousands from a thousand up when they are whole ("4k"), else the figure with its comma. */
export function tickText(tick: number): string {
  return tick >= 1000 && tick % 1000 === 0 ? `${tick / 1000}k` : num(tick)
}

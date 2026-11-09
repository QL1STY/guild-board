import { num } from '../../format.ts'
import type { Ledger, LedgerEntry, LedgerKind } from '../../ledgertypes.ts'

/**
 * The Ledger's days (the Ledger revamp design, sections 4.2 and 4.6): the history grouped by game day and the commissions
 * month laid out as a calendar. Pure: no DOM, no clock; the page gives it today.
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** A calendar date "2026-10-27" as a UTC midnight: no time zone is involved. */
function utc(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date))
}

/** The date `count` days after (or before, when negative) a calendar date. */
export function addDays(day: string, count: number): string {
  const moved = utc(day)
  moved.setUTCDate(moved.getUTCDate() + count)
  return moved.toISOString().slice(0, 10)
}

/** "2026-10-20" as "Tuesday, 20 October". */
export function longDate(day: string): string {
  const date = utc(day)
  return `${WEEKDAY_NAMES[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`
}

/** The month of a calendar date written out: "October". */
export function monthTitle(day: string): string {
  return MONTH_NAMES[utc(day).getUTCMonth()]
}

/** A source's name in a row's second line and in the key: the sources' words of the design (4.2, 4.3). */
export const SOURCE_NAMES: Record<LedgerEntry['source'], string> = {
  welkin: 'Welkin Moon',
  commissions: 'Commissions',
  events: 'Events',
  endgame: 'Abyss and Theater',
  other: 'Chests and other',
  bought: 'Bought',
  shop: 'Shop',
  resin: 'Resin',
  // The other logs' own sources (the revamp design, section 6) are named by kind below; these stand for the rest.
  exchange: 'Exchange',
  domain: 'Domains',
  ley: 'Ley Lines',
  boss: 'Bosses',
  weekly: 'Weekly bosses',
  condensed: 'Condensed Resin',
  elsewhere: 'Elsewhere',
  fed: 'Fed to enhance',
  salvaged: 'Salvaged',
}

/** What a source is called in the log of a kind where it differs from `SOURCE_NAMES`: a crystal top-up is the shop's. */
const KIND_NAMES: Partial<Record<LedgerKind, Partial<Record<LedgerEntry['source'], string>>>> = {
  crystal: { bought: 'Shop', other: 'Other' },
  resin: { other: 'Other' },
  artifact: { other: 'Other' },
}

/** A round icon's drawing, one thin line per source (the Ledger revamp design, section 4.2 and 6), in a 23 by 23 box. */
export type IconName =
  | 'welkin' | 'commissions' | 'events' | 'endgame' | 'other' | 'shop'
  | 'gem' | 'swap' | 'dom' | 'ley' | 'boss' | 'week' | 'cond' | 'fed' | 'salv'

/** One row of the history: an entry, or several folded into one (then `folded` holds the entries). */
export type Row = {
  id: string
  title: string
  source: LedgerEntry['source']
  sourceLabel: string
  /** "20:15", the game's own server time; a folded row's is a span, "14:02–14:20". */
  time: string
  amount: number
  /** The wishes a Fate purchase or an exchange of crystals made (a whole number of 160s); null for any other row. */
  wishes: number | null
  folded?: LedgerEntry[]
  icon: IconName
  /** The row's second line: "Events · 20:15". */
  second: string
}

export type DayGroup = {
  day: string
  label: string
  net: number
  /** What the day's header says on the right: the primogems' net, the crystals' "+300 · −300". */
  summary: string
  rows: Row[]
}

/** The game's day an entry belongs to: its times are the server's, whose day turns over at 04:00 (the game's daily reset). */
function gameDay(time: string): string {
  const day = time.slice(0, 10)
  return time.slice(11, 13) < '04' ? addDays(day, -1) : day
}

const CHEST = /treasure chest/i

/** A signed amount with a true minus: "+60", "−1,600", "0" (the same as `signed` of the page's words, which this file cannot import without a cycle). */
function signed(amount: number): string {
  return amount === 0 ? '0' : amount > 0 ? `+${num(amount)}` : `−${num(-amount)}`
}

const RESIN_ICONS: Record<string, IconName> = { domain: 'dom', ley: 'ley', boss: 'boss', weekly: 'week', condensed: 'cond' }

function iconOf(entry: LedgerEntry, kind: LedgerKind): IconName {
  switch (kind) {
    case 'crystal':
      if (entry.source === 'bought') return /welkin/i.test(entry.title) ? 'welkin' : 'gem'
      return entry.source === 'exchange' ? 'swap' : entry.source === 'shop' ? 'shop' : 'other'
    case 'resin':
      return RESIN_ICONS[entry.source] ?? 'other'
    case 'artifact':
      return entry.source === 'domain' ? 'dom' : entry.source === 'fed' ? 'fed' : entry.source === 'salvaged' ? 'salv' : 'other'
    default:
      // The shop's bag for any primogems that went out (a Fate bought, a resin refill) or came in from crystals.
      return entry.amount < 0 || entry.source === 'bought' ? 'shop' : (entry.source as IconName)
  }
}

/** A span of two times of the game's day: "14:02–14:20"; one time when they are the same. The full times are ordered, since a game day runs past midnight. */
function span(entries: LedgerEntry[]): string {
  const times = entries.map((entry) => entry.time).sort()
  const first = times[0].slice(11, 16)
  const last = times[times.length - 1].slice(11, 16)
  return first === last ? first : `${first}–${last}`
}

/** Entries of a log that fold into one row: a run of the same resin spent in a row, a run of artifacts fed or salvaged. */
function sameRun(a: LedgerEntry, b: LedgerEntry, kind: LedgerKind): boolean {
  if (kind === 'resin') return a.title === b.title && a.source === b.source
  if (kind === 'artifact') return (a.source === 'fed' || a.source === 'salvaged') && a.source === b.source
  return false
}

/** The title of a row of several entries, or of one. */
function titleOf(group: LedgerEntry[], kind: LedgerKind): string {
  const first = group[0]
  if (kind === 'artifact') {
    if (first.source === 'fed' || first.source === 'salvaged') {
      const verb = first.source === 'fed' ? 'Fed' : 'Salvaged'
      if (group.length > 1) return `${verb} ${group.length} artifacts`
      return first.name === '' ? `${verb} an artifact` : `${verb} ${first.name}`
    }
    return first.name === '' ? first.title : first.name
  }
  return group.length > 1 ? `${first.title} ×${group.length}` : first.title
}

/** The second line: where it came from and when; an artifact's starts with its stars, a crystal top-up's with its pack. */
function secondOf(group: LedgerEntry[], kind: LedgerKind, time: string): string {
  const first = group[0]
  const label = KIND_NAMES[kind]?.[first.source] ?? SOURCE_NAMES[first.source]
  if (kind === 'artifact') {
    const where = first.source === 'domain' ? first.title : first.source === 'elsewhere' ? first.reason : label
    return `${first.rarity}★ · ${where} · ${time}`
  }
  if (kind === 'crystal' && first.detail !== '') return `${label} · ${first.detail} · ${time}`
  if (kind === 'primogem') {
    // A primogem spent for something other than Fates or resin is the shop's, whatever the game called it.
    const named = first.amount < 0 && first.source !== 'shop' && first.source !== 'resin' ? 'Shop' : label
    return `${named} · ${time}`
  }
  return `${label} · ${time}`
}

function rowOf(group: LedgerEntry[], kind: LedgerKind): Row {
  const first = group[0]
  const amount = group.reduce((sum, entry) => sum + entry.amount, 0)
  const time = group.length > 1 ? span(group) : first.time.slice(11, 16)
  const exchanged = kind === 'crystal' && first.source === 'exchange' && amount < 0 && Math.floor(-amount / 160) >= 1
  const fates = kind === 'primogem' && first.source === 'shop' && amount < 0 && -amount % 160 === 0
  return {
    id: group.length > 1 ? `run-${first.id}` : first.id,
    title: titleOf(group, kind),
    source: first.source,
    sourceLabel: KIND_NAMES[kind]?.[first.source] ?? SOURCE_NAMES[first.source],
    time,
    amount,
    wishes: fates ? -amount / 160 : exchanged ? Math.floor(-amount / 160) : null,
    ...(group.length > 1 ? { folded: group } : {}),
    icon: iconOf(first, kind),
    second: secondOf(group, kind, time),
  }
}

/** A day's two or more chests as one row, in the place the first of them held; the other entries one row each. */
function foldChests(entries: LedgerEntry[]): Row[] {
  const chests = entries.filter((entry) => CHEST.test(entry.title))
  if (chests.length < 2) return entries.map((entry) => rowOf([entry], 'primogem'))
  const folded: Row = {
    ...rowOf(chests, 'primogem'),
    id: `chests-${chests[0].id}`,
    title: `${chests.length} treasure chests`,
    source: 'other',
    sourceLabel: SOURCE_NAMES.other,
    icon: 'other',
    wishes: null,
  }
  const rows: Row[] = []
  let placed = false
  for (const entry of entries) {
    if (!CHEST.test(entry.title)) rows.push(rowOf([entry], 'primogem'))
    else if (!placed) {
      rows.push(folded)
      placed = true
    }
  }
  return rows
}

/** A day's entries as rows: the primogems fold the day's chests into one; the other logs fold a run of the same entry. */
function rowsOf(entries: LedgerEntry[], kind: LedgerKind): Row[] {
  if (kind === 'primogem') return foldChests(entries)
  const groups: LedgerEntry[][] = []
  for (const entry of entries) {
    const last = groups[groups.length - 1]
    if (last !== undefined && sameRun(last[0], entry, kind)) last.push(entry)
    else groups.push([entry])
  }
  return groups.map((group) => rowOf(group, kind))
}

/** "+300 · −300": what came in and what went out, a part left out when it is nothing. */
function inOut(entries: LedgerEntry[], count: boolean): string {
  const size = (entry: LedgerEntry) => (count ? 1 : Math.abs(entry.amount))
  const came = entries.filter((entry) => entry.amount > 0).reduce((sum, entry) => sum + size(entry), 0)
  const went = entries.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + size(entry), 0)
  const parts = [came > 0 ? `+${num(came)}` : '', went > 0 ? `−${num(went)}` : ''].filter((part) => part !== '')
  return parts.length === 0 ? '0' : parts.join(' · ')
}

/**
 * The history by game day, in the order the entries come (newest first) and each day's rows in it: "Today", "Yesterday",
 * then "Tuesday, 20 October", each with its summary. The primogems fold a day's treasure chests into one row; the resin folds a
 * run of the same domain, the artifacts a run of those fed or salvaged.
 */
export function groupByDay(entries: LedgerEntry[], today: string, kind: LedgerKind = 'primogem'): DayGroup[] {
  const byDay = new Map<string, LedgerEntry[]>()
  for (const entry of entries) {
    const day = gameDay(entry.time)
    const list = byDay.get(day)
    if (list === undefined) byDay.set(day, [entry])
    else list.push(entry)
  }
  const yesterday = addDays(today, -1)
  return [...byDay.entries()].map(([day, list]) => {
    const net = list.reduce((sum, entry) => sum + entry.amount, 0)
    return {
      day,
      label: day === today ? 'Today' : day === yesterday ? 'Yesterday' : longDate(day),
      net,
      summary: kind === 'primogem' || kind === 'resin' ? signed(net) : inOut(list, kind === 'artifact'),
      rows: rowsOf(list, kind),
    }
  })
}

/** The commissions month as a calendar, Monday first: `pad` empty cells before the 1st, then a cell a day. */
export function calendarCells(commissions: Ledger['commissions']): { pad: number; cells: { day: string; state: string; today: boolean }[] } {
  const { days } = commissions
  if (days.length === 0) return { pad: 0, cells: [] }
  const pad = (utc(days[0].day).getUTCDay() + 6) % 7
  // Today is the last day that has come: the core sends the days after it as "future".
  let today = -1
  days.forEach((cell, index) => {
    if (cell.state !== 'future') today = index
  })
  return { pad, cells: days.map((cell, index) => ({ day: cell.day, state: cell.state, today: index === today })) }
}

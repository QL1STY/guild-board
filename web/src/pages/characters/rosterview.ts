import { dayMonth } from '../../format.ts'
import type { Element, Roster, RosterEntry, WeaponType } from '../../types.ts'
import { FOUR_AT_MOST, NOT_YOURS } from './words.ts'

/**
 * What the roster's filters hold (the design's section 6.1): an element, a weapon type and a rarity (a player's ask after
 * the launch), owned only, and in focus only.
 */
export type Filters = { element: Element | null; weapon: WeaponType | null; rarity: 4 | 5 | null; owned: boolean; inFocus: boolean }

export const NO_FILTERS: Filters = { element: null, weapon: null, rarity: null, owned: false, inFocus: false }

/** The rarities a character has, the highest first. */
export const RARITIES = [5, 4] as const

/** How the grid is ordered: by readiness, level, rarity or name, or newest, which is the order the core lists them in. */
export type Sort = 'readiness' | 'level' | 'rarity' | 'name' | 'newest'

export const SORTS: readonly { value: Sort; label: string }[] = [
  { value: 'readiness', label: 'Readiness' },
  { value: 'level', label: 'Level' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'name', label: 'Name' },
  { value: 'newest', label: 'Newest' },
]

/**
 * The characters a search finds, in the order given. The search is words: every word must fit the character's name, her
 * element or her weapon type, in any case ("hydro catalyst", "lan", "polearm"). No words find everyone.
 */
export function searched(entries: readonly RosterEntry[], search: string): RosterEntry[] {
  const words = search.toLowerCase().split(/\s+/).filter((word) => word !== '')
  if (words.length === 0) return [...entries]
  return entries.filter((entry) => {
    const text = [entry.name, entry.element, entry.weapon].map((part) => part.toLowerCase())
    return words.every((word) => text.some((part) => part.includes(word)))
  })
}

/** The characters that pass the search and every filter, in the order given. */
export function visible(entries: readonly RosterEntry[], filters: Filters, search = ''): RosterEntry[] {
  return searched(entries, search).filter(
    (entry) =>
      (filters.element === null || entry.element === filters.element) &&
      (filters.weapon === null || entry.weapon === filters.weapon) &&
      (filters.rarity === null || entry.rarity === filters.rarity) &&
      (!filters.owned || entry.owned) &&
      (!filters.inFocus || entry.focus !== null),
  )
}

const byName = (a: RosterEntry, b: RosterEntry) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })

/**
 * The characters in the order chosen, a new list. Readiness, level and rarity put the most first, and a character the
 * player does not have last for readiness and level (she has neither), ties by name. Name is A to Z, and newest is the
 * core's own order, which lists the newest first. Reversed turns each round (the least first, Z to A, the oldest first),
 * and a character without readiness or level still goes last.
 */
export function sorted(entries: readonly RosterEntry[], sort: Sort, reversed = false): RosterEntry[] {
  const list = [...entries]
  if (sort === 'newest') return reversed ? list.reverse() : list
  if (sort === 'name') return list.sort((a, b) => (reversed ? byName(b, a) : byName(a, b)))
  const key = (entry: RosterEntry) => (sort === 'rarity' ? entry.rarity : sort === 'level' ? entry.level : entry.owned ? entry.readiness : null)
  const way = reversed ? -1 : 1
  return list.sort((a, b) => {
    const [first, second] = [key(a), key(b)]
    if (first === null || second === null) return (first === null ? 1 : 0) - (second === null ? 1 : 0) || byName(a, b)
    return way * (second - first) || byName(a, b)
  })
}

/** The characters before and after this one in an order of keys, or null past either end: the arrows stop there, they do not wrap. */
export function neighbours(order: readonly string[], key: string): { previous: string | null; next: string | null } {
  const at = order.indexOf(key)
  if (at < 0) return { previous: null, next: null }
  return { previous: order[at - 1] ?? null, next: order[at + 1] ?? null }
}

/** "15 of 16 owned" */
export function countLine(roster: Roster): string {
  return `${roster.owned} of ${roster.all} owned`
}

/** The characters in the focus, in the order the core numbered them (1 to 4). */
export function focusCards(roster: Roster): RosterEntry[] {
  return roster.entries
    .filter((entry) => entry.focus !== null)
    .sort((a, b) => (a.focus ?? 0) - (b.focus ?? 0))
}

/** The most characters the focus holds. */
export const FOCUS_MAX = 4

/**
 * The focus after a press on a character's toggle: she goes in after the others, or out leaving them in their order. A
 * fifth is refused, with the sentence the core gives too.
 */
export function toggleFocus(focus: readonly string[], key: string): { focus: string[] } | { refused: string } {
  if (focus.includes(key)) return { focus: focus.filter((one) => one !== key) }
  if (focus.length >= FOCUS_MAX) return { refused: FOUR_AT_MOST }
  return { focus: [...focus, key] }
}

/** "Level 90 · C2", or "Not yours yet". */
export function levelLine(entry: RosterEntry): string {
  if (!entry.owned || entry.level === null) return NOT_YOURS
  return `Level ${entry.level} · C${entry.constellation ?? 0}`
}

/** The date a banner's time falls on in the server's own time, which the core writes in the time: "2026-11-03". */
const dayOf = (instant: string) => dayMonth(instant.slice(0, 10))

/** "On the banner until 3 Nov" or "Banner 4 Nov to 24 Nov", by the days of server time; null where there is none. */
export function bannerLine(banner: RosterEntry['banner']): string | null {
  if (banner === null) return null
  return banner.running ? `On the banner until ${dayOf(banner.ends)}` : `Banner ${dayOf(banner.starts)} to ${dayOf(banner.ends)}`
}

import { duration, plural } from '../format.ts'
import type { PlanAddable, PlanIdle, PlanModel, PlanRow } from '../types.ts'

/*
 * The Plan page's words and arithmetic (the Plan design, section 4), apart from the page so that they are tested alone.
 * Weekdays count from Monday, 0, as the core gives them.
 */

export const DAY_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Said where a book's or a weapon material's days would be, while the wiki's entry for it is not read: never a guess. */
export const NOT_READ = 'Not read from the wiki yet'

export const dayName = (weekday: number): string => DAY_NAMES[weekday]

/** "12 November · 4 characters in the plan" */
export function summaryLine(plan: Pick<PlanModel, 'date' | 'count'>): string {
  const [, month, date] = plan.date.split('-').map(Number)
  const who = plan.count === 0 ? 'nobody in the plan yet' : `${plural(plan.count, 'character')} in the plan`
  return `${date} ${MONTH_NAMES[month - 1]} · ${who}`
}

/** "Domains change at 04:00 server time, in 13 h 20 min": `now` is the core's time (live.now()), not the browser's. */
export function turnsLine(turnsAt: string, now: Date): string {
  const minutes = Math.max(0, (new Date(turnsAt).getTime() - now.getTime()) / 60_000)
  return `Domains change at 04:00 server time, in ${duration(minutes)}`
}

/** "Book on Saturday · weapon on Tuesday", with what is not read yet said so. */
export function nextLine(idle: Pick<PlanIdle, 'book_next' | 'weapon_next'>): string {
  const { book_next: book, weapon_next: weapon } = idle
  if (book === null && weapon === null) return NOT_READ
  return `${book === null ? 'Book not read yet' : `Book on ${dayName(book)}`} · ${weapon === null ? 'weapon material not read yet' : `weapon on ${dayName(weapon)}`}`
}

/** The idle characters that have a day to name: one whose book and weapon material are both unread has nothing to say, and is left out. */
export function idleCards(plan: Pick<PlanModel, 'idle'>): PlanIdle[] {
  return plan.idle.filter((one) => one.book_next !== null || one.weapon_next !== null)
}

/**
 * What stands in the "Nothing open today" card when it has no character to show, or null when it has. Characters that are not read
 * from the wiki yet are not claimed to have nothing open: the card says how many are not read.
 */
export function idleEmpty(plan: Pick<PlanModel, 'idle'>): string | null {
  if (idleCards(plan).length > 0) return null
  const unread = plan.idle.length
  if (unread === 0) return 'Every planned character has something open today.'
  return `${plural(unread, 'planned character')} ${unread === 1 ? 'is' : 'are'} not read from the wiki yet.`
}

/** A weapon material's line in Today: the characters it is for, then their weapons. */
export function weaponSub(names: string, weapons: readonly string[]): string {
  return `${names} · ${weapons.join(', ')}`
}

/** A book or a weapon material in the cell of a day it is open. */
export type Tag = { kind: 'book' | 'weapon'; series: string; icon: string | null }

/** What is open for her on a day: her book, then her weapon's material, each where its days include the day. Sunday holds both. */
export function tagsOf(row: Pick<PlanRow, 'book' | 'material'>, day: number): Tag[] {
  const tags: Tag[] = []
  if (row.book !== null && row.book.days.includes(day)) tags.push({ kind: 'book', series: row.book.series, icon: row.book.icon })
  if (row.material !== null && row.material.days.includes(day)) tags.push({ kind: 'weapon', series: row.material.series, icon: row.material.icon })
  return tags
}

/** The weapon a row names, or that she has none to name. */
export function weaponLine(row: Pick<PlanRow, 'weapon'>): string {
  return row.weapon.name ?? 'No weapon yet'
}

/**
 * What a row cannot say yet: her book or her weapon's material is not read from the wiki. A character with no weapon has no
 * material to read, so that is not said of her. Null when nothing is missing.
 */
export function notReadNote(row: Pick<PlanRow, 'book' | 'material' | 'weapon'>): string | null {
  const book = row.book === null
  const material = row.material === null && row.weapon.name !== null
  if (book && material) return NOT_READ
  if (book) return 'Talent book not read from the wiki yet'
  return material ? 'Weapon material not read from the wiki yet' : null
}

/** "Reset on Monday at 04:00 · 2 of 3 discounted runs left"; without the second part while no Notes read gave the count. */
export function bossLine(plan: Pick<PlanModel, 'discounts_left'>): string {
  const reset = 'Reset on Monday at 04:00'
  return plan.discounts_left === null ? reset : `${reset} · ${plan.discounts_left} of 3 discounted runs left`
}

/** The planned list with a character added after the others (once). */
export function withKey(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? [...keys] : [...keys, key]
}

/** The planned list with a character taken off, the others in their order. */
export function withoutKey(keys: readonly string[], key: string): string[] {
  return keys.filter((one) => one !== key)
}

/** The characters that can be added whose name has the typed words in it, in any case. */
export function searchAddable(addable: readonly PlanAddable[], text: string): PlanAddable[] {
  const words = text.toLowerCase().split(/\s+/).filter((word) => word !== '')
  return addable.filter((one) => words.every((word) => one.name.toLowerCase().includes(word)))
}

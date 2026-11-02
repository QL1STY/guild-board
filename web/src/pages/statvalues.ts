import { num } from '../format.ts'
import { priceParts } from './ledgerview.ts'

/*
 * Reading the stats of the online pages (the online plan, Task B6, decision 3). What a friend shares comes from another
 * player's PC, and the server checks a stat only as a known key that holds an object: any value inside it can be missing or
 * of the wrong type. So the pages never read a stat with a dot. They ask these, which give a number only when there is one,
 * and the pages leave out what they cannot show and never throw.
 */

/** The largest figure the pages draw, so that one very large number from another PC cannot break a row or a tile. */
const LARGEST = 1_000_000_000
/** The weeks and months a stat holds (cloud/stats.py). */
const WEEKS = 6

export const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
]

/** A plain object: not null, not a list. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A figure the pages can show: a finite number from 0 up to a thousand million. Anything else is no figure. */
export function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= LARGEST ? value : null
}

/** What a stat holds under a name, when the stat is a plain object that has it itself. */
export function field(stat: unknown, name: string): unknown {
  return isRecord(stat) && Object.hasOwn(stat, name) ? stat[name] : undefined
}

/** A figure of a stat, or null. */
export function figure(stat: unknown, name: string): number | null {
  return count(field(stat, name))
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/

/** A month key such as "2026-10", read, or null for anything else. */
export function monthParts(key: unknown): { year: number; month: number } | null {
  const found = typeof key === 'string' ? MONTH_KEY.exec(key) : null
  return found === null ? null : { year: Number(found[1]), month: Number(found[2]) }
}

export type MonthValue = { month: string; earned: number | null }

/** The months of a primogems stat, in their order: the entries that name a month, each with its figure or none. */
export function monthsOf(stat: unknown): MonthValue[] {
  const months = field(stat, 'months')
  if (!Array.isArray(months)) return []
  const found: MonthValue[] = []
  for (const entry of months) {
    const month = field(entry, 'month')
    if (typeof month === 'string' && monthParts(month) !== null) found.push({ month, earned: figure(entry, 'earned') })
  }
  return found
}

/** The last six weeks of a play time stat, oldest first, each a figure or null where it is not known. */
export function weeksOf(stat: unknown): (number | null)[] {
  const weeks = field(stat, 'weeks')
  return Array.isArray(weeks) ? weeks.slice(-WEEKS).map(count) : []
}

/** Hours to the tenth, whole hours without a decimal, and without the unit: "18", "9.5", "1,234.5". */
export function hoursFigure(hours: number): string {
  return hours.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

/** Hours with their unit: "18 h", "9.5 h", "1,234.5 h". */
export function hoursText(hours: number): string {
  return `${hoursFigure(hours)} h`
}

const CODE = /^[A-Za-z]{3}$/

/**
 * A price's parts as the Ledger writes them, for the three currencies it knows, and by its code for any other that is three
 * letters. Null where the currency is anything else: a number without its currency says nothing.
 */
export function moneyText(amount: number, currency: unknown): { before: string; figure: string; after: string } | null {
  if (typeof currency !== 'string' || !CODE.test(currency)) return null
  const code = currency.toUpperCase()
  if (code === 'PLN' || code === 'EUR' || code === 'USD') return priceParts(amount, code)
  return { before: '', figure: num(amount), after: code }
}

/** A price on one line: "412 zł", "€450", "30 GBP". Null where there is no currency to put it in. */
export function priceLine(amount: number, currency: unknown): string | null {
  const price = moneyText(amount, currency)
  return price === null ? null : `${price.before}${price.figure}${price.after === '' ? '' : ` ${price.after}`}`
}

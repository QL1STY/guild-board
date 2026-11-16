import type { PrimogemsModel, SourceGroup } from '../types.ts'
import { readAt } from './widgetview.ts'

/*
 * The words and the measures of the Primogems widget (the widgets and Friends design, 2.2), apart from its drawing: which of
 * its four parts are on, its heading, the seven bars' heights and the month's segments.
 */

export type Part = 'savings' | 'pulls' | 'earned' | 'sources'
export type Parts = Record<Part, boolean>

/** The parts in the order they are drawn and switched. */
export const PART_NAMES: readonly Part[] = ['savings', 'pulls', 'earned', 'sources']

/** What a widget saved before the parts has: the Savings widget as it was, with Pulls' balance and its forecast. */
export const DEFAULT_PARTS: Parts = { savings: true, pulls: true, earned: false, sources: false }

/**
 * The parts that are on, from a widget's settings with the defaults under them. A setting that is not a true or false is
 * the default's; settings that turn every part off, which the switches never make, give the savings back.
 */
export function partsOf(settings: Record<string, unknown>): Parts {
  const parts = { ...DEFAULT_PARTS }
  for (const part of PART_NAMES) {
    const value = settings[part]
    if (typeof value === 'boolean') parts[part] = value
  }
  return PART_NAMES.some((part) => parts[part]) ? parts : { ...parts, savings: true }
}

/** The part whose switch cannot go off, because it is the last one on; null while two or more are. */
export function lockedPart(parts: Parts): Part | null {
  const on = PART_NAMES.filter((part) => parts[part])
  return on.length === 1 ? on[0] : null
}

/** The Ledger's model is read only for Earned and By source. */
export const wantsLedger = (parts: Parts): boolean => parts.earned || parts.sources

/** Pulls' model is read only for Savings and Pulls. */
export const wantsPulls = (parts: Parts): boolean => parts.savings || parts.pulls

/** "Savings" while Earned and By source are both off, which is the widget as it was; else none, so the type's name shows. */
export function titleOf(parts: Parts): string | undefined {
  return wantsLedger(parts) ? undefined : 'Savings'
}

/**
 * The heading's text at the right: "ledger read at 10:00" once Earned or By source is on and the Ledger was imported, else
 * when the balance was set ("set today", from the Pulls model), which is null with no balance. `ledger` is null while it reads.
 */
export function metaOf(
  parts: Parts,
  balance: string | null,
  ledger: Pick<PrimogemsModel, 'imported' | 'read_at'> | null,
  now: Date,
): string | null {
  if (wantsLedger(parts) && ledger !== null && ledger.imported && ledger.read_at !== null) {
    return `ledger r${readAt(ledger.read_at, now).slice(1)}`
  }
  return balance
}

/** The least height, in percent, of a bar of a day that earned something: a small day can be seen. */
const LEAST_BAR = 6

/** Each of the seven bars' height in percent of the best day, which is full; 0 for a day with nothing and for one not known. */
export function barHeights(days: readonly { earned: number; known: boolean }[]): number[] {
  const best = Math.max(0, ...days.filter((day) => day.known).map((day) => day.earned))
  return days.map((day) => {
    if (!day.known || day.earned <= 0 || best <= 0) return 0
    return Math.min(100, Math.max(LEAST_BAR, Math.round((day.earned / best) * 100)))
  })
}

/** Each source's segment of the one bar, as its share of the month in percent. */
export function segmentWidths(sources: readonly { amount: number }[], total: number): number[] {
  if (total <= 0) return sources.map(() => 0)
  return sources.map((source) => Math.round((source.amount / total) * 10_000) / 100)
}

const SHORT_NAMES: Record<SourceGroup, string> = {
  commissions: 'Commissions',
  welkin: 'Welkin',
  events: 'Events',
  endgame: 'Endgame',
  other: 'Other',
}

/** A source's name in the legend, shorter than the Ledger's. */
export function sourceName(group: SourceGroup): string {
  return SHORT_NAMES[group]
}

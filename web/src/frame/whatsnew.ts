import type { ChangeItem } from '../types.ts'

/** The word on an item's tag; an item of a plain line, from before kinds, has none. */
export function kindLabel(kind: ChangeItem['kind']): string | null {
  return kind === null ? null : kind.toUpperCase()
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
]

/** "2026-10-26" -> "Released 26 October 2026"; null for a day the core did not give or that is not one. */
export function releasedText(day: string | null): string | null {
  const found = day === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (found === null) return null
  const month = Number(found[2])
  if (month < 1 || month > 12) return null
  return `Released ${Number(found[3])} ${MONTHS[month - 1]} ${found[1]}`
}

/**
 * What the list of changes offers. Before an update it opens from the notice and has Later and Update now; after one it
 * opens by itself and has Got it alone. Escape and a click on the dim do the same as the button that only closes it.
 */
export type ListMode = 'before' | 'after'

export function buttonsOf(mode: ListMode): { close: string; install: string | null } {
  return mode === 'before' ? { close: 'Later', install: 'Update now' } : { close: 'Got it', install: null }
}

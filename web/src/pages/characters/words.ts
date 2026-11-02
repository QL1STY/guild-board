import { ago, plural } from '../../format.ts'
import type { CharSync } from '../../types.ts'

/**
 * The words of the Characters pages (plan call 2: they are kept here, apart from texts.ts). Messages the player sees are
 * plain, factual English, and a pronoun comes from the character's card, never from here.
 */

/** Said wherever a held amount would be, when HoYoLAB's calculator does not share what the player holds (Review Focus 1). */
export const CALCULATOR_OFF =
  "Calculator sync is off in HoYoLAB, so Guild Board can't see what you hold. Switch it on in HoYoLAB's Enhancement Progression Calculator, or type what you hold here."

/** A fifth character in the focus is refused with this, by the page before it asks and by the core after. */
export const FOUR_AT_MOST = 'Four at most: take one out first.'

/** The roster's heading (the design's section 6.1). */
export const ROSTER_HEADING = 'Characters'

/** Said in the week's agenda and in the focus strips while nobody is in the focus (Review Focus 5). */
export const EMPTY_WEEK = 'Choose up to four characters to plan for.'

/** Said in the focus strip for a place nobody holds yet. */
export const ROOM_FOR_ONE = 'Room for one more'

/** Said in the list behind "Add a character" when what was typed matches nobody. */
export const NO_MATCH = 'No character matches that.'

/** Said in the week's grid and its side while nobody is in the focus. */
export const NOTHING_YET = 'Nothing to show until you choose a character.'

/** A character the player does not have. */
export const NOT_YOURS = 'Not yours yet'

/** What the Refresh button and the lines beside it say, from the sync part of a model. */
export type SyncWords = { button: string; disabled: boolean; lines: string[] }

/** `now` is the core's time (live.now()), not the browser's. */
export function syncWords(sync: CharSync, now: Date): SyncWords {
  const lines: string[] = []
  if (sync.message !== null) lines.push(sync.message)
  if (sync.reading) {
    return { button: 'Reading…', disabled: true, lines: ['Reading your characters from HoYoLAB…'] }
  }
  if (sync.read_at !== null) lines.push(`Read from HoYoLAB ${ago(sync.read_at, now)}.`)
  else if (sync.message === null) lines.push('Not read from HoYoLAB yet.')
  if (!sync.can_refresh && sync.wait_minutes !== null) lines.push(`Try again in ${plural(sync.wait_minutes, 'minute')}.`)
  if (sync.calculator === 'off') lines.push(CALCULATOR_OFF)
  return { button: 'Refresh', disabled: !sync.can_refresh, lines }
}

import { ago, plural } from '../../format.ts'
import { ageLabel, type FreshView, ringFill } from '../../frame/freshview.ts'
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

/** What the core says when nobody is logged in to HoYoLAB (`characters/service.py` LOGIN_FIRST). */
export const LOGIN_FIRST = 'Log in to HoYoLAB to see your builds.'

/** What the ring says while the sync is blocked until the player acts (the plate's and the refusal's own sentences). */
const BLOCKED_TIPS = {
  login_needed: 'Log in to HoYoLAB so that Guild Board can read your account.',
  verification_needed: 'HoYoLAB asked for a verification check. Finish it from the sync panel first.',
  paused: 'Syncing is paused. Resume it in Settings.',
} as const

/** "6 hours", "an hour", "30 minutes": how often the core reads again by itself. */
function everyWords(minutes: number): string {
  if (minutes % 60 !== 0) return plural(minutes, 'minute')
  return minutes === 60 ? 'hour' : plural(minutes / 60, 'hour')
}

/** The first sentence of the tip: when HoYoLAB was last read. */
function readSentence(sync: CharSync, now: Date): string {
  return sync.read_at === null ? 'Not read from HoYoLAB yet.' : `Read from HoYoLAB ${ago(sync.read_at, now)}.`
}

/**
 * The freshness ring of the Characters pages, from the sync part of a model (freshness design, section 1). `now` is the
 * core's time (live.now()), not the browser's. `refusal` is what the core said to a press it would not take; it is the tip
 * until the next model.
 */
export function charactersFresh(sync: CharSync, now: Date, refusal: string | null): FreshView {
  const fill = ringFill(sync.read_at, sync.every_minutes, now)
  const age = ageLabel(sync.read_at, now)
  if (refusal !== null) return { tone: 'gold', fill, label: age, tip: refusal, turning: false }
  if (sync.reading) {
    return { tone: 'gold', fill, label: 'Reading…', tip: 'Reading your characters from HoYoLAB…', turning: true }
  }
  if (sync.message === LOGIN_FIRST) return { tone: 'amber', fill, label: 'Log in', tip: sync.message, turning: false }
  if (sync.blocked !== null) {
    // Nothing reads by itself while the sync waits for the player, so the tip says what is wrong and not that it reads again.
    const tip = `${readSentence(sync, now)} ${BLOCKED_TIPS[sync.blocked]}`
    if (sync.blocked === 'paused') return { tone: 'grey', fill, label: age, tip, turning: false }
    return { tone: 'amber', fill, label: sync.blocked === 'login_needed' ? 'Log in' : 'Check needed', tip, turning: false }
  }
  if (sync.calculator === 'off') {
    return { tone: 'amber', fill, label: 'Calculator off', tip: `${readSentence(sync, now)} ${CALCULATOR_OFF}`, turning: false }
  }
  const sentences: string[] = []
  if (sync.message !== null) sentences.push(sync.message)
  sentences.push(readSentence(sync, now))
  sentences.push(`Reads again by itself every ${everyWords(sync.every_minutes)}.`)
  if (!sync.can_refresh && sync.wait_minutes !== null) sentences.push(`Try again in ${plural(sync.wait_minutes, 'minute')}.`)
  return { tone: sync.read_at === null ? 'grey' : 'gold', fill, label: age, tip: sentences.join(' '), turning: false }
}

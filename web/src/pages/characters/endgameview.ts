import type { Element, Endgame, TeamView } from '../../types.ts'

/*
 * Endgame readiness (the Characters plan, Task U6; the design's section 6.5), as pure functions of the core's `Endgame`.
 * The teams, the cast and the readiness are the core's (E5); the page draws them and sends the player's Theater pick.
 */

/** A character counts as fielded from this readiness (the design's section 7.8). */
export const BUILT = 50

/** The model for the switch: "now" is `?after=0`, "after your plans" `?after=1`. */
export function endgamePath(after: boolean): string {
  return `/api/endgame?after=${after ? 1 : 0}`
}

const MODE_ORDER: readonly Endgame['modes'][number]['key'][] = ['abyss', 'theater', 'stygian']

/** One mode's card: its words, and the ring's whole percent, from 0 to 100. */
export type ModeCard = { key: Endgame['modes'][number]['key']; label: string; value: string; text: string; ring: number }

export function modeCards(endgame: Endgame): ModeCard[] {
  return MODE_ORDER.flatMap((key) => {
    const mode = endgame.modes.find((one) => one.key === key)
    if (mode === undefined) return []
    return [{ key, label: mode.label, value: mode.value, text: mode.text, ring: Math.max(0, Math.min(100, Math.round(mode.ready))) }]
  })
}

/** How a team member's face is drawn: the first is the one who deals the damage, and one who is not built is greyed. */
export function faceOf(member: Pick<TeamView['members'][number], 'ready'>, index: number): { dps: boolean; off: boolean } {
  return { dps: index === 0, off: member.ready < BUILT }
}

/** The team's own sentence about its weakest member, which the core writes; null when it has none. */
export function weakestLine(team: Pick<TeamView, 'note'>): string | null {
  return team.note === null || team.note === '' ? null : team.note
}

// ----------------------------------------------------------------------------------------------------------- Theater

/** The most elements a month's Theater lets in. */
const THEATER_ELEMENTS = 3

/**
 * The elements picked after a press on one: a picked one comes out (the last one stays), and a new one goes in after the
 * others, the one picked first making way for a fourth.
 */
export function theaterPick(picked: readonly Element[], element: Element): Element[] {
  if (picked.includes(element)) return picked.length > 1 ? picked.filter((one) => one !== element) : [...picked]
  const next = [...picked, element]
  return next.length > THEATER_ELEMENTS ? next.slice(next.length - THEATER_ELEMENTS) : next
}

/** The body of `PUT /api/endgame/theater`: three different elements, or null while there are not. */
export function theaterBody(picked: readonly Element[]): { elements: Element[] } | null {
  return picked.length === THEATER_ELEMENTS && new Set(picked).size === THEATER_ELEMENTS ? { elements: [...picked] } : null
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-10" is "October 2026". */
function monthLabel(month: string): string {
  const [year, number] = month.split('-').map(Number)
  return `${MONTH_NAMES[number - 1] ?? month} ${year}`
}

/** What the Theater's sheet says under its heading: whose elements these are, or that the calendar had none. */
export function theaterNote(theater: Endgame['theater']): string {
  if (theater.from_calendar) {
    return "Only three elements may enter each month. This month's come from HoYoLAB's calendar; pick others to see another month."
  }
  if (theater.elements.length === 0) return "This month's elements weren't in HoYoLAB's calendar. Pick them:"
  return `These are your picks for ${monthLabel(theater.month)}. Pick three others to see a different month.`
}

/** Whether the player's pick is what the Theater shows: a pick is kept, and the calendar's elements are not. */
export function pickKept(theater: Pick<Endgame['theater'], 'from_calendar' | 'elements'>): boolean {
  return !theater.from_calendar && theater.elements.length > 0
}

/** What the button that takes the pick away says: the way back to the calendar's elements, or, where it names none, that the pick goes. */
export function backLabel(theater: Pick<Endgame['theater'], 'calendar_elements'>): string {
  return theater.calendar_elements.length > 0 ? "Back to this month's elements" : 'Clear the pick'
}

export function closeShown(theater: Pick<Endgame['theater'], 'close'>): boolean {
  return theater.close.length > 0
}

/** "Anemo, 40% ready, 10 to go" */
export function closeLine(entry: Endgame['theater']['close'][number]): string {
  return `${entry.element}, ${entry.ready}% ready, ${entry.to_go} to go`
}

// ----------------------------------------------------------------------------------------------------- To clear everything

/**
 * What an action offers: the planner as a link, or adding to the focus (the key to add). The words need no pronoun, since
 * an action carries a character's name in its title and no pronouns.
 */
export function clearAction(action: Pick<Endgame['clear'][number], 'action' | 'target'>): { label: string; href: string | null; focus: string | null } {
  if (action.action === 'planner') return { label: 'Open the planner', href: `#/characters/${action.target}/plan`, focus: null }
  return { label: 'Add to your focus', href: null, focus: action.target }
}

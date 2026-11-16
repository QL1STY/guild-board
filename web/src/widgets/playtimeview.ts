import { MONTHS, num, plural } from '../format.ts'
import type { BoardModel } from '../types.ts'

/*
 * The Playtime widget's style and its total (the widgets polish mockup, section 3, and its notes): the quiet figures
 * beside the rest, or the total on a gold plate. The total is what Guild Board itself counted from the Windows process
 * list, and it says from when: it cannot know any play before that.
 */

export type PlayStyle = 'quiet' | 'plate'

export const PLAY_STYLES: readonly { id: PlayStyle; name: string; about: string }[] = [
  { id: 'quiet', name: 'Quiet figures', about: 'The total beside the session' },
  { id: 'plate', name: 'Gold plate', about: 'The total on a plate of its own' },
]

/** The style a Playtime widget is set to; the quiet figures for one saved with none, or with one this version does not know. */
export function playStyle(raw: Record<string, unknown>): PlayStyle {
  return PLAY_STYLES.find((one) => one.id === raw.style)?.id ?? 'quiet'
}

export type PlayTotal = {
  /** The figure: hours, or minutes under an hour. */
  value: string
  unit: 'h' | 'min'
  /** The day Guild Board began counting, in this PC's time: "3 Oct 2025". */
  since: string
  /** "412 h in all · counted since 3 Oct 2025" */
  line: string
  /** The same for a screen reader, in words. */
  spoken: string
}

/** The time in game that Guild Board counted, and from when; null before it counted any. */
export function playTotal(playtime: BoardModel['playtime']): PlayTotal | null {
  const minutes = playtime.total_minutes
  const counting = playtime.counting_since
  if (minutes === null || minutes === undefined || counting === null || counting === undefined || !(minutes > 0)) return null
  const at = new Date(counting)
  if (Number.isNaN(at.getTime())) return null
  const since = `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`
  const hours = Math.floor(minutes / 60)
  const [value, unit, words] = hours > 0 ? [num(hours), 'h' as const, plural(hours, 'hour')] : [num(minutes), 'min' as const, plural(minutes, 'minute')]
  return {
    value,
    unit,
    since,
    line: `${value} ${unit} in all · counted since ${since}`,
    spoken: `${words} in all, counted by Guild Board since ${since}`,
  }
}

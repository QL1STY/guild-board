import '../styles/widgets.css'
import '../styles/checkin.css'
import { COMMISSIONS, PINNED_ACHIEVEMENTS, PROGRESS } from './AchievementWidgets.tsx'
import { TODAY } from './CharactersWidgets.tsx'
import { CHECK_IN } from './CheckInWidget.tsx'
import { CLOCK } from './Clock.tsx'
import { NOTES } from './Notes.tsx'
import { DAILY_NOTES, EXPEDITIONS, RESIN } from './NotesWidgets.tsx'
import { LAST_PULLS, LUCK, PITY, SAVINGS, WISHING_NOW, WISHLIST } from './PullsWidgets.tsx'
import { QUICK_TIMER } from './QuickTimer.tsx'
import { STOPWATCH } from './Stopwatch.tsx'
import { ONE_TIMER, TIMERS } from './TimerWidgets.tsx'
import { PLAYTIME, RESETS } from './TimeWidgets.tsx'
import type { SizeRange, WidgetType } from './widget.ts'

/**
 * Every widget type this version knows, in the order of spec 13.3, which "Add a widget" lists; the Pulls widgets after
 * them (the Pulls plan, its call 14), the Characters' Today widget, and the daily check-in last.
 */
export const WIDGET_TYPES: readonly WidgetType[] = [
  TIMERS, ONE_TIMER, PINNED_ACHIEVEMENTS, COMMISSIONS, PROGRESS, RESIN, EXPEDITIONS, DAILY_NOTES, RESETS, PLAYTIME,
  QUICK_TIMER, STOPWATCH, CLOCK, NOTES, WISHING_NOW, PITY, SAVINGS, WISHLIST, LAST_PULLS, LUCK, TODAY, CHECK_IN,
]

/** A type by its id; a type a later version saved is not known here, and its widget is kept as it is. */
export function widgetType(id: string): WidgetType | undefined {
  return WIDGET_TYPES.find((type) => type.id === id)
}

/** The smallest and the largest size of a type by its id, or undefined for a type this version does not know. */
export function rangeOf(type: string): SizeRange | undefined {
  const found = widgetType(type)
  return found === undefined ? undefined : { min: found.min, max: found.max }
}

import { pageOf, type Page } from '../../route.ts'
import type { Status } from '../../types.ts'
import type { WidgetType } from '../../widgets/widget.ts'

/*
 * Your week and Endgame are built and kept, but hidden while the core says so (`characters.WEEK_AND_ENDGAME`, in
 * /api/status as `week_and_endgame`). While they are, the rail has no "Your week", the roster no Endgame tab, "Add a
 * widget" does not offer Today, a Today widget already on the Board or the overlay is left off them (Edit shows it, so that it
 * can be taken off), the Settings page has no switches for the week's three notices, and their addresses open the roster. The
 * status is not read yet: they are hidden.
 */

/** Whether Your week, Endgame and the Today widget are shown. */
export function weekShown(status: Status | null): boolean {
  return status?.week_and_endgame === true
}

/** The pages of the rail, without Your week while it is hidden. */
export function railPages<T extends Page>(pages: readonly T[], shown: boolean): T[] {
  return pages.filter((page) => shown || page !== 'week')
}

/** Where the address of Your week or the Endgame tab goes while they are hidden: the roster. Null for any other address. */
export function placeWhileHidden(hash: string): string | null {
  if (pageOf(hash) === 'week' || hash.split('?')[0].replace(/\/+$/, '') === '#/characters/endgame') return '#/characters'
  return null
}

/** The widget types "Add a widget" offers: those that need the week only while it is shown. */
export function offered(types: readonly WidgetType[], shown: boolean): WidgetType[] {
  return types.filter((type) => shown || type.needsWeek !== true)
}

/** Whether a widget saved on the Board or the overlay is left off while the week is hidden; Edit shows it, to be taken off. */
export function leftOff(type: WidgetType | undefined, shown: boolean, editing: boolean): boolean {
  return !shown && !editing && type?.needsWeek === true
}

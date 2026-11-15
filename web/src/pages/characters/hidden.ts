import type { Status } from '../../types.ts'

/*
 * The Endgame tab is built and kept, but hidden while the core says so (`characters.ENDGAME`, in /api/status as `endgame`); the planner's verdict has its own switch (`characters.VERDICT`, `verdict`).
 * While it is, the roster has no Endgame tab and its address opens the roster. The status is not read yet: it is hidden.
 */

/** Whether the Endgame tab is shown: it has its own switch (`characters.ENDGAME`), to be rebuilt. */
export function endgameShown(status: Status | null): boolean {
  return status?.endgame === true
}

/** Where the address of the Endgame tab goes while it is hidden: the roster. Null for any other address. */
export function placeWhileHidden(hash: string): string | null {
  return hash.split('?')[0].replace(/\/+$/, '') === '#/characters/endgame' ? '#/characters' : null
}

/** Whether the planner shows its verdict and her damage per talent: it has its own switch (`characters.VERDICT`, `verdict` in /api/status). */
export function verdictShown(status: Status | null): boolean {
  return status?.verdict === true
}

/*
 * The undo note's rules (top bar and undo design, section 6), pure: what it says for each outcome, and when Ctrl+Z
 * means undo. ui/note.tsx draws it and keeps its time.
 */

/** How long a note of a change stays when nothing holds it, in milliseconds. A refusal stays until it is closed. */
export const NOTE_MS = 8000

/** The one note: `done` is the dark note, `refused` the brown one; `undo` is its button's name, or null without one. */
export type Note = { id: number; tone: 'done' | 'refused'; text: string; undo: 'Undo' | 'Undo again' | null }

/** A change the core saved: its sentence, as the core words it, with Undo. */
export function changedNote(id: number, text: string): Note {
  return { id, tone: 'done', text, undo: 'Undo' }
}

/** An undo: what it undid, and Undo again while the core keeps earlier changes. */
export function undoneNote(id: number, undone: string, more: boolean): Note {
  return { id, tone: 'done', text: `Undone: ${undone}`, undo: more ? 'Undo again' : null }
}

/** An undo the core answered with "There is nothing to undo.": the sentence, without a button. */
export function nothingNote(id: number, message: string): Note {
  return { id, tone: 'done', text: message, undo: null }
}

/** A change or an undo the core refused: its sentence in brown, without a button. */
export function refusedNote(id: number, message: string): Note {
  return { id, tone: 'refused', text: message, undo: null }
}

/** What undoKeyApplies reads of a key press; a real KeyboardEvent has all of it. */
export type KeyLike = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  target: { tagName?: string; isContentEditable?: boolean; type?: string } | null
}

/** The kinds of input that are not typed into: Ctrl+Z there is not the field's own undo. */
const NOT_TYPED = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/**
 * Whether a key press is Ctrl+Z for the page (Cmd+Z counts as well): not with Shift or Alt, not in a text field, a text
 * area or anything editable, where the field's own undo applies, and not while `editing`, the Board's Edit, which has
 * no change to undo.
 */
export function undoKeyApplies(event: KeyLike, editing: boolean): boolean {
  if (editing) return false
  if (event.key.toLowerCase() !== 'z') return false
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false
  const target = event.target
  if (target === null) return true
  if (target.isContentEditable === true) return false
  const tag = target.tagName?.toUpperCase()
  if (tag === 'TEXTAREA') return false
  if (tag === 'INPUT' && !NOT_TYPED.has((target.type ?? 'text').toLowerCase())) return false
  return true
}

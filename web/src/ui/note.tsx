import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { handFocus } from './focus.ts'
import { type Note, NOTE_MS, undoKeyApplies } from './noteview.ts'
import { Sign } from './Sign.tsx'

/*
 * The undo note (top bar and undo design, section 6): the one note at the bottom centre of the page area that says what
 * the last change or undo did, with Undo. It replaces the undo line and the refusal line the Achievements page and the
 * Board had. The store is the module's, so that a page's changes (ui/changes.tsx) and the Frame's NoteHost need not
 * know each other.
 */

type Store = { note: Note | null; onUndo: (() => void) | undefined }

let store: Store = { note: null, onUndo: undefined }
let nextId = 1
const listeners = new Set<() => void>()

function publish(next: Store) {
  store = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Shows the note `make` makes, in place of any note there is, and restarts its time. `onUndo` is what its Undo button
 * does; a note without the button has none.
 */
export function showNote(make: (id: number) => Note, onUndo?: () => void): void {
  publish({ note: make(nextId++), onUndo })
}

/**
 * Closes the note. When the focus is inside it, the focus goes to the page's heading, the nearest place the page can
 * name that the note did not take the focus from.
 */
export function closeNote(): void {
  if (store.note === null) return
  const active = document.activeElement
  if (active instanceof Element && active.closest('.note') !== null) {
    const title = document.querySelector<HTMLElement>('.gb-title')
    if (title !== null) handFocus(title)
  }
  publish({ note: null, onUndo: undefined })
}

/** The modifiers and key of a key press (a spread of the event itself would carry none of its getters). */
function keyOf({ key, ctrlKey, metaKey, altKey, shiftKey }: KeyboardEvent) {
  return { key, ctrlKey, metaKey, altKey, shiftKey }
}

/**
 * Ctrl+Z (and Cmd+Z) undoes the last change, with the note open or not, except in a text field, where the field's own
 * undo applies (undoKeyApplies). `enabled` is false where there is nothing to undo, as in the Board's Edit.
 */
export function useUndoKey(undo: () => void, enabled: boolean): void {
  const latest = useRef(undo)
  latest.current = undo
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The target of a key press is an element when the key is pressed in the page.
      if (!undoKeyApplies({ ...keyOf(event), target: event.target as Element | null }, !enabled)) return
      event.preventDefault()
      if (!event.repeat) latest.current() // holding the keys is one undo, not a burst
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

/** How long a closed note stays drawn to leave, in milliseconds: --t-open, and a little more in case the browser is late. */
const LEAVE_MS = 400

/**
 * The note, in two live regions that are always on the page (one for a change, one for a refusal), so that each new
 * sentence is announced, as the old lines were. A note stays NOTE_MS, but not while the pointer or the keyboard focus
 * is on it; the time left resumes when they leave. A refusal stays until it is closed. Esc closes the note, unless an
 * open panel or sheet took the key first. The Frame holds it once.
 */
export function NoteHost() {
  const current = useSyncExternalStore(subscribe, () => store.note, () => null)
  const onUndo = useSyncExternalStore(subscribe, () => store.onUndo, () => undefined)
  // The note stays drawn for a moment after it closes, to leave.
  const [shown, setShown] = useState<Note | null>(current)
  if (current !== null && shown !== current) setShown(current)
  const leaving = current === null && shown !== null
  const [pointer, setPointer] = useState(false)
  const [focus, setFocus] = useState(false)
  const held = pointer || focus
  const left = useRef(NOTE_MS) // the time left, in milliseconds
  const lastId = useRef(0)
  useEffect(() => {
    if (current === null || current.tone === 'refused') return
    if (lastId.current !== current.id) {
      lastId.current = current.id
      left.current = NOTE_MS
    }
    if (held) return
    const started = performance.now()
    const timer = setTimeout(closeNote, left.current)
    return () => {
      clearTimeout(timer)
      left.current -= performance.now() - started
    }
  }, [current, held])
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => setShown(null), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leaving])
  // A note that has gone has neither the pointer nor the focus on it.
  useEffect(() => {
    if (current !== null) return
    setPointer(false)
    setFocus(false)
  }, [current])
  useEffect(() => {
    if (current === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      closeNote()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current])
  // Pressing Undo keeps the keyboard's place: when the button goes (nothing earlier is left), the sentence takes it.
  const pressed = useRef(false)
  const text = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (!pressed.current) return
    pressed.current = false
    if (button.current === null) text.current?.focus()
  }, [current])

  const draw = leaving ? shown : current
  const body =
    draw === null ? null : (
      <div
        className={leaving ? 'note out' : 'note in'}
        data-tone={draw.tone}
        data-held={held ? '' : undefined}
        data-testid="note"
        inert={leaving}
        onPointerEnter={() => setPointer(true)}
        onPointerLeave={() => setPointer(false)}
        // Only a focus the keyboard gave holds the time: the button a click leaves the focus on must not keep the note.
        onFocus={(event) => setFocus(event.target.matches(':focus-visible'))}
        onBlur={(event) => {
          if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setFocus(false)
        }}
      >
        <span className="note-mark"><Sign name={draw.tone === 'refused' ? 'warn' : 'tick'} /></span>
        <span ref={text} className="note-text" tabIndex={-1}>
          {draw.text}
        </span>
        {draw.undo !== null && (
          <>
            <button
              ref={button}
              type="button"
              className="note-undo"
              onClick={() => {
                pressed.current = true
                onUndo?.()
              }}
            >
              {draw.undo}
            </button>
            <kbd aria-hidden="true">Ctrl Z</kbd>
          </>
        )}
        <button type="button" className="note-x" aria-label="Close" onClick={closeNote}>
          ×
        </button>
        {draw.tone === 'done' && !leaving && (
          <i key={draw.id} className="note-life" style={{ animationDuration: `${NOTE_MS}ms` }} />
        )}
      </div>
    )
  return (
    <div className="note-host">
      <div role="status">
        {draw?.tone === 'done' && body}
      </div>
      <div role="alert">
        {draw?.tone === 'refused' && body}
      </div>
    </div>
  )
}

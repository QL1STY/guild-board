import { useCallback, useRef, useState } from 'react'
import { api, ApiError, messageOf } from '../api.ts'
import { showNote } from './note.tsx'
import { changedNote, nothingNote, refusedNote, undoneNote } from './noteview.ts'

/*
 * The changes a page sends that the undo history keeps (spec 7.2), and the note that names the last one with Undo
 * (ui/note.tsx): the Achievements page's and the Board's, which share one history.
 */

/** How a change is sent: by POST unless another method is named. */
export type ChangeMethod = 'POST' | 'PUT' | 'DELETE'

/**
 * Sends one change to the core in the page's order of changes; the note names it. It resolves to whether the change was
 * made, and the page says why when it was not.
 */
export type QueuedChange = (path: string, body?: unknown, method?: ChangeMethod) => Promise<boolean>

/**
 * Sends the page's changes one after another, in the order the player made them, so that an undo never overtakes the
 * change before it. The core tells the pages about each change it makes, and the page reads its model again then.
 *
 * What a change or an undo did shows in the note. A change shows its sentence with Undo. An undo shows what it undid,
 * with Undo again while the core keeps earlier changes. An undo that the core answers with "There is nothing to undo."
 * says so, without the button. Any other failure shows its sentence in the brown note, which stays until it is closed.
 * Only this visit's changes can be undone (the core starts its history empty), so a page that opens shows no note.
 *
 * The overlay's window has no note. There (`refusals: 'line'`) a change shows nothing when it is saved, and a refusal is
 * returned as `refusal`, for the overlay's own line, until the next change succeeds.
 */
export function useChanges({ refusals = 'note' }: { refusals?: 'note' | 'line' } = {}) {
  const [failures, setFailures] = useState(0)
  const [refusal, setRefusal] = useState<string | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  // Undo again is the same undo, so the note's button calls whichever one is current.
  const undoRef = useRef<() => void>(() => undefined)
  const run = useCallback((request: () => Promise<void>, undoing: boolean): Promise<boolean> => {
    const done = queue.current.then(request).then(
      () => true,
      (error: unknown) => {
        if (refusals === 'line') {
          setRefusal(messageOf(error))
        } else if (undoing && error instanceof ApiError && error.status === 409) {
          showNote((id) => nothingNote(id, error.message))
        } else {
          showNote((id) => refusedNote(id, messageOf(error)))
        }
        setFailures((count) => count + 1) // the model is read again: it may have changed meanwhile
        return false
      },
    )
    queue.current = done
    return done
  }, [refusals])
  // By POST, unless another method is named, as the timers' Edit and Remove are sent.
  const change = useCallback(
    (path: string, body?: unknown, method: ChangeMethod = 'POST') =>
      run(async () => {
        type Changed = { change: string }
        let sent: Changed
        if (method === 'DELETE') sent = await api.delete<Changed>(path)
        else if (method === 'PUT') sent = await api.put<Changed>(path, body)
        else sent = await api.post<Changed>(path, body)
        if (refusals === 'line') setRefusal(null)
        else showNote((id) => changedNote(id, sent.change), () => undoRef.current())
      }, false),
    [run, refusals],
  )
  const undo = useCallback(() => {
    void run(async () => {
      const { undone, more } = await api.post<{ undone: string; more: boolean }>('/api/achievements/undo')
      if (refusals === 'line') setRefusal(null)
      else showNote((id) => undoneNote(id, undone, more), more ? () => undoRef.current() : undefined)
    }, true)
  }, [run, refusals])
  undoRef.current = undo
  return { failures, refusal, change, undo }
}

/**
 * A change the core refused where the note is not used: the overlay's Edit and the Board's Edit (a refused Done), which
 * keep a line of their own. Always on the page, empty while nothing is refused, so that what is below moves neither when
 * a refusal shows nor when it goes. An alert that is there before its text arrives is also the one screen readers
 * announce most reliably.
 */
export function Refusal({ text }: { text: string | null }) {
  return (
    <p className="ach-refused" role="alert">
      {text}
    </p>
  )
}

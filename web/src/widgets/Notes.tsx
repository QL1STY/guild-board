import { useCallback, useEffect, useRef, useState } from 'react'
import type { Widget } from '../types.ts'
import { noteSave } from './notesave.ts'
import type { WidgetContext, WidgetType } from './widget.ts'
import { useWidgetData } from './widgetdata.ts'

const SAVE_AFTER_MS = 500
const MAX_CHARS = 10_000

type Note = { text: string }

function noteOf(data: unknown): Note {
  const text = (data as { text?: unknown } | null)?.text
  return { text: typeof text === 'string' ? text : '' }
}

/**
 * Free text, kept (spec 13.3), in a field that fills the body on lightly ruled paper (look pass spec 9.14), which is the
 * visual centre. It is saved half a second after typing stops, when the field is left, when the widget leaves the page, and
 * as the page hides, closes or reloads, with a request that outlives the page. Closing the window hides the page a moment
 * before it goes (dashboard.py), so what was typed last leaves then. A save the core did not keep stays pending (noteSave)
 * and goes again at the core's next event, when the field is left, and as the widget or the page goes.
 */
function NotesView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  const { data, problem, save } = useWidgetData(widget.id, noteOf, ctx.version)
  const [text, setText] = useState<string | null>(null)
  const [note] = useState(noteSave)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    // A note from another PC too, unless one is being typed or waits to go again.
    if (data !== null && note.pending() === null) setText(data.text)
  }, [data, note])
  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    const send = note.take()
    if (send === null) return
    void save({ text: send.text }).then((kept) => {
      if (!kept) note.failed(send)
    })
  }, [save, note])
  // At each of the core's events, as when Guild Board answers again after a restart.
  useEffect(() => {
    flush()
  }, [ctx.version, flush])
  useEffect(() => {
    const onHide = () => {
      window.clearTimeout(timer.current)
      const send = note.take()
      if (send === null) return
      // If the page stays, as when the window is only hidden, a send that failed goes again later, and one that was kept
      // ends the problem an earlier save left: it goes the way every save does.
      void save({ text: send.text }, { keepalive: true }).then((kept) => {
        if (!kept) note.failed(send)
      })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [flush, save, note])
  return (
    <div className="notes">
      <textarea
        className="notes-field"
        data-centre
        aria-label="Notes"
        maxLength={MAX_CHARS}
        value={text ?? ''}
        readOnly={text === null}
        onChange={(event) => {
          setText(event.target.value)
          note.typed(event.target.value)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(flush, SAVE_AFTER_MS)
        }}
        onBlur={flush}
      />
      {problem !== null && (
        <p className="wid-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}

export const NOTES: WidgetType = {
  id: 'notes',
  name: 'Notes',
  about: 'Your own notes, kept.',
  sign: 'quill',
  min: { w: 2, h: 1 },
  max: { w: 6, h: 6 },
  start: { w: 3, h: 3 },
  settings: {},
  View: NotesView,
}

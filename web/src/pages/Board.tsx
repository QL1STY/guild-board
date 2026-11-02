import { useRef } from 'react'
import '../styles/board.css'
import { Frame } from '../frame/Frame.tsx'
import type { Live } from '../live.ts'
import { Refusal } from '../ui/changes.tsx'
import { ArrangementGrid, HELP, useArrangement } from './Arrangement.tsx'

/**
 * The Board (spec 12.4 and 13), the page Guild Board opens on: the widgets the player chose, each at its place in a
 * grid of fixed cells over the window's whole width (look pass spec 10.2), listed in reading order for the keyboard and
 * screen readers. A widget whose place changes glides there. Its changes to progress and timers go through the same
 * undo history as the Achievements page's, and the note names the newest of them with Undo.
 *
 * Its arrangement and Edit are the Board's place (Arrangement.tsx): Edit works on a copy of the arrangement this window
 * shows, Done saves it and Cancel drops it.
 */
export function Board({ live }: { live: Live }) {
  const area = useRef<HTMLDivElement>(null)
  const arrangement = useArrangement('board', live, area)
  const { layout, current, widgets, columns, used, draft, startEdit, done, stopEdit, saving } = arrangement
  const controls =
    draft === null ? (
      <button type="button" className="gb-btn quiet" aria-disabled={current === null} onClick={startEdit}>
        Edit
      </button>
    ) : (
      <div className="board-edit">
        <button type="button" className="gb-btn quiet" {...arrangement.addToggle}>
          Add a widget
        </button>
        <button type="button" className="gb-btn" aria-disabled={saving} onClick={() => void done()}>
          Done
        </button>
        <button type="button" className="gb-btn quiet" onClick={stopEdit}>
          Cancel
        </button>
      </div>
    )
  return (
    <Frame page="board" live={live} wide controls={controls}>
      <div ref={area} className="board">
        {draft !== null && (
          <p id={arrangement.helpId} className="gb-note board-help">
            {HELP}
          </p>
        )}
        {/* A refused Done keeps its line in Edit's help area; a change the core refuses goes to the note. */}
        {(draft !== null || arrangement.refusal !== null) && <Refusal text={arrangement.refusal} />}
        {draft !== null && used > columns && (
          <p className="board-narrow">
            This window shows {columns} of the {used} columns your arrangement uses. The widgets beyond them show below,
            and Done saves the arrangement as you see it here.
          </p>
        )}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {arrangement.spoken}
        </p>
        {widgets === undefined ? (
          <div className="gb-panel gb-empty">{layout.error ?? 'Reading the Board…'}</div>
        ) : widgets.length === 0 && draft === null ? (
          <div className="gb-panel gb-empty">Nothing is on the Board. Edit adds widgets.</div>
        ) : (
          // The sheets, which only Edit opens, and the grid.
          <ArrangementGrid arrangement={arrangement} />
        )}
      </div>
    </Frame>
  )
}

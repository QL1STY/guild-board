import { useEffect, useRef } from 'react'
import '../styles/overlay.css'
import { type Live, useModel } from '../live.ts'
import type { OverlayStatus, Widget } from '../types.ts'
import { Refusal } from '../ui/changes.tsx'
import { Sign } from '../ui/Sign.tsx'
import { widgetType } from '../widgets/registry.ts'
import { type Arrangement, ArrangementGrid, HELP, useArrangement } from './Arrangement.tsx'
import { OverlayLines } from './OverlayLines.tsx'

/** The closed overlay's address, which Close and Escape set: the shell watches it and lets the clicks through again. */
const CLOSED = '#/overlay'
/** What the pin says when the pointer rests on it, in Edit and on a pinned widget's heading. */
const PIN_TIP = 'Shows over the game while the overlay is closed'

/** In Edit, a widget's button that pins it over the game, or unpins it, in Edit's copy of the layout. */
function PinTool({ widget, arrangement }: { widget: Widget; arrangement: Arrangement }) {
  const toggle = () =>
    arrangement.edit((all) => all.map((one) => (one.id === widget.id ? { ...one, pinned: one.pinned !== true } : one)))
  return (
    <button
      type="button"
      className="w-tool"
      aria-pressed={widget.pinned === true}
      aria-label={`Pin ${widgetType(widget.type)?.name ?? 'this widget'} over the game`}
      title={PIN_TIP}
      onClick={toggle}
    >
      <Sign name="pin" />
    </button>
  )
}

/** The pin sign after a pinned widget's name, while the overlay is open. */
function PinMark() {
  return (
    <span className="w-pinned" role="img" aria-label="Pinned over the game" title={PIN_TIP}>
      <Sign name="pin" />
    </span>
  )
}

/**
 * The overlay's page (plan 2A-4; stage 2A spec 14), which Guild Board's own see-through window shows over the game's
 * display: the overlay's own layout, in the Board's grid, drawn with the widgets' dark roles (.on-dark).
 *
 * Closed (`#/overlay`), it shows only the pinned widgets, while the settings show them, faded by the opacity setting,
 * and nothing of it takes a click. Open (`#/overlay/open`), a dim layer lies over the display, under every widget of
 * the layout and the bar at the top centre, with Edit as on the Board and a pin for each widget. Close sets the address
 * back to closed, and so does Escape, outside Edit and when nothing inside used the key. Closed during Edit, it shows
 * its saved layout and keeps Edit's copy, unsaved, until it opens again (call 5). Open or closed, it shows the lines
 * over the game while the settings have them (OverlayLines).
 */
export function Overlay({ live, open }: { live: Live; open: boolean }) {
  const area = useRef<HTMLDivElement>(null)
  // Edit only while open; its widgets kept on the display, its last row the display's.
  const arrangement = useArrangement('overlay', live, area, { editable: open, bounded: true })
  const status = useModel<OverlayStatus>('/api/overlay', live.version)
  const { current, editing, startEdit, done, stopEdit, saving } = arrangement
  useEffect(() => {
    if (!open || editing) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      window.location.hash = CLOSED
    }
    window.addEventListener('keydown', onKey) // bubbling: a sheet or a drag that takes the key has its say first
    return () => window.removeEventListener('keydown', onKey)
  }, [open, editing])
  const settings = live.settings
  if (settings === null) return null
  const hotkey = status.data?.hotkey ?? settings.overlay_hotkey
  const pinnedShown = (widget: Widget) => settings.overlay_pinned && widget.pinned === true
  return (
    <div className={open ? 'ov on-dark open' : 'ov on-dark'}>
      {open && <div className="ov-dim" aria-hidden="true" />}
      {/* The top centre: the bar while open, and the lines under it, below the bar's place while closed. */}
      <div className="ov-top">
        {open && (
          <section className="ov-bar" aria-label="Overlay">
            <h1 className="ov-title">Overlay</h1>
            {/* In Edit, Escape closes a sheet or a drag, never the overlay. */}
            {!editing && <p className="ov-hint">{hotkey} or Esc closes it.</p>}
            {editing ? (
              <div className="ov-buttons">
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
            ) : (
              <div className="ov-buttons">
                <button type="button" className="gb-btn quiet" aria-disabled={current === null} onClick={startEdit}>
                  Edit
                </button>
                <button type="button" className="gb-btn" onClick={() => (window.location.hash = CLOSED)}>
                  Close
                </button>
              </div>
            )}
            {editing && (
              <p id={arrangement.helpId} className="ov-help">
                {HELP}
              </p>
            )}
            <Refusal text={arrangement.refusal} />
          </section>
        )}
        {settings.overlay_lines && <OverlayLines lines={live.lines} />}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {arrangement.spoken}
      </p>
      <div ref={area} className="ov-area">
        <ArrangementGrid
          arrangement={arrangement}
          show={open ? undefined : pinnedShown}
          extraTools={(widget) => <PinTool widget={widget} arrangement={arrangement} />}
          headMark={open ? (widget) => (widget.pinned === true ? <PinMark /> : null) : undefined}
          opacity={open ? undefined : settings.overlay_opacity / 100}
        />
      </div>
    </div>
  )
}

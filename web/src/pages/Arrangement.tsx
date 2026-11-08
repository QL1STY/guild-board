import {
  type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject,
  useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import '../styles/board.css'
import { api, ApiError, messageOf } from '../api.ts'
import { type Live, useModel, useTick } from '../live.ts'
import type { BoardModel, Layout, Place, Widget } from '../types.ts'
import { useChanges } from '../ui/changes.tsx'
import { handFocus } from '../ui/focus.ts'
import { Glint } from '../ui/Glint.tsx'
import { glideFrom, reducedMotion, useGlide, useGlint } from '../ui/motion.tsx'
import { useUndoKey } from '../ui/note.tsx'
import { Sign } from '../ui/Sign.tsx'
import { leftOff, offered, weekShown } from './characters/hidden.ts'
import { rangeOf, WIDGET_TYPES, widgetType } from '../widgets/registry.ts'
import { type Head, HeadContext, type WidgetContext, type WidgetType } from '../widgets/widget.ts'
import { WidgetBoundary } from '../widgets/WidgetBoundary.tsx'
import {
  addWidget, type Arrow, arrange, columnsFor, columnsUsed, dropCell, freeCells, fromFull, type Grip, gridColumns, gripSize,
  moveTo, newWidgetId, pitchOf, type Placed, removeWidget, resizeTo, rowsFor, setSettings, sizeTag, stepWith, toFull,
  withPlaces,
} from './boardview.ts'

/*
 * A place's arrangement of widgets and its Edit, moved out of the Board (plan 2A-4) so that the overlay has them too:
 * useArrangement keeps the layout and Edit, and ArrangementGrid draws the grid and the sheets. The page around them
 * keeps its frame, its controls, the line of help (HELP, with the id each widget names as its description in Edit:
 * #board-help on the Board, #overlay-help on the overlay), the live region.
 */

/** Edit's line of help, which is also each widget's accessible description there (spec 10.4). */
export const HELP =
  'Drag a widget to move it, or its edge or corner to resize it. On a chosen widget, the arrow keys move it and Shift with the arrow keys resizes it.'

/** The play time of today and the resets move on with the clock, which no event announces. */
const MINUTE_MS = 60_000
/** How far the pointer goes with the button held before a press on a widget is a drag (spec 10.5). */
const DRAG_PX = 4
/** Within this many pixels of the window's top or bottom edge, a drag scrolls the page. */
const EDGE_PX = 40

const ARROWS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/** A widget's name in Edit: its type's, or "Not available" for a type this version does not know. */
const nameOf = (widget: Widget | undefined) => (widget === undefined ? '' : (widgetType(widget.type)?.name ?? 'Not available'))

/** Edit's changes to the copy of the layout, as the widgets and the sheets make them. */
type Editor = {
  /** An arrow key on a widget: it moves the widget a cell, and with Shift resizes it a cell (spec 10.7). */
  step: (id: string, key: Arrow, resize: boolean) => void
  /** A press of the pointer on a widget, which can begin a drag, or on one of its grips, a resize. */
  press: (id: string, event: ReactPointerEvent<HTMLElement>) => void
  remove: (id: string) => void
  openSettings: (id: string) => void
}

/**
 * A drag or a resize with the pointer in Edit (spec 10.5 and 10.6). Each step of it is worked out from the arrangement
 * at its start, so that going back puts every widget back, and Escape puts the start back.
 */
type Gesture = {
  id: string
  /** The grip of a resize, or null for a move. */
  grip: Grip | null
  /** The widget's frame, which has the pointer's capture. */
  element: HTMLElement
  /** The arrangement at the start, and now. */
  start: Placed[]
  placed: Placed[]
  /** A move has begun: the pointer went DRAG_PX with the button held. */
  lifted: boolean
  /** Ends it, keeping its arrangement or putting the start back. */
  end: (keep: boolean) => void
}

/** What the grid shows of a gesture: its widget, its arrangements and, for a resize, the size tag. */
type Shown = { id: string; grip: Grip | null; start: Placed[]; placed: Placed[]; tag: string | null }

/** Stops the glides of an element (useGlide's). */
function stopGlides(element: HTMLElement): void {
  for (const animation of element.getAnimations()) if (animation.id === 'glide') animation.cancel()
}

/**
 * Brings a widget that a keyboard step moved into view, at its new place. A glide still running from the step before
 * draws it away from there, a long way when the arrow key is held: its translation is set aside while the page measures
 * the widget (an important declaration outweighs an animation's), so that the page follows the place.
 */
function bringIntoView(element: HTMLElement): void {
  element.style.setProperty('transform', 'none', 'important')
  element.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
  element.style.removeProperty('transform')
}

/**
 * Escape in a sheet, or on the button that opened Add a widget, closes the sheet, and only it: the key is taken
 * (preventDefault), so that the page around leaves that press alone. Not while a word is being composed, where Escape
 * belongs to the input method, nor when a control inside the sheet used the key itself.
 */
function closesOnEscape(close: () => void) {
  return (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing) return
    event.preventDefault()
    close()
  }
}

/**
 * A widget's buttons in Edit, in its heading: those the page adds (`extra`), its Settings, for a type that has them,
 * and Remove (spec 10.4).
 */
function Tools({
  widget,
  type,
  editor,
  extra,
}: {
  widget: Widget
  type: WidgetType | undefined
  editor: Editor
  extra: ReactNode
}) {
  const name = type?.name ?? 'this widget'
  return (
    <span className="w-tools">
      {extra}
      {type?.Settings !== undefined && (
        <button
          type="button"
          className="w-tool"
          aria-label={`Settings of ${name}`}
          onClick={() => editor.openSettings(widget.id)}
        >
          <Sign name="gear" />
        </button>
      )}
      <button type="button" className="w-tool" aria-label={`Remove ${name}`} onClick={() => editor.remove(widget.id)}>
        <Sign name="cross" />
      </button>
    </span>
  )
}

/**
 * One widget, in the cells the arrangement gives it (spec 10.2): its place, and its saved size within its type's range
 * and the window's columns. Its frame is a stable element with the widget's id, which a later widget with a view of its
 * own, such as the map of 2B, can be placed over. It has a heading, of the type's sign and name and what its view puts
 * at the right (useHead), over a body that fits itself to the size (widgets.css). A type this version does not know
 * says so, and so does a widget that fails as it is drawn.
 *
 * In Edit its view takes no input, and the widget is a group that the keyboard moves and resizes, named by its size and
 * place and described by the line of help (spec 10.7); its heading holds its buttons instead of its meta. The pointer
 * drags it by any other part of it, and resizes it by its grips, whose size tag says the size it would take.
 *
 * The page can fade the whole frame (`opacity`), as the closed overlay fades its pinned widgets, and put a mark after
 * its name (`headMark`), as the open overlay marks a pinned widget.
 */
function WidgetFrame({
  widget,
  cells,
  ctx,
  editor,
  helpId,
  extraTools,
  headMark,
  opacity,
  glint,
  lifted,
  tag,
}: {
  widget: Widget
  /** Where it shows. */
  cells: Placed
  ctx: WidgetContext
  /** Set in Edit. */
  editor: Editor | null
  /** The id of the line of help, its description in Edit. */
  helpId: string
  /** The buttons the page adds to its heading in Edit, before its own. */
  extraTools: ((widget: Widget) => ReactNode) | undefined
  /** What the page puts after its name in its heading. */
  headMark: ((widget: Widget) => ReactNode) | undefined
  /** How opaque the whole frame is, from 0 to 1; fully when not given. */
  opacity: number | undefined
  /** It was just added: it glints once. */
  glint: boolean
  /** It is being dragged, and follows the pointer. */
  lifted: boolean
  /** It is being resized: the size it would take, as its tag says it. */
  tag: string | null
}) {
  const type = widgetType(widget.type)
  const [head, setHead] = useState<Head>({})
  const name = type?.name ?? 'Not available'
  const states = [editor === null ? '' : ' editing', glint ? ' glint' : '', lifted ? ' lifted' : '', tag === null ? '' : ' sizing']
  const className = `gb-panel w${states.join('')}`
  const style = { gridColumn: `${cells.x + 1} / span ${cells.w}`, gridRow: `${cells.y + 1} / span ${cells.h}`, opacity }
  const frame =
    editor === null
      ? { className, style, 'aria-label': name }
      : {
          className,
          style,
          role: 'group',
          tabIndex: 0,
          'aria-label': `${name}, ${cells.w} by ${cells.h}, column ${cells.x + 1}, row ${cells.y + 1}`,
          'aria-describedby': helpId,
          onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
            if (event.target !== event.currentTarget || !ARROWS.has(event.key)) return
            if (event.altKey || event.ctrlKey || event.metaKey) return
            event.preventDefault() // the page does not scroll
            editor.step(widget.id, event.key as Arrow, event.shiftKey)
          },
          onPointerDown: (event: ReactPointerEvent<HTMLElement>) => editor.press(widget.id, event),
        }
  const tools =
    editor === null ? null : <Tools widget={widget} type={type} editor={editor} extra={extraTools?.(widget)} />
  if (type === undefined) {
    return (
      <section data-widget={widget.id} {...frame}>
        {tools !== null && (
          <header className="w-head">
            <h3 className="w-name">Not available</h3>
            {headMark?.(widget)}
            {tools}
          </header>
        )}
        <div className="w-body w-scroll">
          <p className="w-unknown">Not available in this version.</p>
        </div>
      </section>
    )
  }
  const View = type.View
  return (
    <section data-widget={widget.id} {...frame}>
      <header className="w-head">
        <Sign name={type.sign} />
        <h3 className="w-name">{head.title ?? type.name}</h3>
        {headMark?.(widget)}
        {tools ??
          (!head.meta ? null : head.read === undefined ? (
            <span className="w-meta">{head.meta}</span>
          ) : (
            // What of the meta a read gives glints when a new read changes it (widget.ts, Head).
            <Glint className="w-meta" value={head.counted} read={head.read}>
              {head.meta}
            </Glint>
          ))}
      </header>
      <div className="w-body w-scroll" inert={editor !== null}>
        <HeadContext value={setHead}>
          <WidgetBoundary again={[ctx.version, ctx.board, widget]}>
            <View widget={widget} ctx={ctx} />
          </WidgetBoundary>
        </HeadContext>
      </div>
      {editor !== null && (
        // The grips are for the pointer; the keyboard resizes with Shift and the arrow keys.
        <>
          <span className="grip grip-e" data-grip="e" aria-hidden="true" />
          <span className="grip grip-s" data-grip="s" aria-hidden="true" />
          <span className="grip grip-se" data-grip="se" aria-hidden="true">
            <Sign name="grip" />
          </span>
        </>
      )}
      {tag !== null && (
        <span className="size-tag" aria-hidden="true">
          {tag}
        </span>
      )}
    </section>
  )
}

/**
 * The cells a place has (spec 10.2): as many columns as its width holds at 168 pixels and a 12-pixel gap each, kept as
 * the window changes, and for a place with a last row (`bounded`) as many rows of 96 pixels as its height holds: the
 * overlay keeps its widgets on its display, where the Board grows downward without end. A wider window shows more
 * columns, and on the Board the columns share what is left over, less than one more column, so that the last ends at
 * its right edge; the overlay's stay 168 pixels wide (gridColumns). `ref` is an element as wide as the place's grid, and
 * as tall as its room, that is there from the start, so the cells are known before the layout is read. A widget wider
 * than the columns shows as wide as they are (spec 8.2).
 */
function useCells(ref: RefObject<HTMLElement | null>, bounded: boolean): { columns: number; rows: number } {
  const [cells, setCells] = useState({ columns: 1, rows: Infinity })
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return undefined
    const read = () => {
      const columns = columnsFor(element.clientWidth)
      const rows = bounded ? rowsFor(element.clientHeight) : Infinity
      setCells((last) => (last.columns === columns && last.rows === rows ? last : { columns, rows }))
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, bounded])
  return cells
}

/**
 * Add a widget: every type this version knows, with its sign and a line on what it shows. It stays open for the next,
 * and Escape closes it.
 */
function AddSheet({ add, close, week }: { add: (type: WidgetType) => void; close: () => void; week: boolean }) {
  return (
    <section className="gb-panel board-sheet board-add" aria-label="Add a widget" onKeyDown={closesOnEscape(close)}>
      <ul className="board-types">
        {offered(WIDGET_TYPES, week).map((type) => (
          <li key={type.id}>
            <span className="board-type">
              <Sign name={type.sign} />
              <b>{type.name}</b> <span className="board-about">{type.about}</span>
            </span>
            <button type="button" className="ach-toggle" aria-label={`Add ${type.name}`} onClick={() => add(type)}>
              Add
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The arrangement of a place, the Board's or the overlay's (spec 12.4 and 13): its layout, read and saved at
 * /api/layouts/{place}, with the Board model its widgets draw with, in as many columns as `area` is wide (useCells).
 * The widgets' changes to progress and timers go through the same undo history as the Achievements page's; the note
 * (ui/note.tsx) names each. The page shows the refusal of Done, in Edit.
 *
 * Edit (spec 10.4) works on a copy of the arrangement this window shows, with the grid's free cells drawn: Done saves
 * every widget's place and size over the revision it was taken from, and Cancel drops it. A layout is no change to undo.
 * A save over a layout that changed meanwhile is refused; the place then shows the newer one.
 *
 * A page can set Edit aside (`editable` false), as the overlay does while it is closed: the place then shows its saved
 * layout, with nothing of Edit, and Edit's copy is kept unsaved until the page is editable again (plan 2A-4, call 5).
 * A place can have a last row (`bounded`), as many rows as `area` is tall: Edit's moves, resizes and free cells keep
 * within it, so that the overlay keeps its widgets on its display.
 */
export function useArrangement(
  place: Place,
  live: Live,
  area: RefObject<HTMLElement | null>,
  { editable = true, bounded = false }: { editable?: boolean; bounded?: boolean } = {},
) {
  const { failures, refusal, change, undo } = useChanges({ refusals: place === 'overlay' ? 'line' : 'note' })
  const [reads, setReads] = useState(0) // the layout is read again after a refused save
  const version = live.version + failures
  const minutes = useTick(MINUTE_MS)
  const layout = useModel<Layout>(`/api/layouts/${place}`, version + reads)
  const board = useModel<BoardModel>('/api/board', version + minutes)
  // Edit's copy, kept while Edit is set aside; Edit and everything it draws follow `draft`, which is the copy in Edit. It
  // is of the arrangement Edit began on, a window's or a maximized window's (`full`), whatever the window does meanwhile.
  const [kept, setDraft] = useState<{ revision: number; widgets: Widget[]; full: boolean } | null>(null)
  const draft = editable ? kept : null
  // Ctrl+Z on the Board only: not in its Edit, which works on a draft, and not over the game.
  useUndoKey(undo, place === 'board' && draft === null)
  const [saved, setSaved] = useState<Layout | null>(null) // Done's answer, until a read holds it
  const [sheet, setSheet] = useState<string | null>(null) // "add", or the id of the widget whose settings are open
  const sheetRef = useRef<HTMLElement>(null)
  const addButton = useRef<HTMLButtonElement>(null) // the page's Add a widget, which opens the sheet of that name
  // A widget's settings open over the grid, maybe far from the widget: they come into view, with the focus on them, as
  // they do again when Edit comes back with them open.
  useEffect(() => {
    if (!editable || sheet === null || sheet === 'add') return
    const element = sheetRef.current
    if (element === null) return
    element.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
    element.focus({ preventScroll: true })
  }, [sheet, editable])
  const [saving, setSaving] = useState(false)
  const [saveRefusal, setSaveRefusal] = useState<string | null>(null)
  // Edit's latest sentence, read out by the live region. Each one counts, so that the same sentence again is read again.
  const [said, setSaid] = useState({ text: '', count: 0 })
  const [added, setAdded] = useState<string | null>(null) // the widget Add put in the grid last
  const focusOn = useRef<string | null>(null) // the widget whose group takes the focus once the grid is drawn
  const stepped = useRef(false) // a keyboard step moved that widget: it comes into view as well
  const gesture = useRef<Gesture | null>(null) // a drag or a resize with the pointer, while it lasts
  const [shown, setShown] = useState<Shown | null>(null) // what the grid shows of it
  const letGo = useRef<{ element: HTMLElement; x: number; y: number } | null>(null) // a dragged widget's centre, let go
  const grid = useRef<HTMLDivElement>(null)
  const { columns, rows } = useCells(area, bounded) // rows: Infinity, but on a place with a last row
  const ctx: WidgetContext = { live, version, board: board.data, change }

  const current = saved !== null && (layout.data === null || saved.revision > layout.data.revision) ? saved : layout.data
  // The Board in a maximized window shows its arrangement for it (boardview.ts, toFull); the overlay has one alone.
  const full = draft?.full ?? (place === 'board' && live.status?.window_maximized === true)
  const viewed = useMemo(
    () => (current === null ? undefined : full ? toFull(current.widgets) : current.widgets),
    [current, full],
  )
  const widgets = draft?.widgets ?? viewed
  // A place with a last row shows a widget saved below it on the display (Task 14).
  const arranged = useMemo(
    () => (widgets === undefined ? [] : arrange(widgets, columns, rangeOf, rows)),
    [widgets, columns, rows],
  )
  // A gesture is Edit's: with Edit set aside the saved layout shows at once, not the copy a gesture still holds until it
  // ends (below), whose widgets the saved layout may not have.
  const showing = editable ? shown : null
  const placed = showing?.placed ?? arranged
  const byId = new Map(widgets?.map((widget) => [widget.id, widget]))
  // While a gesture lasts, the widgets keep the order of its start, as a frame moved among the others would lose the
  // pointer's capture; the widget being dragged keeps its cells too, and follows the pointer by a translation.
  const lifted = showing !== null && showing.grip === null ? showing.id : null
  const landing = placed.find((one) => one.id === lifted)
  const at = new Map(placed.map((one) => [one.id, one]))
  const drawn = (showing?.start ?? placed).map((one) => (one.id === lifted ? one : (at.get(one.id) ?? one)))
  // A widget that moves in the reading order is put elsewhere among the grid's elements, which can take the focus from
  // it: after a step, or a drag or a resize that is kept, its group has the focus again, and after Remove the next
  // widget's group. A keyboard step also brings its widget into view, wherever the step took it, whether or not its
  // element was put elsewhere. This runs before the glides begin (useGlide, below), so the widget is measured at its place.
  useLayoutEffect(() => {
    const id = focusOn.current
    const show = stepped.current
    focusOn.current = null
    stepped.current = false
    if (id === null) return
    const element = grid.current?.querySelector<HTMLElement>(`[data-widget="${CSS.escape(id)}"]`)
    if (!element) return
    if (show) {
      if (element !== document.activeElement) element.focus({ preventScroll: true })
      bringIntoView(element)
    } else if (element !== document.activeElement) {
      handFocus(element)
    }
  })
  // A widget let go is measured where it belongs, not where the pointer had it.
  useLayoutEffect(() => {
    if (letGo.current !== null) letGo.current.element.style.translate = ''
  })
  // Every place and size, and the columns: whatever moves a widget changes it, and a widget that moved glides.
  useGlide(grid, 'data-widget', `${columns}:${drawn.map(({ id, x, y, w, h }) => `${id} ${x} ${y} ${w} ${h}`).join()}`)
  // The widget being dragged follows the pointer and never glides. Let go, it glides from the pointer to its place.
  useLayoutEffect(() => {
    const held = gesture.current
    if (held !== null && held.lifted) stopGlides(held.element)
    const left = letGo.current
    if (left === null) return
    letGo.current = null
    stopGlides(left.element)
    const box = left.element.getBoundingClientRect()
    glideFrom(left.element, left.x - (box.left + box.width / 2), left.y - (box.top + box.height / 2))
  })
  // A gesture that outlasts the page ends with it.
  useEffect(() => () => gesture.current?.end(false), [])
  // Edit set aside ends a gesture that is still going, its start put back, before the place is drawn without Edit.
  useLayoutEffect(() => {
    if (!editable) gesture.current?.end(false)
  }, [editable])
  const glint = useGlint(added)
  useEffect(() => {
    // The widget Add put in the grid comes into view.
    if (added === null) return
    const element = grid.current?.querySelector(`[data-widget="${CSS.escape(added)}"]`)
    element?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [added])

  const edit = (next: (widgets: Widget[]) => Widget[]) =>
    setDraft((taken) => (taken === null ? taken : { ...taken, widgets: next(taken.widgets) }))
  const say = (text: string) => setSaid((last) => ({ text, count: last.count + 1 }))
  const editor: Editor | null =
    draft === null
      ? null
      : {
          step: (id, key, resize) => {
            const widget = byId.get(id)
            const named = (other: string) => nameOf(byId.get(other))
            const range = widget === undefined ? undefined : rangeOf(widget.type)
            const { placed: next, said: sentence } = stepWith(
              placed, id, key, resize, nameOf(widget), range, columns, named, rows,
            )
            edit((all) => withPlaces(all, next))
            focusOn.current = id
            stepped.current = true
            say(sentence)
          },
          press: (id, event) => {
            const target = event.target as Element
            if (event.button !== 0 || !event.isPrimary || gesture.current !== null) return
            if (target.closest('button') !== null) return // its own buttons
            const grip = (target.closest<HTMLElement>('[data-grip]')?.dataset.grip ?? null) as Grip | null
            const widget = byId.get(id)
            const range = widget === undefined ? undefined : rangeOf(widget.type)
            const start = arranged
            const from = start.find((one) => one.id === id)
            if (from === undefined || (grip !== null && range === undefined)) return
            const element = event.currentTarget
            const pointer = event.pointerId
            const pressed = { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY }
            // How far apart the cells are, as the grid draws them at each move: the Board's columns share its width, which
            // a scroll bar that comes or goes on the way changes.
            const pitch = () => pitchOf(place, grid.current!.getBoundingClientRect().width, columns)
            let client = { x: event.clientX, y: event.clientY }
            let shownFor = '' // the cell or the size last shown, so that the grid is drawn again only when it changes
            let frame = 0
            const g: Gesture = { id, grip, element, start, placed: start, lifted: false, end: () => undefined }
            // Where the pointer has taken the widget, from the start: worked out again as it moves or the page scrolls.
            const follow = () => {
              const dx = client.x + window.scrollX - pressed.x
              const dy = client.y + window.scrollY - pressed.y
              if (grip !== null) {
                if (range === undefined) return
                const asked = gripSize(from, grip, dx, dy, pitch())
                if (`${asked.w} ${asked.h}` === shownFor) return
                shownFor = `${asked.w} ${asked.h}`
                g.placed = resizeTo(start, id, asked, range, columns, rows)
                const size = g.placed.find((one) => one.id === id) ?? from
                setShown({ id, grip, start, placed: g.placed, tag: sizeTag(size, asked, range, grip) })
                return
              }
              if (!g.lifted && Math.hypot(dx, dy) < DRAG_PX) return // a click moves nothing
              const cell = dropCell(from, dx, dy, pitch()) // the grid is measured before the widget's translation is set
              g.lifted = true
              element.style.translate = `${dx}px ${dy}px`
              if (`${cell.x} ${cell.y}` === shownFor) return
              shownFor = `${cell.x} ${cell.y}`
              g.placed = moveTo(start, id, cell.x, cell.y, columns, rows)
              setShown({ id, grip, start, placed: g.placed, tag: null })
            }
            // Near the window's top or bottom edge the page scrolls, faster nearer the edge, and the widget goes along.
            const scrollStep = () => {
              if (client.y < EDGE_PX) return -Math.ceil((EDGE_PX - client.y) / 4)
              const below = client.y - (window.innerHeight - EDGE_PX)
              return below > 0 ? Math.ceil(below / 4) : 0
            }
            const scroll = () => {
              frame = 0
              const step = gesture.current === g && g.lifted ? scrollStep() : 0
              if (step === 0) return
              window.scrollBy(0, step)
              follow()
              frame = requestAnimationFrame(scroll)
            }
            const onMove = (move: PointerEvent) => {
              if (move.pointerId !== pointer) return
              client = { x: move.clientX, y: move.clientY }
              follow()
              if (g.lifted && frame === 0 && scrollStep() !== 0) frame = requestAnimationFrame(scroll)
            }
            const onUp = (up: PointerEvent) => {
              if (up.pointerId === pointer) g.end(true)
            }
            const onLost = () => g.end(false)
            const onKey = (key: KeyboardEvent) => {
              if (key.key !== 'Escape') return
              key.preventDefault()
              key.stopPropagation()
              g.end(false)
            }
            g.end = (keep) => {
              if (gesture.current !== g) return
              gesture.current = null
              cancelAnimationFrame(frame)
              element.removeEventListener('pointermove', onMove)
              element.removeEventListener('pointerup', onUp)
              element.removeEventListener('pointercancel', onLost)
              element.removeEventListener('lostpointercapture', onLost)
              window.removeEventListener('keydown', onKey, true)
              if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer)
              if (g.lifted) {
                const box = element.getBoundingClientRect()
                letGo.current = { element, x: box.left + box.width / 2, y: box.top + box.height / 2 }
              }
              if (keep && (g.lifted || grip !== null)) {
                edit((all) => withPlaces(all, g.placed))
                focusOn.current = id // wherever the reading order now puts it
              }
              setShown(null)
            }
            gesture.current = g
            element.setPointerCapture(pointer)
            element.addEventListener('pointermove', onMove)
            element.addEventListener('pointerup', onUp)
            element.addEventListener('pointercancel', onLost)
            element.addEventListener('lostpointercapture', onLost)
            window.addEventListener('keydown', onKey, true)
            if (grip !== null) follow() // the size tag shows from the press
          },
          remove: (id) => {
            const at = placed.findIndex((one) => one.id === id)
            focusOn.current = (placed[at + 1] ?? placed[at - 1])?.id ?? null
            edit((all) => removeWidget(all, id))
            setSheet((open) => (open === id ? null : open))
          },
          openSettings: (id) => setSheet(id),
        }
  const add = (type: WidgetType) => {
    const id = newWidgetId(type.id, Date.now(), Math.random())
    edit((all) => addWidget(all, type, id, placed, columns))
    setAdded(id)
  }
  const startEdit = () => {
    if (current === null || viewed === undefined) return
    // Edit works on the arrangement this window shows, every widget at its place there (spec 10.3): a widget saved
    // outside its type's range is within it (spec 8.2), a widget that goes leaves its room free, and one saved below a
    // last row is where the place shows it, so that Done saves that. In a maximized window, that is its arrangement.
    const shownPlaces = arrange(viewed, columns, rangeOf, rows)
    setDraft({ revision: current.revision, widgets: withPlaces(viewed, shownPlaces), full })
    setSaveRefusal(null)
  }
  const stopEdit = () => {
    setSaveRefusal(null)
    setDraft(null)
    setSheet(null)
    setSaid((last) => ({ text: '', count: last.count }))
  }
  // Escape in a sheet, or on Add a widget: the sheet closes, and the focus goes back to what opened it, Add a widget or
  // the widget whose settings these were.
  const closeSheet = () => {
    if (sheet === 'add') addButton.current?.focus()
    else if (sheet !== null) focusOn.current = sheet
    setSheet(null)
  }
  const done = async () => {
    if (draft === null || saving) return
    setSaving(true)
    try {
      const arranged = withPlaces(draft.widgets, placed)
      // A maximized window's arrangement is saved as each widget's `full`, beside its place in a window.
      const widgets = draft.full ? fromFull(arranged) : arranged
      setSaved(await api.put<Layout>(`/api/layouts/${place}`, { revision: draft.revision, widgets }))
      stopEdit()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // The layout changed meanwhile: the newer one shows, and the copy goes.
        stopEdit()
        setReads((count) => count + 1)
      }
      setSaveRefusal(messageOf(error)) // after stopEdit, which clears the line of an earlier refusal
    } finally {
      setSaving(false)
    }
  }

  return {
    place,
    /** The id of the page's line of help, which each widget names as its description in Edit. */
    helpId: `${place}-help`,
    /** The place's layout as read, and the Board model its widgets draw with. */
    layout,
    board,
    /** The layout shown: the newest of the one read and the one Done saved; null until there is one. */
    current,
    /** The widgets shown, Edit's copy's or the layout's; undefined until the layout is read. */
    widgets,
    ctx,
    columns,
    /** The Board shows its arrangement for a maximized window. */
    full,
    /** The place's last row, as a count of rows: Infinity, but on a place with a last row. */
    rows,
    /** The columns the layout shown uses, which can be more than the window has. */
    used: viewed === undefined ? 0 : columnsUsed(viewed),
    /** Each widget's cells, as the grid shows them while a gesture lasts. */
    placed,
    /** Edit's copy of the layout, which Done saves, and whether there is one. */
    draft,
    editing: draft !== null,
    startEdit,
    done,
    stopEdit,
    /** Done is saving. */
    saving,
    sheet,
    setSheet,
    closeSheet,
    /** The props of the page's Add a widget: it opens and closes the sheet, and Escape on it closes the sheet too. */
    addToggle: {
      ref: addButton,
      'aria-expanded': sheet === 'add',
      onClick: () => setSheet(sheet === 'add' ? null : 'add'),
      onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
        if (sheet === 'add') closesOnEscape(closeSheet)(event)
      },
    },
    add,
    /** Changes Edit's copy of the widgets. */
    edit,
    editor,
    /**
     * Edit's latest sentence, for the live region: every other one ends in a no-break space, so that the same sentence
     * said again is new text, and read again.
     */
    spoken: said.count % 2 === 1 ? `${said.text}\u00a0` : said.text,
    /**
     * The refusal of Done, which Edit shows on a line of its own. On the overlay, which has no note, a refused change
     * shows there too; on the Board it goes to the note.
     */
    refusal: saveRefusal ?? refusal,
    /** What ArrangementGrid draws with, which the page has no need of. */
    drawing: { grid, sheetRef, byId, drawn, landing, lifted, shown: showing, added, glint },
  }
}

/** A place's arrangement and its Edit (useArrangement). */
export type Arrangement = ReturnType<typeof useArrangement>

/**
 * An arrangement's grid of cells (spec 10.2), each widget at its place, listed in reading order for the keyboard and
 * screen readers; a widget whose place changes glides there. The Board's columns share its width, and the overlay's are
 * 168 pixels (gridColumns). In Edit it draws the grid's free cells and where a dragged widget will land, and above the
 * grid the sheets: Add a widget, and a widget's Settings, which Escape closes. Nothing is drawn until the layout is read.
 * The grid's test id is the place's name.
 *
 * `show` leaves out the widgets it refuses, `extraTools` gives each widget's heading more buttons in Edit, before its
 * own, `headMark` puts a mark after a widget's name, and `opacity` fades every frame: the closed overlay shows only its
 * pinned widgets, faded, and the open one marks them and pins in Edit (plan 2A-4).
 */
export function ArrangementGrid({
  arrangement,
  show,
  extraTools,
  headMark,
  opacity,
}: {
  arrangement: Arrangement
  show?: (widget: Widget) => boolean
  extraTools?: (widget: Widget) => ReactNode
  headMark?: (widget: Widget) => ReactNode
  opacity?: number
}) {
  const { place, helpId, widgets, draft, sheet, setSheet, closeSheet, add, edit, ctx, editor } = arrangement
  const { columns, rows, placed, full } = arrangement
  const { grid, sheetRef, byId, drawn, landing, lifted, shown, added, glint } = arrangement.drawing
  if (widgets === undefined) return null
  const settingsOpen = draft?.widgets.find((one) => one.id === sheet)
  const settingsType = settingsOpen === undefined ? undefined : widgetType(settingsOpen.type)
  const SettingsForm = settingsType?.Settings
  // Each widget the arrangement has, that `show` lets through and the hidden week does not leave off.
  const frames = drawn.filter((cells) => {
    const one = byId.get(cells.id)
    if (one === undefined || leftOff(widgetType(one.type), weekShown(ctx.live.status), draft !== null)) return false
    return show === undefined || show(one)
  })
  return (
    <>
      {sheet === 'add' && draft !== null && <AddSheet add={add} close={closeSheet} week={weekShown(ctx.live.status)} />}
      {settingsOpen !== undefined && settingsType !== undefined && SettingsForm !== undefined && (
        <section
          ref={sheetRef}
          className="gb-panel board-sheet"
          aria-label={`Settings of ${settingsType.name}`}
          tabIndex={-1}
          onKeyDown={closesOnEscape(closeSheet)}
        >
          <SettingsForm
            widget={settingsOpen}
            ctx={ctx}
            change={(settings) => edit((all) => setSettings(all, settingsOpen.id, settings))}
          />
          <div className="board-sheet-buttons">
            <button type="button" className="gb-btn quiet" onClick={() => setSheet(null)}>
              Close
            </button>
          </div>
        </section>
      )}
      <div
        ref={grid}
        className="board-grid"
        data-testid={place}
        data-arrangement={full ? 'maximized' : 'window'}
        style={{ gridTemplateColumns: gridColumns(place, columns) }}
      >
        {draft !== null && (
          <div className="board-cells">
            {freeCells(placed, columns, rows).map(({ x, y }) => (
              <span
                key={`${x} ${y}`}
                className="board-cell"
                aria-hidden="true"
                style={{ gridColumn: x + 1, gridRow: y + 1 }}
              />
            ))}
          </div>
        )}
        {landing !== undefined && (
          // Where the widget being dragged will land (spec 10.5).
          <div
            className="board-landing"
            aria-hidden="true"
            style={{
              gridColumn: `${landing.x + 1} / span ${landing.w}`,
              gridRow: `${landing.y + 1} / span ${landing.h}`,
            }}
          />
        )}
        {frames.map((cells) => (
          <WidgetFrame
            key={cells.id}
            widget={byId.get(cells.id)!}
            cells={cells}
            ctx={ctx}
            editor={editor}
            helpId={helpId}
            extraTools={extraTools}
            headMark={headMark}
            opacity={opacity}
            glint={glint !== '' && cells.id === added}
            lifted={cells.id === lifted}
            tag={shown !== null && shown.grip !== null && shown.id === cells.id ? shown.tag : null}
          />
        ))}
      </div>
    </>
  )
}

import { createContext, type ReactNode, useCallback, useContext, useLayoutEffect, useState } from 'react'
import type { Live } from '../live.ts'
import type { BoardModel, Widget } from '../types.ts'
import type { QueuedChange } from '../ui/changes.tsx'
import type { SignName } from '../ui/Sign.tsx'

/*
 * The widget system (spec 13), shared by the Board and, from plan 2A-4, the overlay. Each type is self-contained: an
 * id, its sign, its smallest, largest and starting sizes, its default settings, its view, and the form that changes its
 * settings, if it has any. A saved layout keeps type ids and settings, so a type added later changes no saved layout
 * (spec 13.4).
 */

/** A size in grid cells: a cell is 168 pixels wide and 96 tall, with 12-pixel gaps. */
export type Size = { w: number; h: number }

/** The sizes a type can have: every whole-cell size from `min` to `max` (look pass spec 8.2). */
export type SizeRange = { min: Size; max: Size }

/** What every widget's view is given by the page that shows it. */
export type WidgetContext = {
  live: Live
  /** Goes up on the core's events and after a change that failed: the widgets read their models again then. */
  version: number
  /** The Board model, or null until it is read (views/board.py). */
  board: BoardModel | null
  /** Sends a change that the undo history keeps, through the undo note. */
  change: QueuedChange
}

export type WidgetType = {
  id: string
  name: string
  /** One line in "Add a widget". */
  about: string
  /** The drawn sign beside its name in the frame's heading (look pass spec 7.2). */
  sign: SignName
  /** Its smallest and its largest size; every whole-cell size between them is allowed (look pass spec 8.2). */
  min: Size
  max: Size
  /** The size it is added at. */
  start: Size
  /** It draws Your week, so it is offered and shown only while Your week is (pages/characters/hidden.ts). */
  needsWeek?: boolean
  /**
   * Its default settings. A widget added in Edit starts with them; the starting layout's widgets have none, so a view
   * merges them under what its widget keeps (settingsOf).
   */
  settings: Record<string, unknown>
  View: (props: { widget: Widget; ctx: WidgetContext }) => ReactNode
  Settings?: (props: {
    widget: Widget
    ctx: WidgetContext
    change: (settings: Record<string, unknown>) => void
  }) => ReactNode
}

/** A widget's settings, with its type's defaults under those it keeps. */
export function settingsOf<S extends Record<string, unknown>>(widget: Widget, defaults: S): S {
  return { ...defaults, ...widget.settings } as S
}

/** What a view puts in its frame's heading (look pass spec 8.1). */
export type Head = {
  /** Shown in place of the type's name, as the One timer names its timer. The widget is still named by its type. */
  title?: string
  /** The short text at the right of the heading, such as "Read at 13:16"; null, or none, leaves it out. */
  meta?: string | null
  /**
   * The part of the meta that a read gives and the clock may move on, such as "3 of 5 back", and `read`, which names the
   * read it came from: the meta glints once when a new read changes that part (ui/motion.tsx, useReadGlint), and not
   * for the clock. A meta without them never glints.
   */
  counted?: string
  read?: string
}

/** How the frame takes a view's heading: the frame provides it, and a view outside a frame has none. */
export const HeadContext = createContext<((head: Head) => void) | null>(null)

/**
 * Sets the heading of the frame that shows this view: its title and the text at its right, and what of that text a read
 * gives, for its glint. They go when the view does, and a change shows before the frame is drawn, so that the type's
 * name does not show first.
 */
export function useHead({ title, meta, counted, read }: Head): void {
  const set = useContext(HeadContext)
  useLayoutEffect(() => {
    if (set === null) return undefined
    set({ title, meta, counted, read })
    return () => set({})
  }, [set, title, meta, counted, read])
}

/**
 * Where a frame is one cell across: a cell is 168 pixels wide and 96 tall, and two cells 348 and 204, so a frame under
 * this is one cell and over it two or more. The container queries of widgets.css split at the same place (they say 180
 * for a width, and 100 and 180 for a height), and the frame has no padding, so a query and this agree.
 */
const ONE_CELL = 180

/**
 * Whether the frame that holds this view is one cell wide (`narrow`) and one cell tall (`short`), kept as it is
 * resized and measured before it is first drawn, so that nothing shows in the wrong size first. A view whose heading
 * says something else at one cell than at more asks this, as the Clock does for its server time (one cell wide), the
 * Expeditions for the next return (one cell tall, when the faces have no room for their times) and One timer for the
 * clock time of its timer's return (one cell tall, when the body has no room for it); what is only drawn differently
 * is a container query of widgets.css, not this. `ref` goes on an element of the view. It is measured as it
 * appears, so a view that first shows a line while it reads and draws the element later is measured then.
 */
export function useOneCell(): { ref: (element: HTMLElement | null) => (() => void) | undefined; narrow: boolean; short: boolean } {
  const [narrow, setNarrow] = useState(false)
  const [short, setShort] = useState(false)
  const ref = useCallback((element: HTMLElement | null) => {
    if (element === null) return undefined
    const frame = element.closest('.w') ?? element
    const read = () => {
      setNarrow(frame.clientWidth <= ONE_CELL)
      setShort(frame.clientHeight <= ONE_CELL)
    }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])
  return { ref, narrow, short }
}

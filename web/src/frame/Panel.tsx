import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'

/*
 * The drop-down of the profile card and of the plate's sync part (top bar and undo design, sections 3 and 4): a box in
 * the plate's parchment with a few rows and buttons, over the page.
 */

/** What opens a drop-down: the buttons that carry it in the scope's markup. */
const OPENER = '[aria-haspopup="dialog"]'

/**
 * The state of one drop-down. `opener` is the button that opened it, null while it is shut. `scope` goes on the element
 * that holds the drop-down's buttons (the ones with aria-haspopup="dialog") and the drop-down itself. A press on any of
 * its buttons while it is open shuts it, and the focus stays on the button pressed. Closing by the keyboard gives the focus
 * back to the button that opened it, or, when that has gone from the page, to the scope's first button; an outside click
 * leaves the focus where the player put it.
 */
export function usePanel(): {
  opener: HTMLElement | null
  scope: RefObject<HTMLDivElement | null>
  toggle(from: HTMLElement): void
  close(restoreFocus: boolean): void
} {
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  const scope = useRef<HTMLDivElement>(null)
  return {
    opener,
    scope,
    toggle: (from) => {
      if (opener === null) {
        setOpener(from)
      } else {
        setOpener(null)
        from.focus()
      }
    },
    close: (restoreFocus) => {
      setOpener(null)
      if (!restoreFocus) return
      if (opener !== null && opener.isConnected) {
        opener.focus()
      } else if (document.activeElement === null || document.activeElement === document.body) {
        scope.current?.querySelector<HTMLElement>(OPENER)?.focus()
      }
    },
  }
}

/**
 * The box. It is a dialog with a name, drawn only while it is open. Esc closes it, and the key is taken
 * (preventDefault) before the page sees it, so that the undo note and the sheets around it leave that press alone;
 * a click outside the box and the scope's buttons closes it too, and so does a change of page and the opener going from
 * the page (a state that no longer offers it). The box takes no focus of its own: it follows its opener in the page, so
 * that Tab reaches it from there.
 */
export function Panel({
  label,
  testId,
  className,
  opener,
  scope,
  onClose,
  children,
}: {
  /** The dialog's name for a screen reader. */
  label: string
  testId: string
  /** Where the box hangs, for the stylesheet. */
  className: string
  opener: HTMLElement | null
  scope: RefObject<HTMLDivElement | null>
  onClose(restoreFocus: boolean): void
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const latest = useRef(onClose)
  latest.current = onClose
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      event.preventDefault()
      latest.current(true)
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (box.current?.contains(target)) return
      // A press on a button of the scope is that button's own click, which shuts the panel.
      if (target instanceof Element && scope.current?.contains(target) && target.closest(OPENER) !== null) return
      latest.current(false)
    }
    const onHash = () => latest.current(false)
    // The capture phase: before the undo note's own Esc, which comes after on the window.
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('hashchange', onHash)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('hashchange', onHash)
    }
  }, [scope])
  // The button that opened the panel is gone: the state it belonged to has passed.
  useEffect(() => {
    if (opener !== null && !opener.isConnected) latest.current(true)
  })
  return (
    <div ref={box} className={`gb-pop ${className}`} role="dialog" aria-label={label} data-testid={testId}>
      {children}
    </div>
  )
}

/** The rows of a panel: a name on the left and its value on the right. */
export function PanelRows({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="gb-pop-rows">
      {rows.map(([name, value]) => (
        <div key={name} className="gb-pop-row">
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

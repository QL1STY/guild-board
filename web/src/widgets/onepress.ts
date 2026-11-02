import { useEffect, useRef, useState } from 'react'

/** Longer than a double-click: after a press, what is under the pointer can change (Timers.tsx, useSettling). */
export const REST_MS = 500

/**
 * A click handler that takes no notice of the second click of a double-click, or a third, as the browser counts them
 * (MouseEvent.detail): a double-click is one press, wherever its second click lands. A key's press counts.
 */
export function singleClick<E extends { detail: number }>(handler: (event: E) => void): (event: E) => void {
  return (event) => {
    if (event.detail <= 1) handler(event)
  }
}

/**
 * Presses that send something to the core, one at a time: a press while one is on its way, or for half a second after
 * the core answered it, does nothing. A second click as quick as a double-click's could land on a row that moved up.
 */
export function useOnePress(): { resting: boolean; press: (send: () => Promise<unknown>) => void } {
  const until = useRef(0)
  const [resting, setResting] = useState(false)
  const rest = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(rest.current), [])
  const press = (send: () => Promise<unknown>) => {
    if (performance.now() < until.current) return
    until.current = Number.POSITIVE_INFINITY
    setResting(true)
    void send().finally(() => {
      until.current = performance.now() + REST_MS
      rest.current = window.setTimeout(() => setResting(false), REST_MS)
    })
  }
  return { resting, press }
}

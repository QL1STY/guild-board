import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

function step(key: string, across: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return across
    case 'ArrowLeft':
      return -across
    case 'ArrowDown':
      return 1
    case 'ArrowUp':
      return -1
    default:
      return null
  }
}

/**
 * Where a key moves the focus in a row of `count` things: the new index, the same index when there
 * is nowhere to go, or null when the key is not one of ours. In a grid that is filled column by
 * column, `across` is the number of rows, so that left and right move a whole column.
 */
export function nextIndex(key: string, index: number, count: number, across = 1): number | null {
  if (count <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  const move = step(key, across)
  if (move === null) return null
  const next = index + move
  return next >= 0 && next < count ? next : index
}

/**
 * One tab stop for a whole group of marks; the arrow keys, Home and End move the focus between
 * them. Spread what the returned function gives for a mark onto that mark's element.
 */
export function useRoving(count: number, across = 1) {
  const [active, setActive] = useState(0)
  const marks = useRef<(HTMLElement | null)[]>([])
  const current = Math.min(active, Math.max(0, count - 1))
  return (index: number) => ({
    ref: (element: HTMLElement | null) => {
      marks.current[index] = element
    },
    tabIndex: index === current ? 0 : -1,
    onFocus: () => setActive(index),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const next = nextIndex(event.key, index, count, across)
      if (next === null) return
      event.preventDefault()
      marks.current[next]?.focus()
    },
  })
}

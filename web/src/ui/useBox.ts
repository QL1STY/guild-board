import { useCallback, useLayoutEffect, useState } from 'react'

export interface Box {
  width: number
  height: number
}

/**
 * The size of an element as it is laid out, kept up to date as it changes: the ref to put on it and its content box.
 * Both are 0 until the first measure, which is made before the first paint; when the element goes away, the last size
 * stays, so that what is drawn from it does not change.
 */
export function useBox<T extends HTMLElement>(): { ref: (element: T | null) => void } & Box {
  const [element, setElement] = useState<T | null>(null)
  const [box, setBox] = useState<Box>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    if (element === null) return
    const measure = () => setBox((now) => (now.width === element.clientWidth && now.height === element.clientHeight ? now : { width: element.clientWidth, height: element.clientHeight }))
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [element])
  const ref = useCallback((node: T | null) => setElement(node), [])
  return { ref, ...box }
}

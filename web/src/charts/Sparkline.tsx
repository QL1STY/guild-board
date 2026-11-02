import { useLayoutEffect, useRef, useState } from 'react'

/** What the line is laid out for until it has been measured. */
const WIDTH = 120
const HEIGHT = 28
/** The room left round the line, so that its stroke and the round ends are not cut. */
const MARGIN = 5

/**
 * A word-sized trend line without an axis. Its tooltip gives the lowest and the highest point. It draws once, from its
 * first point to its last, when it appears and again when its values change (stats.css: the dash of a path of length 1).
 *
 * It is drawn in the pixels it is shown in and not stretched from a smaller picture, so that its stroke is as thick
 * going up as going across, and so that its dash is the whole of its length: a dash would not be, with a stroke that
 * keeps its width under a stretch (vector-effect: non-scaling-stroke), whatever the path's length is said to be.
 */
export function Sparkline({ values, tip, edge }: { values: number[]; tip: string; edge?: 'start' | 'end' }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(WIDTH)
  useLayoutEffect(() => {
    const element = box.current
    if (element === null) return
    const measure = () => setWidth(element.clientWidth > 0 ? element.clientWidth : WIDTH)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [])
  const top = Math.max(0, ...values)
  const line = values.length === 1 ? [values[0], values[0]] : values
  const points = line.map((value, index) => {
    const x = MARGIN + (index * (width - 2 * MARGIN)) / (line.length - 1)
    const y = top === 0 ? 24 : 24 - (value / top) * 20
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <div
      ref={box}
      className={edge ? `spark tip-${edge}` : 'spark'}
      role="img"
      aria-label={`Trend over the period. ${tip}`}
      data-tip={tip}
      tabIndex={0}
    >
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
        {/* New values are a new line: it is drawn again. */}
        <polyline key={values.join(',')} pathLength={1} points={points.join(' ')} />
      </svg>
    </div>
  )
}

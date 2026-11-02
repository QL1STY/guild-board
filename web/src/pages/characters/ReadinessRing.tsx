import type { CSSProperties } from 'react'
import { SegmentRing } from '../../ui/marks.tsx'
import { CountUp } from '../../ui/motion.tsx'

/**
 * How ready she is, 0 to 100, as a ring in the progress gold over `SegmentRing`, with the figure in the middle (`count`: it counts up to it once, as the profile's does): the
 * profile's sheet draws it large with its caption ("of her full potential"), the roster's cards small. The figure is the
 * ring's own text, so the ring says nothing the number does not. `size` is a CSS length.
 */
export function ReadinessRing({ value, size, caption, count = false }: { value: number; size: string; caption?: string; count?: boolean }) {
  const shown = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="cx-ready" style={{ '--size': size } as CSSProperties} role="img" aria-label={`${shown}% ready`}>
      <SegmentRing value={shown} max={100} segment={0}>
        <span className="cx-ready-in">
          <b>
            {count ? <CountUp value={shown} /> : shown}
            <small>%</small>
          </b>
          {caption !== undefined && <span className="cx-ready-cap">{caption}</span>}
        </span>
      </SegmentRing>
    </div>
  )
}

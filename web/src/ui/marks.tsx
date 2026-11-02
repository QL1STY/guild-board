import type { CSSProperties, ReactNode } from 'react'
import '../styles/marks.css'
import { Sign } from './Sign.tsx'

/*
 * The marks of the look pass (spec 5 and 15): pips, bars, seals, rings and dials. They draw with the widget roles of
 * tokens.css, so that a widget reads the same on parchment and on the overlay's dark panel, and each plays its motion
 * once, when it appears (marks.css). None of them says its value in words: a bar, a ring or a row of pips always has its
 * value as text beside it (spec 15), and the marks that show a value hide themselves from screen readers, except the
 * pips, which carry the text as their name.
 */

/** `value`, kept from `low` to `high`. */
const between = (low: number, high: number, value: number): number => Math.min(high, Math.max(low, value))

/** A number as the markup gets it: three decimals at most, and no zeros after them. */
const trimmed = (value: number): string => String(Number(value.toFixed(3)))

/**
 * A few steps counted in diamonds, `filled` of `total` in the progress gold and the rest outlined, dotted where the
 * number is not known (not read yet). It is one picture for a screen reader, named by `label`, such as "3 of 4 done".
 */
export function Pips({ total, filled, unknown = false, label }: { total: number; filled: number; unknown?: boolean; label: string }) {
  const on = between(0, total, Math.floor(filled))
  return (
    <span className={unknown ? 'pips unknown' : 'pips'} role="img" aria-label={label}>
      {Array.from({ length: Math.max(0, total) }, (_, index) => (
        <i key={index} className={index < on ? 'on' : undefined} />
      ))}
    </span>
  )
}

/**
 * A meter: `value` of `max` in the progress gold, on a track. It grows once when it appears. With `notches`, a thin gap
 * in the track divides it into that many parts, such as the seven days of a week (so six gaps for seven notches). It is
 * hidden from screen readers; its value is the text beside it. It has the width of the place it is put in, and the
 * place gives it a height if it wants another than 6 pixels.
 */
export function Bar({ value, max, notches = 0 }: { value: number; max: number; notches?: number }) {
  const share = max > 0 ? between(0, 100, (value / max) * 100) : 0
  return (
    <span className="bar" aria-hidden="true">
      <i className="bar-fill" style={{ width: `${trimmed(share)}%` }} />
      {Array.from({ length: Math.max(0, notches - 1) }, (_, index) => (
        <i key={index} className="bar-notch" style={{ left: `${trimmed(((index + 1) / notches) * 100)}%` }} />
      ))}
    </span>
  )
}

/**
 * The seal that says Ready, Full, Done or Playing now: the four-point star and a word, in the ready green on its tint.
 * Where the window draws them its corners are scooped, and rounded elsewhere. A quiet seal says a state that is off,
 * such as Not playing or Stopped: the star and the word in the muted ink on the plate, as green means ready.
 */
export function Seal({ children, quiet = false }: { children: ReactNode; quiet?: boolean }) {
  return <span className={quiet ? 'seal quiet' : 'seal'}>{children}</span>
}

/** The gap between two segments, as a share of the maximum: about 2 pixels in a ring 100 pixels across (spec 9.6). */
const GAP_SHARE = 0.008

/** The length of a ring's mark, as a share of the circle (the Pulls mockup's soft pity mark). */
const MARK_SHARE = 0.012

/**
 * Resin's ring: `max` is the whole circle, cut every `segment` by a small gap in the surface's colour (ten segments of 20
 * resin for a maximum of 200), and `value` is filled in the progress gold, clockwise from the top. It fills once when
 * it appears. With a `segment` of 0 it has no gaps. `mark` puts a short dash in the gold ink across the circle at that
 * point of the maximum, as a pity card marks where soft pity starts (the Pulls plan). `children` sit in the middle,
 * centred, in a box whose width the ring measures in `cqi` units; the ring has the width of the place it is put in and
 * is square. It is hidden from screen readers.
 */
export function SegmentRing({
  value,
  max,
  segment,
  mark,
  children,
}: {
  value: number
  max: number
  segment: number
  mark?: number
  children?: ReactNode
}) {
  const total = max > 0 ? max : 1
  const gap = total * GAP_SHARE
  const dash = total * MARK_SHARE
  return (
    <div className="ring">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="r-track" cx="50" cy="50" r="42" pathLength={total} />
        <circle
          className="r-fill"
          cx="50"
          cy="50"
          r="42"
          pathLength={total}
          style={{ strokeDasharray: `${trimmed(between(0, total, value))} ${trimmed(total)}` }}
        />
        {segment > gap && (
          <circle
            className="r-gaps"
            cx="50"
            cy="50"
            r="42"
            pathLength={total}
            style={{ strokeDasharray: `${trimmed(gap)} ${trimmed(segment - gap)}`, strokeDashoffset: trimmed(gap / 2) }}
          />
        )}
        {mark !== undefined && (
          <circle
            className="r-mark"
            cx="50"
            cy="50"
            r="42"
            pathLength={total}
            style={{
              strokeDasharray: `${trimmed(dash)} ${trimmed(total - dash)}`,
              strokeDashoffset: trimmed(-(between(0, total, mark) - dash / 2)),
            }}
          />
        )}
      </svg>
      <div className="ring-in">{children}</div>
    </div>
  )
}

/**
 * A ring of the time passed around a picture or a sign (`children`): `progress` from 0 to 1 in the progress gold on a
 * track. When `ready` it is full and green, with a tick badge, whatever `progress` was; with no `progress` (null) it is
 * an empty track. It fills once when it appears, and once more when it turns ready on the screen: the filled ring is
 * drawn afresh then (its key), so that it sweeps to green as it first did to gold, and then holds still. `size` is a CSS
 * length, 36 pixels without it, and the ring's thickness follows the size. Hidden from screen readers: the time is the
 * text beside it.
 */
export function Dial({ progress, ready, size, children }: { progress: number | null; ready: boolean; size?: string; children: ReactNode }) {
  const style = size === undefined ? undefined : ({ '--size': size } as CSSProperties)
  const filled = ready ? 1 : progress === null ? 0 : between(0, 1, progress)
  return (
    <span className={ready ? 'dial ready' : 'dial'} style={style}>
      <svg aria-hidden="true">
        <circle className="d-track" cx="50%" cy="50%" r="45%" pathLength={100} />
        {filled > 0 && (
          <circle
            key={ready ? 'ready' : 'running'}
            className="d-fill"
            cx="50%"
            cy="50%"
            r="45%"
            pathLength={100}
            style={{ strokeDasharray: `${trimmed(filled * 100)} 100` }}
          />
        )}
      </svg>
      <span className="dial-art">{children}</span>
      {ready && (
        <span className="dial-tick">
          <Sign name="tick" />
        </span>
      )}
    </span>
  )
}

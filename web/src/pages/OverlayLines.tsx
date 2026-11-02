import type { OverlayLine } from '../live.ts'

/**
 * The lines over the game (plan 2A-4; stage 2A spec 10): while the game runs, a timer that turns ready puts a line at
 * the top centre of the display, under the open bar's place, for six seconds (Live.lines), whether the overlay is open
 * or closed. Each is a dark plate with parchment text that fades in once. A screen reader hears each new line, and no
 * line takes a click: one where a line shows reaches what is under it.
 */
export function OverlayLines({ lines }: { lines: readonly OverlayLine[] }) {
  return (
    <ol className="ov-lines" aria-live="polite">
      {lines.map((line) => (
        <li key={line.id} className="ov-line">
          {line.text}
        </li>
      ))}
    </ol>
  )
}

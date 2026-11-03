import { useEffect, useRef, useState } from 'react'
import { ago, num } from '../format.ts'

/** How the ring reads: gold while the source reads by itself, grey when it does not, amber when the player has to act. */
export type FreshTone = 'gold' | 'grey' | 'amber'

/** What the freshness ring shows for one source. Each page builds it from its own model; the ring only draws it. */
export type FreshView = {
  tone: FreshTone
  /** 0..1, the gold part of the ring. */
  fill: number
  /** Beside the ring: "2 min ago", "page 3 · 41 new", "Log in". */
  label: string
  /** The tooltip and the accessible name: whole sentences. */
  tip: string
  /** A read is running. */
  turning: boolean
}

/**
 * How much of the wait for the next read by itself is left: 1 at the read, 0 once `everyMinutes` have passed since. A read
 * time ahead of `now` counts as just made. Without a read or a cadence there is nothing to wait for, and the ring is empty.
 */
export function ringFill(readAt: string | null, everyMinutes: number | null, now: Date): number {
  if (readAt === null || everyMinutes === null || everyMinutes <= 0) return 0
  const elapsed = (now.getTime() - Date.parse(readAt)) / 60_000
  return Math.min(1, Math.max(0, 1 - elapsed / everyMinutes))
}

/** When the source was last read, beside the ring: "2 min ago". A time ahead of `now` reads as "just now". */
export function ageLabel(readAt: string | null, now: Date): string {
  return readAt === null ? 'Not read yet' : ago(readAt, now)
}

/** How long "+3 new" stays beside the ring after an import that found something. */
export const FLASH_MS = 6000

/** What the flash watches: a run's state and the new things it found so far, as a page's source gives them. */
export type FlashSource = { state: string; found: number }

/** "+3 new" for a run that ended having found something; null for anything else. */
export function newLabel(source: FlashSource | null): string | null {
  return source !== null && source.state === 'done' && source.found > 0 ? `+${num(source.found)} new` : null
}

/**
 * One reading of the source: whether its state differs from the one `seen` last time (only a change counts, so that a
 * model read again with the same state, or the state a page opens on, shows nothing), and the label the new state gives.
 */
export function flashChange(
  seen: string | null,
  source: FlashSource | null,
): { seen: string | null; changed: boolean; label: string | null } {
  const state = source?.state ?? null
  if (state === seen) return { seen, changed: false, label: null }
  return { seen: state, changed: true, label: newLabel(source) }
}

/** The view with `flash` as its words, unless a run goes or the player has to act: those words stay. */
export function withFlash(view: FreshView, flash: string | null): FreshView {
  return flash === null || view.turning || view.tone === 'amber' ? view : { ...view, label: flash }
}

/**
 * The view while a press is on its way to the core and no run has begun yet: the sign turns, and the words and the tip say
 * "Importing…", so that the tip does not go on telling of the last read or of a link that is kept. A view that already
 * turns, a run in progress, is left as it is.
 */
export function pressed(view: FreshView): FreshView {
  return view.turning ? view : { ...view, turning: true, label: 'Importing…', tip: 'Importing…' }
}

/**
 * "+3 new" for six seconds after the source's state turns to done with something found (freshness design, section 1);
 * null otherwise. The Pulls page watches the wish import's event, the Ledger its own block of the import's state. The state
 * a page opens on is old news and shows nothing, and a later change of state ends the flash early.
 */
export function useNewFlash(source: FlashSource | null): string | null {
  const [flash, setFlash] = useState<string | null>(null)
  const seen = useRef<string | null>(source?.state ?? null)
  const latest = useRef(source)
  latest.current = source
  const state = source?.state ?? null
  useEffect(() => {
    const step = flashChange(seen.current, latest.current)
    seen.current = step.seen
    if (!step.changed) return
    setFlash(step.label)
    if (step.label === null) return
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [state])
  return flash
}

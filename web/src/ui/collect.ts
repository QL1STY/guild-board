/*
 * The window's engine (Qt WebEngine 140) does not collect the documents and the DOM of the pages left behind by itself: with
 * each page change its renderer grew by 10 to 25 MB for as long as the window lived, while Edge stayed level. The shell gives
 * the page a way to ask (`gbCollect`, shell/app.py), and a collection takes about 10 ms: it is asked for when a page has settled,
 * and once a minute for the pages that stay open and redraw, as the overlay does. In a plain browser there is no `gbCollect`, and
 * this does nothing.
 */

/** How long after a page change the collection waits: the page has come in and its motion is over. */
export const COLLECT_AFTER_MS = 2_000
/** How often a page that stays open is collected. */
export const COLLECT_EVERY_MS = 60_000

type Collecting = { gbCollect?: () => void }

function collect(): void {
  ;(globalThis as Collecting).gbCollect?.()
}

let soon: ReturnType<typeof setTimeout> | null = null

/** Asks for a collection once things have settled; a change that follows puts it off, so that a run of pages costs one. */
export function collectSoon(): void {
  if (soon !== null) clearTimeout(soon)
  soon = setTimeout(() => {
    soon = null
    collect()
  }, COLLECT_AFTER_MS)
}

/** Asks for a collection every minute until the function it gives back is called. */
export function collectEveryMinute(): () => void {
  const timer = setInterval(collect, COLLECT_EVERY_MS)
  return () => clearInterval(timer)
}

import { useEffect, useState } from 'react'

/*
 * The Characters pages' own scale. The window zooms the whole dashboard by its width over 1,640 (shell/dashboard.py), so on a
 * full screen the page is 1,640 CSS pixels wide and no more than about 900 tall, and a character's card (its 680 pixels of art
 * and attributes, and the strip of her weapon and five artifacts under it) does not fit. These pages are zoomed down, by CSS
 * `zoom`, as far as it takes for the whole card to fit the window's height, and never up: in the usual window, 1,640 x 1,100, the
 * card fits and the pages are as they were. The roster and the planner take the same scale, so that the three agree. The top
 * bar stays as it is. The pages keep their width in the screen's pixels (profile.css, `--cs`), so a smaller page lays out
 * wider, and the roster shows more cards to a row.
 */

/** The profile's card in CSS pixels: 680 of art and attributes and its build strip (profile.css). */
export const CARD_HEIGHT = 882
/** What lies above the card: the top bar, and the gap under it. */
export const ABOVE_CARD = 84
/** What the page keeps under the card. */
export const BELOW_CARD = 12
/** The least the pages are scaled to: a window shorter than that scrolls. */
const LEAST = 0.6

/** The scale for a window this tall in CSS pixels, from the least to 1, in hundredths. */
export function charactersScale(viewportHeight: number): number {
  if (!(viewportHeight > 0)) return 1
  const fit = (viewportHeight - ABOVE_CARD - BELOW_CARD) / CARD_HEIGHT
  return Math.max(LEAST, Math.min(1, Math.floor(fit * 100) / 100))
}

/** What the roster is scaled to on a full screen: it shows six cards to a row where the usual window shows five, and more rows. */
const ROSTER_SCALE = 0.85

/** The roster's scale for the pages' scale: the same when the pages are not scaled, otherwise a little smaller. */
export function rosterScale(scale: number): number {
  return scale < 1 ? Math.min(scale, ROSTER_SCALE) : 1
}

/** The style of a scaled page: zoomed, and the scale as `--cs` for the rules that count in the screen's pixels. */
export function scaleStyle(scale: number): { zoom?: number; '--cs': number } {
  return scale === 1 ? { '--cs': 1 } : { zoom: scale, '--cs': scale }
}

/** The scale of the pages now, which follows the window's height. */
export function useCharactersScale(): number {
  const [scale, setScale] = useState(() => (typeof window === 'undefined' ? 1 : charactersScale(window.innerHeight)))
  useEffect(() => {
    const follow = () => setScale(charactersScale(window.innerHeight))
    window.addEventListener('resize', follow)
    return () => window.removeEventListener('resize', follow)
  }, [])
  return scale
}

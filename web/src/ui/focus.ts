import { type FocusEvent, type RefObject, useLayoutEffect, useRef } from 'react'

/**
 * Gives `element` the focus without moving the page: after a press with the mouse, the page stays where the player is.
 * A focus the keyboard moves shows (:focus-visible), and the page then brings it into view, below the bar.
 */
export function handFocus(element: HTMLElement): void {
  element.focus({ preventScroll: true })
  if (element.matches(':focus-visible')) element.scrollIntoView({ block: 'nearest' })
}

/**
 * Keeps the keyboard's place in cards that move. A card that moves to another group, as a Cleared moves a ready timer
 * to Running, or into the fold of the done ones, is drawn anew there, and the focus would fall back to the start of the
 * page. When the element that had the focus has left the page and the focus is on no element, it goes instead to the
 * same control of the same card (a form's data-focus names the button that opened it), or to `elsewhere` once the card
 * is gone, as after Remove. The page follows it only for the keyboard (handFocus): after a press with the mouse, it
 * stays where the player is.
 *
 * Each card holds its id in the attribute named `data-{card}`, as its panel under the row does (RowPanel.tsx), and each
 * of their controls a data-focus that tells it from the card's others. `shown` changes whenever the cards may have
 * moved. `list` goes on the element around the cards, with `onFocus` and `onBlur`.
 */
export function useFocusFollows(shown: unknown, elsewhere: RefObject<HTMLElement | null>, card: string) {
  const list = useRef<HTMLDivElement>(null)
  const focused = useRef<{ element: Element; card: string; control: string } | null>(null)
  useLayoutEffect(() => {
    const lost = focused.current
    if (lost === null || lost.element.isConnected) return // still there: the player put the focus elsewhere, if at all
    focused.current = null
    const active = document.activeElement
    if (active !== null && active !== document.body) return // the focus is somewhere else already
    // The card, and its panel when it has one open.
    const holders = [...(list.current?.querySelectorAll(`[data-${card}="${lost.card}"]`) ?? [])]
    const control = holders
      .map((holder) => holder.querySelector<HTMLElement>(`[data-focus="${lost.control}"]`))
      .find((found) => found !== null)
    const target = control ?? elsewhere.current
    if (target) handFocus(target)
  }, [shown, elsewhere, card])
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const control = event.target.closest<HTMLElement>('[data-focus]')
    const holder = control?.closest<HTMLElement>(`[data-${card}]`)
    const id = holder?.getAttribute(`data-${card}`) ?? null
    focused.current =
      control && id !== null ? { element: event.target, card: id, control: control.dataset.focus ?? '' } : null
  }
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    // A move to something outside the cards forgets the control. When its card goes, the focus goes to no element, and
    // the control is kept for the effect above.
    const next = event.relatedTarget
    if (next instanceof Node && !event.currentTarget.contains(next)) focused.current = null
  }
  return { list, onFocus, onBlur }
}

/**
 * The focus has somewhere to go when a panel moves on to another step. The button the player pressed often goes with
 * its step, and the focus would fall back to the start of the page. It goes instead to `line`, the first line of what
 * took its place, which takes the focus from script only (tabIndex -1), or to `elsewhere` once the panel is gone, which
 * moves the page only for the keyboard (handFocus).
 *
 * `step` names what the panel shows. When it changes while the focus was in the panel and is now on no element, the
 * focus moves. `watch` goes on the panel's outer element, to follow whether the focus is in the panel.
 */
export function useStepFocus(step: string, elsewhere?: RefObject<HTMLElement | null>) {
  const line = useRef<HTMLParagraphElement>(null)
  const inside = useRef(false)
  useLayoutEffect(() => {
    if (!inside.current) return
    const active = document.activeElement
    if (active !== null && active !== document.body) return // the focus is somewhere still
    if (line.current !== null) {
      line.current.focus()
    } else {
      inside.current = false // the panel is gone
      const target = elsewhere?.current
      if (target) handFocus(target)
    }
  }, [step, elsewhere])
  const watch = {
    onFocus: () => {
      inside.current = true
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      // A move to something outside the panel forgets it. When the button that has the focus goes, the focus goes to
      // no element, and the panel keeps it in mind for the effect above.
      const next = event.relatedTarget
      if (next instanceof Node && !event.currentTarget.contains(next)) inside.current = false
    },
  }
  return { line, watch }
}

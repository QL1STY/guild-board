import { type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { reducedMotion, tokenMs } from './motion.tsx'

/**
 * Whether a card's panel is in the page (RowPanel): from when it opens until it has shrunk away after it closes, or at
 * once with reduced motion.
 */
export function usePanelPresence(open: boolean): boolean {
  const [present, setPresent] = useState(open)
  if (open && !present) setPresent(true)
  useEffect(() => {
    if (open || !present) return
    if (reducedMotion()) {
      setPresent(false)
      return
    }
    // How long a panel takes to close (tokens.css, --t-open).
    const timer = window.setTimeout(() => setPresent(false), tokenMs('--t-open', 260))
    return () => window.clearTimeout(timer)
  }, [open, present])
  return open || present
}

/** The attribute that names the card a panel belongs to, as its card's own does, such as `data-group`. */
type Holder = Record<`data-${string}`, string | number>

/**
 * A card's panel, across the row right under the card's row (look pass spec 11.4, 11.6 and 11.7): an achievement's in
 * full, a timer's More or a commission's Details. It comes right after its card in the page, in a grid of cards whose
 * dense packing fills the row's other places with the cards after it, so that the keyboard and screen readers reach it
 * straight after the button that opened it.
 *
 * It is a region, named by the element `labelledBy` names, with a gold border and a notch that points to the middle of
 * its card (`card`), wherever the card stands in the row. Escape inside it calls `close`, which gives the focus back to
 * the card's button; a form or an editor inside keeps its own Escape. It grows to its height as it opens and shrinks as
 * it closes (`closing`), and the rows below move with it; meanwhile it is inert, and its card keeps it in the page until
 * it has shrunk (usePanelPresence). As it opens, the page brings it into view. `holder` names its card as the card's
 * own attribute does, for the page to keep the keyboard's place.
 */
export function RowPanel({
  id,
  labelledBy,
  card,
  closing,
  close,
  holder,
  className,
  testId,
  children,
}: {
  id: string
  labelledBy: string
  card: RefObject<HTMLElement | null>
  closing: boolean
  close: () => void
  holder: Holder
  className?: string
  testId?: string
  children: ReactNode
}) {
  const panel = useRef<HTMLElement>(null)
  // The notch stands under the card's middle, wherever the card stands: measured each time the panel is drawn, when the
  // cards of the list change, as a card before it that leaves the list moves its card to another column, and when the
  // panel or the list of cards changes size, as the window's width does.
  const place = useCallback(() => {
    const element = panel.current
    const below = card.current?.getBoundingClientRect()
    if (element === null || below === undefined) return
    const middle = below.left + below.width / 2 - element.getBoundingClientRect().left
    element.style.setProperty('--notch', `${Math.round(middle)}px`)
  }, [card])
  useLayoutEffect(place)
  useLayoutEffect(() => {
    const element = panel.current
    if (element === null) return
    const observer = new ResizeObserver(place)
    observer.observe(element)
    const list = element.parentElement?.parentElement // the cards' grid, round the panel's wrap
    if (list) observer.observe(list)
    // A card that leaves or comes moves this one without drawing the panel again: the Achievements page leaves the cards
    // that did not change as they are (audit L22).
    const cards = new MutationObserver(place)
    if (list) cards.observe(list, { childList: true })
    return () => {
      observer.disconnect()
      cards.disconnect()
    }
  }, [place])
  // As it opens, the page brings it into view, as far as it must: from under its card, it may open below the window.
  // Its wrap grows from nothing, but the panel inside it has its height from the start. Near the end of the page the
  // page is not yet tall enough for all of it, so the scroll stops short; once the wrap has grown, it is brought into
  // view again.
  const bringIntoView = useCallback(() => {
    panel.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
  }, [])
  useEffect(() => {
    if (!closing) bringIntoView()
  }, [closing, bringIntoView])
  return (
    <div
      className={closing ? 'ach-panel-wrap closing' : 'ach-panel-wrap'}
      inert={closing}
      onTransitionEnd={(event) => {
        if (closing || event.target !== event.currentTarget || event.propertyName !== 'height') return
        bringIntoView()
      }}
    >
      <section
        ref={panel}
        id={id}
        className={className === undefined ? 'ach-panel' : `ach-panel ${className}`}
        aria-labelledby={labelledBy}
        data-testid={testId}
        {...holder}
        onKeyDown={(event) => {
          // Not while a word is being composed, where Escape belongs to the input method.
          if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
          event.preventDefault()
          close()
        }}
      >
        {children}
      </section>
    </div>
  )
}

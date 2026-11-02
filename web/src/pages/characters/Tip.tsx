import { type FocusEvent, type MouseEvent, type ReactNode, useCallback, useState } from 'react'

/** Where a tip stands, in the window's pixels, and what it says. */
export type TipState = { x: number; y: number; body: ReactNode } | null

/**
 * The dark card's tips: a small plate that follows the pointer over a stat, a roll's row or a star, and sits beside the
 * element while it has the keyboard's focus (the mockups' `.tip`). `tipOf(body)` gives the props of an element that shows
 * `body`: it can take the focus, so that a tip is not for the pointer alone.
 */
export function useTip(): {
  tip: TipState
  tipOf: (body: ReactNode) => TipProps
  show: (x: number, y: number, body: ReactNode) => void
  hide: () => void
} {
  const [tip, setTip] = useState<TipState>(null)
  const show = useCallback((x: number, y: number, body: ReactNode) => setTip({ x, y, body }), [])
  const hide = useCallback(() => setTip(null), [])
  const tipOf = useCallback(
    (body: ReactNode): TipProps => ({
      tabIndex: 0,
      onMouseMove: (event: MouseEvent) => setTip({ x: event.clientX, y: event.clientY, body }),
      onMouseLeave: () => setTip(null),
      onFocus: (event: FocusEvent<HTMLElement | SVGElement>) => {
        const box = event.currentTarget.getBoundingClientRect()
        setTip({ x: box.left + 24, y: box.bottom - 8, body })
      },
      onBlur: () => setTip(null),
    }),
    [],
  )
  return { tip, tipOf, show, hide }
}

export type TipProps = {
  tabIndex: number
  onMouseMove: (event: MouseEvent) => void
  onMouseLeave: () => void
  onFocus: (event: FocusEvent<HTMLElement | SVGElement>) => void
  onBlur: () => void
}

/**
 * The tip, over the page: nothing while there is none. It stands in the window's pixels (`position: fixed`), and a page that is
 * scaled (scale.ts) zooms what lies in it, so its place is divided by the page's scale (`--cs`) to come out where the pointer is.
 * `light` is the plate for the parchment top bar (the arrows to the character beside her), where the dark one would not belong.
 */
export function Tip({ tip, light = false }: { tip: TipState; light?: boolean }) {
  if (tip === null) return null
  const left = Math.max(8, Math.min(tip.x + 14, window.innerWidth - 320))
  return (
    <div className={light ? 'cx-tip light' : 'cx-tip'} role="tooltip" style={{ left: `calc(${left}px / var(--cs, 1))`, top: `calc(${tip.y + 16}px / var(--cs, 1))` }}>
      {tip.body}
    </div>
  )
}

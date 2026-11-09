import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import '../styles/themepicker.css'
import type { ThemeName, ThemeSetting } from '../theme.ts'
import { Sign } from '../ui/Sign.tsx'
import {
  boardsOf,
  moreToTheRight,
  NATIONS_FROM,
  NATIONS_LABEL,
  optionLabel,
  scrollLeftToShow,
  SNAP_PADDING,
  sidewaysWheel,
  THEME_OPTIONS,
  themeAfterKey,
  wheelPixels,
} from './themepickerview.ts'

/** A tiny Board (the rail, a heading bar, two cards with a progress bar, a wide card) drawn with the ordinary tokens of its theme. */
function Board({ theme, over = false, children }: { theme: ThemeName; over?: boolean; children?: ReactNode }) {
  return (
    <span className={over ? 'tp-board over' : 'tp-board'} data-theme={theme}>
      <span className="tp-rail">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="tp-main">
        <span className="tp-h" />
        <span className="tp-cards">
          <span className="tp-card">
            <u />
            <s />
          </span>
          <span className="tp-card">
            <u />
            <s />
          </span>
        </span>
        <span className="tp-wide" />
      </span>
      {children}
    </span>
  )
}

function Sun() {
  return (
    <svg className="tp-sun" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="10" cy="10" r="3.4" fill="currentColor" />
      <path d="M10 2.2v2M10 15.8v2M2.2 10h2M15.8 10h2M4.5 4.5l1.4 1.4M14.1 14.1l1.4 1.4M4.5 15.5l1.4-1.4M14.1 5.9l1.4-1.4" />
    </svg>
  )
}

/**
 * The window's theme, chosen from thirteen tiles that each show a tiny Board in their own colours (the themes design,
 * sections 2 and 12), in one row that scrolls sideways: the five looks, Match Windows, a small "Nations" mark and the seven
 * nations. A radio group: one tab stop, the arrow keys choose. Match Windows is the Parchment Board with the Midnight
 * Board over it, cut on the diagonal, a sun on the day half and a moon on the night half. The chosen tile is scrolled into
 * view when the picker opens and when the choice moves; the mouse wheel over the row scrolls it sideways; a fade at the
 * right edge stands while more lies that way.
 */
export function ThemePicker({ value, choose }: { value: ThemeSetting; choose: (value: ThemeSetting) => void }) {
  const row = useRef<HTMLDivElement | null>(null)
  const tiles = useRef<(HTMLButtonElement | null)[]>([])
  const [more, setMore] = useState(false)
  const selected = Math.max(0, THEME_OPTIONS.findIndex((option) => option.value === value))

  const measure = useCallback(() => {
    const element = row.current
    if (element === null) return
    setMore(moreToTheRight({ scrollLeft: element.scrollLeft, viewWidth: element.clientWidth, scrollWidth: element.scrollWidth }))
  }, [])

  /** Scrolls the row, if it must, so that tile `index` shows whole with a margin. `instant` skips the glide. */
  const show = useCallback((index: number, instant: boolean) => {
    const element = row.current
    const tile = tiles.current[index]
    if (element === null || tile === null || tile === undefined) return
    const left = scrollLeftToShow({
      scrollLeft: element.scrollLeft,
      viewWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      tileLeft: tile.offsetLeft,
      tileWidth: tile.offsetWidth,
      snaps: tiles.current.map((each) => (each === null ? 0 : each.offsetLeft - SNAP_PADDING)),
    })
    if (left === null) return
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    element.scrollTo({ left, behavior: instant || calm ? 'instant' : 'smooth' })
  }, [])

  // The chosen tile is in view when Settings opens, and stays in view when the choice moves.
  const opened = useRef(false)
  useLayoutEffect(() => {
    show(selected, !opened.current)
    opened.current = true
    measure()
  }, [selected, show, measure])

  // The wheel over the row scrolls it sideways. React's own wheel handler is passive, so this one is attached by hand. While the
  // wheel turns the row's snapping is off: a touchpad sends a few pixels at a time, and each would be pulled back to the snap point
  // it left, so that the row never moved and the page, whose wheel this takes, did not either. Snapping returns when the wheel rests.
  useEffect(() => {
    const element = row.current
    if (element === null) return
    let rest: ReturnType<typeof setTimeout> | null = null
    const onWheel = (event: WheelEvent) => {
      const delta = sidewaysWheel({
        scrollLeft: element.scrollLeft,
        viewWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        deltaX: event.deltaX,
        deltaY: wheelPixels(event.deltaY, event.deltaMode, element.clientWidth),
      })
      if (delta === null) return
      event.preventDefault()
      element.style.scrollSnapType = 'none'
      element.scrollLeft += delta
      if (rest !== null) clearTimeout(rest)
      rest = setTimeout(() => {
        rest = null
        element.style.scrollSnapType = ''
      }, 150)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', onWheel)
      if (rest !== null) clearTimeout(rest)
      element.style.scrollSnapType = ''
    }
  }, [])

  // The fade follows the row's width as well as its scroll.
  useEffect(() => {
    const element = row.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(measure)
    watch.observe(element)
    return () => watch.disconnect()
  }, [measure])

  return (
    <div className={more ? 'tp-wrap more' : 'tp-wrap'}>
      <div className="tp" role="radiogroup" aria-label="Theme" ref={row} onScroll={measure}>
        {THEME_OPTIONS.map((option, index) => {
          const boards = boardsOf(option.value)
          const on = index === selected
          return (
            <Fragment key={option.value}>
              {option.value === NATIONS_FROM && (
                <span className="tp-sep" aria-hidden="true" data-testid="tp-nations">
                  <span>{NATIONS_LABEL}</span>
                </span>
              )}
              <button
                ref={(element) => {
                  tiles.current[index] = element
                }}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={optionLabel(option)}
                tabIndex={on ? 0 : -1}
                className={on ? 'tp-tile on' : 'tp-tile'}
                data-theme-option={option.value}
                onClick={() => {
                  if (!on) choose(option.value)
                }}
                onKeyDown={(event) => {
                  const next = themeAfterKey(event.key, option.value)
                  if (next === null) return
                  event.preventDefault()
                  if (next === option.value) return
                  choose(next)
                  const target = THEME_OPTIONS.findIndex((each) => each.value === next)
                  tiles.current[target]?.focus({ preventScroll: true })
                  show(target, false)
                }}
              >
                <span className="tp-mini" aria-hidden="true">
                  {boards.map((theme, layer) => (
                    <Board key={theme} theme={theme} over={layer > 0}>
                      {option.value === 'system' && (layer === 0 ? <Sun /> : <Sign name="moon" className="tp-moon" />)}
                    </Board>
                  ))}
                  <span className="tp-tick">
                    <Sign name="tick" />
                  </span>
                </span>
                <span className="tp-name" aria-hidden="true">
                  {option.name}
                </span>
                <span className="tp-ds" aria-hidden="true">
                  {option.words}
                </span>
              </button>
            </Fragment>
          )
        })}
      </div>
      <span className="tp-fade" aria-hidden="true" />
    </div>
  )
}

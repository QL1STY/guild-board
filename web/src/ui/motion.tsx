import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { num } from '../format.ts'

/** Whether Windows' "Animation effects" setting is off, which the window passes on as prefers-reduced-motion. */
export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A token of tokens.css as the page has it, so that the scripted motions take the same times as the styled ones. */
function tokenText(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

/** A duration token such as `--t-count`, in milliseconds, or `fallback` where the page has none. */
export function tokenMs(name: string, fallback: number): number {
  const found = /^([\d.]+)(ms|s)$/.exec(tokenText(name, ''))
  return found === null ? fallback : Number(found[1]) * (found[2] === 's' ? 1000 : 1)
}

/** Ease-out cubic, fast at first and slowing to a stop. `t` is the share of the time that has passed, kept to 0..1. */
export function eased(t: number): number {
  return 1 - (1 - Math.min(1, Math.max(0, t))) ** 3
}

/** The whole number a count shows when `t` (0 to 1) of its time has passed on the way from `from` to `to`. */
export function countValue(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * eased(t))
}

/**
 * A number that counts to `value`: from 0 when it first appears, or, with `fromZero` false, showing `value` then; and
 * from the number on screen when `value` changes, over `--t-count`. With reduced motion it is `value` at once.
 */
export function useCountUp(value: number, fromZero = true): number {
  const reduced = reducedMotion()
  const [shown, setShown] = useState(reduced || !fromZero ? value : 0)
  const onScreen = useRef(shown)
  useEffect(() => {
    const from = onScreen.current
    if (reduced || from === value) {
      onScreen.current = value
      setShown(value)
      return
    }
    const length = tokenMs('--t-count', 800)
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = (now - start) / length
      onScreen.current = t >= 1 ? value : countValue(from, value, t)
      setShown(onScreen.current)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, reduced])
  return reduced ? value : shown
}

/**
 * A number that counts up to `value` (see useCountUp). The counting digits are hidden from screen readers, which are
 * given the final value instead.
 */
export function CountUp({ value, format = num }: { value: number; format?: (n: number) => string }) {
  const shown = useCountUp(value)
  return (
    <>
      <span aria-hidden="true">{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  )
}

/**
 * `'glint'` for the length of `--t-glint` after `value` changes, otherwise `''`: a class name for the element that
 * shows the value. The first render never glints. Give it a value the core changed, such as one in a model read after
 * a sync, and never one that the clock ticks.
 */
export function useGlint(value: unknown): string {
  const [lit, setLit] = useState(false)
  const last = useRef(value)
  useEffect(() => {
    if (Object.is(last.current, value)) return
    last.current = value
    setLit(true)
    const timer = window.setTimeout(() => setLit(false), tokenMs('--t-glint', 900))
    return () => window.clearTimeout(timer)
  }, [value])
  return lit ? 'glint' : ''
}

/** A figure on the screen, and the read of the core it came from, as useReadGlint keeps them. */
export type Seen = { shown: unknown; read: unknown }

/**
 * One step of useReadGlint. `last` is the figure and the read at the last render where either changed, and `now` this
 * render's. A new read that changes the figure glints; the clock moving the figure on, or a read that leaves it as it
 * was, does not. `last` moves on whenever either changes.
 */
export function readGlintStep(last: Seen, now: Seen): { last: Seen; glint: boolean } {
  const shownMoved = !Object.is(last.shown, now.shown)
  const readMoved = !Object.is(last.read, now.read)
  if (!shownMoved && !readMoved) return { last, glint: false }
  return { last: now, glint: shownMoved && readMoved }
}

/**
 * A glint a new read caused: `'glint'` for the length of `--t-glint` after a read changes the figure shown, otherwise
 * `''`, as useGlint. `shown` is the figure on the screen, which the clock may move on, and `read` names the read of the
 * core it comes from, such as the read's time. Both come from one answer of the core, so that one change does not come
 * in two renders. A figure the clock moved on glints nothing, and nor does a read that leaves it as it was. The first
 * render never glints (readGlintStep).
 */
export function useReadGlint(shown: unknown, read: unknown): string {
  const [lit, setLit] = useState(false)
  const last = useRef<Seen>({ shown, read })
  const timer = useRef(0)
  useEffect(() => {
    const step = readGlintStep(last.current, { shown, read })
    last.current = step.last
    if (!step.glint) return
    setLit(true)
    // A change that does not glint leaves a glint that runs to its end.
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setLit(false), tokenMs('--t-glint', 900))
  }, [shown, read])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return lit ? 'glint' : ''
}

type Place = { x: number; y: number }

/** Where an element is in its container, in the container's own coordinates, so that scrolling moves nothing. */
function placeIn(container: HTMLElement, element: Element): Place {
  const box = element.getBoundingClientRect()
  const around = container.getBoundingClientRect()
  return { x: box.left - around.left + container.scrollLeft, y: box.top - around.top + container.scrollTop }
}

/**
 * Makes an element glide to where it is drawn from `dx` and `dy` pixels away on the screen, as getBoundingClientRect
 * measures: a translation only, by the Web Animations API, over `--t-move` with `--ease-move`, as useGlide moves its
 * elements. With reduced motion it is there at once. A translation is in the element's own pixels, which a CSS zoom
 * around it makes larger on the screen (the Backlog's, backlog.css), so the distance is taken back through the zoom.
 */
export function glideFrom(element: HTMLElement, dx: number, dy: number): void {
  if (reducedMotion() || (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5)) return
  const zoom = element.currentCSSZoom || 1 // 1 where a browser has no CSS zoom to report
  element.animate([{ transform: `translate(${dx / zoom}px, ${dy / zoom}px)` }, { transform: 'none' }], {
    id: 'glide',
    duration: tokenMs('--t-move', 280),
    easing: tokenText('--ease-move', 'cubic-bezier(.45, 0, .2, 1)'),
  })
}

/**
 * Makes the elements of a container glide to their new places. After each change of `version`, every element under
 * `container` that has `attribute` and moved since the last time glides from its old place to its new one: a
 * translation only, by the Web Animations API, over `--t-move` with `--ease-move`. The value of the attribute tells
 * the elements apart. An element that has just appeared stays where it is, and so does everything in a container that
 * has just appeared. An element that is still gliding when it moves again goes on from where it is seen. With reduced
 * motion everything jumps to its place.
 */
export function useGlide(container: RefObject<HTMLElement | null>, attribute: string, version: unknown): void {
  const drawn = useRef<{ root: HTMLElement; places: Map<string, Place> } | null>(null)
  useLayoutEffect(() => {
    const root = container.current
    if (root === null) return
    // Where each element was the last time. A container that is new has had nothing drawn in it.
    const previous = drawn.current?.root === root ? drawn.current.places : new Map<string, Place>()
    const current = new Map<string, Place>()
    const moves: { element: HTMLElement; dx: number; dy: number }[] = []
    for (const element of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const key = element.getAttribute(attribute) ?? ''
      // A glide still running is stopped, so that the element is measured where it belongs. How far from there it was
      // drawn is kept, to go on from it.
      const running = element.getAnimations().filter((animation) => animation.id === 'glide')
      const seen = running.length === 0 ? null : placeIn(root, element)
      for (const animation of running) animation.cancel()
      const place = placeIn(root, element)
      current.set(key, place)
      const old = previous.get(key)
      if (old === undefined) continue
      const dx = old.x + (seen === null ? 0 : seen.x - place.x) - place.x
      const dy = old.y + (seen === null ? 0 : seen.y - place.y) - place.y
      if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) moves.push({ element, dx, dy })
    }
    drawn.current = { root, places: current }
    for (const { element, dx, dy } of moves) glideFrom(element, dx, dy)
  }, [container, attribute, version])
}

// ---------------------------------------------------------------------------------------------------------------------
// The Characters pages' entrances (the Characters plan, Task U1; the design's section 3). Each page has one orchestrated
// entrance, and motion that answers the player; nothing loops. All of it is the Web Animations API, over the tokens'
// own times, and every one of them is skipped under reduced motion. A rise moves its element by the `translate` property,
// which leaves its CSS `transform` alone; an animation of `transform` itself would replace a CSS transform for its length,
// so none here does, and none is ever given to an element that a CSS transform positions (animate a wrapper instead).
// Counts need nothing new: `useCountUp` counts from the figure on screen to the next.

/** The time of the `index`th element of a staggered group, in seconds: each one `step` after the one before it. */
export function stagger(index: number, step: number): number {
  return index * step
}

/** A spring-like ease: it runs a little past its end and settles back, the mockups' "bounce 0.4". */
export const SPRING_EASE = 'cubic-bezier(.34, 1.45, .64, 1)'

/** What an entrance takes: a delay in seconds, and a duration in seconds that `--t-enter` gives where there is none. */
export type Entrance = { delay?: number; duration?: number; easing?: string }

const entranceOptions = (entrance: Entrance, fallbackEase: string): KeyframeAnimationOptions => ({
  delay: (entrance.delay ?? 0) * 1000,
  duration: entrance.duration === undefined ? tokenMs('--t-enter', 700) : entrance.duration * 1000,
  easing: entrance.easing ?? tokenText('--ease-out', fallbackEase),
  fill: 'backwards',
})

/**
 * Draws a line (an SVG shape with a stroke) by its stroke dash, from nothing to the whole of its length, as the
 * constellation chart's lines and the days curve are drawn. Null, and nothing drawn, with reduced motion.
 */
export function drawLine(element: SVGGeometryElement, entrance: Entrance = {}): Animation | null {
  if (reducedMotion()) return null
  const length = element.getTotalLength()
  return element.animate(
    [
      { strokeDasharray: String(length), strokeDashoffset: length },
      { strokeDasharray: String(length), strokeDashoffset: 0 },
    ],
    entranceOptions(entrance, 'cubic-bezier(.22, .8, .24, 1)'),
  )
}

/**
 * Uncovers an element from the side it starts on, as the giant name is uncovered, by its clip path alone. Null, and
 * nothing done, with reduced motion.
 */
export function clipReveal(element: HTMLElement, options: Entrance & { from?: 'left' | 'right' } = {}): Animation | null {
  if (reducedMotion()) return null
  const hidden = options.from === 'right' ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)'
  const shown = options.from === 'right' ? 'inset(0 0 0 0%)' : 'inset(0 0% 0 0)'
  return element.animate([{ clipPath: hidden }, { clipPath: shown }], entranceOptions(options, 'cubic-bezier(.22, .8, .24, 1)'))
}

/**
 * Brings elements in one after another: each fades in and rises from `lift` pixels below, a `step` after the one before
 * it, the first after `start` (both in seconds). With `spring` the rise settles with SPRING_EASE. With reduced motion
 * they are there at once.
 */
export function rise(
  elements: Iterable<HTMLElement>,
  options: { step?: number; start?: number; lift?: number; duration?: number; spring?: boolean } = {},
): void {
  if (reducedMotion()) return
  const { step = 0.06, start = 0, lift = 14, duration = 0.5, spring = false } = options
  let index = 0
  for (const element of elements) {
    element.animate(
      [
        { opacity: 0, translate: `0 ${lift}px` },
        { opacity: 1, translate: '0 0' },
      ],
      {
        delay: (start + stagger(index, step)) * 1000,
        duration: duration * 1000,
        easing: spring ? SPRING_EASE : tokenText('--ease-out', 'cubic-bezier(.22, .8, .24, 1)'),
        fill: 'backwards',
      },
    )
    index += 1
  }
}

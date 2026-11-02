import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'
// main.tsx and the stylesheet are read as text with Vite's ?raw, as in styles/contrast.test.ts.
import main from '../main.tsx?raw'
import motionCss from '../styles/motion.css?raw'
import {
  clipReveal, CountUp, countValue, drawLine, eased, readGlintStep, reducedMotion, rise, type Seen, SPRING_EASE, stagger, useCountUp,
  useGlint, useReadGlint,
} from './motion.tsx'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Windows' "Animation effects" setting, as the page sees it through prefers-reduced-motion. */
function reduceMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: on && query === '(prefers-reduced-motion: reduce)' }))
}

test('a count eases out and ends on its value', () => {
  expect(countValue(0, 1219, 0)).toBe(0)
  expect(countValue(0, 1219, 1)).toBe(1219)
  expect(countValue(100, 200, 0.5)).toBe(188) // 100 + 100 × 0.875
  expect(eased(2)).toBe(1)
})

test('the easing rises from 0 to 1 and stays between them', () => {
  expect(eased(-1)).toBe(0)
  expect(eased(0)).toBe(0)
  expect(eased(0.5)).toBe(0.875)
  expect(eased(1)).toBe(1)
  expect(eased(0.25)).toBeLessThan(eased(0.5))
})

test('a count can go down as well as up', () => {
  expect(countValue(200, 100, 0)).toBe(200)
  expect(countValue(200, 100, 0.5)).toBe(113) // 200 - 100 × 0.875 = 112.5
  expect(countValue(200, 100, 1)).toBe(100)
})

test('reducedMotion follows prefers-reduced-motion, and is off where there is no media query', () => {
  expect(reducedMotion()).toBe(false) // node has no matchMedia
  reduceMotion(true)
  expect(reducedMotion()).toBe(true)
  reduceMotion(false)
  expect(reducedMotion()).toBe(false)
})

test('a counting number is hidden from screen readers, which are given its final value', () => {
  expect(renderToStaticMarkup(createElement(CountUp, { value: 1219 }))).toBe(
    '<span aria-hidden="true">0</span><span class="sr-only">1,219</span>',
  )
  const gems = (n: number) => `${n} gems`
  expect(renderToStaticMarkup(createElement(CountUp, { value: 1600, format: gems }))).toBe(
    '<span aria-hidden="true">0 gems</span><span class="sr-only">1600 gems</span>',
  )
})

test('a number that is not to count as it first appears shows its value at once', () => {
  const Still = ({ value }: { value: number }) => createElement('b', null, useCountUp(value, false))
  expect(renderToStaticMarkup(createElement(Still, { value: 30 }))).toBe('<b>30</b>')
})

test('with reduced motion a number shows its value at once', () => {
  reduceMotion(true)
  expect(renderToStaticMarkup(createElement(CountUp, { value: 1219 }))).toBe(
    '<span aria-hidden="true">1,219</span><span class="sr-only">1,219</span>',
  )
})

test('a value shows no glint on its first render', () => {
  const Figure = ({ value }: { value: number }) => createElement('b', { className: useGlint(value) }, value)
  expect(renderToStaticMarkup(createElement(Figure, { value: 5 }))).toBe('<b class="">5</b>')
  const Read = ({ value }: { value: number }) => createElement('b', { className: useReadGlint(value, 'read 1') }, value)
  expect(renderToStaticMarkup(createElement(Read, { value: 5 }))).toBe('<b class="">5</b>')
})

test('a figure glints for a new read that changes it, and not for the clock, nor for a read that leaves it', () => {
  let seen: Seen = { shown: 77, read: 'read 1' }
  const glints = (shown: unknown, read: unknown) => {
    const step = readGlintStep(seen, { shown, read })
    seen = step.last
    return step.glint
  }
  expect(glints(77, 'read 1')).toBe(false) // nothing changed
  expect(glints(78, 'read 1')).toBe(false) // the clock moved the figure on
  expect(glints(78, 'read 2')).toBe(false) // a read that leaves the figure as the clock had it
  expect(glints(80, 'read 3')).toBe(true) // a read that changes it
  expect(glints(80, 'read 3')).toBe(false)
  expect(glints('Back', 'read 3')).toBe(false) // an expedition back by the clock
  expect(glints('15:16', 'read 4')).toBe(true) // and sent again, as a read says
  expect(seen).toEqual({ shown: '15:16', read: 'read 4' })
})

test('motion.css has the keyframes the pages use', () => {
  for (const name of ['grow-w', 'grow-h', 'grow-y', 'sweep', 'stamp', 'glint', 'fade-in']) {
    expect(motionCss).toMatch(new RegExp(`@keyframes ${name}\\s*\\{`))
  }
})

test('a glinting value plays the glint once, for its token', () => {
  expect(motionCss).toMatch(/\.glint\s*\{[^}]*animation:\s*glint var\(--t-glint\)[^;}]*;/)
  expect(motionCss).not.toMatch(/infinite/)
})

test('.sr-only takes no room and is still read by screen readers', () => {
  const rule = /\.sr-only\s*\{([^}]*)\}/.exec(motionCss)?.[1] ?? ''
  expect(rule).toMatch(/position:\s*absolute/)
  expect(rule).toMatch(/width:\s*1px/)
  expect(rule).toMatch(/height:\s*1px/)
  expect(rule).toMatch(/overflow:\s*hidden/)
  expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/) // either would hide it from screen readers too
})

test('with reduced motion every animation and transition is instant, and no delay keeps an element back', () => {
  const reduced = motionCss.slice(motionCss.indexOf('@media (prefers-reduced-motion: reduce)'))
  expect(reduced).toContain('*, *::before, *::after')
  expect(reduced).toMatch(/animation-duration:\s*0s !important/)
  expect(reduced).toMatch(/transition-duration:\s*0s !important/)
  expect(reduced).toMatch(/animation-delay:\s*0s !important/)
  expect(reduced).toMatch(/transition-delay:\s*0s !important/)
})

test('the page loads motion.css', () => {
  expect(main).toContain("import './styles/motion.css'")
})

// The Characters plan, Task U1: what the pages' entrances are made of.
test('a stagger puts each element a step after the one before it, in seconds', () => {
  expect(stagger(0, 0.07)).toBe(0)
  expect(stagger(3, 0.07)).toBeCloseTo(0.21, 10)
  expect(stagger(10, 0.02)).toBeCloseTo(0.2, 10)
})

test('the spring ease overshoots a little and no more', () => {
  const found = /^cubic-bezier\(([^)]+)\)$/.exec(SPRING_EASE)
  expect(found).not.toBeNull()
  const [x1, y1, x2, y2] = (found?.[1] ?? '').split(',').map(Number)
  expect(Math.max(y1, y2)).toBeGreaterThan(1)
  expect(Math.max(y1, y2)).toBeLessThanOrEqual(1.8)
  expect(x1).toBeGreaterThanOrEqual(0)
  expect(x2).toBeLessThanOrEqual(1)
})

/** An element that records the animation it is given, as the Web Animations API would take it. */
function recorder(extra: object = {}) {
  const animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation)
  return { element: { animate, ...extra } as unknown as SVGGeometryElement & HTMLElement, animate }
}

test('a line draws itself by its stroke dash, from nothing to all of its length', () => {
  const { element, animate } = recorder({ getTotalLength: () => 240 })
  drawLine(element, { delay: 0.5 })
  expect(animate).toHaveBeenCalledOnce()
  const [frames, options] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions]
  expect(frames[0]).toMatchObject({ strokeDasharray: '240', strokeDashoffset: 240 })
  expect(frames[frames.length - 1]).toMatchObject({ strokeDashoffset: 0 })
  expect(options.delay).toBe(500)
  expect(options.duration).toBeGreaterThan(0)
})

test('a clip reveal uncovers an element from the side it starts on', () => {
  const left = recorder()
  clipReveal(left.element)
  const [frames] = left.animate.mock.calls[0] as unknown as [Keyframe[]]
  expect(frames[0].clipPath).toBe('inset(0 100% 0 0)')
  expect(frames[frames.length - 1].clipPath).toBe('inset(0 0% 0 0)')
  const right = recorder()
  clipReveal(right.element, { from: 'right' })
  const [fromRight] = right.animate.mock.calls[0] as unknown as [Keyframe[]]
  expect(fromRight[0].clipPath).toBe('inset(0 0 0 100%)')
})

test('elements rise in one after another, each a step later', () => {
  const [a, b, c] = [recorder(), recorder(), recorder()]
  rise([a.element, b.element, c.element], { step: 0.05, start: 0.1 })
  const delays = [a, b, c].map((one) => (one.animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions])[1].delay)
  expect(delays[0]).toBeCloseTo(100, 6)
  expect(delays[1]).toBeCloseTo(150, 6)
  expect(delays[2]).toBeCloseTo(200, 6)
})

test('with reduced motion no line draws, no clip reveals and nothing rises', () => {
  reduceMotion(true)
  const line = recorder({ getTotalLength: () => 100 })
  expect(drawLine(line.element)).toBeNull()
  const clip = recorder()
  expect(clipReveal(clip.element)).toBeNull()
  const one = recorder()
  rise([one.element])
  expect(line.animate).not.toHaveBeenCalled()
  expect(clip.animate).not.toHaveBeenCalled()
  expect(one.animate).not.toHaveBeenCalled()
})

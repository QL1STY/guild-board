import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
// The stylesheet is read as text with Vite's ?raw, as in motion.test.ts.
import marksCss from '../styles/marks.css?raw'
import { Bar, Dial, Pips, SegmentRing, Seal } from './marks.tsx'

/** The attribute a piece of markup gives an element of the class, or null. */
function attribute(markup: string, selector: string, name: string): string | null {
  const element = new RegExp(`<[a-z]+ [^>]*class="[^"]*\\b${selector}\\b[^"]*"[^>]*>`).exec(markup)?.[0]
  return element === undefined ? null : (new RegExp(`${name}="([^"]*)"`).exec(element)?.[1] ?? null)
}

test('pips are one diamond each, the filled ones marked, and named for a screen reader as a picture', () => {
  const markup = renderToStaticMarkup(createElement(Pips, { total: 4, filled: 3, label: '3 of 4 done' }))
  expect(markup).toMatch(/^<span class="pips" role="img" aria-label="3 of 4 done">/)
  expect(markup.match(/<i[ >]/g)).toHaveLength(4)
  expect(markup.match(/<i class="on">/g)).toHaveLength(3)
})

test('pips are dotted where the number is not known', () => {
  const known = renderToStaticMarkup(createElement(Pips, { total: 3, filled: 0, label: 'Not read' }))
  const unknown = renderToStaticMarkup(createElement(Pips, { total: 3, filled: 0, unknown: true, label: 'Not read' }))
  expect(known).toContain('class="pips"')
  expect(unknown).toContain('class="pips unknown"')
})

test('pips never fill more than they have, or fewer than none', () => {
  const filled = (count: number) =>
    renderToStaticMarkup(createElement(Pips, { total: 3, filled: count, label: 'x' })).match(/<i class="on">/g)?.length ?? 0
  expect(filled(5)).toBe(3)
  expect(filled(-1)).toBe(0)
  expect(filled(1.9)).toBe(1)
})

test('a bar is hidden from screen readers, its fill the share of the maximum, and the share kept from 0 to 100', () => {
  const bar = (value: number, max: number, notches?: number) =>
    renderToStaticMarkup(createElement(Bar, { value, max, notches }))
  expect(bar(1219, 1854)).toMatch(/^<span class="bar" aria-hidden="true">/)
  expect(attribute(bar(5, 10), 'bar-fill', 'style')).toBe('width:50%')
  expect(attribute(bar(15, 10), 'bar-fill', 'style')).toBe('width:100%')
  expect(attribute(bar(-3, 10), 'bar-fill', 'style')).toBe('width:0%')
  expect(attribute(bar(3, 0), 'bar-fill', 'style')).toBe('width:0%') // nothing to measure against
})

test('a bar draws the notches it is given, one between each two of its parts', () => {
  const marks = (notches?: number) =>
    renderToStaticMarkup(createElement(Bar, { value: 1, max: 2, notches })).match(/class="bar-notch"/g)?.length ?? 0
  expect(marks()).toBe(0)
  expect(marks(7)).toBe(6) // a week of seven days
  expect(marks(1)).toBe(0)
  const week = renderToStaticMarkup(createElement(Bar, { value: 1, max: 2, notches: 7 }))
  expect(week).toContain('style="left:14.286%"')
  expect(week).toContain('style="left:85.714%"')
})

test('a seal is a word on the plate; the star is drawn by the stylesheet', () => {
  expect(renderToStaticMarkup(createElement(Seal, null, 'Full'))).toBe('<span class="seal">Full</span>')
})

test('a seal can be quiet, for a state that is off: the muted ink on the plate, not the ready green', () => {
  expect(renderToStaticMarkup(createElement(Seal, { quiet: true, children: 'Not playing' }))).toBe('<span class="seal quiet">Not playing</span>')
  expect(marksCss).toMatch(/\.seal\.quiet\s*\{[^}]*background:\s*var\(--w-plate\)/)
  expect(marksCss).toMatch(/\.seal\.quiet\s*\{[^}]*color:\s*var\(--w-muted\)/)
})

test('a ring of segments measures its circles in the maximum, so that the fill is the value', () => {
  const markup = renderToStaticMarkup(createElement(SegmentRing, { value: 77, max: 200, segment: 20 }))
  expect(markup).toMatch(/^<div class="ring"><svg [^>]*aria-hidden="true"/)
  expect(markup.match(/pathLength="200"/g)).toHaveLength(3)
  expect(attribute(markup, 'r-fill', 'style')).toBe('stroke-dasharray:77 200')
  expect(attribute(markup, 'r-track', 'style')).toBeNull()
})

test('a ring of segments leaves a small gap every segment, centred on the segment boundaries', () => {
  const markup = renderToStaticMarkup(createElement(SegmentRing, { value: 77, max: 200, segment: 20 }))
  // Twenty resin to a segment: a gap of 1.6 in every 20 of the 200, half of it either side of the boundary.
  expect(attribute(markup, 'r-gaps', 'style')).toBe('stroke-dasharray:1.6 18.4;stroke-dashoffset:0.8')
  const other = renderToStaticMarkup(createElement(SegmentRing, { value: 30, max: 100, segment: 25 }))
  expect(attribute(other, 'r-fill', 'style')).toBe('stroke-dasharray:30 100')
  expect(attribute(other, 'r-gaps', 'style')).toBe('stroke-dasharray:0.8 24.2;stroke-dashoffset:0.4')
})

test('a ring of segments never fills past the maximum, and holds what it is given inside it', () => {
  const full = renderToStaticMarkup(createElement(SegmentRing, { value: 230, max: 200, segment: 20 }))
  expect(attribute(full, 'r-fill', 'style')).toBe('stroke-dasharray:200 200')
  const inside = renderToStaticMarkup(createElement(SegmentRing, { value: 1, max: 200, segment: 20 }, createElement('b', null, 'in')))
  expect(inside).toContain('<div class="ring-in"><b>in</b></div>')
})

test('a ring can mark a point of its circle, such as where soft pity starts, in its own role, --w-pity-mark', () => {
  // A pity card's ring (the Pulls plan, Task 11): 61 of 90, no segments, soft pity marked at the 74th wish.
  const markup = renderToStaticMarkup(createElement(SegmentRing, { value: 61, max: 90, segment: 0, mark: 74 }))
  expect(markup).not.toContain('r-gaps')
  expect(attribute(markup, 'r-fill', 'style')).toBe('stroke-dasharray:61 90')
  // A short dash, 1.2% of the circle, centred on 74 of the 90.
  expect(attribute(markup, 'r-mark', 'style')).toBe('stroke-dasharray:1.08 88.92;stroke-dashoffset:-73.46')
  expect(marksCss).toMatch(/\.ring > svg \.r-mark\s*\{[^}]*stroke:\s*var\(--w-pity-mark\)/)
  // Resin's ring has none.
  expect(renderToStaticMarkup(createElement(SegmentRing, { value: 77, max: 200, segment: 20 }))).not.toContain('r-mark')
})

test('a dial fills to the progress, in the circle that is a hundred long', () => {
  const markup = renderToStaticMarkup(createElement(Dial, { progress: 0.17, ready: false, children: 'art' }))
  expect(markup).toMatch(/^<span class="dial">/)
  expect(markup.match(/pathLength="100"/g)).toHaveLength(2)
  expect(attribute(markup, 'd-fill', 'style')).toBe('stroke-dasharray:17 100')
  expect(markup).toContain('<span class="dial-art">art</span>')
  expect(markup).not.toContain('dial-tick')
})

test('a ready dial is full, and green, with a tick badge, whatever progress it was given', () => {
  const markup = renderToStaticMarkup(createElement(Dial, { progress: 0.4, ready: true, children: 'art' }))
  expect(markup).toMatch(/^<span class="dial ready">/)
  expect(attribute(markup, 'd-fill', 'style')).toBe('stroke-dasharray:100 100')
  expect(markup).toMatch(/<span class="dial-tick"><svg /) // the drawn tick
})

test('a dial with no known progress is an empty track', () => {
  const markup = renderToStaticMarkup(createElement(Dial, { progress: null, ready: false, children: 'art' }))
  expect(markup).toContain('d-track')
  expect(markup).not.toContain('d-fill')
})

test('a dial is as large as it is asked to be', () => {
  const markup = renderToStaticMarkup(createElement(Dial, { progress: 0.5, ready: false, size: '38px', children: 'art' }))
  expect(markup).toMatch(/^<span class="dial" style="--size:38px">/)
})

test('marks.css draws with the widget roles and no colour of its own', () => {
  expect(marksCss).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  expect(marksCss).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/i)
  for (const role of ['--w-fill', '--w-track', '--w-outline', '--w-good', '--w-done', '--w-gap']) {
    expect(marksCss, role).toContain(`var(${role})`)
  }
  // A mark lies on the panel: what is drawn in the background's colour over it is in the opaque gap colour, which lets
  // none of the mark through on the overlay's see-through panel (widgetcss.test.ts).
  expect(marksCss).not.toContain('var(--w-bg)')
})

test('the seal has scooped corners where the window draws them, and a star the screen reader skips', () => {
  expect(marksCss).toMatch(/\.seal\s*\{[^}]*corner-shape:\s*scoop/)
  expect(marksCss).toMatch(/\.seal::before\s*\{[^}]*content:\s*'✦' \/ ''/)
})

test('the marks that fill play once, with the keyframes of motion.css and the tokens', () => {
  expect(marksCss).toMatch(/\.bar-fill\s*\{[^}]*animation:\s*grow-w var\(--t-enter\) var\(--ease-out\)/)
  expect(marksCss).toMatch(/\.r-fill\s*\{[^}]*animation:\s*sweep var\(--t-enter\) var\(--ease-out\)/)
  expect(marksCss).toMatch(/\.d-fill\s*\{[^}]*animation:\s*sweep var\(--t-enter\) var\(--ease-out\)/)
  expect(marksCss).toMatch(/\.pips i\.on\s*\{[^}]*animation:\s*stamp var\(--t-state\) var\(--ease-stamp\)/)
  expect(marksCss).not.toMatch(/infinite/)
})

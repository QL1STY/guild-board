import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { currentTip } from '../pages/characters/Tip.tsx'
import { CalendarChip } from './CalendarChip.tsx'
import { FreshRing } from './FreshRing.tsx'
import type { FreshView } from './freshview.ts'

const view: FreshView = {
  tone: 'gold', fill: 0.5, label: '2 min ago', tip: 'Read from HoYoLAB 2 min ago. Reads again by itself in 28 minutes.', turning: false,
}
const draw = (over: Partial<FreshView>, onPress?: () => void) =>
  renderToStaticMarkup(createElement(FreshRing, { view: { ...view, ...over }, onPress, testId: 'fresh-test' }))

test('with a press to give it is a button, and without one a mark with a role and a name', () => {
  const button = draw({}, () => undefined)
  expect(button).toContain('<button')
  expect(button).not.toContain('role="img"')
  const mark = draw({})
  expect(mark).not.toContain('<button')
  expect(mark).toContain('role="img"')
  expect(mark).toContain('tabindex="0"')
})

test('the tip is the name of the ring, in both forms', () => {
  expect(draw({}, () => undefined)).toContain(`aria-label="${view.tip}"`)
  expect(draw({})).toContain(`aria-label="${view.tip}"`)
})

test('the button is aria-disabled while a read runs and not otherwise', () => {
  expect(draw({ turning: true }, () => undefined)).toContain('aria-disabled="true"')
  expect(draw({}, () => undefined)).not.toContain('aria-disabled')
})

test('the label is a status carrying the test id', () => {
  expect(draw({})).toMatch(/<span class="gb-fresh-label" role="status" data-testid="fresh-test">2 min ago<\/span>/)
})

test('the calendar chip is a mark to focus with the range as its words and its tip as its name', () => {
  const markup = renderToStaticMarkup(
    createElement(CalendarChip, { label: '5 Oct – 3 Nov', tip: '5 Oct – 3 Nov. Tracking since 19 Oct.', testId: 'period' }),
  )
  expect(markup).toContain('role="img"')
  expect(markup).toContain('tabindex="0"')
  expect(markup).toContain('aria-label="5 Oct – 3 Nov. Tracking since 19 Oct."')
  expect(markup).toContain('data-testid="period">5 Oct – 3 Nov</span>')
  expect(markup).not.toContain('<button')
})

test('an open tip shows the words the element has now, not the ones it had when it opened', () => {
  const open = { x: 10, y: 20, body: 'Wait 3 minutes.' }
  expect(currentTip(open, 'Try again in 2 minutes.')).toEqual({ x: 10, y: 20, body: 'Try again in 2 minutes.' })
  expect(currentTip(null, 'Try again in 2 minutes.')).toBeNull()
})

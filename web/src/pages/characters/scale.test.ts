import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { ABOVE_CARD, BELOW_CARD, CARD_HEIGHT, charactersScale, rosterScale, scaleStyle } from './scale.ts'
import { Tip } from './Tip.tsx'
import css from './profile.css?raw'

test('the usual window keeps the pages as they are: a card that fits is not scaled', () => {
  expect(charactersScale(1100)).toBe(1)
  expect(charactersScale(1500)).toBe(1)
  expect(charactersScale(ABOVE_CARD + CARD_HEIGHT + BELOW_CARD)).toBe(1)
})

test('a window that is shorter than the whole card scales the pages so the whole card fits, and none is larger than the rest of the app', () => {
  for (const height of [923, 922, 897, 800]) {
    const scale = charactersScale(height)
    expect(scale).toBeLessThan(1)
    expect(ABOVE_CARD + CARD_HEIGHT * scale + BELOW_CARD).toBeLessThanOrEqual(height + 0.001)
    expect(scale).toBeGreaterThan(0.6)
  }
  expect(charactersScale(897)).toBeLessThan(charactersScale(923))
})

test('no window makes the pages smaller than a least, and a window with no height is not a reason to scale', () => {
  expect(charactersScale(300)).toBe(0.6)
  expect(charactersScale(0)).toBe(1)
  expect(charactersScale(Number.NaN)).toBe(1)
})

test('the roster, which has no card to fit, goes a little further down on a full screen so that it shows more characters, and stays as it was in the usual window', () => {
  expect(rosterScale(1)).toBe(1)
  expect(rosterScale(charactersScale(1100))).toBe(1)
  for (const height of [923, 922, 897]) {
    const card = charactersScale(height)
    expect(rosterScale(card)).toBeLessThanOrEqual(card)
    expect(rosterScale(card)).toBe(0.85)
  }
  expect(rosterScale(0.7)).toBe(0.7) // never larger than the card's
  // At 0.85 a window 1,440 pixels wide lays out 1,694 wide: six cards of 262 and a gap to a row, where 1.0 had five.
  expect(Math.floor((1440 / 0.85 + 12) / (262 + 12))).toBe(6)
  expect(Math.floor((1440 + 12) / (262 + 12))).toBe(5)
})

test('the scale is in steps of a hundredth, so that a window dragged by a pixel does not redraw the page', () => {
  expect(charactersScale(900)).toBe(Math.floor(charactersScale(900) * 100) / 100)
})

test('a scaled page is zoomed and says its scale to the rules that need it; an unscaled page has neither', () => {
  expect(scaleStyle(1)).toEqual({ '--cs': 1 })
  expect(scaleStyle(0.9)).toEqual({ zoom: 0.9, '--cs': 0.9 })
})

test('a tip stands where the pointer is whatever the scale: its place is divided by the scale of the page it is in', () => {
  vi.stubGlobal('window', { innerWidth: 1640 })
  const markup = renderToStaticMarkup(createElement(Tip, { tip: { x: 100, y: 200, body: 'Hello' } }))
  vi.unstubAllGlobals()
  expect(markup).toContain('left:calc(114px / var(--cs, 1))')
  expect(markup).toContain('top:calc(216px / var(--cs, 1))')
})

test('the pages of the characters keep the width the rest of the app gives them, counted in the screen\'s pixels', () => {
  expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).toMatch(/\.gb-page\.pf-page\s*\{[^}]*max-width:\s*calc\(1440px \/ var\(--cs, 1\)\)/)
})

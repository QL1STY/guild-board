import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import fixture from '../../fixtures/characters/roster.json'
import type { Roster as RosterModel } from '../../types.ts'
import { RosterGrid } from './Roster.tsx'
import css from './roster.css?raw'
import { ROSTER_HEADING } from './words.ts'
import { CharactersTabs } from './Tabs.tsx'

const roster = fixture as unknown as RosterModel
const grid = (entries = roster.entries) => renderToStaticMarkup(createElement(RosterGrid, { entries }))

/** The markup of one card of the grid, by the character's key. */
function card(markup: string, key: string): string {
  return new RegExp(`<article[^>]*data-key="${key}"[\\s\\S]*?</article>`).exec(markup)?.[0] ?? ''
}

test('characters not owned show greyed with "Not yours yet"', () => {
  const markup = grid()
  const escoffier = card(markup, 'escoffier')
  expect(escoffier).toContain('not-owned')
  expect(escoffier).toContain('Not yours yet')
  expect(escoffier).toContain('On the banner until 3 Nov')
  const sandrone = card(markup, 'sandrone')
  expect(sandrone).not.toContain('not-owned')
  expect(sandrone).not.toContain('Not yours yet')
  expect(sandrone).toContain('Level 90 · C2')
})

test('a character who is not out yet says so, in place of the words for one the player lacks', () => {
  const early = roster.entries.map((entry) => (entry.key === 'escoffier' ? { ...entry, early: true, banner: null } : entry))
  const escoffier = card(grid(early), 'escoffier')
  expect(escoffier).toContain('Not out yet')
  expect(escoffier).not.toContain('Not yours yet')
})

test('every card is a link to the character\'s profile, with her name and no button', () => {
  const sandrone = card(grid(), 'sandrone')
  expect(sandrone).toContain('href="#/characters/sandrone"')
  expect(sandrone).toContain('Sandrone')
  expect(grid()).not.toContain('<button')
  expect(grid()).not.toContain('In focus')
  expect(grid()).not.toContain('Add to focus')
})

test('a card is its link alone: no foot, and the banner inside the link', () => {
  const escoffier = card(grid(), 'escoffier')
  expect(escoffier).not.toContain('cr-foot')
  expect(escoffier).toMatch(/<a[^>]*class="cr-link"[\s\S]*On the banner until 3 Nov[\s\S]*<\/a>/)
})

test('the whole card is the link, with no room left for a foot', () => {
  expect(css).toMatch(/\.cr-card\.whole \.cr-link::after\s*\{[^}]*inset:\s*0/)
})

test('a ring on each owned card shows how ready she is', () => {
  expect(card(grid(), 'odette')).toContain('aria-label="64% ready"')
})

test('the roster has no focus strip and no focus styles', () => {
  expect(css).not.toContain('cr-focus')
  expect(css).not.toContain('cr-fc')
})

test('the Characters tabs link the roster and the endgame, and mark the page shown', () => {
  const markup = renderToStaticMarkup(createElement(CharactersTabs, { view: 'roster' }))
  expect(markup).toContain('href="#/characters"')
  expect(markup).toContain('href="#/characters/endgame"')
  expect(markup).toMatch(/aria-current="page"[^>]*>Roster|href="#\/characters"[^>]*aria-current="page"/)
  expect(markup).toContain('Endgame')
})

const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of a rule of roster.css with exactly this selector. */
function ruleOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(plain)?.[1] ?? ''
}

test('the filter pills and the switches beside them are one height', () => {
  const pill = /(?:^|;|\s)height:\s*(\d+px)/.exec(ruleOf('.cr-pill'))?.[1]
  const seg = /(?:^|;|\s)height:\s*(\d+px)/.exec(ruleOf('.cr-filters .gb-seg'))?.[1]
  expect(pill).toBeDefined()
  expect(seg).toBe(pill)
})

test('the roster is headed Characters, as the design says', () => {
  expect(ROSTER_HEADING).toBe('Characters')
})

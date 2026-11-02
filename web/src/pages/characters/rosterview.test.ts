import { expect, test } from 'vitest'
import fixture from '../../fixtures/characters/roster.json'
import type { Roster, RosterEntry } from '../../types.ts'
import { bannerLine, countLine, focusCards, levelLine, neighbours, NO_FILTERS, searched, sorted, toggleFocus, visible } from './rosterview.ts'
import { FOUR_AT_MOST } from './words.ts'

const roster = fixture as unknown as Roster
const names = (entries: RosterEntry[]) => entries.map((entry) => entry.name)

test('the roster counts what the player has out of all', () => {
  expect(countLine(roster)).toBe('15 of 16 owned')
})

test('the element filter keeps one element, and every element when none is chosen', () => {
  expect(names(visible(roster.entries, NO_FILTERS))).toHaveLength(16)
  expect(names(visible(roster.entries, { ...NO_FILTERS, element: 'Anemo' }))).toEqual(['Jahoda', 'Lan Yan', 'Vesna'])
})

test('the weapon filter, the owned filter and the focus filter each narrow the list, and together', () => {
  expect(names(visible(roster.entries, { ...NO_FILTERS, weapon: 'Polearm' }))).toEqual(['Ineffa', 'Iansan', 'Escoffier'])
  expect(names(visible(roster.entries, { ...NO_FILTERS, weapon: 'Polearm', owned: true }))).toEqual(['Ineffa', 'Iansan'])
  expect(names(visible(roster.entries, { ...NO_FILTERS, inFocus: true }))).toEqual(['Sandrone', 'Odette', 'Alyosha', 'Jahoda'])
  expect(names(visible(roster.entries, { ...NO_FILTERS, inFocus: true, element: 'Cryo' }))).toEqual(['Sandrone', 'Odette'])
  expect(visible(roster.entries, { ...NO_FILTERS, element: 'Geo', weapon: 'Sword' })).toEqual([])
})

test('sorting by readiness puts the most ready first, and the ones not owned last, by name where they tie', () => {
  const order = names(sorted(roster.entries, 'readiness'))
  expect(order.slice(0, 3)).toEqual(['Sandrone', 'Nefer', 'Columbina'])
  expect(order.at(-1)).toBe('Escoffier')
  const tied: RosterEntry[] = [
    { ...roster.entries[0], name: 'Zed', readiness: 50 },
    { ...roster.entries[0], name: 'Abe', readiness: 50 },
  ]
  expect(names(sorted(tied, 'readiness'))).toEqual(['Abe', 'Zed'])
})

test('sorting by level puts the highest first and a character with no level last', () => {
  const order = sorted(roster.entries, 'level')
  expect(order[0].level).toBe(90)
  expect(order.at(-1)?.name).toBe('Escoffier')
  expect(order.map((entry) => entry.level ?? -1)).toEqual([...order.map((entry) => entry.level ?? -1)].sort((a, b) => b - a))
})

test('sorting by name is alphabetical, and by newest keeps the core\'s order', () => {
  expect(names(sorted(roster.entries, 'name')).slice(0, 4)).toEqual(['Aino', 'Alyosha', 'Columbina', 'Dahlia'])
  expect(names(sorted(roster.entries, 'newest'))).toEqual(names(roster.entries))
})

test('sorting leaves the list it was given as it was', () => {
  const before = names(roster.entries)
  sorted(roster.entries, 'name')
  expect(names(roster.entries)).toEqual(before)
})

test('the focus strip lists the focus in its order, by the numbers the core gave', () => {
  expect(names(focusCards(roster))).toEqual(['Sandrone', 'Odette', 'Alyosha', 'Jahoda'])
  expect(focusCards({ ...roster, entries: [...roster.entries].reverse() }).map((entry) => entry.focus)).toEqual([1, 2, 3, 4])
})

test('a character goes into the focus after the others, and out of it leaving the others in order', () => {
  expect(toggleFocus(['sandrone'], 'odette')).toEqual({ focus: ['sandrone', 'odette'] })
  expect(toggleFocus(['sandrone', 'odette', 'alyosha'], 'odette')).toEqual({ focus: ['sandrone', 'alyosha'] })
  expect(toggleFocus([], 'nefer')).toEqual({ focus: ['nefer'] })
})

test('a fifth character is refused with "Four at most: take one out first."', () => {
  const four = ['sandrone', 'odette', 'alyosha', 'jahoda']
  expect(toggleFocus(four, 'nefer')).toEqual({ refused: FOUR_AT_MOST })
  expect(FOUR_AT_MOST).toBe('Four at most: take one out first.')
  // The refusal is only for a fifth: one of the four can still be taken out.
  expect(toggleFocus(four, 'jahoda')).toEqual({ focus: ['sandrone', 'odette', 'alyosha'] })
})

test('a card says her level and constellation, and a character not owned says so', () => {
  const [sandrone] = roster.entries
  expect(levelLine(sandrone)).toBe('Level 90 · C2')
  expect(levelLine({ ...sandrone, constellation: 0 })).toBe('Level 90 · C0')
  expect(levelLine(roster.entries.at(-1) as RosterEntry)).toBe('Not yours yet')
})

test('a banner running now says when it ends, and one to come says when it starts, by the days of server time', () => {
  const escoffier = roster.entries.at(-1) as RosterEntry
  expect(bannerLine(escoffier.banner)).toBe('On the banner until 3 Nov')
  expect(bannerLine({ starts: '2026-11-04T11:00:00+08:00', ends: '2026-11-24T17:59:00+08:00', running: false })).toBe('Banner 4 Nov to 24 Nov')
  expect(bannerLine(null)).toBeNull()
})

test('the search finds a character by any part of her name, in any case, and an empty search finds everyone', () => {
  expect(names(searched(roster.entries, 'sandr'))).toEqual(['Sandrone'])
  expect(names(searched(roster.entries, '  ALYO '))).toEqual(['Alyosha'])
  expect(searched(roster.entries, '')).toHaveLength(16)
  expect(searched(roster.entries, '   ')).toHaveLength(16)
  expect(searched(roster.entries, 'zzz')).toEqual([])
})

test('the search also takes an element word and a weapon type word', () => {
  expect(names(searched(roster.entries, 'anemo'))).toEqual(['Jahoda', 'Lan Yan', 'Vesna'])
  expect(names(searched(roster.entries, 'POLEARM'))).toEqual(['Ineffa', 'Iansan', 'Escoffier'])
  expect(searched(roster.entries, 'catalyst').every((entry) => entry.weapon === 'Catalyst')).toBe(true)
  expect(searched(roster.entries, 'catalyst').length).toBeGreaterThan(0)
})

test('several words must all fit, each in the name, the element or the weapon type', () => {
  expect(names(searched(roster.entries, 'anemo polearm'))).toEqual([])
  expect(names(searched(roster.entries, 'hydro sword'))).toEqual(['Dahlia'])
  expect(searched(roster.entries, 'hydro catalyst').every((entry) => entry.element === 'Hydro' && entry.weapon === 'Catalyst')).toBe(true)
  expect(names(searched(roster.entries, 'lan anemo'))).toEqual(['Lan Yan'])
})

test('the search works with the filters, and the sort orders what is left', () => {
  const shown = visible(roster.entries, { ...NO_FILTERS, owned: true }, 'polearm')
  expect(names(shown)).toEqual(['Ineffa', 'Iansan'])
  expect(names(sorted(shown, 'name'))).toEqual(['Iansan', 'Ineffa'])
  expect(names(visible(roster.entries, { ...NO_FILTERS, inFocus: true }, 'cryo'))).toEqual(['Sandrone', 'Odette'])
  expect(visible(roster.entries, { ...NO_FILTERS, element: 'Anemo' }, 'polearm')).toEqual([])
})

test('the neighbours of a character are the ones before and after her in the order, and none past either end', () => {
  const order = ['a', 'b', 'c']
  expect(neighbours(order, 'b')).toEqual({ previous: 'a', next: 'c' })
  expect(neighbours(order, 'a')).toEqual({ previous: null, next: 'b' })
  expect(neighbours(order, 'c')).toEqual({ previous: 'b', next: null })
  expect(neighbours(order, 'z')).toEqual({ previous: null, next: null })
  expect(neighbours(['only'], 'only')).toEqual({ previous: null, next: null })
})

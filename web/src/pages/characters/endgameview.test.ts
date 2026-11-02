import { expect, test } from 'vitest'
import fixture from '../../fixtures/characters/endgame.json'
import type { Element, Endgame } from '../../types.ts'
import {
  BUILT, backLabel, clearAction, closeLine, closeShown, endgamePath, pickKept, faceOf, modeCards, theaterBody, theaterNote, theaterPick, weakestLine,
} from './endgameview.ts'

const endgame = fixture as unknown as Endgame

test("the modes show a ring each, in the order Spiral Abyss, Imaginarium Theater, Stygian Onslaught, with the core's words", () => {
  const cards = modeCards(endgame)
  expect(cards.map((card) => card.key)).toEqual(['abyss', 'theater', 'stygian'])
  expect(cards.map((card) => card.ring)).toEqual([77, 75, 79])
  expect(cards[0]).toMatchObject({ label: 'Spiral Abyss', value: '33 of 36 stars' })
  expect(cards[1].text).toBe('7 ready in these elements, 1 full team. Ends Sat 31 Oct.')
})

test('a ring is a whole percent from 0 to 100, whatever the core sent', () => {
  const odd = { ...endgame, modes: endgame.modes.map((mode, index) => ({ ...mode, ready: [104.4, -3, 49.5][index] })) }
  expect(modeCards(odd).map((card) => card.ring)).toEqual([100, 0, 50])
})

test('the modes come in the plan\'s order even when the core lists them in another', () => {
  const shuffled = { ...endgame, modes: [...endgame.modes].reverse() }
  expect(modeCards(shuffled).map((card) => card.key)).toEqual(['abyss', 'theater', 'stygian'])
})

test('the now / after your plans switch reads the core with ?after=1', () => {
  expect(endgamePath(false)).toBe('/api/endgame?after=0')
  expect(endgamePath(true)).toBe('/api/endgame?after=1')
})

test('a member under 50% is greyed and one at 50% is not; the first of a team is the one who deals the damage', () => {
  expect(BUILT).toBe(50)
  const [first, second] = endgame.abyss[0].members
  expect(faceOf(first, 0)).toEqual({ dps: true, off: false })
  expect(faceOf({ ...second, ready: 49 }, 1)).toEqual({ dps: false, off: true })
  expect(faceOf({ ...second, ready: 50 }, 1).off).toBe(false)
})

test('picking an element out of three leaves two, and picking a fourth drops the one picked first', () => {
  const month: Element[] = ['Cryo', 'Electro', 'Anemo']
  expect(theaterPick(month, 'Anemo')).toEqual(['Cryo', 'Electro'])
  expect(theaterPick(month, 'Geo')).toEqual(['Electro', 'Anemo', 'Geo'])
  expect(theaterPick(['Cryo'], 'Cryo')).toEqual(['Cryo']) // the last one stays
  expect(theaterPick(['Cryo', 'Electro'], 'Hydro')).toEqual(['Cryo', 'Electro', 'Hydro'])
})

test('the Theater pick is sent as three different elements, and not before there are three', () => {
  expect(theaterBody(['Cryo', 'Electro', 'Geo'])).toEqual({ elements: ['Cryo', 'Electro', 'Geo'] })
  expect(theaterBody(['Cryo', 'Electro'])).toBeNull()
  expect(theaterBody(['Cryo', 'Cryo', 'Geo'])).toBeNull()
})

test("the Theater says whose elements they are: the calendar's, the player's pick, or that the calendar had none", () => {
  const theater = endgame.theater
  expect(theaterNote(theater)).toMatch(/come from HoYoLAB's calendar/)
  expect(theaterNote({ ...theater, from_calendar: false })).toBe('These are your picks for October 2026. Pick three others to see a different month.')
  expect(theaterNote({ ...theater, from_calendar: false, elements: [] })).toBe("This month's elements weren't in HoYoLAB's calendar. Pick them:")
})

test("a pick that is kept offers the way back to the calendar's elements, and the calendar's own show until then", () => {
  const theater = endgame.theater
  expect(pickKept(theater)).toBe(false)
  const kept = { ...theater, elements: ['Pyro', 'Hydro', 'Geo'] as Element[], from_calendar: false }
  expect(pickKept(kept)).toBe(true)
  expect(pickKept({ ...kept, elements: [] })).toBe(false)
  expect(backLabel(kept)).toBe("Back to this month's elements")
  expect(backLabel({ ...kept, calendar_elements: [] })).toBe('Clear the pick')
})

test('"close to counting" is hidden when nobody is close', () => {
  expect(closeShown(endgame.theater)).toBe(true)
  expect(closeShown({ ...endgame.theater, close: [] })).toBe(false)
  expect(closeLine(endgame.theater.close[0])).toBe('Anemo, 40% ready, 10 to go')
})

test('a team says its weakest member in the core\'s own words, and nothing when it has none', () => {
  expect(weakestLine(endgame.abyss[0])).toBe('Its weakest member is Dahlia, at 58%.')
  expect(weakestLine({ ...endgame.abyss[0], note: null })).toBeNull()
})

test('each action to clear everything opens the planner or adds to the focus, in words that need no pronoun', () => {
  const [planner, focus] = endgame.clear
  expect(clearAction(planner)).toEqual({ label: 'Open the planner', href: '#/characters/sandrone/plan', focus: null })
  expect(clearAction(focus)).toEqual({ label: 'Add to your focus', href: null, focus: 'vesna' })
})

import { expect, test } from 'vitest'
import fixture from '../../fixtures/characters/planner.json'
import type { PlanBody, Planner } from '../../types.ts'
import {
  canStep, changeClass, floorsOf, curveMarks, curvePath, curveX, curveY, DAYS_BOX, draftBody, draftFromTyped, emptyDraft, findOdds, firstAt, mainChips, mainOptions,
  nextWeight, resinParts, setsShown, setDraftSlot, setKeyOf, signed, stepLevel, stepTarget, subOptionsFor, weaponsCardFirst, withLevelPiece,
  withMain, withSet, withTalent, withWeapon, withWeight,
} from './plannerview.ts'

const planner = fixture as unknown as Planner
const plan: PlanBody = planner.plan

test('a talent target steps one level at a time, from where she is now to the most', () => {
  expect(stepTarget(9, 1, 9, 10)).toBe(10)
  expect(stepTarget(10, 1, 9, 10)).toBe(10)
  expect(stepTarget(10, -1, 9, 10)).toBe(9)
  expect(stepTarget(9, -1, 9, 10)).toBe(9) // never below what she has
  expect(stepTarget(5, 1, 1, 10)).toBe(6)
})

test("a stepper's buttons rest at the ends of their range", () => {
  expect(canStep(9, -1, 9, 10)).toBe(false)
  expect(canStep(9, 1, 9, 10)).toBe(true)
  expect(canStep(10, 1, 9, 10)).toBe(false)
  expect(canStep(10, -1, 9, 10)).toBe(true)
  // The refinement runs from 1 to 5.
  expect(canStep(1, -1, 1, 5)).toBe(false)
  expect(canStep(5, 1, 1, 5)).toBe(false)
  expect(stepTarget(5, 1, 1, 5)).toBe(5)
})

test('the level target moves between the levels a character is raised to', () => {
  expect(stepLevel(80, 1)).toBe(90)
  expect(stepLevel(90, 1)).toBe(90)
  expect(stepLevel(80, -1)).toBe(70)
  expect(stepLevel(20, -1)).toBe(20)
  expect(stepLevel(85, -1)).toBe(80)
  expect(stepLevel(85, 1)).toBe(90)
  expect(stepLevel(1, 1)).toBe(20)
})

test('the steppers start from the build she has now and never go below it', () => {
  expect(floorsOf(null)).toEqual({ level: 1, refinement: 1, weaponLevel: 1 })
  expect(floorsOf({ level: 80, refinement: 3, weapon_level: 70 })).toEqual({ level: 80, refinement: 3, weaponLevel: 70 })
  expect(floorsOf({ level: 80, refinement: null, weapon_level: null })).toEqual({ level: 80, refinement: 1, weaponLevel: 1 })
  expect(floorsOf(planner.now_build)).toEqual({ level: 90, refinement: 1, weaponLevel: 90 })
  expect(stepLevel(90, -1, 80)).toBe(80)
  expect(stepLevel(80, -1, 80)).toBe(80)
  expect(stepLevel(85, -1, 75)).toBe(80)
  expect(stepLevel(80, -1, 75)).toBe(75)
  expect(stepLevel(75, -1, 75)).toBe(75)
  expect(stepLevel(75, 1, 75)).toBe(80)
})

test("the sets shown are the card's, and the one chosen, until the player asks for every set", () => {
  const options = (tags: (string | null)[]) => tags.map((tag, index) => ({ key: `s${index}`, name: `Set ${index}`, icon: null, text: '', tag }))
  const sets = options(['Hers', 'Best', null, null, null, null])
  expect(setsShown(sets, 's0', false).map((set) => set.key)).toEqual(['s0', 's1'])
  expect(setsShown(sets, 's4', false).map((set) => set.key)).toEqual(['s0', 's1', 's4'])
  expect(setsShown(sets, 's0', true)).toHaveLength(6)
  // A card with no tagged set still shows two to choose from, and what is chosen.
  expect(setsShown(options([null, null, null]), 's2', false).map((set) => set.key)).toEqual(['s0', 's1', 's2'])
  expect(setsShown(options([null, null, null]), 's0', false).map((set) => set.key)).toEqual(['s0', 's1'])
})

test("the weapon list has the card's choices first, in their order, and the rest after them", () => {
  const options = [
    { key: 'a', name: 'A', icon: null, text: '', tag: null },
    { key: 'b', name: 'B', icon: null, text: '', tag: 'Best' },
    { key: 'c', name: 'C', icon: null, text: '', tag: null },
    { key: 'd', name: 'D', icon: null, text: '', tag: 'Hers' },
  ]
  expect(weaponsCardFirst(options).map((option) => option.key)).toEqual(['b', 'd', 'a', 'c'])
  expect(weaponsCardFirst(planner.weapons).map((option) => option.key)).toEqual(planner.weapons.map((option) => option.key))
  expect(weaponsCardFirst(planner.weapons)[0].tag).toBe('Hers')
})

test('each main-stat chip says whether it is the one she wears now, and whether the plan chooses it', () => {
  const goblet = planner.mains[1]
  expect(mainChips(goblet)).toEqual([
    { key: 'dmg', label: 'Cryo DMG Bonus', now: false, pressed: true },
    { key: 'atk_pct', label: 'ATK %', now: true, pressed: false },
  ])
  const sands = planner.mains[0]
  expect(mainChips(sands).find((chip) => chip.key === 'atk_pct')).toMatchObject({ now: true, pressed: true })
})

test('a main stat chosen for a slot replaces the one before, and takes a typed piece of that slot out of the plan', () => {
  const typed: PlanBody = { ...plan, typed: { slot: 'goblet', main: 'dmg', subs: [['cr', 7]], use: true } }
  expect(withMain(typed, 'goblet', 'atk_pct').mains.goblet).toBe('atk_pct')
  expect(withMain(typed, 'goblet', 'atk_pct').typed).toBeNull()
  expect(withMain(typed, 'sands', 'er').typed).not.toBeNull()
  expect(withMain(plan, 'sands', 'er').mains).toEqual({ sands: 'er', goblet: 'dmg', circlet: 'cr' })
  expect(plan.mains.sands).toBe('atk_pct') // the plan it was given is left as it was
})

test('talents, weapon, set, levelled pieces and weights each change one part of the plan', () => {
  expect(withTalent(plan, 'normal', 9).talents).toEqual({ normal: 9, skill: 10, burst: 10 })
  expect(withWeapon(plan, 'verdict')).toMatchObject({ weapon: 'verdict' })
  expect(withLevelPiece(plan, 'plume', false).level_pieces).toEqual([])
  expect(withLevelPiece(plan, 'goblet', true).level_pieces).toEqual(['plume', 'goblet'])
  expect(withLevelPiece(withLevelPiece(plan, 'goblet', true), 'goblet', true).level_pieces).toEqual(['plume', 'goblet'])
  expect(withWeight(plan, 'em', 'none').weights.em).toBe('none')
  expect(withWeight(plan, 'em', 'none').weights.cr).toBe('wants')
})

test('a set is a key of its sets joined by "+", and two sets mean 2 and 2', () => {
  expect(setKeyOf(plan.set)).toBe('disenchantment-in-deep-shadow')
  expect(setKeyOf({ sets: ['a', 'b'], pieces: '2+2' })).toBe('a+b')
  expect(setKeyOf(null)).toBe('')
  expect(withSet(plan, 'blizzard-strayer').set).toEqual({ sets: ['blizzard-strayer'], pieces: '4' })
  expect(withSet(plan, 'disenchantment-in-deep-shadow+blizzard-strayer').set).toEqual({
    sets: ['disenchantment-in-deep-shadow', 'blizzard-strayer'],
    pieces: '2+2',
  })
})

test('a substat\'s weight cycles from wants to some use to no use and round again', () => {
  expect(nextWeight('wants')).toBe('some')
  expect(nextWeight('some')).toBe('none')
  expect(nextWeight('none')).toBe('wants')
})

test("\"Try a piece\" has no body until a substat is typed, and then sends the piece as typed", () => {
  const draft = emptyDraft('goblet', 'Cryo')
  expect(draftBody(draft, false)).toBeNull()
  const typed = { ...draft, subs: [['cr', '7.0'], ['cd', '14'], ['', ''], ['atk_pct', '']] as [string, string][] }
  expect(draftBody(typed, false)).toEqual({ slot: 'goblet', main: 'dmg', subs: [['cr', 7], ['cd', 14]], use: false })
  expect(draftBody(typed, true)?.use).toBe(true)
  // A value that is not a number, or is zero, leaves its substat out; so does a substat with no stat.
  const odd = { ...draft, subs: [['cr', 'x'], ['cd', '0'], ['', '5'], ['er', '5.2']] as [string, string][] }
  expect(draftBody(odd, false)?.subs).toEqual([['er', 5.2]])
})

test("a slot's main stats are the game's, and the Goblet's own-element DMG Bonus is named for her element", () => {
  expect(mainOptions('flower', 'Cryo').map((option) => option.key)).toEqual(['hp'])
  expect(mainOptions('plume', 'Cryo').map((option) => option.key)).toEqual(['atk'])
  expect(mainOptions('sands', 'Cryo').map((option) => option.key)).toEqual(['atk_pct', 'hp_pct', 'def_pct', 'er', 'em'])
  expect(mainOptions('goblet', 'Pyro')[0]).toEqual({ key: 'dmg', label: 'Pyro DMG Bonus' })
  expect(mainOptions('goblet', 'Pyro').map((option) => option.key)).toContain('phys')
  expect(mainOptions('circlet', 'Cryo').map((option) => option.key)).toEqual(['cr', 'cd', 'atk_pct', 'hp_pct', 'def_pct', 'heal', 'em'])
})

test("a piece's substats leave out its own main stat", () => {
  expect(subOptionsFor('atk_pct').map((option) => option.key)).not.toContain('atk_pct')
  expect(subOptionsFor('atk_pct')).toHaveLength(9)
  expect(subOptionsFor('dmg')).toHaveLength(10)
})

test('changing the typed piece\'s slot gives it that slot\'s first main stat, and takes its main stat out of the substats', () => {
  const draft = { ...emptyDraft('goblet', 'Cryo'), subs: [['cr', '7'], ['atk_pct', '5'], ['', ''], ['', '']] as [string, string][] }
  const moved = setDraftSlot(draft, 'plume', 'Cryo')
  expect(moved.slot).toBe('plume')
  expect(moved.main).toBe('atk')
  const same = setDraftSlot({ ...draft, main: 'atk_pct' }, 'goblet', 'Cryo')
  expect(same.main).toBe('atk_pct')
  const sands = setDraftSlot({ ...draft, subs: [['cr', '7'], ['atk_pct', '5'], ['', ''], ['', '']] }, 'sands', 'Cryo')
  expect(sands.main).toBe('atk_pct')
  expect(sands.subs[1]).toEqual(['', '']) // atk_pct is the main stat now
})

test('the days curve places a day across the box, and a chance up the box', () => {
  const days = planner.days.points.length - 1
  expect(days).toBe(49)
  expect(curveX(0, days)).toBe(44)
  expect(curveX(days, days)).toBe(DAYS_BOX.width - 12)
  expect(curveY(0)).toBe(DAYS_BOX.height - 26)
  expect(curveY(1)).toBe(14)
  expect(curveY(0.5)).toBe((14 + DAYS_BOX.height - 26) / 2)
})

test('the days curve is a path through every point', () => {
  const path = curvePath(planner.days.points)
  expect(path.startsWith('M44,')).toBe(true)
  expect(path.match(/L/g)).toHaveLength(49)
  expect(curvePath([])).toBe('')
})

test('the 50% and the 90% marks are the first days the chance reaches them', () => {
  expect(firstAt(planner.days.points, 0.5)).toBe(14)
  expect(firstAt(planner.days.points, 0.9)).toBe(46)
  expect(firstAt([0.1, 0.2], 0.5)).toBeNull()
  expect(firstAt([0.6], 0.5)).toBe(0)
})

test('the marks carry the core\'s own dates, and are not drawn where the plan is ready', () => {
  const marks = curveMarks(planner.days)
  expect(marks.map((mark) => mark.label)).toEqual(['Half a chance, Sun 8 Nov', 'Nine in ten, Thu 10 Dec'])
  expect(marks.map((mark) => mark.day)).toEqual([14, 46])
  expect(curveMarks({ ...planner.days, half: null, most: null })).toEqual([])
  expect(curveMarks({ ...planner.days, most: null }).map((mark) => mark.day)).toEqual([14])
})

test('a change reads as up, down or none, by its sign', () => {
  expect(changeClass('+0.8')).toBe('up')
  expect(changeClass('−420')).toBe('down')
  expect(changeClass('no change')).toBe('same')
  expect(signed(35)).toBe('+35%')
  expect(signed(-5)).toBe('−5%')
  expect(signed(0)).toBe('+0%')
})

test("today's resin is cut into the runs it goes on, and what is left over", () => {
  const parts = resinParts(planner.takes)
  expect(parts.map((part) => [part.label, part.resin])).toEqual([
    ['Her book, 6 runs', 120],
    ['The Doctor', 30],
    ['Her pieces', 40],
    ['The rest', 10],
  ])
  expect(parts.map((part) => part.share)).toEqual([60, 15, 20, 5])
  expect(resinParts({ ...planner.takes, resin_today: [] }).map((part) => part.label)).toEqual(['The rest'])
  expect(resinParts({ ...planner.takes, resin_today: [{ label: 'Everything', resin: 210 }] })).toEqual([
    { label: 'Everything', resin: 210, share: 100, tone: 0 },
  ])
})

test('the odds of a piece come from its chance in a run, as "about 1 in 181 runs"', () => {
  expect(findOdds(planner.takes.find[0])).toBe('About 1 in 181 runs')
  expect(findOdds({ ...planner.takes.find[0], per_run: 0 })).toBe('Not in a run')
})

test("a plan's typed piece comes back into the form as the text typed, padded to four substats", () => {
  const typed = { slot: 'goblet' as const, main: 'dmg', subs: [['cr', 7], ['cd', 14.5]] as [string, number][], use: true }
  expect(draftFromTyped(typed, 'Cryo')).toEqual({ slot: 'goblet', main: 'dmg', subs: [['cr', '7'], ['cd', '14.5'], ['', ''], ['', '']] })
  expect(draftFromTyped(null, 'Cryo')).toEqual(emptyDraft('goblet', 'Cryo'))
  expect(draftBody(draftFromTyped(typed, 'Cryo'), true)).toEqual(typed)
})

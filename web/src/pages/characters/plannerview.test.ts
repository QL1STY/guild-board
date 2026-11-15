import { expect, test } from 'vitest'
import fixture from '../../fixtures/characters/planner.json'
import type { PlanBody, Planner } from '../../types.ts'
import { floorsOf, listStale, mainOptions, nextWeight, stepLevel, stepTarget, withTalent } from './plannerview.ts'

const planner = fixture as unknown as Planner
const plan: PlanBody = planner.plan

test('a talent target steps one level at a time, from where she is now to the most', () => {
  expect(stepTarget(9, 1, 9, 10)).toBe(10)
  expect(stepTarget(10, 1, 9, 10)).toBe(10)
  expect(stepTarget(10, -1, 9, 10)).toBe(9)
  expect(stepTarget(9, -1, 9, 10)).toBe(9) // never below what she has
  expect(stepTarget(5, 1, 1, 10)).toBe(6)
  // The refinement runs from 1 to 5.
  expect(stepTarget(1, -1, 1, 5)).toBe(1)
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
  expect(floorsOf({ level: 80, constellation: 0, refinement: 3, weapon_level: 70 })).toEqual({ level: 80, refinement: 3, weaponLevel: 70 })
  expect(floorsOf({ level: 80, constellation: 0, refinement: null, weapon_level: null })).toEqual({ level: 80, refinement: 1, weaponLevel: 1 })
  expect(floorsOf(planner.now_build)).toEqual({ level: 90, refinement: 1, weaponLevel: 90 })
  expect(stepLevel(90, -1, 80)).toBe(80)
  expect(stepLevel(80, -1, 80)).toBe(80)
  expect(stepLevel(85, -1, 75)).toBe(80)
  expect(stepLevel(80, -1, 75)).toBe(75)
  expect(stepLevel(75, -1, 75)).toBe(75)
  expect(stepLevel(75, 1, 75)).toBe(80)
})

test('a talent change changes one part of the plan', () => {
  expect(withTalent(plan, 'normal', 9).talents).toEqual({ normal: 9, skill: 10, burst: 10 })
})

test("a substat's weight cycles from wants to some use to no use and round again", () => {
  expect(nextWeight('wants')).toBe('some')
  expect(nextWeight('some')).toBe('none')
  expect(nextWeight('none')).toBe('wants')
})

test("a slot's main stats are the game's, and the Goblet's own-element DMG Bonus is named for her element", () => {
  expect(mainOptions('flower', 'Cryo').map((option) => option.key)).toEqual(['hp'])
  expect(mainOptions('plume', 'Cryo').map((option) => option.key)).toEqual(['atk'])
  expect(mainOptions('sands', 'Cryo').map((option) => option.key)).toEqual(['atk_pct', 'hp_pct', 'def_pct', 'er', 'em'])
  expect(mainOptions('goblet', 'Pyro')[0]).toEqual({ key: 'dmg', label: 'Pyro DMG Bonus' })
  expect(mainOptions('goblet', 'Pyro').map((option) => option.key)).toContain('phys')
  expect(mainOptions('circlet', 'Cryo').map((option) => option.key)).toEqual(['cr', 'cd', 'atk_pct', 'hp_pct', 'def_pct', 'heal', 'em'])
})

test('a picker list is read when it was never read, and again when the core reports newer data, not on every render', () => {
  expect(listStale(null, 0)).toBe(true)
  expect(listStale(4, 4)).toBe(false)
  expect(listStale(4, 5)).toBe(true) // the background read filled a weapon's entry: its tile must not stay "Not read yet"
})

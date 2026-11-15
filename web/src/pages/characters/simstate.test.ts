import { expect, test } from 'vitest'
import fixture from '../../fixtures/characters/planner.json'
import type { Planner, PlannerHits, PlannerSim, SetChoice } from '../../types.ts'
import { backToHers, changeMain, changeSubStat, clearedSub, pieceChanged, simWithGear, startState, swapSet, testedStats, totalCv, withPiece, wornSets } from './simstate.ts'

const sim = (fixture as unknown as Planner).sim as PlannerSim
const other: SetChoice = { key: 'other', name: 'Other', icon: null, two_text: 'x', four_text: 'y', two: [{ stat: 'er', value: 20 }] }

test('a test starts as exactly what she wears: nothing changed, her stats, her set once', () => {
  const tested = startState(sim)
  for (const slot of ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const) expect(pieceChanged(sim, tested, slot)).toBe(false)
  expect(testedStats(sim, tested)).toEqual(sim.panel)
  expect(wornSets(tested).map((worn) => [worn.set.key, worn.pieces])).toEqual([['disenchantment-in-deep-shadow', 5]])
  expect(totalCv(sim, tested)).toEqual({ total: 130.6, tier: 0 })
})

test('a changed piece is marked, and goes back to hers with its set', () => {
  const start = startState(sim)
  const level = withPiece(start, 'goblet', { ...start.pieces.goblet!, main: 'dmg' })
  expect(pieceChanged(sim, level, 'goblet')).toBe(true)
  expect(pieceChanged(sim, level, 'flower')).toBe(false)
  expect(backToHers(sim, level, 'goblet')).toEqual(start)
})

test('choosing a set swaps only the pieces of the set pressed, and a 2+2 build keeps its other set', () => {
  const start = startState(sim)
  const two = {
    ...start,
    setOf: { flower: 'a', plume: 'a', sands: 'b', goblet: 'b', circlet: 'c' },
    sets: { ...start.sets, a: { ...other, key: 'a', name: 'A' }, b: { ...other, key: 'b', name: 'B' } },
  }
  expect(wornSets(two).map((worn) => [worn.set.name, worn.pieces])).toEqual([['A', 2], ['B', 2]])
  const swapped = swapSet(two, 'b', other)
  expect(swapped.setOf).toEqual({ flower: 'a', plume: 'a', sands: 'other', goblet: 'other', circlet: 'c' })
  expect(wornSets(swapped).map((worn) => worn.set.name)).toEqual(['A', 'Other'])
  // Both tiles becoming one set is one set worn four times.
  expect(wornSets(swapSet(swapped, 'a', other)).map((worn) => [worn.set.key, worn.pieces])).toEqual([['other', 4]])
})

test('a set with 2 pieces counts its 2-piece stats once, and a build with no set counts none', () => {
  const start = startState(sim)
  const swapped = swapSet(start, 'disenchantment-in-deep-shadow', other)
  const stats = testedStats(sim, swapped)
  expect(stats.er).toBeCloseTo(sim.panel.er + 20, 6) // the 2-piece Energy Recharge of the new set
  expect(stats.atk).toBeLessThan(sim.panel.atk) // her old 18% ATK is gone
  const none = { ...start, setOf: { flower: 'a', plume: 'b', sands: 'c', goblet: 'd', circlet: 'e' } }
  expect(wornSets(none)).toEqual([])
})

test('a main stat that a substat already has turns that substat into another, drawn by weight, and keeps its rolls', () => {
  const start = startState(sim)
  const sands = start.pieces.sands! // ATK% main; substats Crit DMG, Crit Rate, Elemental Mastery, DEF
  // Elemental Mastery becomes the main stat: its substat draws a new stat from those the piece does not have.
  const out = changeMain(sands, 'em', sim.tables, () => 0)
  expect(out.piece.main).toBe('em')
  expect(out.piece.subs).toHaveLength(4)
  const changed = out.piece.subs[2]
  expect(changed.tiers).toEqual(sands.subs[2].tiers)
  expect(['em', 'cd', 'cr', 'def']).not.toContain(changed.stat)
  expect(out.said).toBe(`Elemental Mastery moved to the main stat; the substat became ${{ hp: 'HP', atk: 'ATK', hp_pct: 'HP%', atk_pct: 'ATK%', def_pct: 'DEF%', er: 'Energy Recharge' }[changed.stat as 'hp']}.`)
  // No clash: nothing else changes and nothing is said.
  const plain = changeMain(sands, 'er', sim.tables, () => 0)
  expect(plain.piece.subs).toEqual(sands.subs)
  expect(plain.said).toBe('')
})

test('an emptied box takes the typed value off a substat that has rolls, and restores hers on one that has none', () => {
  expect(clearedSub({ stat: 'cd', tiers: [0, 3], typed: 21.8 }, null)).toEqual({ stat: 'cd', tiers: [0, 3], typed: null })
  expect(clearedSub({ stat: 'em', tiers: [], typed: 40 }, 19)).toEqual({ stat: 'em', tiers: [], typed: 19 })
  expect(clearedSub({ stat: 'em', tiers: [], typed: 40 }, null)).toEqual({ stat: 'em', tiers: [], typed: 40 })
})

test('a typed value stays with its stat: a substat that is redrawn or restated drops it, and keeps its rolls or gets one', () => {
  const start = startState(sim)
  const sands = start.pieces.sands! // substats Crit DMG, Crit Rate, Elemental Mastery, DEF
  // Elemental Mastery typed with no rolls (a value from HoYoLAB or the player), then made the main stat: the redrawn substat
  // does not inherit the 40 and gets one roll.
  const typed = { ...sands, subs: sands.subs.map((sub) => (sub.stat === 'em' ? { stat: 'em', tiers: [], typed: 40 } : sub)) }
  const out = changeMain(typed, 'em', sim.tables, () => 0.99)
  const redrawn = out.piece.subs[2]
  expect(redrawn.stat).not.toBe('em')
  expect(redrawn.typed).toBeNull()
  expect(redrawn.tiers).toEqual([3])
  // With rolls it keeps them, and still drops the typed number.
  const rolled = { ...sands, subs: sands.subs.map((sub) => (sub.stat === 'em' ? { stat: 'em', tiers: [0, 2], typed: 40 } : sub)) }
  expect(changeMain(rolled, 'em', sim.tables, () => 0).piece.subs[2].typed).toBeNull()
  expect(changeMain(rolled, 'em', sim.tables, () => 0).piece.subs[2].tiers).toEqual([0, 2])
})

test('changing the stat of a substat does not carry its typed number to the new stat', () => {
  expect(changeSubStat({ stat: 'em', tiers: [], typed: 40 }, 'cr', () => 0)).toEqual({ stat: 'cr', tiers: [0], typed: null })
  expect(changeSubStat({ stat: 'em', tiers: [], typed: 40 }, 'cr', () => 0.6)).toEqual({ stat: 'cr', tiers: [2], typed: null })
  expect(changeSubStat({ stat: 'em', tiers: [1, 3], typed: 40 }, 'cr', () => 0)).toEqual({ stat: 'cr', tiers: [1, 3], typed: null })
  expect(changeSubStat({ stat: 'em', tiers: [1], typed: null }, 'er', () => 0)).toEqual({ stat: 'er', tiers: [1], typed: null })
})

// The planner answer holds the effects of the gear she wears; a weapon or a set the player picks brings its own (the pickers' routes)
const gear = (name: string) => ({ effects: [], toggles: [{ name, label: 'Passive', on: false, covers: [], state: '1' }] })

test('the tested weapon and sets bring their effects to the engine, and hers stay', () => {
  const withHits: PlannerSim = { ...structuredClone(sim), hits: { ...(sim.hits as PlannerHits), weapon_effects: { mine: gear('mine:passive') }, set_effects: { 'disenchantment-in-deep-shadow': gear('s:set4') } } }
  const start = startState(withHits)
  expect(simWithGear(withHits, start)).toBe(withHits) // nothing picked: the same object, so nothing is recomputed
  const picked = swapSet({ ...start, weapon: { ...start.weapon, key: 'theirs', gear: gear('theirs:passive') } }, 'disenchantment-in-deep-shadow', { ...other, gear: gear('other:set2') })
  const next = simWithGear(withHits, picked)
  expect(Object.keys(next.hits!.weapon_effects).sort()).toEqual(['mine', 'theirs'])
  expect(Object.keys(next.hits!.set_effects).sort()).toEqual(['disenchantment-in-deep-shadow', 'other'])
  expect(withHits.hits!.weapon_effects).not.toHaveProperty('theirs') // the answer is never changed
  // a picked item that has no effects adds nothing, and hers is never replaced by a picker's copy
  const plain = { ...start, weapon: { ...start.weapon, key: 'plain' } }
  expect(simWithGear(withHits, plain)).toBe(withHits)
  const again = { ...start, weapon: { ...start.weapon, key: 'mine', gear: gear('other:passive') } }
  expect(simWithGear(withHits, again).hits!.weapon_effects.mine.toggles[0].name).toBe('mine:passive')
})

test('with no hits (the verdict off) the sim is the same', () => {
  const bare: PlannerSim = { ...structuredClone(sim), hits: null }
  expect(simWithGear(bare, startState(bare))).toBe(bare)
})

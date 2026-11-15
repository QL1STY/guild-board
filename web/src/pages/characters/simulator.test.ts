import { expect, test } from 'vitest'
import fixture from '../../fixtures/planner-sim.json'
import type { PlannerSim, SetChoice, SimPiece, Slot, WeaponChoice } from '../../types.ts'
import {
  cvTier, critValue, freshPiece, fromHer, levelUp, reachable, rollBudget, setTier, statsWith, subValue,
  type TestPiece,
} from './simulator.ts'

const sim = fixture as unknown as PlannerSim
const tables = sim.tables
const SLOTS: Slot[] = ['flower', 'plume', 'sands', 'goblet', 'circlet']
const herPieces = Object.fromEntries(sim.pieces.map((p) => [p.slot, fromHer(p)])) as Record<Slot, TestPiece>
const w = sim.weapon!
const herWeapon: WeaponChoice = { key: w.key, name: w.name, icon: w.icon, rarity: w.rarity, base_atk: w.base_atk, sub: w.sub, sub_value: w.sub_value }
const herSets: SetChoice[] = sim.sets.map((s) => ({ key: s.key, name: s.name, icon: s.icon, two_text: s.two_text, four_text: s.four_text, two: s.two }))

/** A random source that answers from a list, and fails loudly when the code asks for more than the test counted on. */
function seq(values: number[]): () => number {
  let i = 0
  return () => {
    if (i >= values.length) throw new Error('asked for more random numbers than the test gave')
    return values[i++]
  }
}

const three: TestPiece = {
  slot: 'sands', main: 'atk_pct', level: 0, rarity: 5, start3: true,
  subs: [
    { stat: 'cd', tiers: [3], typed: null },
    { stat: 'cr', tiers: [0], typed: null },
    { stat: 'em', tiers: [1], typed: null },
  ],
}

test('her own pieces give her own panel', () => {
  expect(statsWith(sim, herPieces, herWeapon, herSets)).toEqual(expect.objectContaining({ atk: 2964.1, cr: 79.4, cd: 176.5 }))
  expect(statsWith(sim, herPieces, herWeapon, herSets)).toEqual(sim.panel)
})

test('an ATK% goblet swapped for Cryo DMG loses 46.6% of base ATK', () => {
  const s = statsWith(sim, { ...herPieces, goblet: { ...herPieces.goblet, main: 'dmg' } }, herWeapon, herSets)
  expect(Math.round(2964.1 - s.atk)).toBe(473)
  expect(s.dmg).toBeCloseTo(46.6, 1)
  expect(s.cd).toBe(176.5)
})

test("another element's DMG goblet adds nothing to her DMG Bonus and takes the ATK% off", () => {
  const s = statsWith(sim, { ...herPieces, goblet: { ...herPieces.goblet, main: 'dmg_other' } }, herWeapon, herSets)
  expect(s.dmg).toBe(0)
  expect(Math.round(2964.1 - s.atk)).toBe(473)
})

test('a Physical DMG goblet counts under physical', () => {
  const s = statsWith(sim, { ...herPieces, goblet: { ...herPieces.goblet, main: 'physical' } }, herWeapon, herSets)
  expect(s.physical).toBeCloseTo(58.3, 1)
  expect(s.dmg).toBe(0)
})

test('a main stat follows its level in the table', () => {
  const s = statsWith(sim, { ...herPieces, flower: { ...herPieces.flower, level: 0 } }, herWeapon, herSets)
  expect(s.hp).toBeCloseTo(20152.4 - (4780 - 717), 1)
})

test('a typed value replaces the rolls', () => {
  const sands = herPieces.sands
  const subs = sands.subs.map((s) => (s.stat === 'cd' ? { ...s, typed: 20.0 } : s))
  const s = statsWith(sim, { ...herPieces, sands: { ...sands, subs } }, herWeapon, herSets)
  expect(s.cd).toBeCloseTo(176.5 - 8.0, 1)
})

test("a flat HP substat is not scaled and HP% acts on base HP", () => {
  const flower = herPieces.flower
  const subs = flower.subs.map((s) => (s.stat === 'er' ? { ...s, stat: 'hp_pct', tiers: [3, 3] } : s))
  const s = statsWith(sim, { ...herPieces, flower: { ...flower, subs } }, herWeapon, herSets)
  // 5.83 + 5.83 = 11.66 -> 11.7% of 13226 base HP, and the 5.2% ER goes
  expect(s.hp).toBeCloseTo(20152.4 + 13226 * 0.117, 0)
  expect(s.er).toBeCloseTo(122.7 - 5.2, 1)
})

test("a swapped weapon changes base ATK (and what it multiplies) and the weapon's substat", () => {
  const other: WeaponChoice = { key: 'x', name: 'X', icon: null, rarity: 5, base_atk: 600, sub: 'atk_pct', sub_value: 41.3 }
  const s = statsWith(sim, herPieces, other, herSets)
  const pctNow = (2964.1 - (258 + 33)) / 1016 - 1
  const want = 2964.1 + (600 - 674) * (1 + pctNow) + 942 * 0.413
  expect(s.atk).toBeCloseTo(want, 1)
  expect(s.cd).toBeCloseTo(176.5 - 44.1, 1)
})

test('reachable: Crit DMG 21.0 is 3 rolls, Crit Rate 3.0 is none, 13.2 is 2', () => {
  expect(reachable('cd', 21.0, tables, 5)).toEqual([3])
  expect(reachable('cr', 3.0, tables, 5)).toEqual([])
  expect(reachable('cd', 13.2, tables, 5)).toContain(2)
})

test('reachable: a flat stat is a whole number, and a 4-star stops at 4 rolls', () => {
  expect(reachable('hp', 299, tables, 5)).toEqual([1])
  expect(reachable('cr', 3.1, tables, 4)).toEqual([1])
  expect(reachable('cd', 24.9, tables, 4)).toEqual([4])    // four 4-star top rolls: 24.88
  expect(reachable('cd', 31.1, tables, 4)).toEqual([])     // five would be needed
  expect(reachable('cd', 31.1, tables, 5)).toContain(5)
})

test('reachable: a sum exactly on a rounding tie can show either neighbour', () => {
  // 5.25 (one 90% ATK% roll) and 8.55 (2.72 + 2.72 + 3.11 of Crit Rate) are on the tie
  expect(reachable('atk_pct', 5.2, tables, 5)).toContain(1)
  expect(reachable('atk_pct', 5.3, tables, 5)).toContain(1)
  expect(reachable('cr', 8.5, tables, 5)).toContain(3)
  expect(reachable('cr', 8.6, tables, 5)).toContain(3)
  expect(reachable('atk_pct', 5.4, tables, 5)).not.toContain(1)
})

test('budget follows level and starting count', () => {
  const p = three
  expect(rollBudget({ ...p, level: 20, start3: false })).toBe(9)
  expect(rollBudget({ ...p, level: 16, start3: true })).toBe(7)
  expect(rollBudget({ ...p, level: 0, start3: true })).toBe(3)
  expect(rollBudget({ ...p, level: 20, start3: true })).toBe(8)
})

test('a 4-star starts with 2 or 3 and has four level-ups', () => {
  const four = { ...three, rarity: 4 }
  expect(rollBudget({ ...four, level: 0, start3: false })).toBe(2)
  expect(rollBudget({ ...four, level: 16, start3: false })).toBe(6)
  expect(rollBudget({ ...four, level: 16, start3: true })).toBe(7)
  expect(rollBudget({ ...four, level: 20, start3: true })).toBe(7)
})

test('a level-up adds a fourth substat first and never repeats a stat or the main stat', () => {
  const rand = seq([0.0, 0.1, 0.5]) // deterministic
  const { piece, said } = levelUp({ ...three, level: 0 }, tables, rand)
  expect(piece.level).toBe(4)
  expect(piece.subs).toHaveLength(4)
  expect(new Set(piece.subs.map((s) => s.stat)).size).toBe(4)
  expect(piece.subs.map((s) => s.stat)).not.toContain(piece.main)
  // the first of the stats still free (HP), at its lowest roll
  expect(piece.subs[3]).toEqual({ stat: 'hp', tiers: [0], typed: null })
  expect(said).toBe('New substat: HP +209')
})

test('a level-up on four substats rolls one of them, each at a quarter', () => {
  const four: TestPiece = { ...three, start3: false, level: 4, subs: [...three.subs, { stat: 'er', tiers: [1], typed: null }] }
  const { piece, said } = levelUp(four, tables, seq([0.8, 0.99]))   // the fourth substat, the top tier
  expect(piece.level).toBe(8)
  expect(piece.subs[3].tiers).toEqual([1, 3])
  expect(piece.subs.slice(0, 3)).toEqual(four.subs.slice(0, 3))
  expect(said).toBe('Energy Recharge +6.5')
  expect(rollBudget(piece)).toBe(rollBudget(four) + 1)
})

test('a level-up clears typed values and stops at the top level', () => {
  const typed: TestPiece = { ...three, subs: three.subs.map((s) => ({ ...s, typed: 9 })) }
  expect(levelUp(typed, tables, seq([0, 0])).piece.subs.every((s) => s.typed === null)).toBe(true)
  const top = { ...three, level: 20, start3: false, subs: [...three.subs, { stat: 'er', tiers: [1], typed: null }] }
  const out = levelUp(top, tables, seq([]))
  expect(out.piece).toEqual(top)
  expect(out.said).toBe('')
  expect(levelUp({ ...top, rarity: 4, level: 16 }, tables, seq([])).said).toBe('')
})

const four = (level: number, rarity = 5, start3 = false, extra = 0): TestPiece => ({
  slot: 'sands', main: 'atk_pct', level, rarity, start3,
  subs: [
    { stat: 'cd', tiers: Array(1 + extra).fill(3), typed: null },
    { stat: 'cr', tiers: [0], typed: null },
    { stat: 'em', tiers: [1], typed: null },
    { stat: 'er', tiers: [1], typed: null },
  ],
})

test('a level-up goes to the next multiple of four, never past the top, and then stops', () => {
  // +18 holds 4 + 4 rolls (start4, 8 of them); one more at +20, then nothing
  const at18 = four(18, 5, false, 4)
  expect(rollBudget(at18)).toBe(8)
  const up = levelUp(at18, tables, seq([0.1, 0.5]))
  expect(up.piece.level).toBe(20)
  expect(up.piece.subs.reduce((n, sub) => n + sub.tiers.length, 0)).toBe(9)
  expect(rollBudget(up.piece)).toBe(9)
  expect(levelUp(up.piece, tables, seq([])).piece).toBe(up.piece)
  // +1 goes to +4 and +13 to +16
  expect(levelUp(four(1, 5, false, 0), tables, seq([0.1, 0.5])).piece.level).toBe(4)
  expect(levelUp(four(13, 5, false, 3), tables, seq([0.1, 0.5])).piece.level).toBe(16)
  // a 4-star at +14 goes to +16 and stops
  const star4 = four(14, 4, true, 2)
  expect(rollBudget(star4)).toBe(6)
  const up4 = levelUp(star4, tables, seq([0.1, 0.5]))
  expect(up4.piece.level).toBe(16)
  expect(levelUp(up4.piece, tables, seq([])).piece).toBe(up4.piece)
  expect(levelUp(up4.piece, tables, seq([])).said).toBe('')
})

test('a piece that already holds every roll it can is not given another', () => {
  const full = four(16, 5, false, 5)       // 9 rolls at +16, a substat at 6: more than a +20 piece can hold
  const out = levelUp(full, tables, seq([]))
  expect(out.piece).toBe(full)
  expect(out.said).toMatch(/already holds all the rolls/)
})

test('a level-up never rolls a substat that is at its most, and says so when none can take one', () => {
  const unsplit = (stat: string): TestPiece['subs'][number] => ({ stat, tiers: [], typed: 5 })
  const none: TestPiece = { ...four(4), subs: ['cd', 'cr', 'em', 'er'].map(unsplit) }
  const out = levelUp(none, tables, seq([]))
  expect(out.piece).toBe(none)
  expect(out.said).toBe('No substat can take another roll')
  // one that can: the split substats are the choice, whatever the draw
  const some: TestPiece = { ...four(4), subs: [unsplit('cd'), unsplit('cr'), { stat: 'em', tiers: [1], typed: null }, unsplit('er')] }
  const rolled = levelUp(some, tables, seq([0.0, 0.9]))
  expect(rolled.piece.subs[2].tiers).toEqual([1, 3])
  expect(rolled.piece.subs[0]).toEqual({ stat: 'cd', tiers: [], typed: 5 })    // typed value with no rolls is kept
})

test('a substat the core could not split into rolls keeps its value', () => {
  const piece: SimPiece = {
    ...sim.pieces[4], subs: [
      { stat: 'cd', value: 19.4, tiers: [] }, { stat: 'cr', value: 6.6, tiers: [0, 3] }, { stat: 'er', value: 6.5, tiers: [3] }, { stat: 'hp', value: 299, tiers: [3] },
    ],
  }
  const mine = fromHer(piece)
  expect(mine.subs[0]).toEqual({ stat: 'cd', tiers: [], typed: 19.4 })
  expect(subValue(mine.subs[0], tables, 5)).toBe(19.4)
  expect(critValue(mine, tables)).toBeCloseTo(19.4 + 2 * 6.6, 5)
  // 5 known rolls and one substat of 1 to 6: +20 holds 8 (start3) or 9: both fit, so the usual count (four) is assumed
  expect(mine.start3).toBe(false)
  const loose: SimPiece = { ...piece, level: 0, subs: [{ stat: 'cd', value: 19.4, tiers: [] }, { stat: 'cr', value: 6.6, tiers: [0] }, { stat: 'er', value: 6.5, tiers: [3] }] }
  expect(fromHer(loose).start3).toBe(true)     // three substats at +0
  // her stats do not change with it
  const own = Object.fromEntries(SLOTS.map((slot) => [slot, slot === 'circlet' ? mine : herPieces[slot]])) as Record<Slot, TestPiece>
  const sameSim: PlannerSim = { ...sim, pieces: sim.pieces.map((p) => (p.slot === 'circlet' ? piece : p)) }
  expect(statsWith(sameSim, own, herWeapon, herSets)).toEqual(sim.panel)
})

test('a new +0 piece has the main stat and 3 or 4 substats, none twice', () => {
  const a = freshPiece('goblet', 'dmg', 5, tables, seq([0.9, 0, 0, 0, 0, 0, 0]))   // 0.9 >= 0.2 odds of four? no: three
  expect(a.start3).toBe(true)
  expect(a.subs).toHaveLength(3)
  const b = freshPiece('goblet', 'dmg', 5, tables, seq([0.1, 0, 0, 0, 0, 0, 0, 0, 0]))
  expect(b.start3).toBe(false)
  expect(b.subs).toHaveLength(4)
  for (const p of [a, b]) {
    expect(p).toMatchObject({ slot: 'goblet', main: 'dmg', level: 0, rarity: 5 })
    expect(new Set(p.subs.map((s) => s.stat)).size).toBe(p.subs.length)
    expect(p.subs.every((s) => s.tiers.length === 1 && s.typed === null)).toBe(true)
  }
  const c = freshPiece('sands', 'atk_pct', 4, tables, seq([0.9, 0, 0, 0, 0]))
  expect(c.subs).toHaveLength(2)
  expect(c.subs.map((s) => s.stat)).not.toContain('atk_pct')
})

test('her own piece knows whether it started with three substats', () => {
  expect(fromHer(sim.pieces[0]).start3).toBe(false)   // her flower holds 9 rolls at +20: 4 + 5
  const start3Piece: SimPiece = { ...sim.pieces[0], level: 0, subs: sim.pieces[0].subs.slice(0, 3).map((s) => ({ ...s, tiers: [s.tiers[0]] })) }
  expect(fromHer(start3Piece).start3).toBe(true)
  expect(fromHer(sim.pieces[0]).subs[0]).toEqual({ stat: 'cd', tiers: [1, 3, 3], typed: null })
  expect(SLOTS.map((s) => herPieces[s].slot)).toEqual(SLOTS)
})

test('a value is the sum of its rolls at display precision', () => {
  expect(subValue({ stat: 'cd', tiers: [1, 3, 3], typed: null }, tables, 5)).toBe(21.8)
  expect(subValue({ stat: 'hp', tiers: [3], typed: null }, tables, 5)).toBe(299)
  expect(subValue({ stat: 'cd', tiers: [1, 3, 3], typed: 20.1 }, tables, 5)).toBe(20.1)
})

test('Crit Value is 2 x Crit Rate + Crit DMG of the shown values', () => {
  for (const p of sim.pieces) expect(critValue(herPieces[p.slot], tables)).toBeCloseTo(p.crit_value, 5)
})

test('CV tiers', () => {
  expect(cvTier(19.4, true)).toBe(2)
  expect(setTier(130.6)).toBe(0)
  expect(cvTier(14.99, false)).toBe(0)
  expect(cvTier(15, false)).toBe(1)
  expect(cvTier(54.4, false)).toBe(6)
  expect(cvTier(46.63, true)).toBe(6)
  expect(setTier(180)).toBe(1)
  expect(setTier(300)).toBe(6)
  for (const p of sim.pieces) expect(cvTier(herPieces[p.slot] && critValue(herPieces[p.slot], tables), p.main === 'cr' || p.main === 'cd')).toBe(p.cv_tier)
})

test('swapping one half of a 2+2 build swaps only its 2-piece stats', () => {
  const choice = (key: string, two: { stat: string; value: number }[]): SetChoice => ({ key, name: key, icon: null, two_text: '', four_text: '', two })
  const A = choice('a', [{ stat: 'atk_pct', value: 18 }])
  const B = choice('b', [{ stat: 'hp_pct', value: 20 }])
  const C = choice('c', [{ stat: 'em', value: 80 }])
  const piece = (slot: Slot, set_key: string, main: string): SimPiece => ({
    slot, icon: null, name: slot, set_key, level: 20, rarity: 5, main, main_value: tables.mains['5'][main][20], subs: [], crit_value: 0, cv_tier: 0,
  })
  const pieces = [piece('flower', 'a', 'hp'), piece('plume', 'a', 'atk'), piece('sands', 'b', 'atk_pct'), piece('goblet', 'b', 'dmg'), piece('circlet', 'a', 'cr')]
  const two: PlannerSim = {
    ...sim,
    panel: { hp: 20000, atk: 2000, def: 800, em: 100, er: 100, cr: 50, cd: 100, dmg: 40, heal: 0, physical: 0 },
    base: { hp: 8000, atk: 900, def: 600 }, char_base_atk: 300,
    weapon: { ...w, base_atk: 600, sub: null, sub_value: 0 },
    sets: [
      { key: 'a', name: 'a', icon: null, pieces: 3, two: A.two, two_text: '', four_text: '' },
      { key: 'b', name: 'b', icon: null, pieces: 2, two: B.two, two_text: '', four_text: '' },
    ],
    pieces,
  }
  const mine = Object.fromEntries(pieces.map((p) => [p.slot, fromHer(p)])) as Record<Slot, TestPiece>
  const myWeapon: WeaponChoice = { key: w.key, name: '', icon: null, rarity: 5, base_atk: 600, sub: null, sub_value: null }
  expect(statsWith(two, mine, myWeapon, [A, B])).toEqual(two.panel)
  const s = statsWith(two, mine, myWeapon, [C, B])
  expect(s.atk).toBeCloseTo(2000 - 900 * 0.18, 1)
  expect(s.em).toBeCloseTo(180, 1)
  expect(s.hp).toBe(20000)
  expect(s.cr).toBe(50)
  const t = statsWith(two, mine, myWeapon, [A, C])
  expect(t.hp).toBeCloseTo(20000 - 8000 * 0.2, 1)
  expect(t.em).toBeCloseTo(180, 1)
  expect(t.atk).toBe(2000)
})

/**
 * What the planner has under test: her pieces, her weapon and her sets as the player has changed them. It lives in the page
 * alone and is forgotten when she leaves it (the design, section 8). All of it is pure: a test starts from her own build and
 * every change returns a new one.
 */
import type { PlannerSim, SetChoice, SimPiece, Slot, WeaponChoice } from '../../types.ts'
import { critValue, cvTier, drawStat, fromHer, setTier, statsWith, tierOf, type StatKey, type Tables, type TestPiece } from './simulator.ts'
import { SLOT_ORDER, statName } from './simview.ts'

export type Tested = {
  pieces: Partial<Record<Slot, TestPiece>>
  /** The set each piece is of. Pieces of her sets are known by `sim.sets`; a picked set is added to `sets`. */
  setOf: Partial<Record<Slot, string>>
  weapon: WeaponChoice
  /** The sets by key: hers, and every one the player picked. */
  sets: Record<string, SetChoice>
}

const NO_WEAPON: WeaponChoice = { key: '', name: 'No weapon', icon: null, rarity: 0, base_atk: null, sub: null, sub_value: null }

export function herWeapon(sim: PlannerSim): WeaponChoice {
  const w = sim.weapon
  return w === null ? NO_WEAPON : { key: w.key, name: w.name, icon: w.icon, rarity: w.rarity, base_atk: w.base_atk, sub: w.sub, sub_value: w.sub_value }
}

export const setChoiceOf = (set: PlannerSim['sets'][number]): SetChoice =>
  ({ key: set.key, name: set.name, icon: set.icon, two_text: set.two_text, four_text: set.four_text, two: set.two })

const herPieceAt = (sim: PlannerSim, slot: Slot): SimPiece | undefined => sim.pieces.find((piece) => piece.slot === slot)

/** The test as it begins: exactly what she wears. */
export function startState(sim: PlannerSim): Tested {
  const pieces: Tested['pieces'] = {}
  const setOf: Tested['setOf'] = {}
  for (const piece of sim.pieces) {
    pieces[piece.slot] = fromHer(piece)
    setOf[piece.slot] = piece.set_key
  }
  return { pieces, setOf, weapon: herWeapon(sim), sets: Object.fromEntries(sim.sets.map((set) => [set.key, setChoiceOf(set)])) }
}

/** What identifies her build, so that a test of an old build is dropped when the core reports a new one. */
export function buildSignature(sim: PlannerSim): string {
  return JSON.stringify([sim.pieces, sim.weapon, sim.sets.map((set) => [set.key, set.pieces])])
}

/** The sets the pieces wear: two or more pieces of one set, in the order of the slots. A build of 4 + 1 has one, of 2 + 2 two. */
export function wornSets(tested: Tested): { set: SetChoice; pieces: number }[] {
  const count = new Map<string, number>()
  for (const slot of SLOT_ORDER) {
    const key = tested.setOf[slot]
    if (key !== undefined) count.set(key, (count.get(key) ?? 0) + 1)
  }
  return [...count].filter(([key, n]) => n >= 2 && tested.sets[key] !== undefined).map(([key, n]) => ({ set: tested.sets[key], pieces: n }))
}

/** The piece differs from hers: its stats, its level, its main stat, or the set it is of. */
export function pieceChanged(sim: PlannerSim, tested: Tested, slot: Slot): boolean {
  const her = herPieceAt(sim, slot)
  const mine = tested.pieces[slot]
  if (her === undefined || mine === undefined) return her !== undefined || mine !== undefined
  return JSON.stringify(mine) !== JSON.stringify(fromHer(her)) || tested.setOf[slot] !== her.set_key
}

export const withPiece = (tested: Tested, slot: Slot, piece: TestPiece): Tested => ({ ...tested, pieces: { ...tested.pieces, [slot]: piece } })

/** One piece back to hers, with its set. */
export function backToHers(sim: PlannerSim, tested: Tested, slot: Slot): Tested {
  const her = herPieceAt(sim, slot)
  const pieces = { ...tested.pieces }
  const setOf = { ...tested.setOf }
  if (her === undefined) {
    delete pieces[slot]
    delete setOf[slot]
  } else {
    pieces[slot] = fromHer(her)
    setOf[slot] = her.set_key
  }
  return { ...tested, pieces, setOf }
}

/** Another set for the pieces of one tile: only the pieces of the set `from` change, the rest of the build stays. */
export function swapSet(tested: Tested, from: string, choice: SetChoice): Tested {
  const setOf = { ...tested.setOf }
  for (const slot of SLOT_ORDER) if (setOf[slot] === from) setOf[slot] = choice.key
  return { ...tested, setOf, sets: { ...tested.sets, [choice.key]: choice } }
}

/**
 * The sim with the effects of the tested weapon and sets in its hits block. The planner answer holds the effects of the gear she wears; a
 * weapon or a set the player picks brings its own (`gear`, from the pickers' routes), and hers are never replaced. The same object when
 * there is nothing to add, so that nothing downstream is computed again.
 */
export function simWithGear(sim: PlannerSim, tested: Tested): PlannerSim {
  const hits = sim.hits
  if (hits === null) return sim
  const weapon = tested.weapon.gear !== undefined && !(tested.weapon.key in hits.weapon_effects) ? tested.weapon : null
  const sets = Object.values(tested.sets).filter((set) => set.gear !== undefined && !(set.key in hits.set_effects))
  if (weapon === null && sets.length === 0) return sim
  return {
    ...sim,
    hits: {
      ...hits,
      weapon_effects: weapon === null ? hits.weapon_effects : { ...hits.weapon_effects, [weapon.key]: weapon.gear! },
      set_effects: { ...hits.set_effects, ...Object.fromEntries(sets.map((set) => [set.key, set.gear!])) },
    },
  }
}

/** The stats she would have with the tested pieces, weapon and sets (unrounded). */
export function testedStats(sim: PlannerSim, tested: Tested): Record<StatKey, number> {
  return statsWith(sim, tested.pieces as Record<Slot, TestPiece>, tested.weapon, wornSets(tested).map((worn) => worn.set))
}

/** A piece's Crit Value and its tier (a Crit Rate or Crit DMG main stat is graded with 7.77 added). */
export function pieceCv(sim: PlannerSim, piece: TestPiece): { cv: number; tier: number } {
  const cv = critValue(piece, sim.tables)
  return { cv, tier: cvTier(cv, piece.main === 'cr' || piece.main === 'cd') }
}

/** The five pieces' Crit Value together, to one decimal, and its tier. */
export function totalCv(sim: PlannerSim, tested: Tested): { total: number; tier: number } {
  const sum = SLOT_ORDER.reduce((total, slot) => {
    const piece = tested.pieces[slot]
    return piece === undefined ? total : total + critValue(piece, sim.tables)
  }, 0)
  const total = Math.round(sum * 10 + 1e-9) / 10
  return { total, tier: setTier(total) }
}

/**
 * A substat that is now another stat. A typed number belongs to the stat it was typed for and is dropped; the rolls stay, and a
 * substat that had none (it was only a typed value) gets one roll at a tier drawn with `rand`, so it still has a value.
 */
export function changeSubStat(sub: TestPiece['subs'][number], stat: string, rand: () => number): TestPiece['subs'][number] {
  return { stat, tiers: sub.tiers.length > 0 ? [...sub.tiers] : [tierOf(rand)], typed: null }
}

/**
 * A piece with another main stat. A substat that has the new main stat cannot stay, since a piece never has its main stat as a
 * substat: it becomes a stat drawn by the game's weights among those the piece does not have, with the rolls it had (its typed number is
 * dropped, since it was typed for the old stat), and
 * `said` tells the player so. Any other change of main stat says nothing.
 */
export function changeMain(piece: TestPiece, main: string, tables: Tables, rand: () => number): { piece: TestPiece; said: string } {
  const clash = piece.subs.findIndex((sub) => sub.stat === main)
  if (clash < 0) return { piece: { ...piece, main }, said: '' }
  const stat = drawStat({ main, subs: piece.subs, rarity: piece.rarity }, tables, rand)
  const subs = piece.subs.map((sub, at) => (at === clash ? changeSubStat(sub, stat, rand) : sub))
  // Element is of no use to a substat's name: only DMG Bonus mains have one, and they are never a substat.
  return { piece: { ...piece, main, subs }, said: `${statName(main, 'Cryo')} moved to the main stat; the substat became ${statName(stat, 'Cryo')}.` }
}

/** A substat whose box was emptied: a substat with rolls goes back to its rolls' sum, and one without keeps hers (or what it had). */
export function clearedSub(sub: TestPiece['subs'][number], hers: number | null): TestPiece['subs'][number] {
  return sub.tiers.length > 0 ? { ...sub, typed: null } : { ...sub, typed: hers ?? sub.typed }
}

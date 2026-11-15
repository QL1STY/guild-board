/**
 * What tools/go-reference runs our damage engine on: the fixture compare-cases.json (or another file of its shape, which `run.py
 * compare --only` and `sheet.py` write) as a world of hits blocks and cases, and our engine on one case. compare.test.ts and
 * toggles.test.ts are the two runners; this file holds no test and ships nowhere (it is under src only so that vitest and tsc see it).
 */
import type { PlannerHits, PlannerSim, SetChoice, WeaponChoice } from '../../types.ts'
import { buckets, countedRows, noChoice, resolveParty, rowDamage, talentChange, type Base, type Choice, type GearWeapon, type Reaction, type Stats } from './damage.ts'
import { simWithGear, startState, swapSet, testedStats } from './simstate.ts'
import { verdictOf } from './verdictview.ts'

/** A weapon or set swap (`run.py compare`, tools/go-reference/compare.py `gear_swap`): the first side as the planner's sim, the effects of the gear it
 * wears, and the weapon and set tested as the pickers' routes give them, each with its own effects. */
export type GearSwap = {
  sim: Pick<PlannerSim, 'panel' | 'base' | 'char_base_atk' | 'weapon' | 'sets' | 'pieces'>
  hits: Pick<PlannerHits, 'weapon_effects' | 'set_effects'>
  weapon_b: WeaponChoice; set_b: SetChoice
  /** the gear's toggles that are on (the `:on` cases); the others are at their own `on` */
  toggles: string[]
}

export type Case = {
  id: string; character: string; /** the name of her hits block when it is not hers alone: her kit at a constellation (`yanfei@c6`) */ kit?: string; constellation?: number; reaction: Reaction | null; error?: string
  weapon?: GearWeapon; sets?: Record<string, number>; base?: Base; panel_a?: Stats; panel_b?: Stats
  go?: { talents: Record<string, number | null>; left_out: string[] }
  ours?: { talents: Record<string, number | null> } | null
  /** A weapon or set swap: `swap` is "weapon" or "set", `sim_set` the set worn; see `oursGear`. */
  swap?: string; sim_set?: string; swap_gear?: GearSwap
}

/** The file's own shape, as far as the runners read it. */
export type Fixture = {
  tolerance: number
  tables: unknown
  gear: unknown
  kits: unknown
  cases: unknown
  /** The weapon and set swaps, with their own sim (absent in a file written before them). */
  gear_cases?: unknown
}

export type World = {
  tolerance: number
  tables: PlannerSim['tables']
  kits: Record<string, PlannerHits>
  cases: Case[]
  gearCases: Case[]
}

/** A character's hits block, by name (hers, or her kit at a constellation, `yanfei@c6`): its own part, and her weapon type's weapon and sets (kept once per weapon type). */
export function worldOf(data: Fixture): World {
  const gear = data.gear as Record<string, Pick<PlannerHits, 'weapon_effects' | 'set_effects'>>
  const own = data.kits as Record<string, Omit<PlannerHits, 'weapon_effects' | 'set_effects'>>
  const kits = Object.fromEntries(Object.entries(own).map(([key, part]) => [key, { ...part, ...gear[part.weapon_type.toLowerCase()] } as PlannerHits]))
  return {
    tolerance: data.tolerance, tables: data.tables as PlannerSim['tables'], kits,
    cases: (data.cases as Case[]).filter((c) => c.error === undefined),
    gearCases: ((data.gear_cases ?? []) as Case[]).filter((c) => c.error === undefined),
  }
}

export type Answer = { talents: Record<string, number | null>; rows: Record<string, { a: number; b: number }>; stats: Stats[] }

/** Our engine on one case: each main talent's change and each counted row's damage in both builds. */
export function ours(world: World, c: Case): Answer {
  if (c.swap_gear !== undefined) return oursGear(world, c)
  const choice: Choice = { ...noChoice(), reaction: c.reaction ? { normal: c.reaction, skill: c.reaction, burst: c.reaction } : {} }
  // her usual team (the case sets GO's to the same)
  const hits = resolveParty(world.kits[c.kit ?? c.character], choice)
  const now = buckets(c.panel_a!, hits, c.weapon!, c.sets!, choice, { base: c.base! })
  const tested = buckets(c.panel_b!, hits, c.weapon!, c.sets!, choice, { base: c.base! })
  const talents: Record<string, number | null> = {}
  const rows: Record<string, { a: number; b: number }> = {}
  for (const t of hits.talents) {
    if (!t.main || countedRows(t).length === 0) continue
    // With a reaction on, the rows GO never lets react (the plunge's collision, Blood Blossom) are left out on both sides.
    const kept = countedRows(t).filter((row) => !(c.go?.left_out ?? []).includes(`${t.key}|${row.name}`))
    let before = 0
    let after = 0
    for (const row of kept) {
      const pair = { a: rowDamage(row, t, now, hits, world.tables, choice), b: rowDamage(row, t, tested, hits, world.tables, choice) }
      // a row that takes the team's element is a row of each element, one row in GO's answer: their damage is summed
      const key = `${t.key}|${row.name}`
      rows[key] = { a: (rows[key]?.a ?? 0) + pair.a, b: (rows[key]?.b ?? 0) + pair.b }
      before += pair.a
      after += pair.b
    }
    talents[t.key] = kept.length === countedRows(t).length ? talentChange(t, now, tested, hits, world.tables, choice)
      : before > 0 ? (after / before - 1) * 100 : null
  }
  return { talents, rows, stats: [now.stats, tested.stats] }
}

/**
 * Our engine on a weapon or set swap the way the planner runs it: her build is a sim (HoYoLAB's panel, her base values, the five pieces, her
 * weapon and set), the planner answer holds the effects of the gear she wears alone, the player tests the weapon or set of the picker's choice
 * (`swapSet`, `simWithGear` brings its effects), and the tested stats are `statsWith`'s (the panel and the difference of the gear). The answer is the
 * verdict's, each main talent's change.
 */
export function oursGear(world: World, c: Case): Answer {
  const g = c.swap_gear!
  const block = world.kits[c.kit ?? c.character]
  const hits: PlannerHits = { ...block, ...g.hits }
  const sim: PlannerSim = { ...g.sim, cv_total: 0, cv_set_tier: 0, tables: world.tables, hits }
  const choice: Choice = { ...noChoice(), toggles: Object.fromEntries(g.toggles.map((name) => [name, true])) }
  const start = startState(sim)
  const tested = c.swap === 'weapon' ? { ...start, weapon: g.weapon_b } : swapSet(start, c.sim_set!, g.set_b)
  const stats = testedStats(sim, tested)
  const answer = verdictOf(simWithGear(sim, tested), tested, stats, choice)
  return { talents: Object.fromEntries(answer.talents.map((t) => [t.key, t.change])), rows: {}, stats: [sim.panel, stats] }
}

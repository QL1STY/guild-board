import type { Element, PlanBody, Planner, Slot, Weight } from '../../types.ts'

// ----------------------------------------------------------------------------------------------------------- steppers

/** A target moved one step, kept from `min` (what she has now) to `max` (the most). */
export function stepTarget(target: number, delta: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, target + delta))
}

/** The levels a character is raised to: each ascension's cap, and the last 90. */
const LEVELS = [20, 40, 50, 60, 70, 80, 90]

/**
 * The level target one step up or down the levels she is raised to; a level between two goes to the next one in that
 * direction. It never goes below `floor`, the level she has now (1 when she is not owned).
 */
export function stepLevel(level: number, delta: 1 | -1, floor = 1): number {
  if (delta > 0) return LEVELS.find((one) => one > level) ?? LEVELS[LEVELS.length - 1]
  const lower = [...LEVELS].reverse().find((one) => one < level) ?? LEVELS[0]
  return Math.min(level, Math.max(lower, floor))
}

/** What the steppers start from: her build as it stands now (`Planner.now_build`), or 1 for each when she is not owned. */
export type Floors = { level: number; refinement: number; weaponLevel: number }

export function floorsOf(nowBuild: Planner['now_build']): Floors {
  if (nowBuild === null) return { level: 1, refinement: 1, weaponLevel: 1 }
  return { level: nowBuild.level, refinement: nowBuild.refinement ?? 1, weaponLevel: nowBuild.weapon_level ?? 1 }
}

// ------------------------------------------------------------------------------------------------ the plan, part by part

export function withTalent(plan: PlanBody, kind: 'normal' | 'skill' | 'burst', level: number): PlanBody {
  return { ...plan, talents: { ...plan.talents, [kind]: level } }
}

/** A substat's next weight when it is pressed: wants, then some use, then no use, and round again. */
export function nextWeight(weight: Weight): Weight {
  return { wants: 'some', some: 'none', none: 'wants' }[weight] as Weight
}

// ------------------------------------------------------------------------------------------------------- stat names

const STAT_LABEL: Record<string, string> = {
  hp: 'HP', atk: 'ATK', def: 'DEF', hp_pct: 'HP %', atk_pct: 'ATK %', def_pct: 'DEF %', er: 'Energy Recharge', em: 'Elemental Mastery',
  cr: 'Crit Rate', cd: 'Crit DMG', heal: 'Healing Bonus', phys: 'Physical DMG Bonus',
}

/** The main stats a slot can have, in the game's own order. `dmg` is the DMG Bonus of her element. */
const MAIN_KEYS: Record<Slot, string[]> = {
  flower: ['hp'],
  plume: ['atk'],
  sands: ['atk_pct', 'hp_pct', 'def_pct', 'er', 'em'],
  goblet: ['dmg', 'phys', 'atk_pct', 'hp_pct', 'def_pct', 'em'],
  circlet: ['cr', 'cd', 'atk_pct', 'hp_pct', 'def_pct', 'heal', 'em'],
}

export function statLabel(key: string, element: Element): string {
  return key === 'dmg' ? `${element} DMG Bonus` : (STAT_LABEL[key] ?? key)
}

export function mainOptions(slot: Slot, element: Element): { key: string; label: string }[] {
  return MAIN_KEYS[slot].map((key) => ({ key, label: statLabel(key, element) }))
}

/**
 * Whether a picker list (the weapons, the sets) is to be read: it never was (`readAt` null), or it was read at an older
 * `version` of the core's data. The background read fills the entries the picker queued, so a list read once per visit would
 * keep a newer weapon's tile at "Not read yet" until she left the page.
 */
export function listStale(readAt: number | null, version: number): boolean {
  return readAt === null || readAt !== version
}

/**
 * What the stat simulator's page says, as plain functions: names of stats, the numbers as the game shows them, the table of her
 * stats now and tested, the legal main stats of a slot and the value a typed substat may be. The arithmetic itself is in
 * simulator.ts; nothing here reads the page or the network.
 */
import type { Element, PlannerHits, PlannerSim, Planner, Slot } from '../../types.ts'

export const SLOT_ORDER: readonly Slot[] = ['flower', 'plume', 'sands', 'goblet', 'circlet']
export const SLOT_LABEL: Record<Slot, string> = { flower: 'Flower', plume: 'Plume', sands: 'Sands', goblet: 'Goblet', circlet: 'Circlet' }

const NAMES: Record<string, string> = {
  hp: 'HP', atk: 'ATK', def: 'DEF', hp_pct: 'HP%', atk_pct: 'ATK%', def_pct: 'DEF%', em: 'Elemental Mastery', er: 'Energy Recharge',
  cr: 'Crit Rate', cd: 'Crit DMG', heal: 'Healing Bonus', physical: 'Physical DMG Bonus', dmg_other: "Another element's DMG Bonus",
}

/** A stat's name: `dmg` is the DMG Bonus of her own element. */
export function statName(stat: string, element: Element): string {
  return stat === 'dmg' ? `${element} DMG Bonus` : (NAMES[stat] ?? stat)
}

const FLAT = new Set(['hp', 'atk', 'def', 'em'])
export const isFlat = (stat: string): boolean => FLAT.has(stat)

const round1 = (x: number): number => Math.round(x * 10 + 1e-9) / 10
const whole = (x: number): number => Math.round(x + 1e-9)

/** A value as the game shows it: a whole number (with thousands) for HP, ATK, DEF and Elemental Mastery, else a percentage to one decimal. */
export function valueText(stat: string, value: number): string {
  return isFlat(stat) ? whole(value).toLocaleString('en-US') : `${round1(value).toFixed(1)}%`
}

/** A value as a box holds it: no unit, no thousands. */
export function boxText(stat: string, value: number): string {
  return isFlat(stat) ? String(whole(value)) : round1(value).toFixed(1)
}

/** The main stats a slot can have, in the game's own order. `dmg` is the DMG Bonus of her element. */
const MAINS: Record<Slot, string[]> = {
  flower: ['hp'],
  plume: ['atk'],
  sands: ['atk_pct', 'hp_pct', 'def_pct', 'er', 'em'],
  goblet: ['dmg', 'physical', 'atk_pct', 'hp_pct', 'def_pct', 'em'],
  circlet: ['cr', 'cd', 'atk_pct', 'hp_pct', 'def_pct', 'heal', 'em'],
}

/** The main stat a new piece of a slot starts with. */
export const defaultMain = (slot: Slot): string => MAINS[slot][0]

/** The main stats to choose from: the slot's, and the stat the piece has now when it is none of them (another element's DMG Bonus). */
export function mainChoices(slot: Slot, current: string): string[] {
  return MAINS[slot].includes(current) ? MAINS[slot] : [...MAINS[slot], current]
}

/** The substats a piece can roll, in the order the editor lists them. */
export const SUB_STATS = ['cr', 'cd', 'atk_pct', 'atk', 'er', 'em', 'hp_pct', 'hp', 'def_pct', 'def']

export type Typed = { value: number } | { problem: string } | { unfinished: true } | null

/** What the player typed in a substat's box: nothing (null), a value the game can show, a percentage still being typed ("21.": no
 * message yet), or a problem to say. */
export function typedValue(stat: string, text: string): Typed {
  const t = text.trim()
  if (t === '') return null
  if (isFlat(stat)) return /^\d{1,6}$/.test(t) ? { value: Number(t) } : { problem: 'Whole numbers only' }
  if (/^\d{1,3}\.$/.test(t)) return { unfinished: true }
  return /^\d{1,3}(\.\d)?$/.test(t) ? { value: Number(t) } : { problem: 'One decimal at most' }
}

/** "3 rolls", "1 roll" or "3 or 4 rolls". */
export function rollsText(ways: number[]): string {
  return `${ways.join(' or ')} ${ways.length === 1 && ways[0] === 1 ? 'roll' : 'rolls'}`
}

const sign = (d: number): string => (d > 0 ? '+' : '−')

export type StatRow = { key: string; label: string; now: string; tested: string; change: string; same: boolean; up: boolean }

/** The change between two numbers at the precision the game shows, in its units: nothing when they show the same. */
function changeOf(stat: string, now: number, tested: number): { text: string; same: boolean; up: boolean } {
  if (isFlat(stat)) {
    const d = whole(tested) - whole(now)
    return d === 0 ? { text: '·', same: true, up: false } : { text: `${sign(d)}${Math.abs(d).toLocaleString('en-US')}`, same: false, up: d > 0 }
  }
  const d = Math.round(tested * 10 + 1e-9) - Math.round(now * 10 + 1e-9)
  return d === 0 ? { text: '·', same: true, up: false } : { text: `${sign(d)}${(Math.abs(d) / 10).toFixed(1)}%`, same: false, up: d > 0 }
}

const ROWS: readonly { key: keyof PlannerSim['panel']; label: string; optional?: boolean }[] = [
  { key: 'atk', label: 'ATK' }, { key: 'hp', label: 'Max HP' }, { key: 'def', label: 'DEF' }, { key: 'em', label: 'Elemental Mastery' },
  { key: 'er', label: 'Energy Recharge' }, { key: 'cr', label: 'Crit Rate' }, { key: 'cd', label: 'Crit DMG' }, { key: 'dmg', label: '' },
  { key: 'physical', label: 'Physical DMG Bonus', optional: true }, { key: 'heal', label: 'Healing Bonus', optional: true },
]

/** Her stats now and tested, one row each; Physical DMG and Healing Bonus show only when she or the test has some. */
export function statRows(now: PlannerSim['panel'], tested: PlannerSim['panel'], element: Element): StatRow[] {
  return ROWS.filter((row) => !row.optional || now[row.key] !== 0 || tested[row.key] !== 0).map((row) => {
    const change = changeOf(row.key, now[row.key], tested[row.key])
    return {
      key: row.key, label: row.key === 'dmg' ? statName('dmg', element) : row.label, now: valueText(row.key, now[row.key]),
      tested: valueText(row.key, tested[row.key]), change: change.text, same: change.same, up: change.up,
    }
  })
}

/** The header's second chip until the damage verdict comes: the ATK change of the tested pieces, "No change" when there is none. */
export function atkHeadline(now: PlannerSim['panel'], tested: PlannerSim['panel']): { text: string; same: boolean; up: boolean } {
  const change = changeOf('atk', now.atk, tested.atk)
  return change.same ? { text: 'No change', same: true, up: false } : { text: `${change.text} ATK`, same: false, up: change.up }
}

/**
 * The talents that carry a "Raise" mark: one within a level of her highest talent and still below 10. It is only a mark; with
 * no damage engine yet the rule is the one the design gives for a main talent (spec 12.2 and 12.3).
 */
export function raiseKinds(talents: Planner['talents']): Set<string> {
  const top = Math.max(...talents.map((talent) => talent.now))
  return new Set(talents.filter((talent) => talent.now >= top - 1 && talent.now < 10).map((talent) => talent.kind))
}

/**
 * With the verdict, "Raise" marks a main talent (the one the verdict counts, `HitTalent.main`) below level 10, however far below
 * (the Plan design, 12.3), in place of the rule above. The level is the one she raised it to, without a constellation's bonus.
 */
export function raiseMains(talents: Planner['talents'], hits: PlannerHits): Set<string> {
  const mains = new Set(hits.talents.filter((talent) => talent.main).map((talent) => talent.key))
  return new Set(talents.filter((talent) => mains.has(talent.kind as 'normal') && talent.now < 10).map((talent) => talent.kind))
}

const WEAPON_SUB: Record<string, string> = {
  atk_pct: 'ATK', hp_pct: 'HP', def_pct: 'DEF', em: 'Elemental Mastery', er: 'Energy Recharge', cr: 'Crit Rate', cd: 'Crit DMG', physical: 'Physical DMG Bonus',
}

/** A weapon's second stat, "Crit DMG 44.1%" or "Elemental Mastery 221"; empty when it has none or its value is not read yet. */
export function weaponSubText(sub: string | null, value: number | null): string {
  if (sub === null || value === null) return ''
  return `${WEAPON_SUB[sub] ?? sub} ${sub === 'em' ? Math.round(value) : `${round1(value).toFixed(1)}%`}`
}

/** The colour of a tier, as a custom property set on the card (planner.css). */
export const tierClass = (tier: number): string => `t${Math.max(0, Math.min(6, tier))}`

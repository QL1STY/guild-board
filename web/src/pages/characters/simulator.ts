/**
 * The planner's stat arithmetic, all pure so that every click answers at once with no request (the Plan page and simulator
 * design, sections 5, 6 and 7.1 to 7.2). It mirrors the core's `characters/rolls.py`: a percentage is shown to one decimal and
 * a flat stat as a whole number, a sum exactly on a rounding tie can show either neighbour, one substat holds at most 6 rolls
 * on a 5-star and 4 on a 4-star. Randomness comes in only as `rand`, a function giving a number from 0 up to but not
 * including 1; nothing here reads the clock, the page or the network.
 */
import type { PlannerSim, SetChoice, SimPiece, Slot, WeaponChoice } from '../../types.ts'

export type Tables = PlannerSim['tables']
export type StatKey = keyof PlannerSim['panel']

/** A piece as the planner tests it: what it is made of (rolls by tier), not what it shows. `typed` is a value the player wrote
 * in place of the rolls' sum. `start3`: it started with three substats (a 5-star; four is the usual) or, for a 4-star, three
 * (two is the usual). */
export type TestPiece = {
  slot: Slot; main: string; level: number; rarity: number
  subs: { stat: string; tiers: number[]; typed: number | null }[]
  start3: boolean
}
type TestSub = TestPiece['subs'][number]

export const CV_THRESHOLDS = [15, 25, 35, 45, 50, 54.4]
export const SET_THRESHOLDS = [180, 200, 220, 240, 260, 300]
export const CRIT_MAIN_BONUS = 7.77
const FLAT = new Set(['hp', 'atk', 'def', 'em'])        // shown as whole numbers; every other stat as a percentage to one decimal
const TIE = 1e-6
const MAX_LEVEL: Record<number, number> = { 5: 20, 4: 16 }
const MAX_ROLLS: Record<number, number> = { 5: 6, 4: 4 }

const NAMES: Record<string, string> = {
  hp: 'HP', atk: 'ATK', def: 'DEF', hp_pct: 'HP%', atk_pct: 'ATK%', def_pct: 'DEF%', em: 'Elemental Mastery', er: 'Energy Recharge', cr: 'Crit Rate', cd: 'Crit DMG',
}

const rarityKey = (rarity: number): string => (rarity >= 5 ? '5' : '4')
const rollsOf = (tables: Tables, rarity: number): Record<string, number[]> => tables.rolls[rarityKey(rarity)]
const maxRolls = (rarity: number): number => MAX_ROLLS[rarity >= 5 ? 5 : 4]
const maxLevel = (rarity: number): number => MAX_LEVEL[rarity >= 5 ? 5 : 4]
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6
const round1 = (x: number): number => Math.round(x * 10 + 1e-9) / 10

/** A value at the precision the game shows: a whole number for HP, ATK, DEF and Elemental Mastery, otherwise one decimal. */
function display(stat: string, value: number): number {
  return FLAT.has(stat) ? Math.round(value + 1e-9) : round1(value)
}

function shown(stat: string, text: number): string {
  return FLAT.has(stat) ? String(Math.round(text)) : text.toFixed(1)
}

/** A piece of hers as a piece to test: the same rolls, no typed values. A substat the core could not split into rolls (empty
 * `tiers`) keeps its shown value as a typed one, so its Crit Value and stats still count. */
export function fromHer(piece: SimPiece): TestPiece {
  const level = Math.min(piece.level, maxLevel(piece.rarity))
  // Rolls = starting substats + level-ups (a fourth substat counts as one): 3 + level/4 when it started with three, else 4 (a
  // 5-star) or 2 (a 4-star) + level/4. A substat with no split holds between 1 and the most rolls, so the count is a range.
  const known = piece.subs.reduce((sum, sub) => sum + sub.tiers.length, 0)
  const unknown = piece.subs.filter((sub) => sub.tiers.length === 0).length
  const fits = (start: number): boolean => {
    const total = start + Math.floor(level / 4)
    return Math.min(4, total) === piece.subs.length && known + unknown <= total && total <= known + unknown * maxRolls(piece.rarity)
  }
  const usual = piece.rarity >= 5 ? 4 : 2
  return {
    slot: piece.slot, main: piece.main, level: piece.level, rarity: piece.rarity,
    subs: piece.subs.map((sub) => ({ stat: sub.stat, tiers: [...sub.tiers], typed: sub.tiers.length === 0 ? sub.value : null })),
    start3: fits(3) && !fits(usual),
  }
}

/** What a substat shows: the value typed in, else the sum of its rolls at display precision. */
export function subValue(sub: TestSub, tables: Tables, rarity: number): number {
  if (sub.typed !== null) return sub.typed
  const values = rollsOf(tables, rarity)[sub.stat]
  return display(sub.stat, round6(sub.tiers.reduce((sum, tier) => sum + values[tier], 0)))
}

/** What the game can show for a sum, in its own units (tenths of a percent, or whole numbers): two numbers on a tie. */
function shownUnits(stat: string, total: number): number[] {
  const units = FLAT.has(stat) ? total : total * 10
  const low = Math.floor(units)
  if (Math.abs(units - low - 0.5) < TIE) return [low, low + 1]
  return [Math.floor(units + 0.5)]
}

function unitsOf(stat: string, value: number): number {
  return Math.round(FLAT.has(stat) ? value : value * 10)
}

/** Every sum of n rolls of a stat, whatever the tiers (multisets of the four values). */
function sums(values: number[], n: number): number[] {
  const out: number[] = []
  const go = (left: number, from: number, total: number): void => {
    if (left === 0) { out.push(round6(total)); return }
    for (let tier = from; tier < values.length; tier++) go(left - 1, tier, total + values[tier])
  }
  go(n, 0, 0)
  return out
}

/** The numbers of rolls (1 up to the most one substat can hold) that can show this value. */
export function reachable(stat: string, value: number, tables: Tables, rarity: number): number[] {
  const values = rollsOf(tables, rarity)[stat]
  if (!values) return []
  const want = unitsOf(stat, value)
  const out: number[] = []
  for (let n = 1; n <= maxRolls(rarity); n++) {
    if (sums(values, n).some((total) => shownUnits(stat, total).includes(want))) out.push(n)
  }
  return out
}

/** How many rolls the piece's substats hold in all at its level: the starting count plus one at each +4. A 5-star starts with
 * 4 (or 3), a 4-star with 2 (or 3); the level stops at the piece's top (+20 and +16). */
export function rollBudget(p: TestPiece): number {
  const start = p.start3 ? 3 : p.rarity >= 5 ? 4 : 2
  return start + Math.floor(Math.min(p.level, maxLevel(p.rarity)) / 4)
}

export const tierOf = (rand: () => number): number => Math.min(3, Math.floor(rand() * 4))

/** A substat's stat, drawn by the game's weights among those the piece does not already have and that are not its main. */
export function drawStat(p: Pick<TestPiece, 'main' | 'subs' | 'rarity'>, tables: Tables, rand: () => number): string {
  const taken = new Set([p.main, ...p.subs.map((sub) => sub.stat)])
  const pool = Object.keys(rollsOf(tables, p.rarity)).filter((stat) => !taken.has(stat))
  let x = rand() * pool.reduce((sum, stat) => sum + (tables.weights[stat] ?? 0), 0)
  for (const stat of pool) {
    x -= tables.weights[stat] ?? 0
    if (x < 0) return stat
  }
  return pool[pool.length - 1]
}

function rollText(stat: string, tier: number, tables: Tables, rarity: number): string {
  return `${NAMES[stat] ?? stat} +${shown(stat, rollsOf(tables, rarity)[stat][tier])}`
}

/** The rolls a piece's substats hold (a substat with no split counts as one). */
function rollsHeld(p: TestPiece): number {
  return p.subs.reduce((sum, sub) => sum + Math.max(1, sub.tiers.length), 0)
}

/** The game's level-up to the next multiple of four (a piece at +18 goes to +20, not +22), capped at the top level: a fourth
 * substat first when there are fewer than four, else one of the four at a quarter each (one that already holds the most rolls
 * is left out, and so is one with no split into rolls), rolled at a uniform tier. Typed values are cleared, except on a
 * substat with no rolls to rebuild it from. A piece at its top level, with every roll it can hold, or with no substat that can
 * take one, is returned as it is, with a `said` when the reason is not simply the top level. */
export function levelUp(p: TestPiece, tables: Tables, rand: () => number): { piece: TestPiece; said: string } {
  const top = maxLevel(p.rarity)
  if (p.level >= top) return { piece: p, said: '' }
  const level = Math.min(top, (Math.floor(p.level / 4) + 1) * 4)
  const subs: TestSub[] = p.subs.map((sub) => ({ stat: sub.stat, tiers: [...sub.tiers], typed: sub.tiers.length === 0 ? sub.typed : null }))
  if (rollsHeld(p) >= rollBudget({ ...p, level })) return { piece: p, said: 'This piece already holds all the rolls it can at that level' }
  let said: string
  if (subs.length < 4) {
    const stat = drawStat(p, tables, rand)
    const tier = tierOf(rand)
    subs.push({ stat, tiers: [tier], typed: null })
    said = `New substat: ${rollText(stat, tier, tables, p.rarity)}`
  } else {
    const open = subs.map((_, i) => i).filter((i) => subs[i].tiers.length > 0 && subs[i].tiers.length < maxRolls(p.rarity))
    if (open.length === 0) return { piece: p, said: 'No substat can take another roll' }
    const i = open[Math.min(open.length - 1, Math.floor(rand() * open.length))]
    const tier = tierOf(rand)
    subs[i].tiers.push(tier)
    said = rollText(subs[i].stat, tier, tables, p.rarity)
  }
  return { piece: { ...p, level, subs }, said }
}

/** A random +0 piece with this main stat and its starting substats (a 5-star: 4, or 3 at 80%; a 4-star: 2, or 3 at 20%), each
 * at one roll of a uniform tier. */
export function freshPiece(slot: Slot, main: string, rarity: number, tables: Tables, rand: () => number): TestPiece {
  // `start4_odds` is the chance of the larger count: a 5-star that starts with 4 (else 3), a 4-star that starts with 3 (else 2).
  const larger = rand() < tables.start4_odds
  const start3 = rarity >= 5 ? !larger : larger
  const count = rarity >= 5 ? (start3 ? 3 : 4) : start3 ? 3 : 2
  const piece: TestPiece = { slot, main, level: 0, rarity, subs: [], start3 }
  while (piece.subs.length < count) {
    const stat = drawStat(piece, tables, rand)
    piece.subs.push({ stat, tiers: [tierOf(rand)], typed: null })
  }
  return piece
}

/** A piece's Crit Value: 2 x Crit Rate + Crit DMG of its substats as shown (one decimal). */
export function critValue(p: TestPiece, tables: Tables): number {
  let cv = 0
  for (const sub of p.subs) {
    const value = subValue(sub, tables, p.rarity)
    if (sub.stat === 'cr') cv += 2 * value
    else if (sub.stat === 'cd') cv += value
  }
  return round1(cv)
}

function tierFrom(score: number, thresholds: number[]): number {
  const s = round6(score)
  return thresholds.filter((limit) => s >= limit).length
}

/** A piece's tier, 0 to 6; a Crit Rate or Crit DMG main stat is graded with 7.77 added. */
export function cvTier(cv: number, critMain: boolean): number {
  return tierFrom(critMain ? cv + CRIT_MAIN_BONUS : cv, CV_THRESHOLDS)
}

/** The five pieces' total Crit Value as a tier, 0 to 6. */
export function setTier(total: number): number {
  return tierFrom(total, SET_THRESHOLDS)
}

type Sums = Record<string, number>

function add(into: Sums, stat: string | null | undefined, value: number | null | undefined): void {
  if (!stat || !value) return
  into[stat] = (into[stat] ?? 0) + value
}

/** A main stat's value at a level. A DMG Bonus of another element has no column of its own (the numbers are the same as her
 * element's) and counts for nothing in her stats. */
export function mainAt(tables: Tables, rarity: number, main: string, level: number): number {
  const column = tables.mains[rarityKey(rarity)][main === 'dmg_other' ? 'dmg' : main]
  if (!column) return 0
  return column[Math.max(0, Math.min(level, column.length - 1))]
}

const sameRolls = (a: number[], b: number[]): boolean => a.length === b.length && a.every((tier, i) => tier === b[i])

/** The stats she would have with these pieces, this weapon and these sets: her panel plus the difference between what is
 * tested and what she wears now (spec 7.2). ATK, HP and DEF percentages act on the base value; ATK's base includes the
 * weapon's. A substat that is unchanged from her piece keeps the value the game showed. Conditional set effects and weapon
 * passives are not added. Each set in `sets` counts its 2-piece stats once (a 4-piece build is one set, a 2+2 two). The results
 * are not rounded (the page rounds what it shows); a change of nothing leaves the panel's own number. */
export function statsWith(
  sim: PlannerSim, pieces: Record<Slot, TestPiece>, weapon: WeaponChoice, sets: SetChoice[],
): Record<StatKey, number> {
  const now: Sums = {}
  const tested: Sums = {}
  const hers = new Map(sim.pieces.map((p) => [p.slot, p]))

  for (const p of sim.pieces) {
    add(now, p.main, p.main_value)
    for (const sub of p.subs) add(now, sub.stat, sub.value)
  }
  const mine = sim.weapon
  add(now, mine?.sub, mine?.sub_value)
  for (const set of sim.sets) if (set.pieces >= 2) for (const part of set.two) add(now, part.stat, part.value)

  for (const [slot, piece] of Object.entries(pieces) as [Slot, TestPiece][]) {
    const her = hers.get(slot)
    const keepMain = her && her.main === piece.main && her.level === piece.level && her.rarity === piece.rarity
    add(tested, piece.main, keepMain ? her.main_value : mainAt(sim.tables, piece.rarity, piece.main, piece.level))
    for (const sub of piece.subs) {
      const same = her && her.rarity === piece.rarity && sub.typed === null ? her.subs.find((s) => s.stat === sub.stat && sameRolls(s.tiers, sub.tiers)) : undefined
      add(tested, sub.stat, same ? same.value : subValue(sub, sim.tables, piece.rarity))
    }
  }

  const sameWeapon = mine !== null && mine.key === weapon.key
  const baseNow = sim.base.atk
  const baseAtk = sameWeapon ? sim.char_base_atk + mine.base_atk
    : weapon.base_atk === null ? baseNow : sim.char_base_atk + weapon.base_atk
  add(tested, weapon.sub, sameWeapon ? mine.sub_value : weapon.sub_value)
  for (const set of sets) for (const part of set.two) add(tested, part.stat, part.value)

  // A change that is only the noise of adding the same numbers in another order is no change.
  const d = (stat: string): number => round6((tested[stat] ?? 0) - (now[stat] ?? 0))
  const panel = sim.panel
  // ATK: the base times (1 + every percentage now + the change) plus the flat; the percentages now are what the panel holds
  // beyond its flat ATK, so what the panel counts that Guild Board does not know of (a passive) keeps its weight on a new base.
  const pctNow = (panel.atk - (now.atk ?? 0)) / baseNow - 1
  const atk = panel.atk + (baseAtk - baseNow) * (1 + pctNow) + (baseAtk * d('atk_pct')) / 100 + d('atk')
  const out: Record<StatKey, number> = {
    hp: panel.hp + (sim.base.hp * d('hp_pct')) / 100 + d('hp'),
    atk,
    def: panel.def + (sim.base.def * d('def_pct')) / 100 + d('def'),
    em: panel.em + d('em'), er: panel.er + d('er'), cr: panel.cr + d('cr'), cd: panel.cd + d('cd'),
    dmg: panel.dmg + d('dmg'), heal: panel.heal + d('heal'), physical: panel.physical + d('physical'),
  }
  return out
}

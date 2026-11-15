/**
 * The damage engine and the verdict (the Plan design, 7.5 and 14). Pure: the planner's `sim.hits` block, two sets of her stats
 * (what she has now and what is tested, both as `statsWith` gives them: HoYoLAB's panel with the tested pieces, weapon and sets
 * swapped in) and the player's choices go in; the percent change in the damage of each main talent and a verdict come out.
 * Nothing here reads the page, the clock or a random source, and only the change is ever given, never a hit's size.
 *
 * What an effect of the kit does (kits.schema.json): it adds `min(rate x max(stat - over, 0), cap)` to its bucket `to`. The
 * stat is read before any conversion (`reads: premod`, the panel's stats plus every plain effect) or after the premod
 * conversions (`final`); a conversion's result never feeds another conversion that reads premod. The buckets are
 *   - the stats: atk% hp% def% (of the base value) atk hp def em er cr cd physical heal, added to her stats;
 *   - `dmg` (every ordinary hit), `dmg:<element>`, `dmg:<move>` (normal charged plunging skill burst): DMG Bonus of ordinary hits;
 *   - `additive` (`additive:<element|move>`: flat damage added to the base of an ordinary hit; `additive:<reaction>`: the
 *     Additive Base DMG Bonus of a Lunar or Stellar hit), `mult` (the base of the hit times one plus it), `cr`/`cd` and
 *     `cr:<element|reaction>`/`cd:<element|reaction>` (a hit's CRIT, by the element it deals or the reaction it is),
 *   - `base:<reaction>` (Base DMG Bonus), `bonus:<reaction>` (Reaction Bonus), `elevation:<reaction>` for Lunar and Stellar
 *     hits and `bonus:vaporize|melt|aggravate|spread` for the ordinary reactions.
 * An effect may also multiply by a second stat of hers (`times`: Kokomi's A4 is 15% of Max HP times her Healing Bonus).
 * An effect with `talents` (moves) or `hits` (row names, of the talent `in_talent` names when two talents have a row of one name) holds only for those rows; `while` is a toggle; `in_stats` marks what
 * HoYoLAB's panel already holds of her own weapon and sets, which is added only for a tested weapon or set that is not hers.
 */
import type { Effect, GearEffects, HitRow, HitTalent, Infusion, PartyBlock, PartyOption, PlannerHits, PlannerSim, Pronouns } from '../../types.ts'
import type { StatKey, Tables } from './simulator.ts'

export type TalentKey = HitTalent['key']
export type Stats = Record<StatKey, number>

// ------------------------------------------------------------------------------------------------ formula pieces

/** Vaporize or Melt: `c` (2 or 1.5) times one plus 2.78 EM/(EM+1400) plus the Reaction Bonus. */
export function amplifying(c: number, em: number, bonus = 0): number {
  const m = Math.max(em, 0)
  return c * (1 + (2.78 * m) / (m + 1400) + bonus)
}

/** Aggravate or Spread: `c` (1.15 or 1.25) times the level multiplier times one plus 5 EM/(EM+1200) plus the Reaction Bonus. */
export function additive(c: number, levelMult: number, em: number, bonus = 0): number {
  const m = Math.max(em, 0)
  return c * levelMult * (1 + (5 * m) / (m + 1200) + bonus)
}

/** The EM bonus of Lunar and Stellar hits, 6 EM/(EM+2000) (added to one with the Reaction Bonus). */
export function lunarEm(em: number): number {
  const m = Math.max(em, 0)
  return (6 * m) / (m + 2000)
}

/** The enemy's DEF: (Lc+100) / ((Lc+100) + (1 - reduction)(Le+100)). */
export function defMult(level: number, enemyLevel: number, reduction = 0): number {
  return (level + 100) / (level + 100 + (1 - reduction) * (enemyLevel + 100))
}

/** The enemy's RES (a fraction, 0.1 is 10%): below 0 it is 1 - res/2, up to 75% 1 - res, above that 1/(1 + 4 res). */
export function resMult(res: number): number {
  if (res < 0) return 1 - res / 2
  if (res < 0.75) return 1 - res
  return 1 / (1 + 4 * res)
}

// ------------------------------------------------------------------------------------------------ choices

export type Reaction = 'none' | 'vaporize' | 'melt' | 'aggravate' | 'spread'

/** The reactions an element can switch on for its hits (none for Anemo, Geo and Physical: an empty list). Pyro: Vaporize or Melt,
 * Hydro: Vaporize, Cryo: Melt, Electro: Aggravate, Dendro: Spread. */
export function reactionsFor(element: string): Reaction[] {
  switch (element.toLowerCase()) {
    case 'pyro': return ['vaporize', 'melt']
    case 'hydro': return ['vaporize']
    case 'cryo': return ['melt']
    case 'electro': return ['aggravate']
    case 'dendro': return ['spread']
    default: return []
  }
}

/** What the player chose: the reaction each talent's ordinary hits trigger (missing: none), the hits Stellar-Conduct's field has
 * recorded for each talent (missing: 12, the most) and the kit's toggles (missing: the toggle's own `on`) and her team (missing: the usual one). */
export type Choice = {
  reaction: Partial<Record<TalentKey, Reaction>>
  recorded: Partial<Record<TalentKey, number>>
  toggles: Record<string, boolean>
  /** The team shape for a character whose damage depends on her team (`PlannerHits.party`; missing: the usual one). */
  party?: string
}

export const noChoice = (): Choice => ({ reaction: {}, recorded: {}, toggles: {} })

/** The weapon of a build as the engine needs it: its key and refinement (its effects' numbers) and, only for the verdict's notes
 * and base ATK, its level and its own base ATK (as `SimWeapon` and `WeaponChoice` give them). */
export type GearWeapon = { key: string; refinement: number; level?: number; base_atk?: number | null }
export type Base = { hp: number; atk: number; def: number }
/** What the stats the engine is given already hold of her own gear (HoYoLAB's panel): her weapon and her sets by key and pieces. */
export type Held = { weapon: { key: string; refinement: number } | null; sets: Record<string, number> }

const RECORDED_MAX = 12
const TALENT_ORDER: TalentKey[] = ['normal', 'skill', 'burst']

/** Every toggle the kit data names for her, her weapon and the sets, with the player's choice or its own `on`. */
function toggleDefaults(hits: PlannerHits): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  const take = (list: { name: string; on: boolean }[] | undefined): void => {
    for (const t of list ?? []) if (!(t.name in out)) out[t.name] = t.on
  }
  take(hits.toggles)
  for (const gear of Object.values(hits.weapon_effects)) take(gear.toggles)
  for (const gear of Object.values(hits.set_effects)) take(gear.toggles)
  return out
}

function labels(hits: PlannerHits): Record<string, string> {
  const out: Record<string, string> = {}
  const take = (list: { name: string; label: string }[] | undefined): void => {
    for (const t of list ?? []) if (!(t.name in out)) out[t.name] = t.label
  }
  take(hits.toggles)
  for (const gear of Object.values(hits.weapon_effects)) take(gear.toggles)
  for (const gear of Object.values(hits.set_effects)) take(gear.toggles)
  return out
}

/** The card's pronouns as the sentences below read them when none are given: "she", "her", "her". */
export const SHE: Pronouns = { she: 'she', her: 'her', hers: 'her' }
const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)
/** A verb as it agrees with a subject of several things or "they" (`many`), else with one. */
const verb = (many: boolean, one: string, more: string): string => (many ? more : one)

/** Whether a toggle is on: the player's choice, else its own `on`, else off. */
export function isOn(hits: PlannerHits, choice: Choice, name: string): boolean {
  return choice.toggles[name] ?? toggleDefaults(hits)[name] ?? false
}

// ------------------------------------------------------------------------------------------------ the team

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

/** A party block once `resolveParty` has chosen its team shape (`applied`). */
type Chosen = PartyBlock & { applied?: string }

function optionOf(party: Chosen, id: string | undefined): PartyOption {
  const found = party.options.find((one) => one.id === (party.applied ?? id)) ?? party.options.find((one) => one.id === party.default)
  return found ?? party.options[0]
}

/** The team shape the verdict is read for: the player's choice, else the usual one, and whether it is the usual one. Null for a
 * character whose damage no team decides. */
export function partyChoice(hits: PlannerHits, choice: Choice): { id: string; label: string; usual: boolean } | null {
  const party: Chosen | null = hits.party
  if (!party) return null
  const picked = optionOf(party, choice.party)
  return { id: picked.id, label: picked.label, usual: picked.id === party.default }
}

/**
 * The hits block for one team shape (the Plan design, 14): the effects that hold in it, the rows only other shapes deal left out,
 * and a row that takes the team's element shared equally among the elements of the shape, a row of each. A block with no
 * party, or one already resolved, is returned as it is, so every function of the engine may resolve what it is given.
 */
export function resolveParty(hits: PlannerHits, choice: Choice): PlannerHits {
  const party: Chosen | null = hits.party
  if (!party || party.applied !== undefined) return hits
  const picked = optionOf(party, choice.party)
  const dealt = (row: HitRow): HitRow[] => {
    if (row.only && !row.only.includes(picked.id)) return []
    // The game does not say which element such a hit takes when the team has several, so the row is shared equally among them: a
    // modelling choice (the mix is the player's team), the same one the comparison with GO makes.
    if (row.takes) {
      return picked.elements.map((element) => ({ ...row, takes: false, count: row.count / picked.elements.length, element: capital(element) as HitRow['element'] }))
    }
    return [row]
  }
  const chosen: Chosen = { ...party, applied: picked.id }
  return {
    ...hits,
    talents: hits.talents.map((talent) => ({ ...talent, rows: talent.rows.flatMap(dealt) })),
    effects: hits.effects.filter((effect) => !effect.party || effect.party.includes(picked.id)),
    infused: hits.infused.filter((item) => !item.party || item.party.includes(picked.id)),
    party: chosen,
  }
}

/** The infusion of her own that holds for one of her moves now: its toggle is on (or it has none) and the team shape chosen is one it
 * holds in. A move with none deals what its rows say (physical, for a Normal Attack's). */
export function infusionFor(hits: PlannerHits, choice: Choice, move: string): Infusion | undefined {
  const shape = partyChoice(hits, choice)?.id
  return hits.infused.find((item) => item.talents.includes(move) && (!item.while || isOn(hits, choice, item.while)) &&
    (!item.party || shape === undefined || item.party.includes(shape)))
}

// ------------------------------------------------------------------------------------------------ buckets

/** One amount in a bucket and the rows it holds for: `talents` are moves, `hits` row names (null: every row), `inTalent` the talent whose
 * rows `hits` names (missing: either talent's, for a name only one talent has). */
export type Add = { to: string; value: number; talents: string[] | null; hits: string[] | null; inTalent?: string | null }

export type Buckets = {
  /** Her stats with every conversion and plain stat effect applied. HP, ATK, DEF, EM are as the panel shows; ER, CRIT Rate,
   * CRIT DMG, the DMG Bonus of her element, Physical DMG Bonus and Healing Bonus are fractions (0.466 is 46.6%). */
  stats: Stats
  adds: Add[]
  /** Infusions that hold (her moves that deal this element), already checked against their toggles. */
  infusions: { moves: string[]; element: string }[]
  /** The labels of the toggles that are on and that an effect or an infusion that holds reads (the Polestar field is one too). */
  counted: string[]
  /** The same toggles by name (the Polestar field is none): two toggles can share a label. */
  countedNames: string[]
}

const PERCENT_STATS = new Set<StatKey>(['er', 'cr', 'cd', 'dmg', 'heal', 'physical'])
const STAT_BUCKETS = new Set(['atk%', 'hp%', 'def%', 'atk', 'hp', 'def', 'em', 'er', 'cr', 'cd', 'heal', 'physical'])

/** A rate or cap that is a list by refinement, at a refinement (1 to 5; a list is clamped); a scalar as it is. */
function atRefinement(value: number | number[] | null, refinement: number): number | null {
  if (value === null) return null
  if (!Array.isArray(value)) return value
  return value[Math.min(Math.max(Math.round(refinement), 1), value.length) - 1] ?? 0
}

type Applied = { effect: Effect; sign: number; refinement: number }

/** The effects that count for one build, with the sign they count by: hers, her weapon's and the sets' that hold; what the
 * panel already holds of her own gear (`in_stats`) counts for nothing while she keeps it, and a tested weapon or set that is not
 * hers adds its own and takes hers out. The 2-piece plain stats are `statsWith`'s (it swaps them), so they are left alone. */
function appliedEffects(hits: PlannerHits, weapon: GearWeapon, sets: Record<string, number>, held: Held): Applied[] {
  // Her own `in_stats` effects (Mitya's and Nefer's innate 100 EM) are her stats, which the panel holds: never added again.
  const out: Applied[] = hits.effects.filter((effect) => !effect.in_stats).map((effect) => ({ effect, sign: 1, refinement: 1 }))
  const wearing = held.weapon?.key === weapon.key
  for (const effect of hits.weapon_effects[weapon.key]?.effects ?? []) {
    const sign = effect.in_stats && wearing ? 0 : 1
    if (sign !== 0) out.push({ effect, sign, refinement: weapon.refinement })
  }
  if (held.weapon && !wearing) {
    for (const effect of hits.weapon_effects[held.weapon.key]?.effects ?? []) {
      if (effect.in_stats) out.push({ effect, sign: -1, refinement: held.weapon.refinement })
    }
  }
  for (const [key, count] of Object.entries(sets)) {
    for (const effect of hits.set_effects[key]?.effects ?? []) {
      const need = effect.pieces ?? 2
      if (count < need) continue
      if (effect.in_stats && (need <= 2 || (held.sets[key] ?? 0) >= need)) continue
      out.push({ effect, sign: 1, refinement: 1 })
    }
  }
  for (const [key, count] of Object.entries(held.sets)) {
    for (const effect of hits.set_effects[key]?.effects ?? []) {
      const need = effect.pieces ?? 2
      if (effect.in_stats && need > 2 && count >= need && (sets[key] ?? 0) < need) out.push({ effect, sign: -1, refinement: 1 })
    }
  }
  return out
}

/** The stat a conversion reads: HP, ATK, DEF and EM as they are, Energy Recharge and Healing Bonus as fractions (the `over` of Raiden's A4 is 1.0). */
function reading(stat: string | null, s: Stats): number {
  switch (stat) {
    case 'hp': case 'atk': case 'def': case 'em': case 'er': case 'heal': return s[stat]
    default: return 0
  }
}

/**
 * Her stats and the buckets of effects for one build. `stats` is `statsWith`'s result (HoYoLAB's panel with the tested pieces,
 * weapon and sets swapped in), in the panel's units. Effects whose gates and toggles hold are applied: the plain ones first, then
 * the conversions that read the stats before conversions (`premod`), then those that read them after (`final`).
 * `options.base` is her base HP, ATK (the weapon's included) and DEF, which the percentage buckets act on; `options.held` what the
 * stats already hold of her own gear (default: the weapon and sets given, so nothing of them is added a second time).
 */
export function buckets(
  stats: Stats, plannerHits: PlannerHits, weapon: GearWeapon, sets: Record<string, number>, choice: Choice,
  options: { base?: Base; held?: Held } = {},
): Buckets {
  const hits = resolveParty(plannerHits, choice)
  const base = options.base ?? { hp: 0, atk: 0, def: 0 }
  const held = options.held ?? { weapon: { key: weapon.key, refinement: weapon.refinement }, sets }
  const on = { ...toggleDefaults(hits), ...choice.toggles }
  const names = labels(hits)

  const pm: Stats = { ...stats }
  for (const stat of PERCENT_STATS) pm[stat] = stats[stat] / 100
  const adds: Add[] = []
  const counted: string[] = []
  const countedNames: string[] = []

  const holds = (e: Effect): boolean => {
    if (e.weapon_types && !e.weapon_types.includes(hits.weapon_type.toLowerCase())) return false
    if (e.while && !on[e.while]) return false
    if (e.also?.some((name) => !on[name])) return false
    return true
  }
  const note = (name: string | null): void => {
    if (!name) return
    if (!countedNames.includes(name)) countedNames.push(name)
    if (!counted.includes(names[name] ?? name)) counted.push(names[name] ?? name)
  }
  const put = (target: Stats, e: Effect, value: number): void => {
    const scoped = e.talents !== null || e.hits !== null
    if (!scoped && STAT_BUCKETS.has(e.to)) {
      switch (e.to) {
        case 'atk%': target.atk += base.atk * value; break
        case 'hp%': target.hp += base.hp * value; break
        case 'def%': target.def += base.def * value; break
        case 'atk': case 'hp': case 'def': case 'em': case 'er': case 'cr': case 'cd': case 'heal': case 'physical':
          target[e.to] += value
          break
      }
      return
    }
    // A stat scoped to some rows (Skirk's ATK%) is kept as the amount of that stat, which those rows' scaling adds.
    const to = e.to === 'atk%' ? 'atk' : e.to === 'hp%' ? 'hp' : e.to === 'def%' ? 'def' : e.to
    const of = e.to === 'atk%' ? base.atk : e.to === 'hp%' ? base.hp : e.to === 'def%' ? base.def : 1
    adds.push({ to, value: value * of, talents: e.talents, hits: e.hits, inTalent: e.in_talent ?? null })
  }
  const amount = (a: Applied, from: Stats): number => {
    const { effect: e } = a
    const rate = atRefinement(e.rate, a.refinement) ?? 0
    if (e.from === null) return a.sign * rate
    let value = rate * Math.max(reading(e.from, from) - (e.over ?? 0), 0)
    if (e.times) value *= reading(e.times, from)    // a second stat of hers it multiplies by (Kokomi's Healing Bonus)
    const cap = atRefinement(e.cap, a.refinement)
    if (cap !== null) value = Math.min(value, cap * (e.cap_from === 'base_atk' ? base.atk : 1))
    return a.sign * value
  }

  const applied = appliedEffects(hits, weapon, sets, held).filter((a) => holds(a.effect))
  const plain = applied.filter((a) => a.effect.from === null)
  const premod = applied.filter((a) => a.effect.from !== null && a.effect.reads === 'premod')
  const final = applied.filter((a) => a.effect.from !== null && a.effect.reads !== 'premod')

  for (const a of plain) put(pm, a.effect, amount(a, pm))
  const mid: Stats = { ...pm }
  for (const a of premod) put(mid, a.effect, amount(a, pm))
  const fin: Stats = { ...mid }
  for (const a of final) put(fin, a.effect, amount(a, mid))

  const infusions: Buckets['infusions'] = []
  for (const item of hits.infused) {
    if (item.while && !on[item.while]) continue
    infusions.push({ moves: item.talents, element: item.element.toLowerCase() })
  }
  // A toggle is counted when it is on and an effect (or an infusion) that holds reaches one of the rows the verdict counts.
  const rows = hits.talents.filter((t) => t.main).flatMap((t) => countedRows(t).map((row) => ({ row, key: t.key })))
  for (const a of applied) {
    if (a.effect.while && rows.some(({ row, key }) => reachesRow(a.effect, row, key, hits, infusions))) {
      note(a.effect.while)
      for (const name of a.effect.also ?? []) note(name)
    }
  }
  for (const item of hits.infused) {
    if (item.while && on[item.while] && rows.some(({ row }) => row.kind === 'physical' && item.talents.includes(row.move))) note(item.while)
  }
  if (rows.some(({ row }) => row.kind === 'stellar-conduct')) counted.push(POLESTAR_FIELD)
  return { stats: fin, adds, infusions, counted, countedNames }
}

// ------------------------------------------------------------------------------------------------ one row

/** The name the verdict gives the Polestar field in what it counts. */
export const POLESTAR_FIELD = 'Polestar field'

const SPECIAL_ELEMENT: Record<string, string | null> = {
  'lunar-bloom': 'dendro', 'lunar-charged': 'electro', 'lunar-crystallize': 'geo', 'stellar-conduct': null, 'stellar-swirl': null,
}
export const isSpecial = (kind: string): boolean => kind in SPECIAL_ELEMENT

const baseName = (name: string): string => name.replace(/ \(\d+ of \d+\)$/, '')

/** A scope entry for the first alternative of a slash row (`Moon/Wheel DMG (1 of 2)`), which the row itself names with no suffix. */
const firstOf = (name: string): string | null => /^(.*) \(1 of \d+\)$/.exec(name)?.[1] ?? null

function inScope(scope: { talents: string[] | null; hits: string[] | null; inTalent?: string | null }, row: HitRow, key: TalentKey): boolean {
  if (scope.inTalent && scope.inTalent !== key) return false
  if (scope.talents && !scope.talents.includes(row.move)) return false
  if (scope.hits && !(scope.hits.includes(row.name) || scope.hits.includes(baseName(row.name)) || (row.alternative !== null && scope.hits.includes(row.alternative)) ||
    (row.alternative !== null && row.name === row.alternative && scope.hits.some((entry) => firstOf(entry) === row.name)))) return false
  return true
}

const sum = (b: Buckets, row: HitRow, key: TalentKey, ...to: string[]): number => {
  let total = 0
  for (const a of b.adds) if (to.includes(a.to) && inScope(a, row, key)) total += a.value
  return total
}

/** The element a row deals: a Lunar kind's own, a Stellar row's, the team's for a row that takes it, an infused physical row's, else her element or physical. */
function elementOf(row: HitRow, hits: PlannerHits, infusions: Buckets['infusions']): string {
  if (isSpecial(row.kind)) return SPECIAL_ELEMENT[row.kind] ?? (row.element ?? hits.element).toLowerCase()
  if (row.element !== null) return row.element.toLowerCase() // a row that takes the team's element
  if (row.kind === 'physical') return infusions.find((i) => i.moves.includes(row.move))?.element ?? 'physical'
  return hits.element.toLowerCase()
}

/** Whether an effect adds to a row: its scope holds and its bucket is one that row reads (`dmg:geo` is nothing to a Cryo row). */
function reachesRow(e: Effect, row: HitRow, key: TalentKey, hits: PlannerHits, infusions: Buckets['infusions']): boolean {
  if (!inScope({ talents: e.talents, hits: e.hits, inTalent: e.in_talent }, row, key)) return false
  const [bucket, name] = e.to.split(':')
  const special = isSpecial(row.kind)
  const element = elementOf(row, hits, infusions)
  switch (bucket) {
    case 'dmg': return !special && (name === undefined || name === element || name === row.move)
    case 'additive': return name === row.kind || (!special && (name === row.move || name === element))
    case 'base': case 'elevation': return name === row.kind
    case 'bonus': return name === row.kind || (!special && ['vaporize', 'melt', 'aggravate', 'spread'].includes(name))
    case 'cr': case 'cd': return name === undefined || name === element || name === row.kind
    default: return true
  }
}

/** The Polestar field is up while a talent counts Stellar-Conduct rows (the controller's ruling: the field belongs to the hit). */
const hasField = (talent: HitTalent): boolean => countedRows(talent).some((row) => row.kind === 'stellar-conduct')

/**
 * One row's damage against the enemy of `tables.enemy`, at average crit. Ordinary hits: `(Σ(mult × stat) + flat + additive) ×
 * (1 + DMG Bonus) × crit × DEF × RES × amplifying`, Aggravate and Spread adding to the base. Lunar and Stellar hits: `(RM × Σ(mult ×
 * stat) × (1 + base bonus) × (1 + 6EM/(EM+2000) + reaction bonus) + additive base) × crit × RES × (1 + elevation)`: no DMG Bonus, no
 * DEF, no level multiplier. A row counts `count` times, and a flat addition (an additive bonus, Aggravate, Spread) once for each of its
 * `instances` hits. A stat that an effect adds to some rows only (Skirk's ATK%) is added to those
 * rows' scaling. In a talent that counts Stellar-Conduct rows the Polestar field is up at that talent's recorded hits (12 by default):
 * its Cryo and Electro DMG Bonus goes to her ordinary Cryo and Electro rows and it lowers the enemy's Physical RES by 40%. Only
 * differences between two builds mean anything.
 */
export function rowDamage(row: HitRow, talent: HitTalent, b: Buckets, hits: PlannerHits, tables: Tables, choice: Choice): number {
  const s = b.stats
  const stat = (name: string): number => (name in s ? s[name as StatKey] : 0) + sum(b, row, talent.key, name)
  let scale = row.flat
  for (const term of row.terms) scale += term.mult * stat(term.stat)
  scale *= 1 + sum(b, row, talent.key, 'mult')
  const res = resMult(tables.enemy.res)
  const recorded = Math.min(Math.max(Math.round(choice.recorded[talent.key] ?? RECORDED_MAX), 0), tables.stellar_conduct.length - 1)
  const element = elementOf(row, hits, b.infusions)

  if (isSpecial(row.kind)) {
    const rm = row.kind === 'stellar-conduct' ? tables.stellar_conduct[recorded] : tables.lunar[row.kind]
    const crit = critAverage(
      s.cr + sum(b, row, talent.key, 'cr', `cr:${element}`, `cr:${row.kind}`),
      s.cd + sum(b, row, talent.key, 'cd', `cd:${element}`, `cd:${row.kind}`),
    )
    const direct = rm * scale * (1 + sum(b, row, talent.key, `base:${row.kind}`)) * (1 + lunarEm(stat('em')) + sum(b, row, talent.key, `bonus:${row.kind}`))
    return row.count * (direct + row.instances * sum(b, row, talent.key, `additive:${row.kind}`)) * crit * res * (1 + sum(b, row, talent.key, `elevation:${row.kind}`))
  }

  const field = hasField(talent)
  const own = hits.element.toLowerCase()
  let bonus = (element === 'physical' ? s.physical + sum(b, row, talent.key, 'physical') : element === own ? s.dmg : 0) +
    sum(b, row, talent.key, 'dmg', `dmg:${element}`, `dmg:${row.move}`)
  if (field && (element === 'cryo' || element === 'electro')) bonus += tables.polestar_dmg[recorded]
  const crit = critAverage(s.cr + sum(b, row, talent.key, 'cr', `cr:${element}`), s.cd + sum(b, row, talent.key, 'cd', `cd:${element}`))

  // a flat bonus is added to each hit of the row (`47.4%+88.1%` is two hits)
  let flat = row.instances * sum(b, row, talent.key, `additive:${row.move}`, `additive:${element}`)
  let amp = 1
  const reaction = choice.reaction[talent.key] ?? 'none'
  const levelMult = tables.level_mult[Math.min(Math.max(hits.level, 1), tables.level_mult.length) - 1]
  if (reaction === 'vaporize' || reaction === 'melt') {
    const c = tables.amplifying[`${reaction}-${element}`]
    if (c !== undefined) amp = amplifying(c, stat('em'), sum(b, row, talent.key, `bonus:${reaction}`))
  } else if (reaction === 'aggravate' || reaction === 'spread') {
    const c = tables.additive[reaction]
    if (c !== undefined && element === (reaction === 'aggravate' ? 'electro' : 'dendro')) {
      flat += row.instances * additive(c, levelMult, stat('em'), sum(b, row, talent.key, `bonus:${reaction}`))
    }
  }
  const against = element === 'physical' && field ? resMult(tables.enemy.res - 0.4) : res
  return row.count * (scale + flat) * (1 + bonus) * crit * defMult(hits.level, tables.enemy.level) * against * amp
}

function critAverage(cr: number, cd: number): number {
  return 1 + Math.min(Math.max(cr, 0), 1) * cd
}

// ------------------------------------------------------------------------------------------------ talents

/**
 * The rows of a talent that the verdict counts: the rows the kit names (every row of a kit that names none). Rows split from one
 * "/" row of the wiki's table (an `alternative` group, "1-Hit DMG / 2-Hit DMG") are each counted once, as spec 12.2 counts each row
 * once, and not as one row of which only a variant hits at a time. The percent change is unaffected when the variants share their
 * scaling stat, and the comparison with Genshin Optimizer agreed with this choice.
 */
export function countedRows(talent: HitTalent): HitRow[] {
  return talent.rows.filter((row) => row.main)
}

function talentDamage(talent: HitTalent, b: Buckets, hits: PlannerHits, tables: Tables, choice: Choice): number {
  let total = 0
  for (const row of countedRows(talent)) total += rowDamage(row, talent, b, hits, tables, choice)
  return total
}

/** The change in percent of the sum of a talent's counted rows (each row once, so bigger rows weigh more); null when it has no
 * counted row or none that deals damage now. */
export function talentChange(talent: HitTalent, now: Buckets, tested: Buckets, hits: PlannerHits, tables: Tables, choice: Choice): number | null {
  if (countedRows(talent).length === 0) return null
  const before = talentDamage(talent, now, hits, tables, choice)
  const after = talentDamage(talent, tested, hits, tables, choice)
  if (!(before > 0)) return null
  return (after / before - 1) * 100
}

// ------------------------------------------------------------------------------------------------ the verdict

export type Verdict = {
  kind: 'harder' | 'softer' | 'none' | 'depends' | 'unknown'
  /** The average of the main talents' changes in percent for harder and softer (negative for softer), 0 for none, else null. */
  figure: number | null
  talents: { key: TalentKey; change: number | null; kind: string }[]
  why: string
  /** The labels of the toggles that are on and counted, in either build. */
  counted: string[]
  notes: string[]
}

export const NO_CHANGE = 0.05

const TALENT_WORD: Record<TalentKey, string> = { normal: 'Normal Attack', skill: 'Skill', burst: 'Burst' }
/** What a Lunar or Stellar kind of hit is called on the page. */
export const KIND_WORD: Record<string, string> = {
  'lunar-bloom': 'Lunar-Bloom', 'lunar-charged': 'Lunar-Charged', 'lunar-crystallize': 'Lunar-Crystallize',
  'stellar-conduct': 'Stellar-Conduct', 'stellar-swirl': 'Stellar Swirl',
}
const STAT_WORD: Record<StatKey, string> = {
  hp: 'Max HP', atk: 'ATK', def: 'DEF', em: 'Elemental Mastery', er: 'Energy Recharge', cr: 'CRIT Rate', cd: 'CRIT DMG',
  dmg: 'DMG Bonus', heal: 'Healing Bonus', physical: 'Physical DMG Bonus',
}

function list(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

const sameSets = (a: Record<string, number>, b: Record<string, number>): boolean =>
  JSON.stringify(Object.entries(a).sort(([x], [y]) => (x < y ? -1 : 1))) === JSON.stringify(Object.entries(b).sort(([x], [y]) => (x < y ? -1 : 1)))

const sameStats = (a: Stats, b: Stats): boolean => (Object.keys(a) as StatKey[]).every((k) => Math.abs(a[k] - b[k]) < 1e-9)

/** The base ATK of a build, as `statsWith` takes it: her own weapon's, or the tested one's added to the character's. */
function baseOf(sim: PlannerSim, weapon: GearWeapon): Base {
  const mine = sim.weapon
  const same = mine !== null && mine.key === weapon.key
  const atk = same || weapon.base_atk === undefined || weapon.base_atk === null ? sim.base.atk : sim.char_base_atk + weapon.base_atk
  return { hp: sim.base.hp, atk, def: sim.base.def }
}

/** The kind of damage that most of a talent's counted damage is: the kinds' rows summed, the biggest sum. */
function dominantKind(talent: HitTalent, b: Buckets, hits: PlannerHits, tables: Tables, choice: Choice): string {
  const sums = new Map<string, number>()
  for (const row of countedRows(talent)) sums.set(row.kind, (sums.get(row.kind) ?? 0) + rowDamage(row, talent, b, hits, tables, choice))
  let best = ''
  let most = -1
  for (const [kind, total] of sums) {
    if (total > most) { most = total; best = kind }
  }
  return best
}

/** What changes damage the most: each stat that differs, put on her current build alone, and the change it makes on average. */
function drivers(
  sim: PlannerSim, hits: PlannerHits, mains: HitTalent[], now: Stats, tested: Stats, wn: GearWeapon, setsNow: Record<string, number>,
  choice: Choice, held: Held,
): { stat: StatKey; change: number }[] {
  const baseNow = baseOf(sim, wn)
  const before = buckets(now, hits, wn, setsNow, choice, { base: baseNow, held })
  const out: { stat: StatKey; change: number }[] = []
  for (const stat of Object.keys(now) as StatKey[]) {
    if (Math.abs(now[stat] - tested[stat]) < 1e-9) continue
    const only = buckets({ ...now, [stat]: tested[stat] }, hits, wn, setsNow, choice, { base: baseNow, held })
    const changes = mains.map((t) => talentChange(t, before, only, hits, sim.tables, choice)).filter((c): c is number => c !== null)
    out.push({ stat, change: changes.length ? changes.reduce((x, y) => x + y, 0) / changes.length : 0 })
  }
  return out.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
}

/** What HoYoLAB's panel already holds of her own gear: her weapon and her sets. */
function heldOf(sim: PlannerSim): Held {
  return {
    weapon: sim.weapon ? { key: sim.weapon.key, refinement: sim.weapon.refinement } : null,
    sets: Object.fromEntries(sim.sets.map((s) => [s.key, s.pieces])),
  }
}

/**
 * The labels of the toggles that are on and counted, in either build: the same list `verdict` gives as `counted`, with none of
 * its other work, for a page that asks it for each toggle it could count (a toggle that is off is counted when it is on).
 */
export function countedLabels(
  sim: PlannerSim, now: Stats, tested: Stats, weaponNow: GearWeapon, weaponTested: GearWeapon,
  setsNow: Record<string, number>, setsTested: Record<string, number>, choice: Choice,
): string[] {
  return countedBoth(sim, now, tested, weaponNow, weaponTested, setsNow, setsTested, choice).labels
}

/** The names of the toggles that are on and counted, in either build: what `countedLabels` says, by name (the Polestar field has none). */
export function countedNames(
  sim: PlannerSim, now: Stats, tested: Stats, weaponNow: GearWeapon, weaponTested: GearWeapon,
  setsNow: Record<string, number>, setsTested: Record<string, number>, choice: Choice,
): string[] {
  return countedBoth(sim, now, tested, weaponNow, weaponTested, setsNow, setsTested, choice).names
}

/**
 * What each counted row of the main talents deals in the two builds, in order (the now build's, then the tested build's, row by row):
 * the planner compares two such lists to see whether counting a toggle moves any row it counts, whatever the verdict's own change is.
 */
export function countedDamages(
  sim: PlannerSim, now: Stats, tested: Stats, weaponNow: GearWeapon, weaponTested: GearWeapon,
  setsNow: Record<string, number>, setsTested: Record<string, number>, choice: Choice,
): number[] {
  const hits = sim.hits === null ? null : resolveParty(sim.hits, choice)
  if (hits === null) return []
  const held = heldOf(sim)
  const bNow = buckets(now, hits, weaponNow, setsNow, choice, { base: baseOf(sim, weaponNow), held })
  const bTested = buckets(tested, hits, weaponTested, setsTested, choice, { base: baseOf(sim, weaponTested), held })
  const out: number[] = []
  for (const talent of hits.talents.filter((t) => t.main)) {
    for (const row of countedRows(talent)) {
      out.push(rowDamage(row, talent, bNow, hits, sim.tables, choice), rowDamage(row, talent, bTested, hits, sim.tables, choice))
    }
  }
  return out
}

function countedBoth(
  sim: PlannerSim, now: Stats, tested: Stats, weaponNow: GearWeapon, weaponTested: GearWeapon,
  setsNow: Record<string, number>, setsTested: Record<string, number>, choice: Choice,
): { labels: string[]; names: string[] } {
  const hits = sim.hits === null ? null : resolveParty(sim.hits, choice)
  if (hits === null) return { labels: [], names: [] }
  const held = heldOf(sim)
  const bNow = buckets(now, hits, weaponNow, setsNow, choice, { base: baseOf(sim, weaponNow), held })
  const bTested = buckets(tested, hits, weaponTested, setsTested, choice, { base: baseOf(sim, weaponTested), held })
  return {
    labels: [...new Set([...bNow.counted, ...bTested.counted])],
    names: [...new Set([...bNow.countedNames, ...bTested.countedNames])],
  }
}

/**
 * The verdict for a test: every main talent's change; all above +0.05% is "harder" (its figure the average), all below -0.05% "softer",
 * all within ±0.05% "none"; otherwise "depends". `now` and `tested` are `statsWith`'s results, the weapons and sets the ones worn
 * and tested ({set key: pieces}); `sim.weapon` and `sim.sets` are what the panel holds. With no hits of hers the kind is "unknown".
 */
export function verdict(
  sim: PlannerSim, now: Stats, tested: Stats, weaponNow: GearWeapon, weaponTested: GearWeapon,
  setsNow: Record<string, number>, setsTested: Record<string, number>, choice: Choice, p: Pronouns = SHE,
): Verdict {
  const hits = sim.hits === null ? null : resolveParty(sim.hits, choice)
  const unknown = (why: string): Verdict => ({ kind: 'unknown', figure: null, talents: [], why, counted: [], notes: [] })
  if (hits === null) return unknown(`${cap(p.hers)} hits are not known yet.`)
  const mains = TALENT_ORDER.map((key) => hits.talents.find((t) => t.key === key)).filter(
    (t): t is HitTalent => t !== undefined && t.main && countedRows(t).length > 0)
  if (mains.length === 0) return unknown(`${cap(p.hers)} damage rows are not known yet.`)

  const held = heldOf(sim)
  const bNow = buckets(now, hits, weaponNow, setsNow, choice, { base: baseOf(sim, weaponNow), held })
  const bTested = buckets(tested, hits, weaponTested, setsTested, choice, { base: baseOf(sim, weaponTested), held })
  const talents = mains.map((t) => ({
    key: t.key, change: talentChange(t, bNow, bTested, hits, sim.tables, choice), kind: dominantKind(t, bNow, hits, sim.tables, choice),
  }))
  const known = talents.map((t) => t.change).filter((c): c is number => c !== null)
  const counted = [...new Set([...bNow.counted, ...bTested.counted])]
  const notes = notesFor(hits, mains, weaponNow, weaponTested, choice, p)
  if (known.length === 0) return { ...unknown(`None of ${p.hers} counted hits deal damage yet.`), talents, counted, notes }

  const same = sameStats(now, tested) && weaponNow.key === weaponTested.key && weaponNow.refinement === weaponTested.refinement &&
    sameSets(setsNow, setsTested)
  // A kit the comparison with Genshin Optimizer could not prove (kits.json `unsure`) gives no figure: each talent's change, and why.
  if (hits.unsure && !same) return { kind: 'depends', figure: null, talents, why: hits.unsure, counted, notes }
  const average = known.reduce((x, y) => x + y, 0) / known.length
  let kind: Verdict['kind']
  if (known.every((c) => c > NO_CHANGE)) kind = 'harder'
  else if (known.every((c) => c < -NO_CHANGE)) kind = 'softer'
  else if (known.every((c) => Math.abs(c) <= NO_CHANGE)) kind = 'none'
  else kind = 'depends'
  const figure = kind === 'harder' || kind === 'softer' ? average : kind === 'none' ? 0 : null

  const why = whyOf({ kind, hits, mains, talents, sim, now, tested, weaponNow, setsNow, choice, held, same, p })
  return { kind, figure, talents, why, counted, notes }
}

/** Whether a reaction that is on is one this row can trigger: an ordinary row of an element that takes it (an infused physical row is its infusion's). */
function reacts(row: HitRow, reaction: Reaction, hits: PlannerHits, choice: Choice): boolean {
  if (reaction === 'none' || isSpecial(row.kind)) return false
  let element = row.element ?? hits.element
  if (row.kind === 'physical') {
    const infusion = infusionFor(hits, choice, row.move)
    if (infusion === undefined) return false
    element = infusion.element
  }
  return reactionsFor(element).includes(reaction)
}

function notesFor(hits: PlannerHits, mains: HitTalent[], now: GearWeapon, tested: GearWeapon, choice: Choice, p: Pronouns): string[] {
  const notes: string[] = []
  const Hers = cap(p.hers)
  if (!hits.checked) notes.push(`${Hers} passives are not counted yet.`)
  if (now.level !== undefined && tested.level !== undefined && now.level !== tested.level) {
    notes.push(`${Hers} weapon is level ${now.level}; the tested one is level ${tested.level}.`)
  }
  if (now.key !== tested.key && now.refinement !== tested.refinement) {
    notes.push(`${Hers} weapon is refinement ${now.refinement}; the tested one is refinement ${tested.refinement}.`)
  }
  if (hits.recommended.includes('em')) {
    const rows = mains.flatMap((t) => countedRows(t).map((row) => ({ t, row })))
    const usesEm = rows.some(({ t, row }) =>
      isSpecial(row.kind) || row.terms.some((term) => term.stat === 'em') || reacts(row, choice.reaction[t.key] ?? 'none', hits, choice))
    if (!usesEm) {
      notes.push(reactionsFor(hits.element).length > 0
        ? `HoYoverse recommends Elemental Mastery for ${p.her}. Turn on the reaction ${p.she} ${verb(p.she === 'they', 'triggers', 'trigger')} to count it.`
        : `HoYoverse recommends Elemental Mastery for ${p.her}. The hits counted here don't use it.`)
    }
  }
  return notes
}

function whyOf(c: {
  kind: Verdict['kind']; hits: PlannerHits; mains: HitTalent[]; talents: Verdict['talents']; sim: PlannerSim; now: Stats; tested: Stats
  weaponNow: GearWeapon; setsNow: Record<string, number>; choice: Choice; held: Held; same: boolean; p: Pronouns
}): string {
  const { hits, mains, p } = c
  const Hers = cap(p.hers)
  const names = list(mains.map((t) => TALENT_WORD[t.key]))
  // The verb of "Her Skill" is singular, of "Her Skill and Burst" plural.
  const many = mains.length > 1
  if (c.same) return `Nothing in ${p.hers} build changes.`
  // Every counted row is a Lunar or Stellar one (a talent that mixes in an ordinary row is not).
  const kinds = [...new Set(mains.flatMap((t) => countedRows(t).map((row) => row.kind)))]
  const allSpecial = kinds.length > 0 && kinds.every(isSpecial)
  const element = hits.element
  const driven = drivers(c.sim, hits, mains, c.now, c.tested, c.weaponNow, c.setsNow, c.choice, c.held)
  // A bonus that goes up and that the counted hits do not read (every one is a Lunar or Stellar hit), when that is what leaves
  // the build no better: the usual reason a Lunar or Stellar build is "wrong".
  if (allSpecial && c.kind !== 'harder' && c.kind !== 'depends') {
    for (const stat of ['dmg', 'physical'] as StatKey[]) {
      const idle = driven.some((d) => d.stat === stat && Math.abs(d.change) < NO_CHANGE)
      if (c.tested[stat] > c.now[stat] + 1e-9 && idle) {
        const bonus = stat === 'dmg' ? `${element} DMG Bonus` : 'Physical DMG Bonus'
        return `${Hers} ${names} ${verb(many, 'deals', 'deal')} ${list(kinds.map((k) => KIND_WORD[k] ?? k))} damage, which ${bonus} does not raise.`
      }
    }
  }
  const top = driven[0]
  const word = (stat: StatKey): string => (stat === 'dmg' ? `${element} DMG Bonus` : STAT_WORD[stat])
  switch (c.kind) {
    case 'harder':
      return top && top.change > 0 ? `${Hers} ${names} ${verb(many, 'hits', 'hit')} harder because ${p.hers} ${word(top.stat)} goes up.` : `${Hers} ${names} ${verb(many, 'hits', 'hit')} harder with the tested weapon and sets.`
    case 'softer':
      return top && top.change < 0 ? `${Hers} ${names} ${verb(many, 'hits', 'hit')} softer because ${p.hers} ${word(top.stat)} goes down.` : `${Hers} ${names} ${verb(many, 'hits', 'hit')} softer with the tested weapon and sets.`
    case 'none':
      return `The stats that change do not move the hits ${p.she} ${verb(p.she === 'they', 'is', 'are')} counted on.`
    default: {
      const up = c.talents.filter((t) => (t.change ?? 0) > NO_CHANGE).map((t) => TALENT_WORD[t.key])
      const down = c.talents.filter((t) => (t.change ?? 0) < -NO_CHANGE).map((t) => TALENT_WORD[t.key])
      if (up.length && down.length) return `${Hers} ${list(up)} ${verb(up.length > 1, 'hits', 'hit')} harder and ${p.hers} ${list(down)} ${verb(down.length > 1, 'hits', 'hit')} softer, because they scale on different stats.`
      return `Some of ${p.hers} hits change and some stay the same, because they scale on different stats.`
    }
  }
}

/** The toggles the page lists for a test: hers, the weapon's and the sets' that hold for the build, each with its state now. */
export function togglesFor(hits: PlannerHits, weaponKey: string, setKeys: string[], choice: Choice): { name: string; label: string; on: boolean }[] {
  const out: { name: string; label: string; on: boolean }[] = []
  const take = (gear: { toggles: { name: string; label: string; on: boolean }[] } | undefined): void => {
    for (const t of gear?.toggles ?? []) {
      if (!out.some((o) => o.name === t.name)) out.push({ name: t.name, label: t.label, on: choice.toggles[t.name] ?? t.on })
    }
  }
  take(hits)
  take(hits.weapon_effects[weaponKey] as GearEffects | undefined)
  for (const key of setKeys) take(hits.set_effects[key])
  return out
}

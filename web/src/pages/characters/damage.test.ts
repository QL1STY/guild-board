import { describe, expect, test } from 'vitest'
import damageKits from '../../fixtures/damage-kits.json'
import simFixture from '../../fixtures/planner-sim.json'
import type { Effect, HitRow, HitTalent, PlannerHits, PlannerSim } from '../../types.ts'
import {
  additive, amplifying, buckets, countedLabels, countedNames, countedRows, defMult, lunarEm, noChoice, reactionsFor, resMult, rowDamage, talentChange, togglesFor,
  verdict, type Base, type Choice, type GearWeapon, type Stats, type TalentKey,
} from './damage.ts'

const tables = damageKits.tables as unknown as PlannerSim['tables']
const kit = (key: 'sandrone' | 'lauma' | 'hu-tao'): PlannerHits => structuredClone(damageKits.kits[key]) as unknown as PlannerHits
const talentOf = (hits: PlannerHits, key: TalentKey): HitTalent => hits.talents.find((t) => t.key === key)!
const rowOf = (hits: PlannerHits, key: TalentKey, name: string): HitRow => talentOf(hits, key).rows.find((r) => r.name === name)!

/** A kit effect with every field of the data format; `over` says what is not null. */
const effect = (over: Partial<Effect>): Effect => ({
  from: null, reads: null, to: 'dmg', rate: 0, cap: null, cap_from: null, over: null, pieces: null, from_ascension: null,
  from_constellation: null, talents: null, weapon_types: null, hits: null, row: null, while: null, in_stats: false, ...over,
})

/** SHAPE-ONLY INPUT: a row and a hits block made up for the tests of the engine's own arithmetic, where the test states what it
 * expects by hand. Every number of the three GO builds (the kit rows, the stats, the effects) is the game's, from damage-kits.json. */
const synthetic = (over: Partial<HitRow>): HitRow => ({
  name: 'Row', kind: 'elemental', terms: [{ stat: 'atk', mult: 1 }], flat: 0, count: 1, instances: 1, move: 'skill', element: null, alternative: null,
  main: true, ...over,
})
const talent = (key: TalentKey, rows: HitRow[], main = true): HitTalent => ({ key, name: key, icon: null, level: 10, main, source: 'hoyolab', rows })
/** SHAPE-ONLY INPUT, like `synthetic`. */
const hitsOf = (over: Partial<PlannerHits>): PlannerHits => ({
  element: 'Pyro', weapon_type: 'Sword', level: 90, checked: true, unsure: null, recommended: [], talents: [], effects: [], toggles: [], infused: [],
  weapon_effects: {}, set_effects: {}, party: null, ...over,
})

const stats = (over: Partial<Stats>): Stats => ({
  hp: 20000, atk: 2000, def: 800, em: 0, er: 100, cr: 50, cd: 100, dmg: 0, heal: 0, physical: 0, ...over,
})
const base: Base = { hp: 0, atk: 0, def: 0 }
const weapon = (key: string, refinement = 1): GearWeapon => ({ key, refinement })

/** The percent change of one row between two builds of the same weapon and sets. */
function rowChange(hits: PlannerHits, key: TalentKey, name: string, a: Stats, b: Stats, w: GearWeapon, sets: Record<string, number>,
  baseValues: Base, choice: Choice = noChoice()): number {
  const t = talentOf(hits, key)
  const row = rowOf(hits, key, name)
  const before = rowDamage(row, t, buckets(a, hits, w, sets, choice, { base: baseValues }), hits, tables, choice)
  const after = rowDamage(row, t, buckets(b, hits, w, sets, choice, { base: baseValues }), hits, tables, choice)
  return (after / before - 1) * 100
}

describe('the formulas', () => {
  test('the Fandom worked example', () => {
    // formulas-and-rolls.md 2.11: Mona Lv 70, ATK 1500, EM 150, CRIT DMG 80%, Hydro DMG Bonus 40%, Stellaris Phantasm 619% with +52%,
    // Vaporize, a crit, against a Lv 75 Fatui Agent with 10% Hydro RES, Viridescent Venerer (-40%) and Klee's C2 (-23% DEF).
    const damage = 1500 * 6.19 * (1 + 0.4 + 0.52) * defMult(70, 75, 0.23) * resMult(0.1 - 0.4) * amplifying(2, 150) * (1 + 0.8)
    expect(defMult(70, 75, 0.23)).toBeCloseTo(0.55783, 5)
    expect(resMult(-0.3)).toBeCloseTo(1.15, 6)
    expect(amplifying(2, 150)).toBeCloseTo(2.53806, 4)
    expect(Math.abs(damage - 52247)).toBeLessThan(1)
  })

  test('amplifying, additive and Lunar EM terms', () => {
    expect(amplifying(2, 0)).toBe(2)
    expect(lunarEm(500)).toBeCloseTo(1.2, 3)
    expect(lunarEm(1000)).toBeCloseTo(2, 3)
    expect(additive(1.15, 1446.8535, 100)).toBeCloseTo(1.15 * 1446.8535 * (1 + 500 / 1300), 1)
    expect(amplifying(1.5, 100, 0.15)).toBeCloseTo(1.5 * (1 + (2.78 * 100) / 1500 + 0.15), 6)
    expect(resMult(0.1)).toBe(0.9)
    expect(resMult(0.8)).toBeCloseTo(1 / 4.2, 6)
    expect(defMult(90, 100)).toBeCloseTo(190 / 390, 6)
  })

  test('the reactions an element can switch on', () => {
    expect(reactionsFor('Pyro')).toEqual(['vaporize', 'melt'])
    expect(reactionsFor('hydro')).toEqual(['vaporize'])
    expect(reactionsFor('Cryo')).toEqual(['melt'])
    expect(reactionsFor('Electro')).toEqual(['aggravate'])
    expect(reactionsFor('Dendro')).toEqual(['spread'])
    expect(reactionsFor('Geo')).toEqual([])
    expect(reactionsFor('Anemo')).toEqual([])
  })

  test('ordinary hits take the reactions, Lunar and Stellar hits take none of the ordinary bonuses', () => {
    const hits = hitsOf({ element: 'Pyro' })
    const t = talent('skill', [synthetic({})])
    const b = buckets(stats({ em: 200 }), hits, weapon('w'), {}, noChoice(), { base })
    const plain = rowDamage(t.rows[0], t, b, hits, tables, noChoice())
    const vape = rowDamage(t.rows[0], t, b, hits, tables, { ...noChoice(), reaction: { skill: 'vaporize' } })
    const melt = rowDamage(t.rows[0], t, b, hits, tables, { ...noChoice(), reaction: { skill: 'melt' } })
    expect(vape / plain).toBeCloseTo(amplifying(1.5, 200), 6)   // Pyro on Hydro
    expect(melt / plain).toBeCloseTo(amplifying(2, 200), 6)     // Pyro on Cryo
    const dendro = hitsOf({ element: 'Dendro' })
    const spread = rowDamage(t.rows[0], t, buckets(stats({ em: 200 }), dendro, weapon('w'), {}, noChoice(), { base }), dendro, tables,
      { ...noChoice(), reaction: { skill: 'spread' } })
    const bare = rowDamage(t.rows[0], t, buckets(stats({ em: 200 }), dendro, weapon('w'), {}, noChoice(), { base }), dendro, tables, noChoice())
    expect(spread / bare).toBeCloseTo((2000 + additive(1.25, 1446.8535, 200)) / 2000, 6)
  })

  test("a row of several hits takes a flat bonus per hit once for each (Raiden's 4-Hit under Aggravate)", () => {
    // found by the comparison with Genshin Optimizer (2026-11-14): `55.1%+55.3%` is two hits, each taking Aggravate's addition
    const hits = hitsOf({ element: 'Electro', effects: [effect({ to: 'additive:burst', rate: 100 })] })
    const two = synthetic({ move: 'burst', terms: [{ stat: 'atk', mult: 1.104 }], instances: 2 })
    const one = synthetic({ move: 'burst', terms: [{ stat: 'atk', mult: 1.104 }] })
    const t = talent('burst', [two])
    const b = buckets(stats({ em: 200 }), hits, weapon('w'), {}, noChoice(), { base })
    const agg = { ...noChoice(), reaction: { burst: 'aggravate' as const } }
    const extra = additive(1.15, 1446.8535, 200)
    const ratio = (row: HitRow): number => rowDamage(row, t, b, hits, tables, agg) / rowDamage(row, t, b, hits, tables, noChoice())
    expect(ratio(two)).toBeCloseTo((2000 * 1.104 + 2 * (100 + extra)) / (2000 * 1.104 + 2 * 100), 9)
    expect(ratio(one)).toBeCloseTo((2000 * 1.104 + 100 + extra) / (2000 * 1.104 + 100), 9)
  })

  test('Lunar and Stellar hits ignore DMG Bonus and DEF', () => {
    const hits = hitsOf({ element: 'Cryo' })
    const lunar = synthetic({ kind: 'lunar-bloom', terms: [{ stat: 'em', mult: 2.736 }] })
    const stellar = synthetic({ kind: 'stellar-conduct', element: 'Cryo' })
    const t = talent('skill', [lunar, stellar])
    for (const row of t.rows) {
      const none = rowDamage(row, t, buckets(stats({ dmg: 0, em: 300 }), hits, weapon('w'), {}, noChoice(), { base }), hits, tables, noChoice())
      const lots = rowDamage(row, t, buckets(stats({ dmg: 46.6, em: 300 }), hits, weapon('w'), {}, noChoice(), { base }), hits, tables, noChoice())
      expect(lots).toBe(none)
      const tough = { ...tables, enemy: { ...tables.enemy, level: 140 } }
      const b = buckets(stats({ em: 300 }), hits, weapon('w'), {}, noChoice(), { base })
      expect(rowDamage(row, t, b, hits, tough, noChoice())).toBe(rowDamage(row, t, b, hits, tables, noChoice()))
    }
    // Their own bonuses count: Reaction Bonus, base bonus, an elemental CRIT bonus and Elevation by name.
    const withBonus = hitsOf({
      element: 'Cryo',
      effects: [
        effect({ to: 'bonus:lunar-bloom', rate: 0.5 }), effect({ to: 'base:lunar-bloom', rate: 0.14 }),
        effect({ to: 'elevation:lunar-bloom', rate: 0.25 }), effect({ to: 'cd:dendro', rate: 0.5 }),
      ],
    })
    const s = stats({ em: 500, cr: 100, cd: 100 })
    const row = synthetic({ kind: 'lunar-bloom', terms: [{ stat: 'em', mult: 1 }] })
    const t2 = talent('skill', [row])
    const got = rowDamage(row, t2, buckets(s, withBonus, weapon('w'), {}, noChoice(), { base }), withBonus, tables, noChoice())
    const hand = 1 * 500 * 1.14 * (1 + lunarEm(500) + 0.5) * (1 + 1 * 1.5) * 0.9 * 1.25
    expect(got).toBeCloseTo(hand, 6)
  })

  test('Stellar-Conduct takes the recorded hits of its talent; an additive base makes them count in the change', () => {
    const hits = hitsOf({ element: 'Cryo' })
    const row = synthetic({ kind: 'stellar-conduct', element: 'Cryo' })
    const t = talent('skill', [row])
    const b = buckets(stats({}), hits, weapon('w'), {}, noChoice(), { base })
    const full = rowDamage(row, t, b, hits, tables, noChoice())
    const none = rowDamage(row, t, b, hits, tables, { ...noChoice(), recorded: { skill: 0 } })
    expect(full / none).toBeCloseTo(2, 9)
    // With no additive base it cancels out of a percent change; with one it does not.
    const bigger = stats({ atk: 3000 })
    const plus = (extra: Effect[]): number => {
      const h = hitsOf({ element: 'Cryo', effects: extra })
      const c0 = { ...noChoice(), recorded: { skill: 0 } as Choice['recorded'] }
      const change = (c: Choice): number => {
        const a = rowDamage(row, t, buckets(stats({}), h, weapon('w'), {}, c, { base }), h, tables, c)
        const z = rowDamage(row, t, buckets(bigger, h, weapon('w'), {}, c, { base }), h, tables, c)
        return z / a
      }
      return change(c0) - change(noChoice())
    }
    expect(plus([])).toBeCloseTo(0, 9)
    expect(Math.abs(plus([effect({ to: 'additive:stellar-conduct', rate: 2000 })]))).toBeGreaterThan(1e-4)
  })
})

describe('effects', () => {
  test('conversions read the stats before conversions, `final` ones after, and a cap can be a part of base ATK', () => {
    const hits = hitsOf({
      effects: [
        effect({ from: 'hp', reads: 'premod', to: 'atk', rate: 0.1, cap: 1, cap_from: 'base_atk' }),
        effect({ from: 'atk', reads: 'premod', to: 'em', rate: 0.1 }),     // reads ATK before the line above
        effect({ from: 'atk', reads: 'final', to: 'base:lunar-bloom', rate: 0.0001 }),
        effect({ from: 'er', reads: 'premod', over: 1, to: 'dmg:pyro', rate: 0.4 }),
      ],
    })
    const b = buckets(stats({ hp: 20000, atk: 1000, er: 150 }), hits, weapon('w'), {}, noChoice(), { base: { hp: 10000, atk: 500, def: 100 } })
    expect(b.stats.atk).toBeCloseTo(1500, 6)    // min(2000, 1 x 500 base ATK) added
    expect(b.stats.em).toBeCloseTo(100, 6)      // 10% of the ATK of 1000, not of 1500
    expect(b.adds.find((a) => a.to === 'base:lunar-bloom')!.value).toBeCloseTo(0.15, 9)   // 1500 final ATK
    expect(b.adds.find((a) => a.to === 'dmg:pyro')!.value).toBeCloseTo(0.2, 9)            // 0.4 x (1.5 - 1)
  })

  test('an effect that multiplies its stat by a second one (Kokomi: Max HP times Healing Bonus) reads both as they are', () => {
    // asc >= 4: 15% of Max HP x Healing Bonus, flat damage on her Normal Attack
    const hits = hitsOf({ effects: [effect({ from: 'hp', reads: 'premod', to: 'additive:normal', rate: 0.15, times: 'heal' })] })
    const at = (heal: number, hp: number): number =>
      buckets(stats({ hp, heal }), hits, weapon('w'), {}, noChoice(), { base }).adds.find((a) => a.to === 'additive:normal')!.value
    expect(at(25, 30000)).toBeCloseTo(0.15 * 30000 * 0.25, 9)
    expect(at(0, 30000)).toBe(0)
    // a Healing Bonus another effect adds (the goblet's, a conversion's) counts, as the stat after the plain effects
    const raised = hitsOf({ effects: [effect({ to: 'heal', rate: 0.5 }), effect({ from: 'hp', reads: 'premod', to: 'additive:normal', rate: 0.15, times: 'heal' })] })
    expect(buckets(stats({ hp: 30000, heal: 25 }), raised, weapon('w'), {}, noChoice(), { base }).adds.find((a) => a.to === 'additive:normal')!.value)
      .toBeCloseTo(0.15 * 30000 * 0.75, 9)
    // the Normal Attack row adds it to each hit: a bigger Healing Bonus is more damage
    const row = synthetic({ name: 'Hit', move: 'normal', kind: 'elemental' })
    const damage = (heal: number): number => {
      const b = buckets(stats({ hp: 30000, heal }), hits, weapon('w'), {}, noChoice(), { base })
      return rowDamage(row, talent('normal', [row]), b, hits, tables, noChoice())
    }
    expect(damage(50)).toBeGreaterThan(damage(25))
  })

  test('scoped effects hold for their rows only', () => {
    const hits = hitsOf({
      effects: [
        effect({ to: 'dmg:skill', rate: 0.5 }),
        effect({ to: 'cd', rate: 1, hits: ['Named hit'] }),
        effect({ to: 'dmg', rate: 0.25, talents: ['burst'] }),
      ],
    })
    const named = synthetic({ name: 'Named hit', move: 'skill' })
    const other = synthetic({ name: 'Other hit', move: 'skill' })
    const burst = synthetic({ name: 'Burst hit', move: 'burst' })
    const b = buckets(stats({ cr: 100, cd: 100 }), hits, weapon('w'), {}, noChoice(), { base })
    const damage = (row: HitRow): number => rowDamage(row, talent(row.move as TalentKey, [row]), b, hits, tables, noChoice())
    expect(damage(named) / damage(other)).toBeCloseTo(3 / 2, 9)   // CRIT multiplier 3 against 2
    expect(damage(burst)).toBeCloseTo(2000 * 1.25 * 2 * defMult(90, 100) * 0.9, 6)
  })

  test("an effect for rows of one talent leaves another talent's row of the same name alone (Skirk's and Cyno's 1-Hit DMG)", () => {
    const hits = hitsOf({
      effects: [
        effect({ to: 'dmg', rate: 1, hits: ['1-Hit DMG'], in_talent: 'burst' }),
        effect({ to: 'dmg:normal', rate: 0.5, hits: ['1-Hit DMG'] }),     // no talent given: both
      ],
    })
    const normal = synthetic({ name: '1-Hit DMG', move: 'normal', kind: 'elemental' })
    const burstRow = synthetic({ name: '1-Hit DMG', move: 'normal', kind: 'elemental' })
    const b = buckets(stats({ cr: 0 }), hits, weapon('w'), {}, noChoice(), { base })
    const damage = (key: TalentKey, row: HitRow): number => rowDamage(row, talent(key, [row]), b, hits, tables, noChoice())
    expect(damage('burst', burstRow) / damage('normal', normal)).toBeCloseTo(2.5 / 1.5, 9)
    // the toggle's note counts it for the talent's rows only
    const gated = hitsOf({
      talents: [talent('normal', [normal]), talent('burst', [{ ...burstRow, name: 'Other' }])],
      effects: [effect({ to: 'dmg', rate: 1, hits: ['1-Hit DMG'], in_talent: 'burst', while: 'state' })],
      toggles: [{ name: 'state', label: 'State', on: true, covers: [], state: 'on' }],
    })
    expect(buckets(stats({}), gated, weapon('w'), {}, noChoice(), { base }).counted).toEqual([])
    const reached = hitsOf({
      talents: [talent('normal', [{ ...normal, name: 'Other' }]), talent('burst', [burstRow])],
      effects: gated.effects, toggles: gated.toggles,
    })
    expect(buckets(stats({}), reached, weapon('w'), {}, noChoice(), { base }).counted).toEqual(['State'])
  })

  test("a set's pieces and a weapon type gate their effects", () => {
    const hits = kit('sandrone')
    const w = weapon('wolf-s-gravestone')
    const has = (pieces: number): boolean => buckets(stats({}), hits, w, { 'gladiator-s-finale': pieces }, noChoice(), { base })
      .adds.some((a) => a.to === 'dmg:normal')
    expect(has(2)).toBe(false)
    expect(has(4)).toBe(true)
    const bow = { ...hits, weapon_type: 'Bow' }
    expect(buckets(stats({}), bow, w, { 'gladiator-s-finale': 4 }, noChoice(), { base }).adds.some((a) => a.to === 'dmg:normal')).toBe(false)
  })

  test('what the panel already holds of her gear is added only for a tested weapon or set that is not hers', () => {
    const hits = kit('sandrone')
    const hold = { weapon: { key: 'wolf-s-gravestone', refinement: 1 }, sets: { 'gladiator-s-finale': 5 } }
    const s = stats({ atk: 3000 })
    const b = { hp: 0, atk: 1000, def: 0 }
    const keeps = buckets(s, hits, weapon('wolf-s-gravestone'), { 'gladiator-s-finale': 5 }, noChoice(), { base: b, held: hold })
    expect(keeps.stats.atk).toBe(3000)                                    // hers: the panel has its 20% ATK and the 2 pieces' 18%
    const other = buckets(s, hits, weapon('some-other-weapon'), { 'gladiator-s-finale': 5 }, noChoice(), { base: b, held: hold })
    expect(other.stats.atk).toBeCloseTo(3000 - 200, 9)                    // hers taken out (20% of 1000)
    const back = buckets(s, hits, weapon('wolf-s-gravestone', 3), {}, noChoice(), { base: b, held: { weapon: null, sets: {} } })
    expect(back.stats.atk).toBeCloseTo(3000 + 300, 9)                     // a tested Wolf's Gravestone adds its 30% at R3
    // the 2-piece plain stats are statsWith's: never added or taken out here
    const none = buckets(s, hits, weapon('wolf-s-gravestone'), {}, noChoice(), { base: b, held: hold })
    expect(none.stats.atk).toBe(3000)
  })

  test("a weapon's numbers follow the tested refinement", () => {
    const hits = kit('hu-tao')
    const at = (r: number): number => buckets(stats({ hp: 30000, atk: 1000 }), hits, weapon('staff-of-homa', r), {}, noChoice(),
      { base: { hp: 15000, atk: 700, def: 0 }, held: { weapon: { key: 'staff-of-homa', refinement: 1 }, sets: {} } }).stats.atk
    // Her own Paramita Papilio adds 6.256% of 30,000 HP; Homa gives 0.8% (R1) or 1.2% (R3) of it
    expect(at(1)).toBeCloseTo(1000 + 0.06256 * 30000 + 0.008 * 30000, 6)
    expect(at(3)).toBeCloseTo(1000 + 0.06256 * 30000 + 0.012 * 30000, 6)
  })
})

// The three builds Genshin Optimizer was measured on (go-engine.md, section 1): level 90, talents 10/10/10, C0, the weapon at 90 R1,
// five 5-star pieces of one set. The stats are GO's own output before conversions (its totals less what the kit's conversions add).
const SANDRONE_A: Stats = { hp: 19328.141914240005, atk: 3074.0342979688594, def: 0, em: 40, er: 110, cr: 54.2, cd: 172.2, dmg: 0, heal: 0, physical: 0 }
const SANDRONE_B: Stats = { ...SANDRONE_A, atk: 2631.2878449452596, dmg: 46.6 }
const SANDRONE_BASE: Base = { hp: 0, atk: 950.0996846, def: 0 }
const LAUMA_A: Stats = { hp: 16499.33667036, atk: 1260.342623988, def: 0, em: 808.2, er: 110, cr: 99.1768, cd: 110, dmg: 0, heal: 0, physical: 0 }
const LAUMA_B: Stats = { ...LAUMA_A, em: 621.7, dmg: 46.6 }
const HUTAO_A: Stats = { hp: 32245.3734902136, atk: 1096.95987503, def: 0, em: 40, er: 110, cr: 35, cd: 276.7536, dmg: 61.6, heal: 0, physical: 0 }
const HUTAO_B: Stats = { ...HUTAO_A, hp: 24997.99860548, atk: 1429.9210584518 }
const HUTAO_BASE: Base = { hp: 15552.3066196, atk: 714.5089773, def: 0 }

describe("Genshin Optimizer's three swaps", () => {
  const tolerance = 0.05

  test('Sandrone, ATK% goblet to Cryo goblet: Stellar-Conduct falls, an ordinary hit rises with the Polestar field', () => {
    const hits = kit('sandrone')
    const w = weapon('wolf-s-gravestone')
    const sets = { 'gladiator-s-finale': 5 }
    const change = (key: TalentKey, name: string, h = hits): number => rowChange(h, key, name, SANDRONE_A, SANDRONE_B, w, sets, SANDRONE_BASE)
    expect(Math.abs(change('skill', 'Prism Shot Stellar-Conduct DMG') - -14.403)).toBeLessThan(tolerance)
    expect(Math.abs(change('burst', 'Convective Inhibition Ray Stellar-Conduct DMG') - -14.403)).toBeLessThan(tolerance)
    // GO ran this with the Polestar field's +40% Cryo DMG Bonus on both builds (12 recorded hits): the field is the engine's, tied to
    // the Stellar-Conduct rows she counts, so the real kit gives GO's +14.089% with nothing added by hand.
    expect(Math.abs(change('skill', 'Prism Shot DMG') - 14.089)).toBeLessThan(tolerance)
    expect(Math.abs(change('burst', 'Convective Inhibition Ray DMG') - 14.089)).toBeLessThan(tolerance)
    // With no hit recorded the field gives 20%, not 40% (KQM's table): the ordinary hit gains more from the Cryo goblet.
    const c0 = { ...noChoice(), recorded: { skill: 0 } }
    const by = (f: number): number => ((1 + f + 0.466) / (1 + f)) * (SANDRONE_B.atk / SANDRONE_A.atk) * 100 - 100
    expect(Math.abs(rowChange(hits, 'skill', 'Prism Shot DMG', SANDRONE_A, SANDRONE_B, w, sets, SANDRONE_BASE, c0) - by(0.2))).toBeLessThan(1e-6)
    expect(Math.abs(change('skill', 'Prism Shot DMG') - by(0.4))).toBeLessThan(1e-6)
    // The recorded hits cancel out of the change (GO: the same -14.403% with 0 hits).
    expect(Math.abs(rowChange(hits, 'skill', 'Prism Shot Stellar-Conduct DMG', SANDRONE_A, SANDRONE_B, w, sets, SANDRONE_BASE, c0) - -14.403)).toBeLessThan(tolerance)
  })

  test('Lauma, EM goblet to Dendro goblet: a Lunar-Bloom hit falls, the Pale Hymn additive damps it', () => {
    const hits = kit('lauma')
    const w = weapon('lost-prayer-to-the-sacred-winds')
    const sets = { 'gilded-dreams': 5 }
    const change = (name: string, c: Choice = noChoice()): number => rowChange(hits, 'skill', name, LAUMA_A, LAUMA_B, w, sets, { hp: 0, atk: 0, def: 0 }, c)
    expect(Math.abs(change('2-Hit Hold DMG') - -33.522)).toBeLessThan(tolerance)
    expect(Math.abs(change('Press DMG') - 29.9)).toBeLessThan(tolerance)
    expect(Math.abs(change('Frostgrove Sanctuary Attack DMG') - 13.057)).toBeLessThan(tolerance)
    const hymn = { ...noChoice(), toggles: { burstPaleHymn: true } }
    expect(Math.abs(change('2-Hit Hold DMG', hymn) - -30.181)).toBeLessThan(tolerance)
  })

  test('Hu Tao, HP% sands to ATK% sands: Paramita Papilio on lowers every hit, off raises them', () => {
    const hits = kit('hu-tao')
    const w = weapon('staff-of-homa')
    const sets = { 'crimson-witch-of-flames': 5 }
    const change = (key: TalentKey, name: string, c: Choice = noChoice()): number => rowChange(hits, key, name, HUTAO_A, HUTAO_B, w, sets, HUTAO_BASE, c)
    expect(Math.abs(change('normal', 'Charged Attack') - -5.291)).toBeLessThan(tolerance)
    expect(Math.abs(change('burst', 'Skill DMG') - -5.291)).toBeLessThan(tolerance)
    expect(Math.abs(change('skill', 'Blood Blossom DMG') - -5.291)).toBeLessThan(tolerance)
    expect(Math.abs(change('normal', '1-Hit DMG') - -5.291)).toBeLessThan(tolerance)
    const off = { ...noChoice(), toggles: { GuideToAfterlifeVoyage: false } }
    expect(Math.abs(change('normal', 'Charged Attack', off) - 20.295)).toBeLessThan(tolerance)
    expect(Math.abs(change('burst', 'Skill DMG', off) - 20.295)).toBeLessThan(tolerance)
  })
})

/** A sim for the verdict: the sample planner's sim with the kit's hits, tables and a stated weapon and set. */
function simOf(hits: PlannerHits | null, weaponKey: string, setKey: string, baseValues: Base, over: Partial<PlannerSim> = {}): PlannerSim {
  const sample = simFixture as unknown as PlannerSim
  return {
    ...sample, hits, tables, base: baseValues, char_base_atk: baseValues.atk - 608,
    weapon: { ...sample.weapon!, key: weaponKey, base_atk: 608, level: 90, refinement: 1 },
    sets: [{ ...sample.sets[0], key: setKey, pieces: 5 }], ...over,
  }
}

describe('what the panel holds, and the Polestar field', () => {
  test("her own innate stats are in the panel: Mitya's and Nefer's 100 Elemental Mastery are not added again", () => {
    // kits.json: Mitya's and Nefer's `{to: em, rate: 100, in_stats: true}`
    const hits = hitsOf({ effects: [effect({ to: 'em', rate: 100, in_stats: true })] })
    const b = buckets(stats({ em: 250 }), hits, weapon('w'), {}, noChoice(), { base })
    expect(b.stats.em).toBe(250)
  })

  test("an ascension passive's plain stat is in the panel too: its Hydro DMG Bonus is not added again, a constellation's is", () => {
    // kits.json: `{to: dmg:hydro, rate: 0.2, from_ascension: 4, in_stats: true}`; a constellation's stat is not in the panel (the audit's panel question)
    const held = hitsOf({ element: 'Hydro', effects: [effect({ to: 'dmg:hydro', rate: 0.2, from_ascension: 4, in_stats: true })] })
    expect(buckets(stats({ dmg: 46.6 }), held, weapon('w'), {}, noChoice(), { base }).adds.find((a) => a.to === 'dmg:hydro')).toBeUndefined()
    const added = hitsOf({ element: 'Hydro', effects: [effect({ to: 'dmg:hydro', rate: 0.2, from_constellation: 1, in_stats: false })] })
    expect(buckets(stats({ dmg: 46.6 }), added, weapon('w'), {}, noChoice(), { base }).adds.find((a) => a.to === 'dmg:hydro')!.value).toBeCloseTo(0.2, 9)
  })

  test('a talent that counts Stellar-Conduct rows has the Polestar field: its DMG Bonus, by its recorded hits, and 40% less Physical RES', () => {
    const hits = kit('sandrone')
    const w = weapon('wolf-s-gravestone')
    const sets = { 'gladiator-s-finale': 5 }
    const b = buckets(SANDRONE_A, hits, w, sets, noChoice(), { base: SANDRONE_BASE })
    expect(b.counted).toEqual(['Polestar field'])
    const skill = talentOf(hits, 'skill')
    const prism = rowOf(hits, 'skill', 'Prism Shot DMG')
    const at = (recorded: number, t = skill): number => rowDamage(prism, t, b, hits, tables, { ...noChoice(), recorded: { skill: recorded } })
    expect(at(12) / at(0)).toBeCloseTo(1.4 / 1.2, 9)
    expect(at(1) / at(0)).toBeCloseTo(1.29 / 1.2, 9)
    // no counted Stellar-Conduct row in the talent: no field
    const bare = { ...skill, rows: skill.rows.filter((r) => r.kind === 'elemental') }
    expect(rowDamage(prism, bare, b, hits, tables, noChoice()) / at(12)).toBeCloseTo(1 / 1.4, 9)
    // her physical rows lose 40% of the enemy's Physical RES: RES 10% becomes -30%
    const normal = talentOf(hits, 'normal')
    const oneHit = rowOf(hits, 'normal', '1-Hit DMG')
    const withField = rowDamage(oneHit, normal, b, hits, tables, noChoice())
    const without = rowDamage(oneHit, { ...normal, rows: normal.rows.filter((r) => r.kind !== 'stellar-conduct') }, b, hits, tables, noChoice())
    expect(withField / without).toBeCloseTo(resMult(-0.3) / resMult(0.1), 9)
    // a character with no Stellar-Conduct row has none of it
    expect(buckets(LAUMA_A, kit('lauma'), weapon('lost-prayer-to-the-sacred-winds'), {}, noChoice(), { base }).counted).toEqual([])
  })

  test("a stat an effect adds to some rows only is added to those rows' scaling", () => {
    // shape-only effect (Skirk's C2 is of this form: ATK% to her Skill and Burst)
    const hits = hitsOf({ effects: [effect({ to: 'atk%', rate: 0.5, talents: ['burst'] })] })
    const b = buckets(stats({ atk: 2000, cr: 0, dmg: 0 }), hits, weapon('w'), {}, noChoice(), { base: { hp: 0, atk: 1000, def: 0 } })
    expect(b.stats.atk).toBe(2000)
    const skill = synthetic({ move: 'skill' })
    const burst = synthetic({ move: 'burst' })
    const damage = (row: HitRow): number => rowDamage(row, talent(row.move as TalentKey, [row]), b, hits, tables, noChoice())
    expect(damage(burst) / damage(skill)).toBeCloseTo(2500 / 2000, 9)
  })
})

describe('the verdict', () => {
  const hutao = (): { sim: PlannerSim; w: GearWeapon; sets: Record<string, number> } => ({
    sim: simOf(kit('hu-tao'), 'staff-of-homa', 'crimson-witch-of-flames', HUTAO_BASE), w: { key: 'staff-of-homa', refinement: 1, level: 90 },
    sets: { 'crimson-witch-of-flames': 5 },
  })

  test('Hu Tao: softer with Paramita Papilio, harder without, and the counted toggle follows', () => {
    const { sim, w, sets } = hutao()
    const on = verdict(sim, HUTAO_A, HUTAO_B, w, w, sets, sets, noChoice())
    expect(on.kind).toBe('softer')
    expect(on.figure).toBeCloseTo(-5.291, 1)
    expect(on.counted).toEqual(['Paramita Papilio'])
    expect(on.talents.map((t) => t.key)).toEqual(['normal', 'skill', 'burst'])
    const off = verdict(sim, HUTAO_A, HUTAO_B, w, w, sets, sets, { ...noChoice(), toggles: { GuideToAfterlifeVoyage: false } })
    expect(off.kind).toBe('harder')
    expect(off.figure).toBeCloseTo(20.295, 1)
    expect(off.counted).toEqual([])
  })

  test('a counted toggle can be switched off, and one that is off by default can be switched on', () => {
    const { sim, w, sets } = hutao()
    const hits = sim.hits!
    expect(togglesFor(hits, 'staff-of-homa', ['crimson-witch-of-flames'], noChoice()).find((t) => t.name === 'GuideToAfterlifeVoyage')!.on).toBe(true)
    const choice = { ...noChoice(), toggles: { SanguineRouge: true } }
    const v = verdict(sim, HUTAO_A, HUTAO_B, w, w, sets, sets, choice)
    expect([...v.counted].sort()).toEqual(['HP below 50%', 'Paramita Papilio'])
  })

  test('countedLabels and countedNames list what verdict counts, in either build, and follow a switch', () => {
    const { sim, w, sets } = hutao()
    const args = [sim, HUTAO_A, HUTAO_B, w, w, sets, sets] as const
    expect(countedLabels(...args, noChoice())).toEqual(['Paramita Papilio'])
    expect(countedNames(...args, noChoice())).toEqual(['GuideToAfterlifeVoyage'])
    expect(countedLabels(...args, noChoice())).toEqual(verdict(...args, noChoice()).counted)
    const off = { ...noChoice(), toggles: { GuideToAfterlifeVoyage: false } }
    expect(countedLabels(...args, off)).toEqual([])
    expect(countedNames(...args, off)).toEqual([])
    // one that is off by default is counted once it is on, when an effect that holds reaches a counted row
    const on = { ...noChoice(), toggles: { SanguineRouge: true } }
    expect(countedLabels(...args, on)).toContain('HP below 50%')
    expect(countedNames(...args, on)).toContain('SanguineRouge')
    // no hits: nothing
    expect(countedLabels({ ...sim, hits: null }, HUTAO_A, HUTAO_B, w, w, sets, sets, noChoice())).toEqual([])
    // the Polestar field is counted by label and has no toggle's name
    const sandrone = simOf(kit('sandrone'), 'wolf-s-gravestone', 'gladiator-s-finale', SANDRONE_BASE)
    const sw: GearWeapon = { key: 'wolf-s-gravestone', refinement: 1 }
    const ss = { 'gladiator-s-finale': 5 }
    expect(countedLabels(sandrone, SANDRONE_A, SANDRONE_B, sw, sw, ss, ss, noChoice())).toEqual(['Polestar field'])
    expect(countedNames(sandrone, SANDRONE_A, SANDRONE_B, sw, sw, ss, ss, noChoice())).toEqual([])
  })

  test('a reaction left on for a talent that cannot take it does not count for the Mitya note', () => {
    const { sim, w, sets } = hutao()
    sim.hits!.recommended = ['cr', 'em']
    const note = 'HoYoverse recommends Elemental Mastery for her. Turn on the reaction she triggers to count it.'
    const reacting = { ...noChoice(), reaction: { normal: 'vaporize', skill: 'vaporize', burst: 'vaporize' } as Choice['reaction'] }
    expect(verdict(sim, HUTAO_A, HUTAO_B, w, w, sets, sets, reacting).notes).not.toContain(note)
    // Paramita Papilio off: her normal attack is physical again and cannot Vaporize, but her Skill and Burst still can
    const off = { ...reacting, toggles: { GuideToAfterlifeVoyage: false } }
    expect(verdict(sim, HUTAO_A, HUTAO_B, w, w, sets, sets, off).notes).not.toContain(note)
    const normalOnly = { ...off, reaction: { normal: 'vaporize' } as Choice['reaction'] }
    expect(verdict(sim, HUTAO_A, HUTAO_B, w, w, sets, sets, normalOnly).notes).toContain(note)
  })

  test('an unchanged build is No change', () => {
    const { sim, w, sets } = hutao()
    const v = verdict(sim, HUTAO_A, HUTAO_A, w, w, sets, sets, noChoice())
    expect(v.kind).toBe('none')
    expect(v.figure).toBe(0)
    expect(v.why).toBe('Nothing in her build changes.')
  })

  test('Sandrone on her unmodified kit rows: the Stellar Swirl rows are listed, not counted; the field is counted', () => {
    const hits = kit('sandrone')
    const sim = simOf(hits, 'wolf-s-gravestone', 'gladiator-s-finale', SANDRONE_BASE)
    const w: GearWeapon = { key: 'wolf-s-gravestone', refinement: 1 }
    const sets = { 'gladiator-s-finale': 5 }
    const v = verdict(sim, SANDRONE_A, SANDRONE_B, w, w, sets, sets, noChoice())
    expect(countedRows(talentOf(hits, 'skill')).map((r) => r.name)).toEqual(['Prism Shot DMG', 'Prism Shot Stellar-Conduct DMG'])
    expect(v.talents.map((t) => t.key)).toEqual(['normal', 'skill', 'burst'])
    expect(v.counted).toEqual(['Polestar field'])
    // pinned: Stellar-Conduct rows fall 14.4% and her ordinary Cryo rows rise 14.1% (GO's numbers), so each talent falls by what the
    // weight of the Stellar-Conduct row leaves (about -8% for the Skill: GO's rows give (8699.68 / 9455.32 - 1) = -7.99%)
    expect(v.kind).toBe('softer')
    expect(v.figure).toBeCloseTo(-7.27, 1)
    // a talent's kind is the kind most of its counted damage is, the kinds' rows summed: Normal Attack's physical hits outweigh its Stellar-Conduct one
    expect(v.talents.map((t) => [t.key, Number(t.change!.toFixed(1)), t.kind])).toEqual([
      ['normal', -9.2, 'physical'], ['skill', -8.0, 'stellar-conduct'], ['burst', -4.6, 'stellar-conduct'],
    ])
    expect(v.why).toBe('Her Normal Attack, Skill and Burst hit softer because her ATK goes down.')
  })

  test('Sandrone with her Stellar-Conduct rows alone: softer, and why', () => {
    const hits = kit('sandrone')
    for (const t of hits.talents) {
      t.rows = t.rows.filter((r) => r.kind === 'stellar-conduct')
      t.main = t.key !== 'normal'
    }
    const sim = simOf(hits, 'wolf-s-gravestone', 'gladiator-s-finale', SANDRONE_BASE)
    const w: GearWeapon = { key: 'wolf-s-gravestone', refinement: 1 }
    const sets = { 'gladiator-s-finale': 5 }
    const v = verdict(sim, SANDRONE_A, SANDRONE_B, w, w, sets, sets, noChoice())
    expect(v.kind).toBe('softer')
    expect(v.figure).toBeCloseTo(-14.403, 1)
    expect(v.talents.map((t) => t.kind)).toEqual(['stellar-conduct', 'stellar-conduct'])
    expect(v.why).toBe('Her Skill and Burst deal Stellar-Conduct damage, which Cryo DMG Bonus does not raise.')
    // the same sentence is not given when the build is better for another reason
    const better = verdict(sim, SANDRONE_A, { ...SANDRONE_B, atk: SANDRONE_A.atk * 1.2 }, w, w, sets, sets, noChoice())
    expect(better.kind).toBe('harder')
    expect(better.why).toBe('Her Skill and Burst hit harder because her ATK goes up.')
  })

  test('the Mitya check', () => {
    const { sim, w, sets } = hutao()
    sim.hits!.recommended = ['cr', 'em']
    const note = 'HoYoverse recommends Elemental Mastery for her. Turn on the reaction she triggers to count it.'
    expect(verdict(sim, HUTAO_A, HUTAO_B, w, w, sets, sets, noChoice()).notes).toContain(note)
    const reacting = { ...noChoice(), reaction: { normal: 'vaporize', skill: 'vaporize', burst: 'vaporize' } as Choice['reaction'] }
    expect(verdict(sim, HUTAO_A, HUTAO_B, w, w, sets, sets, reacting).notes).not.toContain(note)
    sim.hits!.recommended = ['cr']
    expect(verdict(sim, HUTAO_A, HUTAO_B, w, w, sets, sets, noChoice()).notes).not.toContain(note)
    // a Lunar row uses Elemental Mastery by itself
    const lauma = simOf(kit('lauma'), 'lost-prayer-to-the-sacred-winds', 'gilded-dreams', { hp: 0, atk: 0, def: 0 })
    lauma.hits!.recommended = ['em']
    const lw: GearWeapon = { key: 'lost-prayer-to-the-sacred-winds', refinement: 1 }
    const ls = { 'gilded-dreams': 5 }
    expect(verdict(lauma, LAUMA_A, LAUMA_B, lw, lw, ls, ls, noChoice()).notes).not.toContain(note)
  })

  test('Lauma: only her named rows are counted', () => {
    const lauma = simOf(kit('lauma'), 'lost-prayer-to-the-sacred-winds', 'gilded-dreams', { hp: 0, atk: 0, def: 0 })
    const lw: GearWeapon = { key: 'lost-prayer-to-the-sacred-winds', refinement: 1 }
    const ls = { 'gilded-dreams': 5 }
    const v = verdict(lauma, LAUMA_A, LAUMA_B, lw, lw, ls, ls, noChoice())
    expect(v.talents.map((t) => t.key)).toEqual(['skill'])
    expect(countedRows(talentOf(lauma.hits!, 'skill')).map((r) => r.name)).toEqual(['2-Hit Hold DMG', 'Frostgrove Sanctuary Attack DMG'])
    const change = talentChange(talentOf(lauma.hits!, 'skill'), buckets(LAUMA_A, lauma.hits!, lw, ls, noChoice(), { base }),
      buckets(LAUMA_B, lauma.hits!, lw, ls, noChoice(), { base }), lauma.hits!, tables, noChoice())!
    // between the two rows' changes (-33.5% and +13.1%), weighed by their sizes
    expect(change).toBeLessThan(13.057)
    expect(change).toBeGreaterThan(-33.522)
    expect(v.kind).toBe(change < 0 ? 'softer' : 'harder')
  })

  test('a mixed talent weighs its rows', () => {
    // An ordinary row and a Lunar row, the Lunar one three times the size; +10% DMG Bonus raises only the ordinary one.
    const hits = hitsOf({ element: 'Dendro' })
    const s = stats({ em: 0, cr: 0, dmg: 0 })
    const b0 = buckets(s, hits, weapon('w'), {}, noChoice(), { base })
    const ordinary = synthetic({ name: 'Ordinary' })
    const lunar = synthetic({ name: 'Lunar', kind: 'lunar-bloom', terms: [{ stat: 'atk', mult: 1 }] })
    const t0 = talent('skill', [ordinary, lunar])
    const a = rowDamage(ordinary, t0, b0, hits, tables, noChoice())
    const l = rowDamage(lunar, t0, b0, hits, tables, noChoice())
    lunar.terms = [{ stat: 'atk', mult: (3 * a) / l }]
    const t = talent('skill', [ordinary, lunar])
    const change = talentChange(t, b0, buckets({ ...s, dmg: 10 }, hits, weapon('w'), {}, noChoice(), { base }), hits, tables, noChoice())!
    expect(change).toBeCloseTo(2.5, 6)
  })

  test('a kit the comparison with Genshin Optimizer could not prove says "It depends" and why', () => {
    const { sim, w, sets } = hutao()
    const reason = "Her first passive raises her Max HP by the party's elements, which the planner does not know."
    sim.hits!.unsure = reason
    const v = verdict(sim, HUTAO_A, HUTAO_B, w, w, sets, sets, noChoice())
    expect(v.kind).toBe('depends')
    expect(v.figure).toBeNull()
    expect(v.why).toBe(reason)
    expect(v.talents.every((t) => t.change !== null)).toBe(true)   // each talent's change is still shown
    // an unchanged build is still No change
    expect(verdict(sim, HUTAO_A, HUTAO_A, w, w, sets, sets, noChoice()).kind).toBe('none')
  })

  test('no hits gives no verdict', () => {
    const { w, sets } = hutao()
    const none = verdict(simOf(null, 'staff-of-homa', 'x', HUTAO_BASE), HUTAO_A, HUTAO_B, w, w, sets, sets, noChoice())
    expect(none.kind).toBe('unknown')
    expect(none.figure).toBeNull()
    const empty = simOf(hitsOf({ talents: [talent('skill', [])] }), 'staff-of-homa', 'x', HUTAO_BASE)
    expect(verdict(empty, HUTAO_A, HUTAO_B, w, w, sets, sets, noChoice()).kind).toBe('unknown')
    expect(talentChange(talent('skill', []), buckets(HUTAO_A, hitsOf({}), w, {}, noChoice()), buckets(HUTAO_B, hitsOf({}), w, {}, noChoice()), hitsOf({}), tables, noChoice())).toBeNull()
  })

  test('the verdict rule', () => {
    // Skill scales on ATK, Burst on HP, so each stat moves one talent by exactly its own change.
    const rows = [talent('skill', [synthetic({ terms: [{ stat: 'atk', mult: 1 }] })]), talent('burst', [synthetic({ move: 'burst', terms: [{ stat: 'hp', mult: 1 }] })])]
    const sim = simOf(hitsOf({ talents: rows, element: 'Pyro' }), 'w', 's', { hp: 1, atk: 1, def: 1 })
    const w: GearWeapon = { key: 'w', refinement: 1 }
    const now = stats({ atk: 10000, hp: 10000 })
    const by = (atk: number, hp: number): ReturnType<typeof verdict> =>
      verdict(sim, now, { ...now, atk: now.atk * (1 + atk / 100), hp: now.hp * (1 + hp / 100) }, w, w, {}, {}, noChoice())
    const same = by(0.04, -0.04)
    expect(same.kind).toBe('none')
    const up = by(1, 2)
    expect(up.kind).toBe('harder')
    expect(up.figure).toBeCloseTo(1.5, 6)
    const down = by(-1, -3)
    expect(down.kind).toBe('softer')
    expect(down.figure).toBeCloseTo(-2, 6)
    const mixed = by(1, -1)
    expect(mixed.kind).toBe('depends')
    expect(mixed.figure).toBeNull()
    expect(mixed.talents.map((t) => t.change!.toFixed(3))).toEqual(['1.000', '-1.000'])
    expect(mixed.why).toBe('Her Skill hits harder and her Burst hits softer, because they scale on different stats.')
    expect(by(1, 0.04).kind).toBe('depends')
  })

  test("the words follow the card's pronouns and the number of talents: he, she, they; one talent, several", () => {
    const HE = { she: 'he', her: 'him', hers: 'his' }
    const THEY = { she: 'they', her: 'them', hers: 'their' }
    const w: GearWeapon = { key: 'w', refinement: 1 }
    const one = simOf(hitsOf({ checked: false, recommended: ['em'], talents: [talent('skill', [synthetic({})])] }), 'w', 's', { hp: 1, atk: 1, def: 1 })
    const two = simOf(hitsOf({
      checked: false, talents: [talent('skill', [synthetic({})]), talent('burst', [synthetic({ move: 'burst' })])],
    }), 'w', 's', { hp: 1, atk: 1, def: 1 })
    const up = (sim: PlannerSim, p?: typeof HE) => verdict(sim, stats({}), stats({ atk: 2100 }), w, w, {}, {}, noChoice(), p)
    expect(up(one).why).toBe('Her Skill hits harder because her ATK goes up.')
    expect(up(one, HE).why).toBe('His Skill hits harder because his ATK goes up.')
    expect(up(one, THEY).why).toBe('Their Skill hits harder because their ATK goes up.')
    expect(up(two, HE).why).toBe('His Skill and Burst hit harder because his ATK goes up.')
    expect(up(one, HE).notes).toEqual([
      'His passives are not counted yet.',
      'HoYoverse recommends Elemental Mastery for him. Turn on the reaction he triggers to count it.',
    ])
    expect(up(one, THEY).notes).toEqual([
      'Their passives are not counted yet.',
      'HoYoverse recommends Elemental Mastery for them. Turn on the reaction they trigger to count it.',
    ])
    const down = (sim: PlannerSim, p?: typeof HE) => verdict(sim, stats({}), stats({ atk: 1900 }), w, w, {}, {}, noChoice(), p)
    expect(down(two).why).toBe('Her Skill and Burst hit softer because her ATK goes down.')
    expect(down(one, HE).why).toBe('His Skill hits softer because his ATK goes down.')
    const same = stats({})
    expect(verdict(one, same, same, w, w, {}, {}, noChoice(), THEY).why).toBe('Nothing in their build changes.')
    expect(verdict(simOf(hitsOf({ talents: [] }), 'w', 's', { hp: 1, atk: 1, def: 1 }), same, same, w, w, {}, {}, noChoice(), HE).why).toBe('His damage rows are not known yet.')
    // a mixed answer: each list takes its own verb
    const mixed = simOf(hitsOf({
      talents: [talent('skill', [synthetic({ terms: [{ stat: 'atk', mult: 1 }] })]), talent('burst', [synthetic({ move: 'burst', terms: [{ stat: 'hp', mult: 1 }] })])],
    }), 'w', 's', { hp: 1, atk: 1, def: 1 })
    const now = stats({ atk: 10000, hp: 10000 })
    expect(verdict(mixed, now, { ...now, atk: 10100, hp: 9900 }, w, w, {}, {}, noChoice(), HE).why)
      .toBe('His Skill hits harder and his Burst hits softer, because they scale on different stats.')
  })

  test('a Lunar or Stellar sentence takes the verb of one talent or several', () => {
    const hits = kit('sandrone')
    for (const t of hits.talents) {
      t.rows = t.rows.filter((r) => r.kind === 'stellar-conduct')
      t.main = t.key !== 'normal'
    }
    const sim = simOf(hits, 'wolf-s-gravestone', 'gladiator-s-finale', SANDRONE_BASE)
    const w: GearWeapon = { key: 'wolf-s-gravestone', refinement: 1 }
    const sets = { 'gladiator-s-finale': 5 }
    const v = verdict(sim, SANDRONE_A, SANDRONE_B, w, w, sets, sets, noChoice(), { she: 'he', her: 'him', hers: 'his' })
    expect(v.why).toBe('His Skill and Burst deal Stellar-Conduct damage, which Cryo DMG Bonus does not raise.')
    const lone = structuredClone(sim)
    lone.hits!.talents = lone.hits!.talents.filter((t) => t.key === 'skill')
    expect(verdict(lone, SANDRONE_A, SANDRONE_B, w, w, sets, sets, noChoice()).why).toBe('Her Skill deals Stellar-Conduct damage, which Cryo DMG Bonus does not raise.')
  })

  test('the Mitya note for an element with no reaction does not ask for one', () => {
    const geo = simOf(hitsOf({ element: 'Geo', recommended: ['em'], talents: [talent('skill', [synthetic({})])] }), 'w', 's', { hp: 1, atk: 1, def: 1 })
    const w: GearWeapon = { key: 'w', refinement: 1 }
    const v = verdict(geo, stats({}), stats({ atk: 2100 }), w, w, {}, {}, noChoice())
    expect(v.notes).toEqual(["HoYoverse recommends Elemental Mastery for her. The hits counted here don't use it."])
  })

  test('the same build is the same whatever order the sets are given in, and a refinement is a change', () => {
    const sim = simOf(hitsOf({ talents: [talent('skill', [synthetic({})])] }), 'w', 's', { hp: 1, atk: 1, def: 1 })
    const w: GearWeapon = { key: 'w', refinement: 1 }
    const s = stats({})
    expect(verdict(sim, s, s, w, w, { a: 2, b: 2 }, { b: 2, a: 2 }, noChoice()).why).toBe('Nothing in her build changes.')
    expect(verdict(sim, s, s, w, { ...w, refinement: 3 }, {}, {}, noChoice()).why).not.toBe('Nothing in her build changes.')
  })

  test('a toggle is counted only when its effect reaches a row that is counted', () => {
    const toggles = ['a', 'b', 'c', 'd'].map((name) => ({ name, label: `Toggle ${name}`, on: true, covers: [], state: 'on' }))
    const hits = hitsOf({
      element: 'Pyro', toggles, talents: [talent('skill', [synthetic({ name: 'Counted hit', move: 'skill' })])],
      effects: [
        effect({ to: 'dmg:skill', rate: 0.1, while: 'a' }),                           // reaches the row
        effect({ to: 'dmg:geo', rate: 0.1, while: 'b' }),                             // a Geo bonus, the row is Pyro
        effect({ to: 'dmg', rate: 0.1, hits: ['Another hit'], while: 'c' }),          // another row's
        effect({ to: 'cd', rate: 0.1, talents: ['burst'], while: 'd' }),              // the Burst's
      ],
    })
    const sim = simOf(hits, 'w', 's', { hp: 1, atk: 1, def: 1 })
    const w: GearWeapon = { key: 'w', refinement: 1 }
    const v = verdict(sim, stats({}), stats({ atk: 2100 }), w, w, {}, {}, noChoice())
    expect(v.counted).toEqual(['Toggle a'])
  })

  test('an effect that names more toggles holds only while all of them are on, and the verdict counts them all', () => {
    const toggles = ['a', 'b'].map((name) => ({ name, label: `Toggle ${name}`, on: true, covers: [], state: 'on' }))
    const hits = hitsOf({
      element: 'Pyro', toggles, talents: [talent('skill', [synthetic({ name: 'Counted hit', move: 'skill' })])],
      effects: [effect({ to: 'dmg:skill', rate: 0.5, while: 'a', also: ['b'] })],
    })
    const sim = simOf(hits, 'w', 's', { hp: 1, atk: 1, def: 1 })
    const w: GearWeapon = { key: 'w', refinement: 1 }
    const at = (toggled: Record<string, boolean>) => verdict(sim, stats({}), stats({ atk: 2100 }), w, w, {}, {}, { ...noChoice(), toggles: toggled })
    expect(at({}).counted).toEqual(['Toggle a', 'Toggle b'])
    expect(at({ b: false }).counted).toEqual([])
    expect(at({ a: false }).counted).toEqual([])
    const damage = (toggled: Record<string, boolean>): number => {
      const choice = { ...noChoice(), toggles: toggled }
      const row = rowOf(hits, 'skill', 'Counted hit')
      return rowDamage(row, talentOf(hits, 'skill'), buckets(stats({}), hits, w, {}, choice, { base }), hits, tables, choice)
    }
    expect(damage({ b: false })).toBeLessThan(damage({}))
    expect(damage({ a: false })).toBe(damage({ b: false }))
  })

  test('notes', () => {
    const { sim, sets } = hutao()
    sim.hits!.checked = false
    const a: GearWeapon = { key: 'staff-of-homa', refinement: 1, level: 80 }
    const b: GearWeapon = { key: 'other', refinement: 1, level: 90 }
    const v = verdict(sim, HUTAO_A, HUTAO_B, a, b, sets, sets, noChoice())
    expect(v.notes).toEqual(['Her passives are not counted yet.', 'Her weapon is level 80; the tested one is level 90.'])
    const same = verdict(sim, HUTAO_A, HUTAO_B, { ...a, level: 90 }, b, sets, sets, noChoice())
    expect(same.notes).toEqual(['Her passives are not counted yet.'])
    sim.hits!.checked = true
    expect(verdict(sim, HUTAO_A, HUTAO_B, { ...a, level: 90 }, { ...b, refinement: 3 }, sets, sets, noChoice()).notes)
      .toEqual(['Her weapon is refinement 1; the tested one is refinement 3.'])
  })
})

describe('one alternative of a slash row', () => {
  test('an effect for "(1 of 2)" holds for the first alternative, the plain name for both and "(2 of 2)" for the second (Nilou\'s Luminous Illusion)', () => {
    const first = synthetic({ name: 'Moon/Wheel DMG', alternative: 'Moon/Wheel DMG', move: 'skill' })
    const second = synthetic({ name: 'Moon/Wheel DMG (2 of 2)', alternative: 'Moon/Wheel DMG', move: 'skill' })
    const at = (hits: string[]): [number, number] => {
      const kitHits = hitsOf({ effects: [effect({ to: 'dmg:skill', rate: 1, hits })] })
      const b = buckets(stats({}), kitHits, weapon('w'), {}, noChoice(), { base })
      const damage = (row: HitRow): number => rowDamage(row, talent('skill', [row]), b, kitHits, tables, noChoice())
      const none = rowDamage(first, talent('skill', [first]), buckets(stats({}), hitsOf({}), weapon('w'), {}, noChoice(), { base }), hitsOf({}), tables, noChoice())
      return [damage(first) / none, damage(second) / none]
    }
    expect(at(['Moon/Wheel DMG (1 of 2)'])).toEqual([2, 1])
    expect(at(['Moon/Wheel DMG (2 of 2)'])).toEqual([1, 2])
    expect(at(['Moon/Wheel DMG'])).toEqual([2, 2])
  })
})

import { describe, expect, test } from 'vitest'
import damageKits from '../../fixtures/damage-kits.json'
import type { Effect, HitRow, HitTalent, PlannerHits, PlannerSim } from '../../types.ts'
import { buckets, countedRows, noChoice, partyChoice, resolveParty, rowDamage, verdict, type Choice, type Stats } from './damage.ts'
import { kindShown } from './verdictview.ts'
import { ours, type Case, type World } from './comparison.ts'

const tables = damageKits.tables as unknown as PlannerSim['tables']

// SHAPE-ONLY INPUT: rows, effects and a hits block made up for the party's own arithmetic, where each test states what it expects by hand.
const effect = (over: Partial<Effect>): Effect => ({
  from: null, reads: null, to: 'dmg', rate: 0, cap: null, cap_from: null, over: null, pieces: null, from_ascension: null,
  from_constellation: null, talents: null, weapon_types: null, hits: null, row: null, while: null, in_stats: false, ...over,
})
const row = (over: Partial<HitRow>): HitRow => ({
  name: 'Row', kind: 'elemental', terms: [{ stat: 'atk', mult: 1 }], flat: 0, count: 1, instances: 1, move: 'burst', element: null, alternative: null,
  main: true, takes: false, only: null, ...over,
})
const talent = (rows: HitRow[]): HitTalent => ({ key: 'burst', name: 'Burst', icon: null, level: 10, main: true, source: 'hoyolab', rows })
const hitsOf = (over: Partial<PlannerHits>): PlannerHits => ({
  element: 'Anemo', weapon_type: 'Catalyst', level: 90, checked: true, unsure: null, recommended: [], talents: [], effects: [], toggles: [], infused: [],
  weapon_effects: {}, set_effects: {}, party: null, ...over,
})
const PARTY = {
  default: 'pyro', reason: 'Most teams have Pyro.',
  options: [
    { id: 'pyro', label: 'Pyro', elements: ['pyro'] }, { id: 'both', label: 'Pyro and Hydro', elements: ['pyro', 'hydro'] },
    { id: 'none', label: 'No Stellar team', elements: [] },
  ],
  element_rows: { burst: ['Iris DMG'] }, only_rows: { burst: { 'Stellar DMG': ['both'] } },
}
const stats = (over: Partial<Stats>): Stats => ({ hp: 20000, atk: 2000, def: 800, em: 0, er: 100, cr: 50, cd: 100, dmg: 0, heal: 0, physical: 0, ...over })
const weapon = { key: 'w', refinement: 1 }
const base = { hp: 0, atk: 0, def: 0 }
const choose = (id: string | undefined): Choice => ({ ...noChoice(), party: id })

describe('resolving the team', () => {
  const rows = [row({ name: 'Iris DMG', takes: true }), row({ name: 'Skill DMG' }), row({ name: 'Stellar DMG', kind: 'stellar-swirl', only: ['both'] })]
  const hits = hitsOf({ talents: [talent(rows)], party: PARTY })
  const names = (h: PlannerHits): string[] => h.talents[0].rows.map((r) => `${r.name}:${r.element ?? ''}`)

  test('a kit with no party is the same block', () => {
    const plain = hitsOf({ talents: [talent([row({})])] })
    expect(resolveParty(plain, noChoice())).toBe(plain)
  })

  test('the usual team is the choice when none is made, and a row that takes the team element is a row of each of its elements', () => {
    expect(partyChoice(hits, noChoice())).toEqual({ id: 'pyro', label: 'Pyro', usual: true })
    expect(names(resolveParty(hits, noChoice()))).toEqual(['Iris DMG:Pyro', 'Skill DMG:'])
    expect(names(resolveParty(hits, choose('both')))).toEqual(['Iris DMG:Pyro', 'Iris DMG:Hydro', 'Skill DMG:', 'Stellar DMG:'])
    expect(names(resolveParty(hits, choose('none')))).toEqual(['Skill DMG:'])
  })

  test('a team the block does not have is the usual one', () => {
    expect(partyChoice(hits, choose('nonsense'))?.id).toBe('pyro')
  })

  test('resolving again changes nothing', () => {
    const once = resolveParty(hits, choose('both'))
    expect(resolveParty(once, choose('none'))).toBe(once)
  })

  test('an effect with a party holds only in those teams', () => {
    const withEffects = hitsOf({
      talents: [talent([row({ name: 'Skill DMG' })])], party: PARTY,
      effects: [effect({ to: 'dmg', rate: 0.1 }), effect({ to: 'dmg', rate: 0.2, party: ['both'] }), effect({ to: 'dmg', rate: 0.4, party: ['pyro', 'none'] })],
    })
    const dmg = (id: string) => buckets(stats({}), withEffects, weapon, {}, choose(id), { base }).adds.reduce((sum, a) => sum + a.value, 0)
    expect(dmg('pyro')).toBeCloseTo(0.5, 9)
    expect(dmg('both')).toBeCloseTo(0.3, 9)
    expect(dmg('none')).toBeCloseTo(0.5, 9)
  })
})

describe('what a row of the team deals', () => {
  const iris = row({ name: 'Iris DMG', takes: true })
  const hits = hitsOf({ talents: [talent([iris])], party: PARTY })
  const damage = (id: string, s: Stats, extra: Partial<PlannerHits> = {}) => {
    const h = resolveParty({ ...hits, ...extra }, choose(id))
    const t = h.talents[0]
    const b = buckets(s, h, weapon, {}, choose(id), { base })
    return t.rows.reduce((sum, r) => sum + rowDamage(r, t, b, h, tables, choose(id)), 0)
  }

  test("her own element's DMG Bonus does nothing for a row of another element, and the team's element's bonus does", () => {
    const plain = damage('pyro', stats({ dmg: 0 }))
    expect(damage('pyro', stats({ dmg: 0.5 }))).toBeCloseTo(plain, 6)
    const pyroBonus = { effects: [effect({ to: 'dmg:pyro', rate: 0.5 })] }
    expect(damage('pyro', stats({}), pyroBonus) / plain).toBeCloseTo(1.5, 6)
    expect(damage('none', stats({}), pyroBonus)).toBe(0)
  })

  test("two elements share the row: the hit is one of them, each as likely as the other", () => {
    const once = damage('pyro', stats({}))
    expect(damage('both', stats({}))).toBeCloseTo(once, 9)
    const hydroOnly = { effects: [effect({ to: 'dmg:hydro', rate: 1 })] }
    expect(damage('both', stats({}), hydroOnly) / once).toBeCloseTo(1.5, 9)
  })

  test('the row can take a reaction of its element', () => {
    const shown = kindShown(resolveParty(hits, choose('pyro')), 'burst', noChoice())
    expect(shown.reactions).toEqual(['none', 'vaporize', 'melt'])
    const both = kindShown(resolveParty(hits, choose('both')), 'burst', noChoice())
    expect(both.reactions).toEqual(['none', 'vaporize', 'melt'])
    expect(kindShown(resolveParty(hits, choose('none')), 'burst', noChoice()).reactions).toBeNull()
  })
})

describe('the verdict follows the team', () => {
  // an Anemo character whose Burst hit takes the team's element: the Anemo goblet does nothing for it, the ATK goblet does
  const sim = (): PlannerSim =>
    ({
      hits: hitsOf({ talents: [talent([row({ name: 'Iris DMG', takes: true })])], party: PARTY }), tables, panel: stats({ dmg: 0.466 }),
      base: { hp: 1, atk: 1000, def: 1 }, weapon: null, sets: [], char_base_atk: 400,
    }) as unknown as PlannerSim
  test('the goblet swap raises a hit of another element and lowers none', () => {
    const now = stats({ dmg: 0.466 })
    const tested = stats({ dmg: 0, atk: 2000 + 1000 })
    const a = verdict(sim(), now, tested, weapon, weapon, {}, {}, noChoice())
    expect(a.kind).toBe('harder')
    // with a team that deals nothing there is no counted row at all
    const b = verdict(sim(), now, tested, weapon, weapon, {}, {}, choose('none'))
    expect(b.kind).toBe('unknown')
  })

  test('counted rows follow the team', () => {
    const h = resolveParty(sim().hits!, choose('both'))
    expect(countedRows(h.talents[0]).length).toBe(2)
  })
})

describe('the comparison keeps the rows of a team row together', () => {
  test("a row dealt as one row of each element is one row of the answer, their damage summed", () => {
    const hits = hitsOf({ talents: [talent([row({ name: 'Iris DMG', takes: true })])], party: PARTY })
    const panel = stats({})
    const c: Case = { id: 'x:sands', character: 'x', reaction: null, weapon, sets: {}, base, panel_a: panel, panel_b: { ...panel, atk: 3000 } }
    const world = { tolerance: 0.05, tables, kits: { x: { ...hits, effects: [effect({ to: 'dmg:hydro', rate: 1 })] } }, cases: [c] } as unknown as World
    const one = ours(world, c).rows['burst|Iris DMG']
    const both = ours({ ...world, kits: { x: { ...world.kits.x, party: { ...PARTY, default: 'both' } } } }, c).rows['burst|Iris DMG']
    // Pyro alone: one row of Pyro; both: half of Pyro and half of Hydro (with 100% Hydro DMG Bonus): 1 / 2 + 2 / 2 of it
    expect(both.a / one.a).toBeCloseTo(1.5, 9)
  })
})

describe('an infusion follows the team and the toggle that gives it', () => {
  // A Geo character whose Normal Attack is physical; her kit infuses it with Cryo in the Stellar-Conduct shape (the Traveler's A1)
  const normal = (): HitTalent => ({ key: 'normal', name: 'Normal Attack', icon: null, level: 10, main: true, source: 'hoyolab', rows: [row({ name: '1-Hit DMG', kind: 'physical', move: 'normal' })] })
  const infused = [{ talents: ['normal'], element: 'Cryo' as const, while: 'star', party: ['both'] }]
  const hits = hitsOf({ element: 'Geo', talents: [normal()], party: PARTY, infused, toggles: [{ name: 'star', label: 'Star', on: true, covers: ['normal'], state: 'on' }] })
  const holding = (id: string, h: PlannerHits = hits): string[] => buckets(stats({}), h, weapon, {}, choose(id), { base }).infusions.map((i) => i.element)

  test('only the team shapes that have it are infused, and only while its toggle is on', () => {
    expect(holding('both')).toEqual(['cryo'])
    expect(holding('pyro')).toEqual([])
    expect(holding('none')).toEqual([])
    expect(buckets(stats({}), hits, weapon, {}, { ...choose('both'), toggles: { star: false } }, { base }).infusions).toEqual([])
  })

  test('an infusion with no party holds in every team shape', () => {
    const everywhere = { ...hits, infused: [{ ...infused[0], party: undefined }] }
    expect(holding('pyro', everywhere)).toEqual(['cryo'])
    expect(holding('none', everywhere)).toEqual(['cryo'])
  })

  test("the infused Normal Attack takes the infusion's element's DMG Bonus, none of her own element's, and its reactions", () => {
    const damage = (id: string, s: Stats, extra: Partial<PlannerHits> = {}): number => {
      const h = resolveParty({ ...hits, ...extra }, choose(id))
      const b = buckets(s, h, weapon, {}, choose(id), { base })
      return rowDamage(h.talents[0].rows[0], h.talents[0], b, h, tables, choose(id))
    }
    const plain = damage('both', stats({}))
    const cryoBonus = { effects: [effect({ to: 'dmg:cryo', rate: 0.5 })] }
    expect(damage('both', stats({}), cryoBonus) / plain).toBeCloseTo(1.5, 6)
    expect(damage('pyro', stats({}), cryoBonus) / damage('pyro', stats({}))).toBeCloseTo(1, 9)
    // her own element's goblet (Geo, `dmg`) does nothing to a Cryo hit
    expect(damage('both', stats({ dmg: 0.5 }))).toBeCloseTo(plain, 9)
    expect(kindShown(hits, 'normal', choose('both')).reactions).toEqual(['none', 'melt'])
    expect(kindShown(hits, 'normal', choose('pyro')).reactions).toBeNull()
  })
})

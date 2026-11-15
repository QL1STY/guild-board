/**
 * What the planner's verdict says, as plain functions (the Plan design, sections 6 and 7.5): the engine's answer for the build under
 * test, the words and signs the page shows for it, which talents get a reaction switch or a fixed kind of damage, the toggles it
 * names and the choices it takes. The arithmetic is damage.ts's; nothing here reads the page or the network.
 */
import type { PlannerHits, PlannerSim, Pronouns, Toggle } from '../../types.ts'
import {
  countedDamages, countedNames, countedRows, infusionFor, isSpecial, KIND_WORD, partyChoice, reactionsFor, resolveParty, SHE, verdict, type Choice, type GearWeapon, type Reaction,
  type TalentKey, type Verdict,
} from './damage.ts'
import { startState, type Tested, wornSets } from './simstate.ts'
import type { StatKey } from './simulator.ts'

type Stats = Record<StatKey, number>

/** The weapons and sets of the two builds, as the engine takes them: hers as HoYoLAB shows them, the tested ones compared at level 90, R1 (12.4). */
export type Gear = { weaponNow: GearWeapon; weaponTested: GearWeapon; setsNow: Record<string, number>; setsTested: Record<string, number> }

export function gearOf(sim: PlannerSim, tested: Tested): Gear {
  const mine = sim.weapon
  const weaponNow: GearWeapon = mine === null ? { key: '', refinement: 1 } : { key: mine.key, refinement: mine.refinement, level: mine.level, base_atk: mine.base_atk }
  const weaponTested: GearWeapon =
    tested.weapon.key === weaponNow.key ? weaponNow : { key: tested.weapon.key, refinement: 1, level: 90, base_atk: tested.weapon.base_atk }
  return {
    weaponNow, weaponTested,
    setsNow: Object.fromEntries(sim.sets.map((set) => [set.key, set.pieces])),
    setsTested: Object.fromEntries(wornSets(tested).map((worn) => [worn.set.key, worn.pieces])),
  }
}

/** The verdict for the build under test, against what she has now (HoYoLAB's panel). */
export function verdictOf(sim: PlannerSim, tested: Tested, testedStats: Stats, choice: Choice, pronouns: Pronouns = SHE): Verdict {
  const gear = gearOf(sim, tested)
  return verdict(sim, sim.panel, testedStats, gear.weaponNow, gear.weaponTested, gear.setsNow, gear.setsTested, choice, pronouns)
}

/** Whether the test is still exactly what she wears: nothing tested yet. */
export const nothingTested = (sim: PlannerSim, tested: Tested): boolean => JSON.stringify(tested) === JSON.stringify(startState(sim))

/** What every figure of the verdict assumes (the Plan design, 7.5), for the title of the verdict box and the header chip. */
export const ENEMY_NOTE = 'Only the change in damage is shown: against a level 100 enemy with 10% resistance, at average crit.'

const one = (x: number): string => (Math.round(Math.abs(x) * 10 + 1e-9) / 10).toFixed(1)

/** The verdict's headline and the class that colours it (the mockup's `.v`). */
export function headline(v: Verdict): { text: string; cls: 'more' | 'less' | 'same' | 'mixed' } {
  switch (v.kind) {
    case 'harder': return { text: `Hits harder: +${one(v.figure ?? 0)}%`, cls: 'more' }
    case 'softer': return { text: `Hits softer: −${one(v.figure ?? 0)}%`, cls: 'less' }
    case 'none': return { text: 'No change', cls: 'same' }
    case 'depends': return { text: 'It depends', cls: 'mixed' }
    default: return { text: 'No verdict yet', cls: 'mixed' }
  }
}

/** The header's second chip: the verdict's figure. Null while there is no verdict (the page then shows the ATK change, stage 1's). */
export function chipOf(v: Verdict, untouched: boolean): { text: string; cls: 'up' | 'down' | 'same'; sub: string } | null {
  const tested = 'with the tested pieces'
  switch (v.kind) {
    case 'harder': return { text: `+${one(v.figure ?? 0)}%`, cls: 'up', sub: tested }
    case 'softer': return { text: `−${one(v.figure ?? 0)}%`, cls: 'down', sub: tested }
    case 'none': return { text: 'No change', cls: 'same', sub: untouched ? 'nothing tested yet' : tested }
    case 'depends': return { text: 'It depends', cls: 'same', sub: tested }
    default: return null
  }
}

/** A talent's change as its row shows it: "+14.1%", "−14.4%", "±0%" within the 0.05% of "No change", a dash when it has none. */
export function changeText(change: number | null): { text: string; cls: 'up' | 'down' | '' } {
  if (change === null) return { text: '—', cls: '' }
  if (Math.abs(change) < 0.05 + 1e-9) return { text: '±0%', cls: '' }
  return { text: `${change > 0 ? '+' : '−'}${one(change)}%`, cls: change > 0 ? 'up' : 'down' }
}

export const REACTION_WORD: Record<Reaction, string> = { none: 'None', vaporize: 'Vaporize', melt: 'Melt', aggravate: 'Aggravate', spread: 'Spread' }

/**
 * What a talent's row says of its kind of damage: the Lunar or Stellar kinds among its counted rows (named), and, when it counts an
 * ordinary elemental row (or a physical one an infusion that holds turns into an element) of an element a reaction can follow, the
 * reactions that row can trigger, with "none" first. A talent with neither shows what its rows are: Physical, or the element.
 */
export type KindShown = { labels: string[]; reactions: Reaction[] | null }

export function kindShown(hits: PlannerHits, key: TalentKey, choice: Choice): KindShown {
  const talent = hits.talents.find((one) => one.key === key)
  const rows = talent === undefined ? [] : countedRows(talent)
  const labels = [...new Set(rows.filter((row) => isSpecial(row.kind)).map((row) => KIND_WORD[row.kind] ?? row.kind))]
  const elements = new Set<string>()
  for (const row of rows) {
    if (isSpecial(row.kind)) continue
    if (row.kind !== 'physical') {
      elements.add((row.element ?? hits.element).toLowerCase())
      continue
    }
    const infusion = infusionFor(hits, choice, row.move)
    if (infusion !== undefined) elements.add(infusion.element.toLowerCase())
  }
  const options = [...new Set([...elements].flatMap((element) => reactionsFor(element)))]
  if (options.length > 0) return { labels, reactions: ['none', ...options] }
  if (labels.length > 0) return { labels, reactions: null }
  const [only] = elements
  return { labels: [only === undefined ? 'Physical' : only.charAt(0).toUpperCase() + only.slice(1)], reactions: null }
}

const TALENT_ORDER: TalentKey[] = ['normal', 'skill', 'burst']
const TALENT_WORD: Record<TalentKey, string> = { normal: 'Normal Attack', skill: 'Skill', burst: 'Burst' }
const SCALES: [string, string][] = [['atk', 'ATK'], ['hp', 'Max HP'], ['def', 'DEF'], ['em', 'Elemental Mastery']]

function listed(words: string[]): string {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/**
 * The one plain note on what matters for her hits (the Plan design, section 6), from the rows the verdict counts: which of her
 * talents deal Lunar or Stellar damage, which DMG Bonus does nothing for it, and what her other hits scale with.
 */
export function mattersNote(hits: PlannerHits, talents: Verdict['talents'], choice: Choice, pronouns: Pronouns = SHE): string {
  const keys = new Set(talents.map((one) => one.key))
  const rows = hits.talents.filter((talent) => keys.has(talent.key)).flatMap((talent) => countedRows(talent).map((row) => ({ talent, row })))
  const special = rows.filter(({ row }) => isSpecial(row.kind))
  const ordinary = rows.filter(({ row }) => !isSpecial(row.kind))
  if (rows.length === 0) return ''
  const element = hits.element
  const hers = pronouns.hers
  const Hers = hers.charAt(0).toUpperCase() + hers.slice(1)
  const scales = (of: typeof rows): string[] => SCALES.filter(([stat]) => of.some(({ row }) => row.terms.some((term) => term.stat === stat))).map(([, word]) => word)
  const parts: string[] = []
  if (special.length > 0) {
    const who = TALENT_ORDER.filter((key) => special.some(({ talent }) => talent.key === key)).map((key) => TALENT_WORD[key])
    const kinds = [...new Set(special.map(({ row }) => KIND_WORD[row.kind] ?? row.kind))]
    const stats = [...scales(special).filter((word) => word !== 'Elemental Mastery'), 'crit', 'Elemental Mastery']
    parts.push(`${Hers} ${listed(who)} ${who.length === 1 ? 'deals' : 'deal'} ${listed(kinds)} damage. ${element} DMG Bonus and enemy DEF do not change it; ${listed(stats)} do.`)
  }
  if (ordinary.length > 0) {
    const bonus = [...new Set(ordinary.map(({ row }) => {
      if (row.kind !== 'physical') return `${row.element ?? element} DMG Bonus`
      const infusion = infusionFor(hits, choice, row.move)
      return infusion === undefined ? 'Physical DMG Bonus' : `${infusion.element} DMG Bonus`
    }))]
    parts.push(`${Hers} ${special.length > 0 ? 'other hits' : 'hits'} scale with ${listed([...scales(ordinary), ...bonus, 'crit'])}.`)
  }
  return parts.join(' ')
}

/** The hits Stellar-Conduct's field has recorded for a talent that counts Stellar-Conduct rows (12 unless chosen); null for any other talent. */
export function recordedOf(hits: PlannerHits, key: TalentKey, choice: Choice, tables: PlannerSim['tables']): number | null {
  const talent = hits.talents.find((one) => one.key === key)
  if (talent === undefined || !countedRows(talent).some((row) => row.kind === 'stellar-conduct')) return null
  const most = tables.stellar_conduct.length - 1
  return Math.min(Math.max(Math.round(choice.recorded[key] ?? most), 0), most)
}

/** The team a character's damage depends on, as the verdict's Team line shows it: the shapes to choose from, the one chosen (the usual one
 * until the player chooses), a sentence that says which is usual, and why it is. Null for a character whose damage no team decides. */
export type TeamLine = { options: { id: string; label: string }[]; chosen: string; note: string; reason: string }

export function teamLine(hits: PlannerHits, choice: Choice): TeamLine | null {
  const party = hits.party
  const picked = partyChoice(hits, choice)
  if (!party || picked === null) return null
  const usual = party.options.find((option) => option.id === party.default)
  return {
    options: party.options.map((option) => ({ id: option.id, label: option.label })), chosen: picked.id,
    note: `Usual team: ${usual?.label ?? picked.label}. Change it if yours differs.`, reason: party.reason,
  }
}

export type CountedLine = {
  /** What is counted that is no toggle (the Polestar field), which only goes with her hits. */
  fixed: string[]
  /** The toggles that are on and counted. */
  on: { name: string; label: string }[]
  /**
   * The toggles that are not counted now and would change a counted row if they were: off in the kit data or switched off by the player.
   * `with` is what pressing one switches on: itself, and the toggles an effect needs beside it when it needs some.
   */
  off: { name: string; label: string; with: string[] }[]
}

type Named = { name: string; raw: string; label: string; on: boolean }

/**
 * A toggle's name as the page shows it. The kit data's labels are short and often say nothing alone ("Passive", "Stack", "Set4"), so
 * a weapon's or a set's toggle is named with the item it belongs to, and a toggle of a character whose kit nobody has gone through
 * yet with "Her".
 */
export function toggleLabel(origin: { kind: 'hers'; checked: boolean; her: string } | { kind: 'weapon' | 'set'; item: string }, label: string): string {
  if (origin.kind === 'hers') return origin.checked ? label : `${origin.her} ${label}`
  if (origin.kind === 'weapon') return label === 'Passive' ? `${origin.item} passive` : `${origin.item}: ${label}`
  const piece = /^Set(\d)$/.exec(label)
  return piece === null ? `${origin.item}: ${label}` : `${origin.item} ${piece[1]}-piece`
}

/** Her kit's toggles, her weapon's and her sets' in either build, each named as the page shows it, with whether it is on now. */
function namedToggles(sim: PlannerSim, tested: Tested, choice: Choice, her: string): Named[] {
  const hits = sim.hits
  const out: Named[] = []
  if (hits === null) return out
  const take = (list: Toggle[] | undefined, show: (label: string) => string): void => {
    for (const toggle of list ?? []) {
      if (!out.some((one) => one.name === toggle.name)) out.push({ name: toggle.name, raw: toggle.label, label: show(toggle.label), on: choice.toggles[toggle.name] ?? toggle.on })
    }
  }
  take(hits.toggles, (label) => toggleLabel({ kind: 'hers', checked: hits.checked, her }, label))
  const weapons = [sim.weapon === null ? null : { key: sim.weapon.key, name: sim.weapon.name }, { key: tested.weapon.key, name: tested.weapon.name }]
  for (const weapon of weapons) {
    if (weapon !== null) take(hits.weapon_effects[weapon.key]?.toggles, (label) => toggleLabel({ kind: 'weapon', item: weapon.name }, label))
  }
  const sets = [...sim.sets.map((set) => ({ key: set.key, name: set.name })), ...wornSets(tested).map(({ set }) => ({ key: set.key, name: set.name }))]
  for (const set of sets) take(hits.set_effects[set.key]?.toggles, (label) => toggleLabel({ kind: 'set', item: set.name }, label))
  return out
}

/** Every group of toggles an effect or infusion needs together that holds this one: the toggle alone, then the sets that go with it, the smallest first. */
function groupsOf(hits: PlannerHits, name: string): string[][] {
  const groups: string[][] = [[name]]
  const seen = new Set<string>([name])
  const scan = (effects: { while?: string | null; also?: string[] | null }[]): void => {
    for (const effect of effects) {
      if (!effect.while) continue
      const group = [effect.while, ...(effect.also ?? [])]
      if (!group.includes(name)) continue
      const key = [...group].sort().join('|')
      if (!seen.has(key)) {
        seen.add(key)
        groups.push(group)
      }
    }
  }
  scan(hits.effects)
  for (const gear of Object.values(hits.weapon_effects)) scan(gear.effects)
  for (const gear of Object.values(hits.set_effects)) scan(gear.effects)
  return groups.sort((one, other) => one.length - other.length)
}

/** The names that some effect or infusion of hers reads: no other toggle can ever be counted. */
function readNames(hits: PlannerHits): Set<string> {
  const out = new Set<string>()
  const scan = (effects: { while?: string | null; also?: string[] | null }[]): void => {
    for (const effect of effects) {
      if (effect.while) out.add(effect.while)
      for (const name of effect.also ?? []) out.add(name)
    }
  }
  scan(hits.effects)
  scan(hits.infused)
  for (const gear of Object.values(hits.weapon_effects)) scan(gear.effects)
  for (const gear of Object.values(hits.set_effects)) scan(gear.effects)
  return out
}

/**
 * The toggles the page names under the verdict (the Plan design, 14.4), those of her kit, her weapon and her sets, in either build.
 * `on` holds those counted now. `off` holds every other one that counting would change: a toggle that an effect or infusion reaching a
 * counted row reads, and that moves what at least one counted row deals (a DEF% bonus on a character whose rows do not read DEF is not
 * offered). Those off in the kit data and those the player switched off are in it alike. An effect whose gate her constellations,
 * ascension or the team chosen do not reach is not in her data, so its toggle is not named. `with` is what pressing a chip switches on:
 * the toggle alone, or the toggles an effect needs beside it; a toggle with no effect of its own that two or more such groups hold is
 * not named (which partner to press would be a guess), and each of its partners' chips carries it.
 */
export function countedLine(sim: PlannerSim, tested: Tested, testedStats: Stats, choice: Choice, v: Verdict, her = 'Her'): CountedLine {
  const hits = sim.hits === null ? null : resolveParty(sim.hits, choice)
  if (hits === null) return { fixed: [], on: [], off: [] }
  const gear = gearOf(sim, tested)
  const withToggles = (toggles: Record<string, boolean>): Choice => ({ ...choice, toggles })
  const names = (toggles: Record<string, boolean>): string[] =>
    countedNames(sim, sim.panel, testedStats, gear.weaponNow, gear.weaponTested, gear.setsNow, gear.setsTested, withToggles(toggles))
  const damages = (toggles: Record<string, boolean>): number[] =>
    countedDamages(sim, sim.panel, testedStats, gear.weaponNow, gear.weaponTested, gear.setsNow, gear.setsTested, withToggles(toggles))
  const counted = names(choice.toggles)
  const before = damages(choice.toggles)
  const moves = (toggles: Record<string, boolean>): boolean => {
    const after = damages(toggles)
    return after.some((value, index) => Math.abs(value - (before[index] ?? 0)) > 1e-9 * Math.max(1, Math.abs(value)))
  }
  const all = namedToggles(sim, tested, choice, her)
  const read = readNames(hits)
  const line: CountedLine = { fixed: [], on: [], off: [] }
  for (const toggle of all) {
    if (counted.includes(toggle.name)) {
      line.on.push({ name: toggle.name, label: toggle.label })
      continue
    }
    if (!read.has(toggle.name)) continue
    const valid = groupsOf(hits, toggle.name).filter((group) => {
      const switched = { ...choice.toggles, ...Object.fromEntries(group.map((name) => [name, true])) }
      return names(switched).includes(toggle.name) && moves(switched)
    })
    const alone = valid.find((group) => group.length === 1)
    const pick = alone ?? (valid.length === 1 ? valid[0] : undefined)
    if (pick !== undefined) line.off.push({ name: toggle.name, label: toggle.label, with: pick })
  }
  line.fixed = v.counted.filter((label) => !all.some((toggle) => toggle.raw === label))
  return line
}

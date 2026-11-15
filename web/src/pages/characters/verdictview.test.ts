import { describe, expect, test } from 'vitest'
import damageKits from '../../fixtures/damage-kits.json'
import simFixture from '../../fixtures/planner-sim.json'
import type { PlannerHits, PlannerSim } from '../../types.ts'
import { noChoice, type Choice, type Verdict } from './damage.ts'
import { swapSet, startState } from './simstate.ts'
import { changeText, chipOf, countedLine, gearOf, headline, kindShown, mattersNote, nothingTested, recordedOf, teamLine, toggleLabel, verdictOf } from './verdictview.ts'

const tables = damageKits.tables as unknown as PlannerSim['tables']
const kit = (key: 'sandrone' | 'lauma' | 'hu-tao'): PlannerHits => structuredClone(damageKits.kits[key]) as unknown as PlannerHits

/** Hu Tao as Genshin Optimizer was measured on her (damage.test.ts): her kit, Staff of Homa, Crimson Witch of Flames, its own stats. */
const HUTAO_A = { hp: 32245.3734902136, atk: 1096.95987503, def: 0, em: 40, er: 110, cr: 35, cd: 276.7536, dmg: 61.6, heal: 0, physical: 0 }
const HUTAO_B = { ...HUTAO_A, hp: 24997.99860548, atk: 1429.9210584518 }
const BASE = { hp: 15552.3066196, atk: 714.5089773, def: 0 }

function huTao(): PlannerSim {
  const sample = simFixture as unknown as PlannerSim
  const sim: PlannerSim = {
    ...structuredClone(sample), hits: kit('hu-tao'), tables, panel: { ...HUTAO_A }, base: BASE, char_base_atk: BASE.atk - 608,
    weapon: { ...sample.weapon!, key: 'staff-of-homa', base_atk: 608, level: 90, refinement: 1 },
    sets: [{ ...sample.sets[0], key: 'crimson-witch-of-flames', pieces: 5 }],
  }
  for (const piece of sim.pieces) piece.set_key = 'crimson-witch-of-flames'
  return sim
}

describe('the build the engine is given', () => {
  test("hers as HoYoLAB shows it, the tested weapon at level 90 R1, and the sets worn", () => {
    const sim = huTao()
    const start = startState(sim)
    const same = gearOf(sim, start)
    expect(same.weaponNow).toEqual({ key: 'staff-of-homa', refinement: 1, level: 90, base_atk: 608 })
    expect(same.weaponTested).toBe(same.weaponNow)
    expect(same.setsNow).toEqual({ 'crimson-witch-of-flames': 5 })
    expect(same.setsTested).toEqual({ 'crimson-witch-of-flames': 5 })
    const other = { ...start, weapon: { key: 'primordial-jade-winged-spear', name: 'x', icon: null, rarity: 5, base_atk: 674, sub: 'cr' as const, sub_value: 22.1 } }
    expect(gearOf({ ...sim, weapon: { ...sim.weapon!, refinement: 3, level: 80 } }, other).weaponTested)
      .toEqual({ key: 'primordial-jade-winged-spear', refinement: 1, level: 90, base_atk: 674 })
    // 2 + 2: the set of a tile pressed is swapped, and each set keeps its pieces
    const swapped = swapSet(start, 'crimson-witch-of-flames', { key: 'x-set', name: 'X', icon: null, two_text: '', four_text: '', two: [] })
    expect(gearOf(sim, swapped).setsTested).toEqual({ 'x-set': 5 })
  })

  test('nothing is tested until the build differs from hers', () => {
    const sim = huTao()
    const start = startState(sim)
    expect(nothingTested(sim, start)).toBe(true)
    expect(nothingTested(sim, { ...start, weapon: { ...start.weapon, key: 'other' } })).toBe(false)
  })
})

describe("the verdict's words", () => {
  test('Hu Tao: softer with Paramita Papilio, harder without (the verdict of damage.test.ts, in the page`s words)', () => {
    const sim = huTao()
    const start = startState(sim)
    const on = verdictOf(sim, start, HUTAO_B, noChoice())
    expect(headline(on)).toEqual({ text: 'Hits softer: −5.3%', cls: 'less' })
    expect(chipOf(on, false)).toEqual({ text: '−5.3%', cls: 'down', sub: 'with the tested pieces' })
    const off = verdictOf(sim, start, HUTAO_B, { ...noChoice(), toggles: { GuideToAfterlifeVoyage: false } })
    expect(headline(off)).toEqual({ text: 'Hits harder: +20.3%', cls: 'more' })
    expect(chipOf(off, false)?.text).toBe('+20.3%')
  })

  test('no change names nothing tested yet only while nothing is tested; it depends has no figure; no hits has no chip', () => {
    const sim = huTao()
    const none = verdictOf(sim, startState(sim), HUTAO_A, noChoice())
    expect(headline(none)).toEqual({ text: 'No change', cls: 'same' })
    expect(chipOf(none, true)).toEqual({ text: 'No change', cls: 'same', sub: 'nothing tested yet' })
    expect(chipOf(none, false)?.sub).toBe('with the tested pieces')
    const mixed: Verdict = { kind: 'depends', figure: null, talents: [], why: '', counted: [], notes: [] }
    expect(headline(mixed)).toEqual({ text: 'It depends', cls: 'mixed' })
    expect(chipOf(mixed, false)).toEqual({ text: 'It depends', cls: 'same', sub: 'with the tested pieces' })
    const unknown = verdictOf({ ...sim, hits: null }, startState(sim), HUTAO_B, noChoice())
    expect(headline(unknown).text).toBe('No verdict yet')
    expect(chipOf(unknown, false)).toBeNull()
  })

  test('a talent change: a sign and one decimal, ±0% within the no-change margin, a dash for none', () => {
    expect(changeText(14.089)).toEqual({ text: '+14.1%', cls: 'up' })
    expect(changeText(-14.403)).toEqual({ text: '−14.4%', cls: 'down' })
    expect(changeText(0.04)).toEqual({ text: '±0%', cls: '' })
    expect(changeText(-0.05)).toEqual({ text: '±0%', cls: '' })
    expect(changeText(0.06)).toEqual({ text: '+0.1%', cls: 'up' })
    expect(changeText(null)).toEqual({ text: '—', cls: '' })
  })
})

describe('what a talent row says of its kind', () => {
  test('a talent that mixes ordinary and Stellar-Conduct rows names the kind and keeps the reaction (Sandrone, Cryo: Melt)', () => {
    const sandrone = kit('sandrone')
    for (const key of ['normal', 'skill', 'burst'] as const) {
      expect(kindShown(sandrone, key, noChoice())).toEqual({ labels: ['Stellar-Conduct'], reactions: ['none', 'melt'] })
    }
  })

  test('Lauma: her Lunar-Bloom row is named, and her ordinary Dendro row can Spread', () => {
    expect(kindShown(kit('lauma'), 'skill', noChoice())).toEqual({ labels: ['Lunar-Bloom'], reactions: ['none', 'spread'] })
    // with only her Lunar row counted there is nothing to choose
    const lunar = kit('lauma')
    for (const t of lunar.talents) t.rows = t.rows.filter((r) => r.kind === 'lunar-bloom')
    expect(kindShown(lunar, 'skill', noChoice())).toEqual({ labels: ['Lunar-Bloom'], reactions: null })
  })

  test('an ordinary elemental talent has the reactions her element allows, with none first; an element with none is only named', () => {
    expect(kindShown(kit('hu-tao'), 'skill', noChoice())).toEqual({ labels: [], reactions: ['none', 'vaporize', 'melt'] })
    const geo = kit('sandrone')
    geo.element = 'Geo'
    for (const t of geo.talents) t.rows = t.rows.filter((r) => r.kind === 'elemental')
    expect(kindShown(geo, 'skill', noChoice())).toEqual({ labels: ['Geo'], reactions: null })
  })

  test("a physical talent is physical until an infusion that holds makes it Hu Tao's Pyro", () => {
    const hits = kit('hu-tao')
    const off: Choice = { ...noChoice(), toggles: { GuideToAfterlifeVoyage: false } }
    // Paramita Papilio infuses her normal attack, charged attack and plunge while it is on
    expect(kindShown(hits, 'normal', noChoice())).toEqual({ labels: [], reactions: ['none', 'vaporize', 'melt'] })
    expect(kindShown(hits, 'normal', off)).toEqual({ labels: ['Physical'], reactions: null })
  })

  test('Recorded hits belongs to a talent that counts Stellar-Conduct rows, 12 until chosen', () => {
    const sandrone = kit('sandrone')
    expect(recordedOf(sandrone, 'skill', noChoice(), tables)).toBe(12)
    expect(recordedOf(sandrone, 'skill', { ...noChoice(), recorded: { skill: 3 } }, tables)).toBe(3)
    expect(recordedOf(sandrone, 'skill', { ...noChoice(), recorded: { skill: 40 } }, tables)).toBe(12)
    expect(recordedOf(kit('hu-tao'), 'skill', noChoice(), tables)).toBeNull()
  })
})

describe('the toggles the verdict names', () => {
  test('Hu Tao: Paramita Papilio is counted and can be switched off, then back on; what is off in the kit data is offered in the Not counted list', () => {
    const sim = huTao()
    const start = startState(sim)
    const v = verdictOf(sim, start, HUTAO_B, noChoice())
    const line = countedLine(sim, start, HUTAO_B, noChoice(), v)
    expect(line.fixed).toEqual([])
    expect(line.on.map((t) => t.label)).toEqual(['Paramita Papilio'])
    expect(line.on[0].name).toBe('GuideToAfterlifeVoyage')
    // what is off in the kit data is offered too, when counting it would change a counted row: hers, then the weapon's, then the set's
    sim.weapon!.name = 'Staff of Homa'
    sim.sets[0].name = 'Crimson Witch of Flames'
    expect(countedLine(sim, start, HUTAO_B, noChoice(), v).off).toEqual([
      { name: 'SanguineRouge', label: 'HP below 50%', with: ['SanguineRouge'] },
      { name: 'staff-of-homa:RecklessCinnabar', label: 'Staff of Homa: More ATK from Max HP below 50% HP', with: ['staff-of-homa:RecklessCinnabar'] },
      { name: 'crimson-witch-of-flames:stack', label: 'Crimson Witch of Flames: Pyro DMG bonus at 3 stacks from Skill use', with: ['crimson-witch-of-flames:stack'] },
    ])

    const choice: Choice = { ...noChoice(), toggles: { GuideToAfterlifeVoyage: false } }
    const after = countedLine(sim, start, HUTAO_B, choice, verdictOf(sim, start, HUTAO_B, choice))
    expect(after.on).toEqual([])
    // the one the player switched off is in the same list, hers first
    expect(after.off.map((t) => t.label)).toContain('Paramita Papilio')
    expect(after.off.map((t) => t.name).slice(0, 2).sort()).toEqual(['GuideToAfterlifeVoyage', 'SanguineRouge'])
  })

  test("a toggle that is off in the kit data and reaches a counted row is offered, and counting it changes her damage", () => {
    const sim = huTao()
    const start = startState(sim)
    const before = verdictOf(sim, start, HUTAO_B, noChoice())
    const line = countedLine(sim, start, HUTAO_B, noChoice(), before)
    const chip = line.off.find((t) => t.name === 'SanguineRouge')!
    expect(chip.with).toEqual(['SanguineRouge'])
    const pressed: Choice = { ...noChoice(), toggles: Object.fromEntries(chip.with.map((name) => [name, true])) }
    const after = countedLine(sim, start, HUTAO_B, pressed, verdictOf(sim, start, HUTAO_B, pressed))
    expect(after.on.map((t) => t.name)).toContain('SanguineRouge')
    expect(after.off.map((t) => t.name)).not.toContain('SanguineRouge')
    const harder = verdictOf(sim, start, HUTAO_B, pressed)
    expect(harder.figure).not.toBe(before.figure)
  })

  test('a toggle that reaches no counted row is not offered, and neither is one that has no effect in her data', () => {
    const sim = huTao()
    sim.hits!.toggles.push({ name: 'Nothing', label: 'Does nothing', on: false, covers: [], state: 'on' } as never)
    sim.hits!.toggles.push({ name: 'Gated', label: 'No effect here', on: false, covers: [], state: 'on' } as never)
    const start = startState(sim)
    const line = countedLine(sim, start, HUTAO_B, noChoice(), verdictOf(sim, start, HUTAO_B, noChoice()))
    expect(line.off.map((t) => t.name)).not.toContain('Nothing')
    expect(line.off.map((t) => t.name)).not.toContain('Gated')
    // an effect that reaches no row of hers (Cryo DMG Bonus on her Pyro hits) does not make its toggle count
    sim.hits!.effects.push({ ...sim.hits!.effects[0], while: 'Gated', to: 'dmg:cryo' })
    const again = countedLine(sim, start, HUTAO_B, noChoice(), verdictOf(sim, start, HUTAO_B, noChoice()))
    expect(again.off.map((t) => t.name)).not.toContain('Gated')
  })

  test("a toggle whose effect adds a stat her counted rows do not read is not offered (DEF on a Pyro attacker's hits), one whose stat they read is", () => {
    const sim = huTao()
    sim.hits!.toggles.push(
      { name: 'DefBuff', label: 'DEF bonus', on: false, covers: [], state: 'on' } as never,
      { name: 'AtkBuff', label: 'ATK bonus', on: false, covers: [], state: 'on' } as never,
    )
    sim.hits!.effects.push({ ...sim.hits!.effects[0], while: 'DefBuff', to: 'def%', rate: 0.2 } as never, { ...sim.hits!.effects[0], while: 'AtkBuff', to: 'atk%', rate: 0.2 } as never)
    const start = startState(sim)
    const line = countedLine(sim, start, HUTAO_B, noChoice(), verdictOf(sim, start, HUTAO_B, noChoice()))
    expect(line.off.map((t) => t.name)).not.toContain('DefBuff')
    expect(line.off.map((t) => t.name)).toContain('AtkBuff')
  })

  test("a toggle with no effect of its own that two effects need is not offered; each partner's chip carries it", () => {
    const sim = huTao()
    for (const name of ['Lock', 'PartA', 'PartB']) sim.hits!.toggles.push({ name, label: name, on: false, covers: [], state: 'on' } as never)
    sim.hits!.effects.push({ ...sim.hits!.effects[0], while: 'Lock', also: ['PartA'] } as never, { ...sim.hits!.effects[0], while: 'Lock', also: ['PartB'], to: 'atk%', rate: 0.2 } as never)
    const start = startState(sim)
    const line = countedLine(sim, start, HUTAO_B, noChoice(), verdictOf(sim, start, HUTAO_B, noChoice()))
    expect(line.off.map((t) => t.name)).not.toContain('Lock')
    expect(line.off.find((t) => t.name === 'PartA')?.with.sort()).toEqual(['Lock', 'PartA'])
    expect(line.off.find((t) => t.name === 'PartB')?.with.sort()).toEqual(['Lock', 'PartB'])
  })

  test("a party option that is not chosen leaves its toggle out, and the chosen one's is offered", () => {
    const sim = huTao()
    sim.hits!.toggles.push({ name: 'TeamBuff', label: 'Team buff', on: false, covers: [], state: 'on' } as never)
    sim.hits!.effects.push({ ...sim.hits!.effects[0], while: 'TeamBuff', party: ['b'] } as never)
    sim.hits!.party = { default: 'a', reason: 'x', options: [{ id: 'a', label: 'A', elements: ['pyro'] }, { id: 'b', label: 'B', elements: ['pyro'] }] } as never
    const start = startState(sim)
    const usual = countedLine(sim, start, HUTAO_B, noChoice(), verdictOf(sim, start, HUTAO_B, noChoice()))
    expect(usual.off.map((t) => t.name)).not.toContain('TeamBuff')
    const other: Choice = { ...noChoice(), party: 'b' }
    expect(countedLine(sim, start, HUTAO_B, other, verdictOf(sim, start, HUTAO_B, other)).off.map((t) => t.name)).toContain('TeamBuff')
  })

  test("the tested weapon's and set's toggles are offered after her own, in that order", () => {
    const sim = huTao()
    sim.sets[0].name = 'Crimson Witch of Flames'
    const start = startState(sim)
    const line = countedLine(sim, start, HUTAO_B, noChoice(), verdictOf(sim, start, HUTAO_B, noChoice()))
    const names = line.off.map((t) => t.name)
    const own = names.indexOf('SanguineRouge')
    const weapon = names.findIndex((name) => name.startsWith('staff-of-homa:'))
    const set = names.findIndex((name) => name.startsWith('crimson-witch-of-flames:'))
    expect(own).toBeGreaterThanOrEqual(0)
    expect(weapon).toBeGreaterThan(own)
    expect(set).toBeGreaterThan(weapon)
    expect(line.off[weapon].label).toMatch(/: More ATK from Max HP below 50% HP$/)
  })

  test('a toggle that needs another one beside it is offered with that one, and pressing it counts both', () => {
    const sim = huTao()
    sim.hits!.toggles.push(
      { name: 'First', label: 'First half', on: false, covers: [], state: 'on' } as never,
      { name: 'Second', label: 'Second half', on: false, covers: [], state: 'on' } as never,
    )
    sim.hits!.effects.push({ ...sim.hits!.effects[0], while: 'First', also: ['Second'] } as never)
    const start = startState(sim)
    const line = countedLine(sim, start, HUTAO_B, noChoice(), verdictOf(sim, start, HUTAO_B, noChoice()))
    const first = line.off.find((t) => t.name === 'First')!
    expect(first.with.sort()).toEqual(['First', 'Second'])
    const pressed: Choice = { ...noChoice(), toggles: Object.fromEntries(first.with.map((name) => [name, true])) }
    const after = countedLine(sim, start, HUTAO_B, pressed, verdictOf(sim, start, HUTAO_B, pressed))
    expect(after.on.map((t) => t.name)).toEqual(expect.arrayContaining(['First', 'Second']))
  })

  test("a weapon's or a set's toggle is named with its item, and an undecided character's toggle with Her", () => {
    expect(toggleLabel({ kind: 'weapon', item: 'A Teaspoon of Transcendence' }, 'Passive')).toBe('A Teaspoon of Transcendence passive')
    expect(toggleLabel({ kind: 'weapon', item: 'Staff of Homa' }, 'After skill')).toBe('Staff of Homa: After skill')
    expect(toggleLabel({ kind: 'set', item: 'Disenchantment in Deep Shadow' }, 'Set4')).toBe('Disenchantment in Deep Shadow 4-piece')
    expect(toggleLabel({ kind: 'set', item: 'Crimson Witch of Flames' }, 'Stack')).toBe('Crimson Witch of Flames: Stack')
    expect(toggleLabel({ kind: 'hers', checked: false, her: 'Her' }, 'Bonus skirk2')).toBe('Her Bonus skirk2')
    expect(toggleLabel({ kind: 'hers', checked: true, her: 'Her' }, 'Paramita Papilio')).toBe('Paramita Papilio')
  })

  test('the line names a set toggle with the set, and a toggle of her kit that nobody has gone through with Her', () => {
    const sim = huTao()
    sim.sets[0].name = 'Crimson Witch of Flames'
    sim.hits!.checked = false
    // the player's choice puts the Crimson Witch's states, off in the kit data, on
    const set = sim.hits!.set_effects['crimson-witch-of-flames']
    const names = set.toggles.map((t) => t.name)
    const all: Choice = { ...noChoice(), toggles: Object.fromEntries([...names, 'GuideToAfterlifeVoyage'].map((n) => [n, true])) }
    const start = startState(sim)
    const line = countedLine(sim, start, HUTAO_B, all, verdictOf(sim, start, HUTAO_B, all))
    const labels = line.on.map((t) => t.label)
    expect(labels).toContain('Her Paramita Papilio')
    expect(labels.filter((label) => label.startsWith('Crimson Witch of Flames: ')).length).toBeGreaterThan(0)
  })

  test('Sandrone: the Polestar field is counted with her Stellar-Conduct hits and is no toggle', () => {
    const sample = simFixture as unknown as PlannerSim
    const sim: PlannerSim = { ...structuredClone(sample), hits: kit('sandrone'), tables }
    const v = verdictOf(sim, startState(sim), sim.panel, noChoice())
    expect(countedLine(sim, startState(sim), sim.panel, noChoice(), v).fixed).toEqual(['Polestar field'])
  })
})

describe('the note on what matters for her hits', () => {
  test('Sandrone: her talents deal Stellar-Conduct damage that Cryo DMG Bonus does not change, her other hits scale with their own stats', () => {
    const talents = (['normal', 'skill', 'burst'] as const).map((key) => ({ key, change: 0, kind: 'stellar-conduct' }))
    const note = mattersNote(kit('sandrone'), talents, noChoice())
    expect(note).toMatch(/^Her Normal Attack, Skill and Burst deal Stellar-Conduct damage\. Cryo DMG Bonus and enemy DEF do not change it; ATK, crit and Elemental Mastery do\. /)
    expect(note).toMatch(/Her other hits scale with ATK, .*Cryo DMG Bonus and crit\.$/)
  })

  test('Lauma: a sentence about her other hits only while she counts some', () => {
    const talents = [{ key: 'skill' as const, change: 0, kind: 'lunar-bloom' }]
    expect(mattersNote(kit('lauma'), talents, noChoice())).toBe('Her Skill deals Lunar-Bloom damage. Dendro DMG Bonus and enemy DEF do not change it; crit and Elemental Mastery do. Her other hits scale with ATK, Elemental Mastery, Dendro DMG Bonus and crit.')
    const lunar = kit('lauma')
    for (const t of lunar.talents) t.rows = t.rows.filter((r) => r.kind === 'lunar-bloom')
    const note = mattersNote(lunar, talents, noChoice())
    expect(note).toBe('Her Skill deals Lunar-Bloom damage. Dendro DMG Bonus and enemy DEF do not change it; crit and Elemental Mastery do.')
  })

  test("a row that takes the team's element names that element's DMG Bonus, not her own (Anemo Heizou's Iris is Pyro)", () => {
    const heizou = kit('hu-tao')
    heizou.element = 'Anemo'
    for (const t of heizou.talents) t.rows = t.rows.filter((r) => r.kind === 'elemental' || r.kind === 'physical').slice(0, 1)
    heizou.talents[0].rows[0] = { ...heizou.talents[0].rows[0], kind: 'elemental', element: 'Pyro' }
    const note = mattersNote(heizou, [{ key: 'normal', change: 0, kind: 'elemental' }], noChoice())
    expect(note).toContain('Pyro DMG Bonus')
    expect(note).not.toContain('Anemo DMG Bonus')
  })

  test('Hu Tao: ordinary hits scale with their stats, her element and crit', () => {
    const note = mattersNote(kit('hu-tao'), (['normal', 'skill', 'burst'] as const).map((key) => ({ key, change: 0, kind: 'elemental' })), noChoice())
    expect(note).toMatch(/^Her hits scale with .*Pyro DMG Bonus and crit\.$/)
    expect(note).not.toContain('Stellar')
  })

  test("the note follows the card's pronouns", () => {
    const talents = [{ key: 'skill' as const, change: 0, kind: 'lunar-bloom' }]
    expect(mattersNote(kit('lauma'), talents, noChoice(), { she: 'he', her: 'him', hers: 'his' }))
      .toMatch(/^His Skill deals Lunar-Bloom damage\..* His other hits scale with /)
    expect(mattersNote(kit('lauma'), talents, noChoice(), { she: 'they', her: 'them', hers: 'their' })).toMatch(/^Their Skill deals .* Their other hits scale with /)
  })

  test("an infusion that is switched off does not make her Normal Attack a Pyro one: the note names Physical DMG Bonus", () => {
    const hits = kit('hu-tao')
    const normal = [{ key: 'normal' as const, change: 0, kind: 'elemental' }]
    const on = mattersNote(hits, normal, noChoice())
    expect(on).toContain('Pyro DMG Bonus')
    expect(on).not.toContain('Physical DMG Bonus')
    const off = mattersNote(hits, normal, { ...noChoice(), toggles: { GuideToAfterlifeVoyage: false } })
    expect(off).toContain('Physical DMG Bonus')
    expect(off).not.toContain('Pyro DMG Bonus')
  })

  test("an infusion of another element than hers: the note names that element's DMG Bonus, and only in the team shapes that have it", () => {
    const hits = kit('hu-tao')
    hits.element = 'Geo'
    hits.infused = [{ talents: ['normal', 'charged', 'plunging'], element: 'Cryo', while: 'GuideToAfterlifeVoyage', party: ['sc'] }]
    hits.party = { default: 'sc', reason: 'x', options: [{ id: 'sc', label: 'Stellar-Conduct', elements: [] }, { id: 'none', label: 'None', elements: [] }], element_rows: {}, only_rows: {} }
    const normal = [{ key: 'normal' as const, change: 0, kind: 'elemental' }]
    const infused = mattersNote(hits, normal, noChoice())
    expect(infused).toContain('Cryo DMG Bonus')
    expect(infused).not.toContain('Geo DMG Bonus')
    expect(infused).not.toContain('Physical DMG Bonus')
    const other = mattersNote(hits, normal, { ...noChoice(), party: 'none' })
    expect(other).toContain('Physical DMG Bonus')
    expect(kindShown(hits, 'normal', { ...noChoice(), party: 'none' })).toEqual({ labels: ['Physical'], reactions: null })
    expect(kindShown(hits, 'normal', noChoice()).reactions).toEqual(['none', 'melt'])
  })

  test('no counted row, no note', () => {
    expect(mattersNote(kit('hu-tao'), [], noChoice())).toBe('')
  })
})

describe('the team line', () => {
  // SHAPE-ONLY INPUT: a party made up for the line's own words; the engine's arithmetic of the team is in party.test.ts
  const party = {
    default: 'a', reason: 'Because.',
    options: [{ id: 'a', label: 'Pyro, Hydro', elements: ['pyro', 'hydro'] }, { id: 'b', label: 'Cryo', elements: ['cryo'] }],
    element_rows: {}, only_rows: {},
  }
  const hits = (over: Partial<PlannerHits>): PlannerHits => ({ ...kit('sandrone'), party, ...over })

  test('a character whose damage no team decides has no line', () => {
    expect(teamLine(kit('sandrone'), noChoice())).toBeNull()
  })

  test('the line offers every team, shows the usual one until another is chosen, and says which is usual and why', () => {
    const line = teamLine(hits({}), noChoice())!
    expect(line.options).toEqual([{ id: 'a', label: 'Pyro, Hydro' }, { id: 'b', label: 'Cryo' }])
    expect(line.chosen).toBe('a')
    expect(line.note).toBe('Usual team: Pyro, Hydro. Change it if yours differs.')
    expect(line.reason).toBe('Because.')
    expect(teamLine(hits({}), { ...noChoice(), party: 'b' })!.chosen).toBe('b')
    expect(teamLine(hits({}), { ...noChoice(), party: 'gone' })!.chosen).toBe('a')
  })
})

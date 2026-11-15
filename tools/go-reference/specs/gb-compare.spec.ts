/**
 * Guild Board's damage comparison (tools/go-reference, Guild Board's own file, MIT).
 *
 * run.py copies it into a Genshin Optimizer checkout's libs/gi/pando-parity/src/ and runs it there with vitest. For every
 * case of tools/go-reference/cases.json (path in $GB_CASES) it builds both builds the way GO's website does
 * (getCharDataBundle's data layers wrapped by uiDataForTeam, so a character's own team buffs count: go-engine.md, section 1)
 * with Waverider (never Pando) and writes, per build, the average-crit damage of every hit her talents show, her base
 * values (what HoYoLAB's panel is made from) and her final stats (for diagnosis). Level 90, ascension 6, the case's talents
 * and constellation, the weapon (the case's, or the build's own in a weapon swap) at 90 R1, five 5-star +20 pieces of the case's set, enemy level 100 with WR's 10% RES.
 *
 * Output: $GB_OUT_DIR/gb-compare.json (default: the checkout's root).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  allArtifactData,
  displayDataMap,
  getCharSheet,
  getWeaponSheet,
  reactionData,
  resonanceData,
} from '@genshin-optimizer/gi/sheets'
import { getCharStat, getWeaponStat } from '@genshin-optimizer/gi/stats'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import type { Data } from '@genshin-optimizer/gi/wr'
import { common, constant, dataObjForCharacter, dataObjForWeapon, input, mergeData } from '@genshin-optimizer/gi/wr'
import { wrArtsData } from './harness'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any
type Piece = { set: string; stats: { key: string; value: number }[] }
/** `weapon`: the build's own weapon (a weapon swap's second side), else the case's. */
type Build = { pieces: Piece[]; weapon_go?: string }
type Case = {
  id: string
  go_key: string
  weapon_go: string
  constellation: number
  talents: { auto: number; skill: number; burst: number }
  conds: Record<string, Record<string, string>>
  /** her states without the Polestar field, for the talents that count no Stellar-Conduct row (the engine's field is per talent) */
  conds_plain?: Record<string, Record<string, string>>
  /** a swap to a weapon or set with toggles decided on: the states without them, to show GO's answer moves with them */
  conds_off?: Record<string, Record<string, string>>
  reaction: string | null
  /** the elements of the other members of her team and how many of them are Moonsign characters (the Plan design 14, her `party`) */
  team?: string[]
  moonsign?: number
  a: Build
  b: Build
}

const GROUPS = ['normal', 'charged', 'plunging', 'skill', 'burst']
const TOTALS = ['hp', 'atk', 'def', 'eleMas', 'enerRech_', 'critRate_', 'critDMG_', 'heal_', 'physical_dmg_']

function evaluate(c: Case, build: Build, conds: Record<string, Record<string, string>>) {
  const weaponGo = build.weapon_go ?? c.weapon_go
  const character = {
    key: c.go_key, level: 90, ascension: 6, constellation: c.constellation, talent: { ...c.talents },
    equippedArtifacts: { flower: '', plume: '', sands: '', goblet: '', circlet: '' }, equippedWeapon: 'w',
  } as never
  const weapon = { id: 'w', key: weaponGo, level: 90, ascension: 6, refinement: 1, location: c.go_key, lock: false } as never
  const sheet: N = getCharSheet(c.go_key as never, 'F')
  const { display: _display, ...restWeapon } = (getWeaponSheet(weaponGo as never) as N).data
  const weaponSheets = mergeData([restWeapon, displayDataMap[getCharStat(c.go_key as never).weaponType]])
  const charObj = dataObjForCharacter(character) as N
  charObj.enemy = { ...charObj.enemy, level: constant(100) }
  charObj.hit = { ...charObj.hit, hitMode: constant('avgHit'), ...(c.reaction ? { reaction: constant(c.reaction) } : {}) }
  const conditional = {
    conditional: Object.fromEntries(Object.entries(conds).map(([s, kv]) =>
      [s, Object.fromEntries(Object.entries(kv).map(([k, v]) => [k, constant(v)]))])),
  } as Data
  const data: Data[] = [
    wrArtsData(build.pieces as never), charObj, dataObjForWeapon(weapon), conditional,
    mergeData([sheet.data, weaponSheets, allArtifactData]), common, resonanceData, reactionData,
  ]
  // the rest of her team: members with nothing of their own but the element they add to the party's tally (and a Moonsign flag)
  const mates = Object.fromEntries((c.team ?? []).map((ele, i) => [
    `Mate${i}`,
    [{ teamBuff: { tally: { [ele]: constant(1), ...(i < (c.moonsign ?? 0) ? { moonsign: constant(1) } : {}) } } } as Data],
  ]))
  const ui: N = uiDataForTeam({ [c.go_key]: data, ...mates } as never, 'F', c.go_key as never)[c.go_key]!.target
  const value = (node: N): number | null => {
    try {
      const v = ui.get(node).value
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    } catch {
      return null
    }
  }
  const hits: Record<string, number | null> = {}
  for (const group of GROUPS) {
    for (const [name, node] of Object.entries(sheet.data.display?.[group] ?? {})) hits[`${group}.${name}`] = value(node)
  }
  const stat: N = getCharStat(c.go_key as never)
  const element = stat.ele ?? null
  const specialKey = Object.keys(stat.ascensionBonus ?? {}).find((k) => !['hp', 'atk', 'def'].includes(k)) ?? null
  const total: Record<string, number | null> = {}
  for (const key of [...TOTALS, ...(element ? [`${element}_dmg_`] : [])]) total[key] = value((input.total as N)[key])
  return {
    hits,
    base: { hp: value(input.base.hp), atk: value(input.base.atk), def: value(input.base.def) },
    weapon: {
      main: value(input.weapon.main), sub: value(input.weapon.sub),
      sub_key: (getWeaponStat(weaponGo as never) as N).subStat?.type ?? null,
    },
    special: specialKey ? { key: specialKey, value: value(input.special) } : null,
    innate: stat.baseStats ?? null,
    element,
    total,
    // the talent levels GO's hits are at: 10, or more where a passive of hers raises one (Tartaglia's Normal Attack)
    levels: {
      normal: (value((input.total as N).autoIndex) ?? 9) + 1,
      skill: (value((input.total as N).skillIndex) ?? 9) + 1,
      burst: (value((input.total as N).burstIndex) ?? 9) + 1,
    },
  }
}

test('gb-compare: each case in both builds', () => {
  const file = JSON.parse(readFileSync(process.env['GB_CASES'] ?? 'cases.json', 'utf8'))
  // the weapon and set swaps (`gear_cases`: their builds have a weapon of their own) are run with the others
  const cases: Case[] = [...file.cases, ...(file.gear_cases ?? [])]
  const out: N = {}
  let failed = 0
  for (const c of cases) {
    try {
      out[c.id] = { a: evaluate(c, c.a, c.conds), b: evaluate(c, c.b, c.conds) }
      if (c.conds_plain) {
        out[c.id].a_plain = evaluate(c, c.a, c.conds_plain)
        out[c.id].b_plain = evaluate(c, c.b, c.conds_plain)
      }
      if (c.conds_off) {
        out[c.id].a_off = evaluate(c, c.a, c.conds_off)
        out[c.id].b_off = evaluate(c, c.b, c.conds_off)
      }
    } catch (e) {
      failed += 1
      out[c.id] = { error: String(e) }
    }
  }
  writeFileSync(join(process.env['GB_OUT_DIR'] ?? '.', 'gb-compare.json'), JSON.stringify(out))
  console.log(`GB-COMPARE ${cases.length} cases, ${failed} failed`)
}, 120_000)   // vitest's own 5 seconds is too short for some 430 cases of two builds each

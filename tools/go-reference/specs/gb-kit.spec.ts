/**
 * Guild Board's kit extractor (tools/go-reference, Guild Board's own file, MIT).
 *
 * run.py copies it into a Genshin Optimizer checkout's libs/gi/pando-parity/src/ and runs it there with vitest. It walks
 * the Waverider sheets (libs/gi/sheets, the engine GO's website uses; never Pando) of every character, weapon and set
 * and writes their effect data as plain JSON trees: what each sheet adds before conversions read it (`premod`), after
 * them (`total`), to the whole party (`teamBuff`), each hit's own additional data, the infusions. run.py turns the
 * trees into kits.json; nothing of GO is shipped with Guild Board. Names are written only to make Guild Board's keys.
 *
 * Output: $GB_OUT_DIR/gb-kit.json (default: the checkout's root).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  allArtifactSetKeys,
  allCharacterKeys,
  allTravelerKeys,
  allWeaponKeys,
} from '@genshin-optimizer/gi/consts'
import {
  getArtSheet,
  getCharSheet,
  getWeaponSheet,
} from '@genshin-optimizer/gi/sheets'
import { allStats, getWeaponStat } from '@genshin-optimizer/gi/stats'
import { damagesIn, ser } from './gb-tree'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any
const LOC = join(__dirname, '../../dm-localization/assets/locales/en')

/** The sheet's data without the hits (display) and the conditionals' bookkeeping, as trees. */
function effectsOf(data: N) {
  const out: N = {}
  for (const [k, v] of Object.entries(data ?? {})) {
    if (['display', 'conditional'].includes(k)) continue
    out[k] = ser(v)
  }
  return out
}

/** Each hit's additional data (Alhaitham's A4, Nahida's A4, a weapon's burst-only bonus), by display group and name. */
function hitDataOf(display: N) {
  const out: N = {}
  for (const [group, entries] of Object.entries(display ?? {}) as [string, N][]) {
    for (const [name, shown] of Object.entries(entries ?? {}) as [string, N][]) {
      // a display entry with a damage node in more than one branch (gb-match gives a hit for each, the later ones `<name>~<n>`)
      const damages = damagesIn(shown)
      for (const [position, { node }] of damages.slice(1).entries()) {
        const d: N = {}
        for (const [k, v] of Object.entries(node.data ?? {})) {
          if (k === 'hit') continue
          d[k] = ser(v)
        }
        if (Object.keys(d).length) out[`${group}.${name}~${position + 1}`] = d
      }
      // through the gates a hit is shown behind (equal(state, 'on', hit)), as gb-match finds it
      let node = shown
      while (node && (node.operation === 'match' || node.operation === 'threshold'))
        node = node.operands?.[2]?.operation === 'const' ? node.operands?.[3] : node.operands?.[2]
      if (node?.operation !== 'data') continue
      const d: N = {}
      for (const [k, v] of Object.entries(node.data ?? {})) {
        if (k === 'hit') continue
        d[k] = ser(v)
      }
      if (Object.keys(d).length) out[`${group}.${name}`] = d
    }
  }
  return out
}

test('gb-kit: the Waverider sheets as trees', () => {
  const weaponNames = JSON.parse(readFileSync(join(LOC, 'weaponNames_gen.json'), 'utf8'))
  const setNames = JSON.parse(readFileSync(join(LOC, 'artifactNames_gen.json'), 'utf8'))
  const characters: N = {}
  const travelers = new Set<string>(allTravelerKeys)
  for (const key of allCharacterKeys) {
    let sheet: N
    try {
      sheet = getCharSheet(key as never, 'F')
    } catch {
      continue
    }
    if (!sheet) continue
    characters[key] = {
      sheet: travelers.has(key) ? `${key}F` : key,
      effects: effectsOf(sheet.data),
      hit_data: hitDataOf(sheet.data.display),
    }
  }
  const weapons: N = {}
  for (const key of allWeaponKeys) {
    const sheet = getWeaponSheet(key as never)
    if (!sheet) continue
    const stat: N = getWeaponStat(key as never)
    // its base ATK and substat at level 90, ascension 6, as the weapon's data layer makes them (the stat's base times its curve at the
    // level, plus the ascension's ATK); the wiki's numbers that the app's reference holds are these, rounded
    const curve = (s: N) => (allStats.weapon.expCurve as N)[s.curve][90]
    weapons[key] = {
      name: weaponNames[key] ?? null,
      type: stat?.weaponType ?? null,
      rarity: stat?.rarity ?? null,
      // 1- and 2-star weapons stop at level 70 (ascension 4): they have no numbers at 90
      level_90: stat?.mainStat && (stat.rarity ?? 0) >= 3 ? {
        main: stat.mainStat.base * curve(stat.mainStat) + (stat.ascensionBonus?.atk?.[6] ?? 0),
        sub: stat.subStat?.type ? stat.subStat.base * curve(stat.subStat) : null,
        sub_key: stat.subStat?.type ?? null,
      } : null,
      effects: effectsOf(sheet.data),
      hit_data: hitDataOf(sheet.data.display),
    }
  }
  const sets: N = {}
  for (const key of allArtifactSetKeys) {
    const sheet = getArtSheet(key as never)
    if (!sheet) continue
    sets[key] = { name: setNames[key] ?? null, effects: effectsOf(sheet.data), hit_data: hitDataOf(sheet.data.display) }
  }
  const dir = process.env['GB_OUT_DIR'] ?? '.'
  writeFileSync(join(dir, 'gb-kit.json'), JSON.stringify({ characters, weapons, sets }))
  console.log(
    'GB-KIT ' +
      JSON.stringify({
        characters: Object.keys(characters).length,
        weapons: Object.keys(weapons).length,
        sets: Object.keys(sets).length,
      })
  )
})

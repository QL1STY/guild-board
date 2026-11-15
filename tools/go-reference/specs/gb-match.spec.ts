/**
 * Guild Board's hit matcher (tools/go-reference, Guild Board's own file, MIT).
 *
 * run.py copies it into a Genshin Optimizer checkout's libs/gi/pando-parity/src/ and runs it there with vitest. For
 * every damage hit of every Waverider character sheet it writes what the hit is (its move, its element, whether it is
 * a Lunar or Stellar hit and of which kind), its formula as a plain tree, and the datamined parameter its multiplier
 * array is (list identity with `skillParam`, restricted to the hit's own talent), with the in-game rows that print that
 * parameter (GO's `skillParamsEncoding`). run.py matches those rows to HoYoLAB's and the wiki's by name and value. The
 * row names are used as match keys only; no other localisation text is written.
 *
 * Output: $GB_OUT_DIR/gb-match.json (default: the checkout's root).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { allCharacterKeys, allTravelerKeys } from '@genshin-optimizer/gi/consts'
import { getCharSheet } from '@genshin-optimizer/gi/sheets'
import { allStats, getCharEle, getCharStat } from '@genshin-optimizer/gi/stats'
import { damagesIn, ser, walk } from './gb-tree'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any
const LOC = join(__dirname, '../../dm-localization/assets/locales/en')
const VARIANTS = ['lunarcharged', 'lunarbloom', 'lunarcrystallize', 'stellarconduct', 'stellarswirl']
const TALENT_OF: Record<string, string> = {
  normal: 'auto', charged: 'auto', plunging: 'auto', plunging_collision: 'auto', plunging_impact: 'auto',
  skill: 'skill', burst: 'burst',
}

const same = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9)

function rowsOf(loc: N) {
  const out: N = {}
  for (const t of ['auto', 'skill', 'burst']) {
    const names = loc?.[t]?.skillParams ?? {}
    const enc = loc?.[t]?.skillParamsEncoding ?? {}
    out[t] = Object.keys(enc)
      .filter((r) => names[r])
      .map((r) => ({
        row: Number(r),
        name: names[r],
        enc: enc[r],
        params: [...String(enc[r]).matchAll(/\{\{(\d+)[,}]/g)].map((m) => Number(m[1])),
      }))
  }
  return out
}

test('gb-match: hits to parameters to rows', () => {
  const out: N = {}
  const names = JSON.parse(readFileSync(join(LOC, 'charNames_gen.json'), 'utf8'))
  const travelers = new Set<string>(allTravelerKeys)
  for (const key of allCharacterKeys) {
    const sheetKey = travelers.has(key) ? `${key}F` : key
    let sheet: N
    try {
      sheet = getCharSheet(key as never, 'F')
    } catch {
      continue
    }
    if (!sheet) continue
    const sp = (allStats.char.skillParam as N)[sheetKey] ?? {}
    const file = join(LOC, `char_${sheetKey}_gen.json`)
    const loc = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
    const stat: N = getCharStat(key as never)
    const hits: N[] = []
    for (const [group, entries] of Object.entries(sheet.data.display ?? {}) as [string, N][]) {
      if (['basic', 'reaction', 'nicole', 'moonsign'].includes(group)) continue
      for (const [name, shown] of Object.entries(entries ?? {}) as [string, N][]) {
        // a hit can be shown only in a state (Sandrone's Stellar hits: equal(a0StellarRadianceSc, 'on', hit)): the gates
        // it sits behind are written beside it. A display entry with a damage node in more than one branch gives a hit for each; the later
        // ones are named `<name>~<n>` and say which entry GO evaluates for them (`shown`)
        let emitted = 0
        for (const { node, gates } of damagesIn(shown)) {
          const hitName = emitted === 0 ? name : `${name}~${emitted}`
          let variant: string | null = null
          let resist: string | null = null
          walk(node, (n) => {
            if (n.operation !== 'read') return
            const last = String(n.path?.[n.path.length - 1] ?? '')
            const v = VARIANTS.find((x) => last === `${x}_baseDmg_`)
            if (v) variant = v
            const r = /^(\w+)_resMulti_$/.exec(last)
            if (r && n.path[0] === 'enemy') resist = r[1]
          })
          const ordinary = node.operands?.[0]?.operation === 'read' && node.operands[0].path.join('.') === 'hit.dmg'
          if (!ordinary && !variant) continue // heals, shields, buffs shown as numbers
          const hit = node.data?.hit ?? {}
          const move = hit.move?.operation === 'const' ? hit.move.value : null
          const ele = hit.ele?.operation === 'const' ? hit.ele.value : null // null: inferred from move and weapon
          // an element a state decides (Aloy's Rushing Ice, Yoimiya's Niwabi Fire-Dance): the tree, which run.py reads as an infusion
          const eleTree = hit.ele && hit.ele.operation !== 'const' ? ser(hit.ele) : null
          const formula = ordinary ? hit.base : node.operands[0]
          if (ordinary && hit.base === undefined) continue
          const lists: (readonly number[])[] = []
          walk(formula, (n) => {
            if (n.operation === 'subscript' && Array.isArray(n.list)) lists.push(n.list)
          })
          const own = move ? [TALENT_OF[move]] : TALENT_OF[group] ? [TALENT_OF[group]] : []
          const params: N[] = []
          for (const talents of [own, ['auto', 'skill', 'burst']]) {
            for (const t of talents) {
              ;((sp[t] ?? []) as N[]).forEach((p: N, i: number) => {
                if (Array.isArray(p) && lists.some((l) => same(l, p)) && !params.some((x) => x.talent === t && x.index === i))
                  params.push({ talent: t, index: i, levels: p })
              })
            }
            if (params.length) break
          }
          // a hit GO never lets trigger the party's reaction (the plunge's collision, Hu Tao's Blood Blossom): `hit.reaction` ''
          const reacts = !(hit.reaction?.operation === 'const' && hit.reaction.value === '')
          hits.push({ group, name: hitName, ...(emitted ? { shown: `${group}.${name}` } : {}), move, ele, ele_tree: eleTree, variant, resist, ordinary, reacts, params, gates, formula: ser(formula) })
          emitted += 1
        }
      }
    }
    out[key] = {
      sheet: sheetKey,
      name: travelers.has(key) ? null : names[key] ?? null,
      element: getCharEle(key as never),
      weapon_type: stat?.weaponType ?? null,
      rarity: stat?.rarity ?? null,
      // her innate stats (Mitya's 100 EM, Kokomi's Healing Bonus): her own, like base HP, so on HoYoLAB's panel
      base_stats: stat?.baseStats ?? null,
      rows: rowsOf(loc),
      // every talent parameter per level, so that run.py finds the row a buff's multiplier is (Hu Tao's ATK Increase)
      params: Object.fromEntries(
        ['auto', 'skill', 'burst'].map((t) => [t, ((sp[t] ?? []) as N[]).map((p) => (Array.isArray(p) ? p : null))])
      ),
      hits,
    }
  }
  const dir = process.env['GB_OUT_DIR'] ?? '.'
  writeFileSync(join(dir, 'gb-match.json'), JSON.stringify(out))
  console.log('GB-MATCH ' + Object.keys(out).length)
})

/**
 * What each of her toggles does to her main talents' damage in the standard build (tools/go-reference/sheet.py, the decision
 * sheet). Runs only when sheet.py sets GB_TOGGLES_IN (a fixture of compare-cases.json's shape holding the characters to look at,
 * with the hits blocks as the core builds them now) and GB_TOGGLES_OUT: for each character, every toggle of hers switched on alone (and with the states an effect of it needs beside it)
 * against all of hers off, the change of each main talent's counted rows and of each row, and the toggles she has on now together.
 * It is our own engine (damage.ts) on the same builds the comparison with Genshin Optimizer uses; nothing here is a second engine.
 */
import { describe, expect, test } from 'vitest'
import { buckets, countedRows, noChoice, resolveParty, rowDamage, type Choice } from './damage.ts'
import { worldOf, type Fixture, type World } from './comparison.ts'

const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const input = env['GB_TOGGLES_IN']
const output = env['GB_TOGGLES_OUT']

type Rows = Record<string, number>
type Result = {
  /** each counted row's damage (average crit) with all her toggles off, `talent|row` */
  baseline: Rows
  /** the change in percent of each main talent's counted rows, by toggle name (alone), and "(decided)" for the ones she has on */
  toggles: Record<string, { talents: Record<string, number | null>; rows: Record<string, number> }>
  /** for a toggle some effect of which needs other states: the change with those on beside it (`with`) */
  together: Record<string, { with: string[]; talents: Record<string, number | null>; rows: Record<string, number> }>
  decided: string[]
}

/** The damage of each counted row of her main talents, with exactly the toggles `on` on (all of hers; the weapon's and sets' are off). */
function damages(world: World, key: string, on: string[]): Rows {
  const c = world.cases.find((x) => x.character === key)!
  const toggles = Object.fromEntries(world.kits[key].toggles.map((t) => [t.name, on.includes(t.name)]))
  const choice: Choice = { ...noChoice(), toggles }
  // her usual team: a row that takes the team's element is a row of each of its elements
  const hits = resolveParty(world.kits[key], choice)
  const b = buckets(c.panel_a!, hits, c.weapon!, c.sets!, choice, { base: c.base! })
  const out: Rows = {}
  for (const t of hits.talents) {
    if (!t.main) continue
    for (const row of countedRows(t)) out[`${t.key}|${row.name}`] = (out[`${t.key}|${row.name}`] ?? 0) + rowDamage(row, t, b, hits, world.tables, choice)
  }
  return out
}

/** Each main talent's change, the sum of its counted rows, and each row's change, in percent. */
function change(before: Rows, after: Rows): { talents: Record<string, number | null>; rows: Record<string, number> } {
  const sums: Record<string, [number, number]> = {}
  const rows: Record<string, number> = {}
  for (const [name, was] of Object.entries(before)) {
    const talent = name.split('|')[0]
    const now = after[name]
    sums[talent] = [(sums[talent]?.[0] ?? 0) + was, (sums[talent]?.[1] ?? 0) + now]
    if (was > 0 && Math.abs(now / was - 1) > 1e-9) rows[name] = (now / was - 1) * 100
  }
  const talents = Object.fromEntries(Object.entries(sums).map(([t, [was, now]]) => [t, was > 0 ? (now / was - 1) * 100 : null]))
  return { talents, rows }
}

describe.skipIf(input === undefined || output === undefined)('her toggles on the standard build, for sheet.py', () => {
  test('write them', async () => {
    type Files = { writeFileSync: (path: string, text: string) => void; readFileSync: (path: string, encoding: string) => string }
    const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as Files
    const world = worldOf(JSON.parse(fs.readFileSync(input!, 'utf8')) as Fixture)
    const result: Record<string, Result> = {}
    for (const key of [...new Set(world.cases.map((c) => c.character))]) {
      const hits = world.kits[key]
      const base = damages(world, key, [])
      const toggles: Result['toggles'] = {}
      const together: Result['together'] = {}
      // a toggle on alone, and, when an effect of it needs other states (`also`: Yoimiya's Pyro bonus needs her Skill's state and its stacks), with them beside it
      const partners = (name: string): string[] => [...new Set(hits.effects.filter((e) => e.also?.length && (e.while === name || e.also.includes(name)))
        .flatMap((e) => [e.while, ...(e.also ?? [])]).filter((other): other is string => !!other && other !== name))]
      for (const t of hits.toggles) {
        toggles[t.name] = change(base, damages(world, key, [t.name]))
        const beside = partners(t.name)
        if (beside.length > 0) together[t.name] = { with: beside, ...change(base, damages(world, key, [t.name, ...beside])) }
      }
      const decided = hits.toggles.filter((t) => t.on).map((t) => t.name)
      if (decided.length > 0) toggles['(decided)'] = change(base, damages(world, key, decided))
      result[key] = { baseline: base, toggles, together, decided }
    }
    fs.writeFileSync(output!, JSON.stringify(result))
    expect(Object.keys(result).length).toBeGreaterThan(0)
  })
})

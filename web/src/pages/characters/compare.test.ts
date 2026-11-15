/**
 * The damage engine against Genshin Optimizer's Waverider for every character with a kit (the Plan design, 14.6). The cases and
 * GO's answers are in compare-cases.json, which tools/go-reference/run.py compare writes: for each character a standard build of
 * her weapon type and two swaps (the sands to Elemental Mastery, the goblet to her scaling stat), a few with a reaction on. A character
 * whose decided states, rows or constellation effects need a constellation has the same swaps again at it (`yanfei:goblet@c6`), on her
 * kit there, and a third one (the circlet's CRIT DMG to CRIT Rate) where a constellation gives CRIT. Here our engine runs on the same
 * builds: each main talent's change must be GO's within 0.05 percentage points (unless her kit is marked unsure, with the reason), and
 * must stay what it was when the answers were pinned, so a later change that moves one
 * fails. With GB_COMPARE_OUT set (run.py does it) our answers and each row's damage are written there instead.
 */
import { describe, expect, test } from 'vitest'
import fixture from '../../fixtures/compare-cases.json'
import { ours, worldOf, type Fixture } from './comparison.ts'

// The interface's sources are typed without Node's; run.py's one write goes through Node's own module, loaded by name at run time.
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const out = env['GB_COMPARE_OUT']
const world = worldOf(fixture as unknown as Fixture)
const cases = world.cases
const gearCases = world.gearCases
const kits = world.kits

describe.skipIf(out !== undefined)('our engine against Genshin Optimizer', () => {
  test('every case has GO\'s answer and a pinned one of ours', () => {
    expect(cases.length).toBeGreaterThan(200)
    for (const c of cases) {
      expect(c.go, c.id).toBeDefined()
      expect(c.ours, c.id).toBeTruthy()
    }
  })

  test('the cases at a constellation run on their own hits block, her kit there', () => {
    const high = cases.filter((c) => c.kit !== undefined)
    expect(high.length).toBeGreaterThanOrEqual(30)
    for (const c of high) {
      expect(c.id, c.id).toMatch(/@c[1-6]$/)
      expect(kits[c.kit!], c.id).toBeDefined()
      expect(c.kit).toBe(`${c.character}@c${c.constellation}`)
    }
    // Yanfei's Charged Attack with four Scarlet Seals is Constellation 6's: counted in her kit there, not in her kit at 0
    const counted = (name: string): boolean | undefined => kits[name].talents[0].rows.find((row) => row.name === 'Charged Attack (5 of 5)')?.main
    expect(counted('yanfei')).toBe(false)
    expect(counted('yanfei@c6')).toBe(true)
  })

  test.each(cases.map((c) => [c.id, c] as const))('%s agrees with GO and with its pinned answer', (_id, c) => {
    const got = ours(world, c).talents
    expect(Object.keys(got).sort()).toEqual(Object.keys(c.ours!.talents).sort())
    for (const [talent, change] of Object.entries(got)) {
      const pinned = c.ours!.talents[talent]
      if (change === null || pinned === null) expect(change).toBe(pinned)
      else expect(Math.abs(change - pinned), `${talent} moved from its pinned ${pinned}`).toBeLessThan(1e-6)
      const theirs = c.go!.talents[talent]
      if (kits[c.character].unsure) continue
      expect(theirs === null || theirs === undefined, `${talent}: GO has no answer`).toBe(change === null)
      if (change !== null && theirs !== null && theirs !== undefined) {
        expect(Math.abs(change - theirs), `${talent}: ours ${change}, GO ${theirs}`).toBeLessThanOrEqual(world.tolerance)
      }
    }
  })
})

describe.skipIf(out !== undefined)('our engine on a weapon or set swap, as the planner runs it', () => {
  test('there are the weapon and set swaps, each with GO answers and a pinned one of ours', () => {
    const ids = gearCases.map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining([
      'ganyu:set:wanderer-s-troupe', 'hu-tao:set:crimson-witch-of-flames', 'hu-tao:set:crimson-witch-of-flames:on',
      'hu-tao:weapon:deathmatch', 'hu-tao:weapon:deathmatch:on', 'raiden-shogun:set:emblem-of-severed-fate', 'raiden-shogun:set:emblem-of-severed-fate:on',
      'raiden-shogun:weapon:the-catch', 'raiden-shogun:weapon:the-catch:on', 'nahida:weapon:kagura-s-verity', 'nahida:weapon:kagura-s-verity:on',
    ]))
    // and a swap to each weapon or set a decision file turns a toggle on (compare.py's DECIDED_GEAR_CASES: 26 weapons and 3 sets), at the
    // planner's start and, where it turns on something more, with every toggle on
    // and Nahida's swap to Kagura's Verity, an undecided toggle of three states, on at the third
    expect(ids.filter((id) => !id.endsWith(':on')).length).toBe(5 + 1 + 29)
    for (const id of ids) if (id.endsWith(':on')) expect(ids, id).toContain(id.slice(0, -3))
    for (const c of gearCases) {
      expect(c.go, c.id).toBeDefined()
      expect(c.ours, c.id).toBeTruthy()
    }
  })

  test('the planner answer of a case holds the worn gear only: the tested weapon and set bring theirs', () => {
    for (const c of gearCases) {
      const g = c.swap_gear!
      expect(Object.keys(g.hits.weapon_effects), c.id).toEqual([c.weapon!.key])
      expect(Object.keys(g.hits.set_effects), c.id).toEqual([c.sim_set])
      const tested = c.swap === 'weapon' ? g.weapon_b : g.set_b
      expect(tested.key, c.id).toBe(c.id.split(':')[2])
    }
  })

  test.each(gearCases.map((c) => [c.id, c] as const))('%s agrees with GO and with its pinned answer', (_id, c) => {
    const got = ours(world, c).talents
    expect(Object.keys(got).sort()).toEqual(Object.keys(c.ours!.talents).sort())
    for (const [talent, change] of Object.entries(got)) {
      const pinned = c.ours!.talents[talent]
      if (change === null || pinned === null) expect(change).toBe(pinned)
      else expect(Math.abs(change - pinned), `${talent} moved from its pinned ${pinned}`).toBeLessThan(1e-6)
      const theirs = c.go!.talents[talent]
      if (kits[c.character].unsure) continue
      expect(theirs === null || theirs === undefined, `${talent}: GO has no answer`).toBe(change === null)
      if (change !== null && theirs !== null && theirs !== undefined) {
        expect(Math.abs(change - theirs), `${talent}: ours ${change}, GO ${theirs}`).toBeLessThanOrEqual(world.tolerance)
      }
    }
  })
})

describe.skipIf(out === undefined)('our answers for run.py', () => {
  test('write them', async () => {
    type Files = { writeFileSync: (path: string, text: string) => void; readFileSync: (path: string, encoding: string) => string }
    const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as Files
    // `run.py compare --only` has our engine run on its own partial fixture (GB_COMPARE_FIXTURE), never on the committed one.
    const other = env['GB_COMPARE_FIXTURE']
    const mine = other ? worldOf(JSON.parse(fs.readFileSync(other, 'utf8')) as Fixture) : world
    fs.writeFileSync(out!, JSON.stringify(Object.fromEntries([...mine.cases, ...mine.gearCases].map((c) => [c.id, ours(mine, c)]))))
  })
})

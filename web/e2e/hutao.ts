import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import type { PlannerHits } from '../src/types.ts'

/*
 * Hu Tao's planner for the tests that the demo cannot make: the demo has Sandrone only. The kit is the core's own block for her
 * (`web/src/fixtures/damage-kits.json`, made by tools/make-damage-fixtures.py from Genshin Optimizer's sheets), the build is the
 * one Genshin Optimizer was measured on (Staff of Homa, Crimson Witch of Flames, 90 / 10 / 10 / 10) with its own stats, and the
 * swap is the one it ran: an HP% sands for an ATK% sands, where Paramita Papilio on makes every hit softer (-5.291%) and off makes
 * them harder (+20.295%). Everything else of the page is the demo's answer for Sandrone.
 */
const fixture = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'fixtures', 'damage-kits.json'), 'utf-8'),
) as { kits: Record<string, PlannerHits> }

/** Genshin Optimizer's own numbers for the build (damage.test.ts holds the same). */
const PANEL = { hp: 32245.3734902136, atk: 1096.95987503, def: 0, em: 40, er: 110, cr: 35, cd: 276.7536, dmg: 61.6, heal: 0, physical: 0 }
const BASE = { hp: 15552.3066196, atk: 714.5089773, def: 0 }
const SET = 'crimson-witch-of-flames'

type Model = {
  name: string
  element: string
  sim: {
    panel: typeof PANEL; base: typeof BASE; char_base_atk: number; hits: PlannerHits | null
    weapon: Record<string, unknown>; sets: Record<string, unknown>[]
    pieces: { slot: string; set_key: string; main: string; main_value: number }[]
  }
}

/** The demo's answer for Sandrone, made into Hu Tao's: her kit, her weapon and set, her stats, an HP% sands. */
export function huTao(model: Model, over: { recommended?: string[] } = {}): Model {
  const hits = structuredClone(fixture.kits['hu-tao'])
  if (over.recommended !== undefined) hits.recommended = over.recommended
  model.name = 'Hu Tao'
  model.element = 'Pyro'
  const sim = model.sim
  sim.hits = hits
  sim.panel = { ...PANEL }
  sim.base = { ...BASE }
  sim.char_base_atk = BASE.atk - 608
  sim.weapon = { key: 'staff-of-homa', name: 'Staff of Homa', icon: null, type: 'Polearm', rarity: 5, level: 90, refinement: 1, base_atk: 608, sub: 'cd', sub_value: 66.2 }
  sim.sets = [{ key: SET, name: 'Crimson Witch of Flames', icon: null, pieces: 5, two: [{ stat: 'dmg', value: 15 }], two_text: 'Pyro DMG Bonus +15%.', four_text: 'Increases Overloaded and Burning DMG by 40%. Increases Vaporize and Melt DMG by 15%. When an Elemental Skill hits an opponent, the Pyro DMG Bonus from this artifact set will increase by 50% of its starting value for 10s. Max 3 stacks.' }]
  for (const piece of sim.pieces) piece.set_key = SET
  const sands = sim.pieces.find((piece) => piece.slot === 'sands')!
  sands.main = 'hp_pct'
  sands.main_value = 46.6
  return model
}

/** Answers the planner's read of `character` with Hu Tao's page. */
export async function asHuTao(page: Page, character: string, over: { recommended?: string[] } = {}): Promise<void> {
  await page.route(new RegExp(`/api/characters/${character}/plan$`), async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, json: huTao((await response.json()) as Model, over) })
  })
}

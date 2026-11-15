import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import type { PlannerHits } from '../src/types.ts'

/*
 * Lauma's planner for the pictures that the demo cannot make: the demo has Sandrone only, and Lauma is the Lunar character (Lunar-Bloom
 * hits that scale with Elemental Mastery). The kit is the core's own block for her (`web/src/fixtures/damage-kits.json`), the build and
 * the numbers are the comparison's case `lauma:goblet` (`web/src/fixtures/compare-cases.json`, Genshin Optimizer's own stats for
 * her): Lost Prayer to the Sacred Winds, Gladiator's Finale, an Elemental Mastery sands, a Dendro DMG Bonus goblet and a Crit DMG
 * circlet. Everything else of the page is the demo's answer for Sandrone, as hutao.ts does for Hu Tao.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const kits = JSON.parse(readFileSync(path.join(here, '..', 'src', 'fixtures', 'damage-kits.json'), 'utf-8')) as { kits: Record<string, PlannerHits> }
const compare = JSON.parse(readFileSync(path.join(here, '..', 'src', 'fixtures', 'compare-cases.json'), 'utf-8')) as {
  cases: { id: string; panel_a: Record<string, number>; base: { hp: number; atk: number; def: number }; weapon: { base_atk: number } }[]
}
const CASE = compare.cases.find((item) => item.id === 'lauma:goblet')!
const SET = 'gladiator-s-finale'

type Model = {
  name: string
  element: string
  sim: {
    panel: Record<string, number>; base: Record<string, number>; char_base_atk: number; hits: PlannerHits | null
    weapon: Record<string, unknown>; sets: Record<string, unknown>[]
    pieces: { slot: string; set_key: string; main: string; main_value: number }[]
  }
}

/** The demo's answer for Sandrone, made into Lauma's. */
export function lauma(model: Model): Model {
  model.name = 'Lauma'
  model.element = 'Dendro'
  const sim = model.sim
  sim.hits = structuredClone(kits.kits.lauma)
  sim.panel = { ...CASE.panel_a }
  sim.base = { ...CASE.base }
  sim.char_base_atk = CASE.base.atk - CASE.weapon.base_atk
  sim.weapon = {
    key: 'lost-prayer-to-the-sacred-winds', name: 'Lost Prayer to the Sacred Winds', icon: null, type: 'Catalyst', rarity: 5, level: 90,
    refinement: 1, base_atk: Math.round(CASE.weapon.base_atk), sub: 'cr', sub_value: 33.1,
  }
  sim.sets = [{
    key: SET, name: "Gladiator's Finale", icon: null, pieces: 5, two: [{ stat: 'atk_pct', value: 18 }], two_text: 'ATK +18%.',
    four_text: 'If the wielder of this artifact set uses a Sword, Claymore or Polearm, increases their Normal Attack DMG by 35%.',
  }]
  for (const piece of sim.pieces) piece.set_key = SET
  const mains: Record<string, [string, number]> = { sands: ['em', 187], goblet: ['dmg', 46.6], circlet: ['cd', 62.2] }
  for (const piece of sim.pieces) {
    const main = mains[piece.slot]
    if (main) [piece.main, piece.main_value] = main
  }
  return model
}

/** Answers the planner's read of `character` with Lauma's page. */
export async function asLauma(page: Page, character: string): Promise<void> {
  await page.route(new RegExp(`/api/characters/${character}/plan$`), async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, json: lauma((await response.json()) as Model) })
  })
}

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import fixture from '../../fixtures/characters/planner.json'
import type { Planner, PlannerSim } from '../../types.ts'
import { PieceEditor } from './PieceEditor.tsx'
import { fromHer } from './simulator.ts'

const sim = (fixture as unknown as Planner).sim as PlannerSim
const model = fixture as unknown as Planner

test('a substat whose stat has no roll table shows its value with no tier buttons, and does not break the page', () => {
  const her = sim.pieces[2]
  const piece = fromHer({ ...her, subs: [{ stat: 'dmg', value: 7.5, tiers: [] }, ...her.subs.slice(1)] })
  const markup = renderToStaticMarkup(
    createElement(PieceEditor, { sim, slot: 'sands', piece, hers: her, icon: null, element: model.element, pronouns: model.pronouns, onChange: () => undefined, onBack: () => undefined }),
  )
  expect(markup).toContain('value="7.5"')
  // Three substats have four tier buttons each (and a minus); the one without a table has only its minus.
  expect(markup.match(/title="Add a \d+% roll"/g)).toHaveLength(12)
})

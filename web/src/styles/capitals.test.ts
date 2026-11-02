import { expect, test } from 'vitest'
import achievements from './achievements.css?raw'
import backlog from './backlog.css?raw'
import commissions from './commissions.css?raw'
import characters from '../pages/characters/characters.css?raw'
import elements from '../pages/characters/elements.css?raw'
import planner from '../pages/characters/planner.css?raw'
import profile from '../pages/characters/profile.css?raw'
import roster from '../pages/characters/roster.css?raw'
import card from '../pages/characters/card.css?raw'
import endgame from '../pages/characters/endgame.css?raw'
import week from '../pages/characters/week.css?raw'
import ledger from './ledger.css?raw'
import marks from './marks.css?raw'
import timers from './timers.css?raw'
import widgets from './widgets.css?raw'

// Stylesheets are read as text with Vite's ?raw (vite.config.ts lets those through), as contrast.test.ts reads them.

// The look pass counts all-caps labels among its anti-goals (spec 3) and takes the small capitals out of the headings
// (spec 5): the stylesheets of the widgets and of the pages it rebuilt set no text in capitals.
test.each([
  ['widgets.css', widgets],
  ['marks.css', marks],
  ['achievements.css', achievements],
  ['timers.css', timers],
  ['commissions.css', commissions],
  ['backlog.css', backlog],
  ['ledger.css', ledger],
  ['elements.css', elements], // the Characters plan, Task U1
  ['characters.css', characters],
  ['roster.css', roster],
  ['profile.css', profile],
  ['planner.css', planner],
  ['week.css', week],
  ['endgame.css', endgame],
  ['card.css', card],
])('%s sets no text in capitals', (_, css) => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  expect(plain).not.toMatch(/text-transform:\s*uppercase/)
  expect(plain).not.toMatch(/font-variant(-caps)?:[^;]*small-caps/)
})

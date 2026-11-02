import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import profileFixture from '../../fixtures/characters/profile.json'
import type { Profile } from '../../types.ts'
import { contrast } from '../../styles/contrast.ts'
import { CardBody, CardFoot } from './CardPanel.tsx'
import type { CardExtra } from './cardview.ts'
import css from './card.css?raw'

const profile = profileFixture as unknown as Profile
const card: CardExtra = profile.card
const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of a rule of card.css with exactly this selector. */
function ruleOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(plain)?.[1] ?? ''
}

const draw = (edited: string[] = [], onEdit: (body: Record<string, unknown>) => void = () => undefined) =>
  renderToStaticMarkup(
    createElement(CardBody, { profile: { ...profile, card: { ...profile.card, edited } }, card, onEdit, onBack: () => undefined }),
  )

test('the panel has a section for each group of the card, and what the card says without editing', () => {
  const markup = draw()
  for (const label of ['Role', 'Goals', 'Main stats', 'Substats', 'Sets', 'Weapons', 'Partners', 'Pronouns', 'What the card says']) {
    expect(markup).toContain(`aria-label="${label}"`)
  }
  expect(markup).toContain('Sandrone is a Cryo damage dealer')
  expect(markup).toContain('HoYoLAB wiki build guide')
})

test('the card\'s goals, weapons and sets show as the card has them, best first', () => {
  const markup = draw()
  expect(markup).toMatch(/<span>Crit Rate<\/span><input[^>]*value="75"/)
  expect(markup).toMatch(/<span>ATK<\/span><input[^>]*value="2600"/)
  expect(markup.indexOf('A Teaspoon of Transcendence')).toBeLessThan(markup.indexOf('A Thousand Blazing Suns'))
  expect(markup).toContain('4 pieces: Disenchantment in Deep Shadow')
  expect(markup).toContain('2 and 2: Disenchantment in Deep Shadow, Blizzard Strayer')
})

test('an edited field is marked yours and has its own "Back to the card"; the others have neither', () => {
  expect(draw().match(/Back to the card/g)).toBeNull()
  expect(draw().match(/class="cp-yours"/g)).toBeNull()
  const markup = draw(['goals', 'partners'])
  expect(markup.match(/Back to the card/g)).toHaveLength(2)
  // Each edit says "yours" once: Goals is a group of one field, so its heading carries the mark and the way back; Partners has two
  // fields, and the one that was edited carries them.
  expect(markup.match(/class="cp-yours"/g)).toHaveLength(2)
  expect(markup).toMatch(/data-group="goals"[\s\S]*?cp-yours[\s\S]*?Back to the card[\s\S]*?data-group="mains"/)
  expect(markup).toMatch(/data-field="partners"[\s\S]*?cp-yours[\s\S]*?Back to the card/)
})

test('a group of one field has no second heading, so Goals is said once and its field is not named again', () => {
  const markup = draw(['goals'])
  expect(markup.match(/<h3>Goals/g)).toHaveLength(1)
  expect(markup.match(/<b>Goals<\/b>/g)).toBeNull()
  expect(markup).toContain('<b>Roles</b>') // a group of several fields names each
})

test('Back to the card for everything ends the panel, and shows only while something is edited', () => {
  const foot = (edited: string[]) => renderToStaticMarkup(createElement(CardFoot, { edited, onBackAll: () => undefined }))
  expect(foot([])).toBe('')
  expect(foot(['goals'])).toMatch(/<footer class="cp-foot"><button[^>]*>Back to the card<\/button><\/footer>/)
  expect(draw(['goals'])).not.toContain('class="cp-foot"')
})

test('the three Main stats columns share one width and their add controls sit on one line, at the foot of each', () => {
  expect(ruleOf('.cp-slots')).toMatch(/repeat\(3, minmax\(0, 1fr\)\)/)
  expect(ruleOf('.cp-slot')).toMatch(/display:\s*flex/)
  expect(ruleOf('.cp-slot')).toMatch(/flex-direction:\s*column/)
  // The add control is the last child of its list, so the list is the column that carries it down to the foot.
  expect(ruleOf('.cp-slot .cp-list')).toMatch(/display:\s*flex/)
  expect(ruleOf('.cp-slot .cp-list')).toMatch(/flex:\s*1/)
  expect(ruleOf('.cp-slot .cp-add')).toMatch(/margin-top:\s*auto/)
  expect(ruleOf('.cp-add select')).toMatch(/min-width:\s*0/)
})

test('a button to put the weapons or the sets out of the card\'s order is a button of its own, all the same size', () => {
  expect(ruleOf('.cp-mini')).toMatch(/width:\s*26px/)
  expect(ruleOf('.cp-mini')).toMatch(/height:\s*26px/)
  expect(ruleOf('.cp-back')).toMatch(/height:\s*26px/)
  expect(ruleOf('.cp-wbtn')).toMatch(/width:\s*92px/)
  expect(ruleOf('.cp-actions .gb-btn')).toMatch(/min-width:\s*150px/)
})

test('the window keeps one height, its body scrolls, and nothing in it is moved by a transform that is animated', () => {
  expect(ruleOf('.cp-wrap')).toMatch(/height:\s*min\(860px, calc\(100vh/)
  expect(ruleOf('.cp-body')).toMatch(/overflow-y:\s*auto/)
  expect(plain).not.toMatch(/zoom:/)
  expect(plain).not.toMatch(/animation|transition:[^;]*transform/)
})

test('the text of card.css reaches 4.5:1 on its grounds', () => {
  expect(contrast('#7A5418', '#F1E3C2')).toBeGreaterThanOrEqual(4.5)
  expect(contrast('#7A5418', '#FBF7EE')).toBeGreaterThanOrEqual(4.5)
})

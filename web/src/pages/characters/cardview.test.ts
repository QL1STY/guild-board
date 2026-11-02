import { expect, test } from 'vitest'
import profileFixture from '../../fixtures/characters/profile.json'
import type { Profile } from '../../types.ts'
import {
  addItem, backBody, type CardExtra, cardPath, goalBody, checkedLine, editBody, fieldIsYours, GROUPS, goalRows, groupYours, moveItem, PRONOUN_PRESETS,
  pronounsIndex, removeItem, ROLES, roleToggle, setChoice,
} from './cardview.ts'

const profile = profileFixture as unknown as Profile
const card: CardExtra = profile.card

test('each group of the panel has the fields of a card that belong to it, and every field of a card is in one group', () => {
  expect(GROUPS.map((group) => group.key)).toEqual(['role', 'goals', 'mains', 'substats', 'sets', 'weapons', 'partners', 'pronouns'])
  const fields = Object.fromEntries(GROUPS.map((group) => [group.key, group.fields]))
  expect(fields.role).toEqual(['roles', 'keeps_alive', 'scaling', 'damage_talent', 'talent_priority'])
  expect(fields.goals).toEqual(['goals'])
  expect(fields.mains).toEqual(['mains'])
  expect(fields.substats).toEqual(['weights'])
  expect(fields.sets).toEqual(['sets'])
  expect(fields.weapons).toEqual(['weapons'])
  expect(fields.partners).toEqual(['partners', 'partner_roles'])
  expect(fields.pronouns).toEqual(['pronouns'])
  expect(GROUPS.flatMap((group) => group.fields).sort()).toEqual(Object.keys(card.fields).sort())
})

test('an edited field is marked yours, and so is the group it belongs to', () => {
  const edited = ['goals', 'partners']
  expect(fieldIsYours(edited, 'goals')).toBe(true)
  expect(fieldIsYours(edited, 'weapons')).toBe(false)
  const yours = GROUPS.filter((group) => groupYours(edited, group)).map((group) => group.key)
  expect(yours).toEqual(['goals', 'partners'])
  expect(GROUPS.filter((group) => groupYours([], group))).toEqual([])
})

test('an edit sends the one field it changed, and "Back to the card" for a field sends null for it', () => {
  expect(cardPath('sandrone')).toBe('/api/characters/sandrone/card')
  expect(editBody('keeps_alive', true)).toEqual({ keeps_alive: true })
  expect(editBody('weapons', ['verdict'])).toEqual({ weapons: ['verdict'] })
  expect(backBody('goals')).toEqual({ goals: null })
})

test("a goal is sent alone: a number, with or without its percent sign, and an empty box takes that goal's edit away", () => {
  expect(goalBody('cr', '80')).toEqual({ goals: { cr: 80 } })
  expect(goalBody('cr', '80%')).toEqual({ goals: { cr: 80 } })
  expect(goalBody('dmg', '46,6')).toEqual({ goals: { dmg: 46.6 } })
  expect(goalBody('cr', '')).toEqual({ goals: { cr: null } })
  expect(goalBody('cr', 'a lot')).toBeNull()
  expect(goalBody('cr', '-5')).toBeNull()
  expect(goalBody('cr', '1000000')).toBeNull()
})

test('the goals listed are Crit Rate, Crit DMG, Energy Recharge, Elemental Mastery, her scaling stat and DMG Bonus', () => {
  const rows = goalRows(card.fields)
  expect(rows.map((row) => row.key)).toEqual(['cr', 'cd', 'er', 'em', 'atk', 'dmg'])
  expect(rows.map((row) => row.text)).toEqual(['75', '200', '130', '', '2600', '46.6'])
  expect(rows.map((row) => row.unit)).toEqual(['%', '%', '%', '', '', '%'])
  const hp = goalRows({ ...card.fields, scaling: 'hp' }).map((row) => row.key)
  expect(hp).toEqual(['cr', 'cd', 'er', 'em', 'hp', 'dmg'])
  expect(goalRows({ ...card.fields, scaling: 'em' }).map((row) => row.key)).toEqual(['cr', 'cd', 'er', 'em', 'dmg'])
})

test('an ordered list moves one place, loses an item or gains one at its end, and never holds one twice', () => {
  expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
  expect(removeItem(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  expect(addItem(['a'], 'b')).toEqual(['a', 'b'])
  expect(addItem(['a', 'b'], 'a')).toEqual(['a', 'b'])
})

test('a role is switched on or off, and at least one stays', () => {
  expect(ROLES).toEqual(['damage', 'support', 'healer', 'protector'])
  expect(roleToggle(['damage'], 'support')).toEqual(['damage', 'support'])
  expect(roleToggle(['damage', 'support'], 'damage')).toEqual(['support'])
  expect(roleToggle(['damage'], 'damage')).toEqual(['damage'])
})

test('a set choice is one set worn whole, or two worn two and two', () => {
  expect(setChoice(['blizzard-strayer'])).toEqual({ sets: ['blizzard-strayer'], pieces: '4' })
  expect(setChoice(['blizzard-strayer', 'scarlet-proof'])).toEqual({ sets: ['blizzard-strayer', 'scarlet-proof'], pieces: '2+2' })
})

test('the pronouns are one of three, as the game writes them, and the card says which', () => {
  expect(PRONOUN_PRESETS.map((preset) => preset.join('/'))).toEqual(['she/her/her', 'he/him/his', 'they/them/their'])
  expect(pronounsIndex(['he', 'him', 'his'])).toBe(1)
  expect(pronounsIndex(['xe', 'xem', 'xyr'])).toBe(2)
})

test('the panel says how sure the card is and when it was checked, or that it is only defaults', () => {
  expect(checkedLine('2026-10-20', 'high', false)).toBe('Checked 20 Oct 2026, high confidence.')
  expect(checkedLine(null, 'medium', false)).toBe('Medium confidence; no check date.')
  expect(checkedLine(null, 'none', false)).toBe('No researched card yet; these are defaults.')
  expect(checkedLine('2026-10-20', 'high', true)).toBe('Not out yet: this card is an early look. Checked 20 Oct 2026, high confidence.')
})

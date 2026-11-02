import type { Profile } from '../../types.ts'

/*
 * The Card panel (the Characters plan, Task U8; the design's section 6.7), as pure functions. The card is the character's
 * researched goals, sets, main stats, substats, weapons, role and partners; each field can be edited, and an edited field
 * is the player's own until "Back to the card". The profile carries the card (`Profile.card`); a change goes to
 * `PUT /api/characters/{key}/card` as the one field it changed, which the core answers with the new profile. A field sent
 * as `null` is back to the card. Goals are merged one at a time: `{goals: {cr: 60}}` changes Crit Rate alone, `{goals: {cr:
 * null}}` takes that goal's edit away, and `{goals: null}` all of them.
 */

/** The card as the profile carries it (types.ts), which the panel reads and edits field by field. */
export type CardFields = Profile['card']['fields']
export type CardExtra = Pick<Profile['card'], 'fields' | 'notes' | 'sources' | 'checked' | 'options'>

export type CardFieldName = keyof CardFields

export function cardPath(key: string): string {
  return `/api/characters/${key}/card`
}

export type Group = { key: 'role' | 'goals' | 'mains' | 'substats' | 'sets' | 'weapons' | 'partners' | 'pronouns'; label: string; fields: CardFieldName[] }

/** The panel's groups, in the design's order, and the fields of a card each one holds. */
export const GROUPS: readonly Group[] = [
  { key: 'role', label: 'Role', fields: ['roles', 'keeps_alive', 'scaling', 'damage_talent', 'talent_priority'] },
  { key: 'goals', label: 'Goals', fields: ['goals'] },
  { key: 'mains', label: 'Main stats', fields: ['mains'] },
  { key: 'substats', label: 'Substats', fields: ['weights'] },
  { key: 'sets', label: 'Sets', fields: ['sets'] },
  { key: 'weapons', label: 'Weapons', fields: ['weapons'] },
  { key: 'partners', label: 'Partners', fields: ['partners', 'partner_roles'] },
  { key: 'pronouns', label: 'Pronouns', fields: ['pronouns'] },
]

/** Whether the player edited a field. */
export function fieldIsYours(edited: readonly string[], field: CardFieldName): boolean {
  return edited.includes(field)
}

/** Whether the player edited any field of a group. */
export function groupYours(edited: readonly string[], group: Pick<Group, 'fields'>): boolean {
  return group.fields.some((field) => fieldIsYours(edited, field))
}

/** The body of `PUT /api/characters/{key}/card` for one field changed. */
export function editBody<F extends CardFieldName>(field: F, value: CardFields[F]): Record<string, unknown> {
  return { [field]: value }
}

/** The body for one field "Back to the card": the field, empty. All of them are `DELETE /api/characters/{key}/card`. */
export function backBody(field: CardFieldName): Record<string, null> {
  return { [field]: null }
}

// -------------------------------------------------------------------------------------------------------------------- lists

/** The list with the item at `index` one place earlier (-1) or later (1); the same at either end. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta
  if (to < 0 || to >= list.length) return [...list]
  const next = [...list]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

export function removeItem<T>(list: readonly T[], item: T): T[] {
  return list.filter((one) => one !== item)
}

/** The list with an item after the others, unless it is in it already. */
export function addItem<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? [...list] : [...list, item]
}

/** The roles known to the card's engine, in the order the design names them. */
export const ROLES: readonly string[] = ['damage', 'support', 'healer', 'protector']

/** The roles after one is switched on or off; at least one stays. */
export function roleToggle(roles: readonly string[], role: string): string[] {
  if (!roles.includes(role)) return [...roles, role]
  return roles.length > 1 ? roles.filter((one) => one !== role) : [...roles]
}

// ------------------------------------------------------------------------------------------------------------------- goals

const GOAL_LABELS: Record<string, { label: string; unit: string }> = {
  cr: { label: 'Crit Rate', unit: '%' },
  cd: { label: 'Crit DMG', unit: '%' },
  er: { label: 'Energy Recharge', unit: '%' },
  em: { label: 'Elemental Mastery', unit: '' },
  atk: { label: 'ATK', unit: '' },
  hp: { label: 'HP', unit: '' },
  def: { label: 'DEF', unit: '' },
  dmg: { label: 'DMG Bonus', unit: '%' },
}

export type GoalRow = { key: string; label: string; unit: string; text: string }

/** The goals the panel lists: Crit Rate, Crit DMG, Energy Recharge, Elemental Mastery, her scaling stat and DMG Bonus, each as typed. */
export function goalRows(fields: Pick<CardFields, 'goals' | 'scaling'>): GoalRow[] {
  const keys = ['cr', 'cd', 'er', 'em', ...(fields.scaling === 'em' ? [] : [fields.scaling]), 'dmg']
  return keys.map((key) => ({ key, ...GOAL_LABELS[key], text: fields.goals[key] === undefined ? '' : String(fields.goals[key]) }))
}

/** The most a goal can be typed as, which no stat comes near. */
const GOAL_MAX = 99_999

/**
 * The body for one goal typed: a number, with or without "%", sets that goal alone; empty takes that goal's edit away
 * (it is the card's again); anything else is null. The core merges it with the goals already edited.
 */
export function goalBody(key: string, text: string): { goals: Record<string, number | null> } | null {
  const typed = text.trim().replace(/%$/, '').replace(',', '.').trim()
  if (typed === '') return { goals: { [key]: null } }
  if (!/^\d+(\.\d+)?$/.test(typed)) return null
  const value = Number(typed)
  return value > GOAL_MAX ? null : { goals: { [key]: value } }
}

// --------------------------------------------------------------------------------------------------------- sets, pronouns

/** A set choice: one set worn whole (4 pieces), or two worn two and two. */
export function setChoice(sets: readonly string[]): CardFields['sets'][number] {
  return { sets: [...sets], pieces: sets.length > 1 ? '2+2' : '4' }
}

/** The three sets of pronouns a card can have, as the game writes them. */
export const PRONOUN_PRESETS: readonly (readonly [string, string, string])[] = [
  ['she', 'her', 'her'],
  ['he', 'him', 'his'],
  ['they', 'them', 'their'],
]

/** Which preset a card's pronouns are; "they" is for any other, as the pages read a card with none. */
export function pronounsIndex(pronouns: readonly string[]): number {
  const found = PRONOUN_PRESETS.findIndex((preset) => preset.every((word, index) => word === pronouns[index]))
  return found < 0 ? 2 : found
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** How sure the card is, when it was last checked, and whether it is an early look, or that it is only defaults. */
export function checkedLine(checked: string | null, confidence: string, early: boolean): string {
  if (confidence === 'none') return 'No researched card yet; these are defaults.'
  const sure = confidence.charAt(0).toUpperCase() + confidence.slice(1)
  let when = `${sure} confidence; no check date.`
  if (checked !== null) {
    const [year, month, day] = checked.split('-').map(Number)
    when = `Checked ${day} ${MONTHS[month - 1]} ${year}, ${confidence} confidence.`
  }
  return early ? `Not out yet: this card is an early look. ${when}` : when
}

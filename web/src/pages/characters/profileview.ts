import type { MaterialRow, PieceView, Profile, StatRow, SubView, Weight, WeaponType } from '../../types.ts'
import type { SignName } from '../../ui/Sign.tsx'
import { weaponSign } from './elements.ts'

/** The six pages of a profile's sidebar, in the design's order (section 6.2). */
export type PaneKey = 'attr' | 'weapon' | 'arts' | 'cons' | 'talents' | 'story'

export const PANES: readonly { key: PaneKey; label: string }[] = [
  { key: 'attr', label: 'Attributes' },
  { key: 'weapon', label: 'Weapon' },
  { key: 'arts', label: 'Artifacts' },
  { key: 'cons', label: 'Constellation' },
  { key: 'talents', label: 'Talents' },
  { key: 'story', label: 'Story' },
]

/**
 * What a key press does on a character's card: -1 for the left arrow (the previous character), 1 for the right (the next),
 * null for anything else. Not while the player types, with a modifier (Alt+Left is the window's Back), while composing, or when a
 * control has used the key already (a row of options moves with the arrows).
 */
export function stepKey(
  event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; defaultPrevented: boolean; isComposing: boolean },
  target: { tagName: string; isContentEditable?: boolean } | null,
): -1 | 1 | null {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return null
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented || event.isComposing) return null
  if (target !== null && (target.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return null
  return event.key === 'ArrowLeft' ? -1 : 1
}

/** The drawn sign of a page. The Weapon page's follows the character's weapon type. */
export function paneSign(pane: PaneKey, weapon: WeaponType): SignName {
  switch (pane) {
    case 'attr':
      return 'bust'
    case 'weapon':
      return weaponSign(weapon)
    case 'arts':
      return 'flower'
    case 'cons':
      return 'stars'
    case 'talents':
      return 'crown'
    case 'story':
      return 'book'
  }
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places

/** A figure in the plain way the mockup writes it: no trailing ".0", thousands set apart. */
function plain(value: number): string {
  return round(value, 1).toLocaleString('en-GB', { maximumFractionDigits: 1 })
}

// ------------------------------------------------------------------------------------------------------------ attributes

/** Where a part of a stat comes from, as the bar is cut. */
export type Share = { key: 'her' | 'weapon' | 'artifacts'; width: number }

/**
 * The parts of a stat's bar: her own, her weapon's and her artifacts' shares of the stat's scale, each as a width in
 * per cent. A share of nothing has no part, and the parts never run past the end of the bar.
 */
export function statShares(row: StatRow): Share[] {
  const parts: [Share['key'], number][] = [
    ['her', row.her],
    ['weapon', row.weapon],
    ['artifacts', row.artifacts],
  ]
  const widths = parts.map(([key, amount]) => ({ key, width: row.scale > 0 ? (amount / row.scale) * 100 : 0 })).filter((part) => part.width > 0)
  const total = widths.reduce((sum, part) => sum + part.width, 0)
  const fit = total > 100 ? 100 / total : 1
  return widths.map((part) => ({ key: part.key, width: round(part.width * fit, 2) }))
}

/** Where the gold mark of the card's goal stands on the bar, in per cent of its scale, or null where there is no goal. */
export function goalMark(row: StatRow): number | null {
  if (row.goal === null || row.scale <= 0) return null
  return Math.min(100, round((row.goal / row.scale) * 100, 2))
}

/** What a stat's tip says: its name and figure, where it comes from, and how far the goal is. */
export function statTip(row: StatRow): { title: string; how: string; goal: string | null } {
  let goal: string | null = null
  if (row.goal_text !== null && row.goal !== null) {
    const unit = row.goal_text.endsWith('%') ? '%' : ''
    goal = row.met === true || row.value >= row.goal ? `Goal ${row.goal_text}: reached.` : `Goal ${row.goal_text}: ${plain(row.goal - row.value)}${unit} to go.`
  }
  return { title: `${row.label} ${row.text}`, how: row.how, goal }
}

/** How a roll is coloured: it helps her, is of some use, or is wasted (the profile's chart of her rolls). */
export type Unit = 'h' | 's' | 'n'

const UNIT_OF: Record<Weight, Unit> = { wants: 'h', some: 's', none: 'n' }

/** One square per roll, in the colour of its weight. */
export function rollUnits(row: { rolls: number; weight: Weight }): Unit[] {
  return Array.from({ length: Math.max(0, row.rolls) }, () => UNIT_OF[row.weight])
}

// The card's pronouns (types.ts): `she` is the subject ("she", "he", "they"), `her` the object ("her", "him", "them") and
// `hers` the possessive ("her", "his", "their").

/** The word for her as the object of a sentence ("help her", "help him", "help them"). */
export function objectPronoun(pronouns: Profile['pronouns']): string {
  return pronouns.her
}

/** The word for what is hers ("her card", "his card", "their card"). */
export function possessive(pronouns: Profile['pronouns']): string {
  return pronouns.hers
}

/** The subject and its verb, which agrees with "they": agree(p, 'wants', 'want') is "she wants" or "they want". */
export function agree(pronouns: Profile['pronouns'], one: string, they: string): string {
  return `${pronouns.she} ${pronouns.she === 'they' ? they : one}`
}

/** "Her own", "His own" or "Their own": the label of the part of a stat that comes from the character herself. */
export function ownLabel(pronouns: Profile['pronouns']): string {
  return `${pronouns.hers.charAt(0).toUpperCase()}${pronouns.hers.slice(1)} own`
}

/** "Where her 41 substat rolls went" */
export function rollsHeading(profile: Pick<Profile, 'rolls' | 'pronouns'>): string {
  const total = profile.rolls.reduce((sum, roll) => sum + roll.rolls, 0)
  return `Where ${profile.pronouns.hers} ${total} substat rolls went`
}

/** "28 help her, 5 are of some use, 8 are wasted." */
export function rollsSummary(profile: Pick<Profile, 'rolls_by' | 'pronouns'>): string {
  const { wants, some, none } = profile.rolls_by
  return `${wants} help ${objectPronoun(profile.pronouns)}, ${some} are of some use, ${none} are wasted.`
}

// ---------------------------------------------------------------------------------------------------------------- pieces

/** What a piece's verdict says, and its chip's class in profile.css. */
export function verdictLabel(verdict: PieceView['verdict']): string {
  return { keep: 'Keep', level: 'Level up', replace: 'Replace' }[verdict]
}

export function verdictChip(verdict: PieceView['verdict']): string {
  return { keep: 'keep', level: 'lvl-up', replace: 'swap' }[verdict]
}

/**
 * The card's verdict on her weapon, a sentence that opens with the word: "Keep it. Its bonuses match her kit." The chip is
 * the word in the chip colours of a piece's verdict, and `text` is the sentence without it. A sentence that opens with
 * another word has no chip, and is all `text`.
 */
export function weaponVerdict(sentence: string): { label: string | null; chip: string | null; text: string } {
  const found = /^(Keep|Replace|Level up|Upgrade)( it)?[.:]\s*/i.exec(sentence)
  if (found === null) return { label: null, chip: null, text: sentence }
  const word = found[1].toLowerCase()
  const label = word === 'keep' ? 'Keep' : word === 'level up' ? 'Level up' : 'Replace'
  const chip = word === 'keep' ? 'keep' : word === 'level up' ? 'lvl-up' : 'swap'
  return { label, chip, text: sentence.slice(found[0].length) }
}

/** The six segments of an unfolded substat: the rolls it had in their colour, and the rest of the six empty. */
export function unfoldSegments(sub: SubView): (Unit | 'e')[] {
  const filled = Math.min(6, Math.max(0, sub.rolls))
  return Array.from({ length: 6 }, (_, index) => (index < filled ? UNIT_OF[sub.weight] : 'e'))
}

/** Whether she wants crit: Crit Rate or Crit DMG is among the substats the card wants. */
export function usesCrit(profile: Pick<Profile, 'rolls'>): boolean {
  return profile.rolls.some((roll) => (roll.key === 'cr' || roll.key === 'cd') && roll.weight === 'wants')
}

/** The pieces in order of crit value, or, for a role that uses no crit, of the rolls she wants. A new list. */
export function piecesByCrit(profile: Pick<Profile, 'pieces' | 'rolls'>): PieceView[] {
  const key = usesCrit(profile) ? (piece: PieceView) => piece.crit_value : (piece: PieceView) => piece.rolls_wanted
  return [...profile.pieces].sort((a, b) => key(b) - key(a))
}

/** How full a piece's bar is on the Artifacts page, in per cent: its crit value out of 50, or the share of its rolls she wants. */
export function pieceBar(piece: PieceView, crit: boolean): number {
  if (crit) return Math.min(100, (piece.crit_value / 50) * 100)
  return piece.rolls_all > 0 ? Math.min(100, (piece.rolls_wanted / piece.rolls_all) * 100) : 0
}

/** A set as the Artifacts page tells it: its name, how many of her pieces it is, and what each count gives. */
export type SetView = { name: string; sub: string; bonuses: { label: string; text: string }[] }

export function setsView(sets: Profile['sets'], pronouns: Profile['pronouns']): SetView[] {
  return sets.map((set) => ({
    name: set.name,
    sub: sets.length === 1 && set.pieces === 5 ? 'All five pieces from one set' : `${set.pieces} of ${pronouns.hers} pieces`,
    bonuses: [
      ...(set.pieces >= 2 && set.two !== '' ? [{ label: '2 pieces', text: set.two }] : []),
      ...(set.pieces >= 4 && set.four !== '' ? [{ label: '4 pieces', text: set.four }] : []),
    ],
  }))
}

// ------------------------------------------------------------------------------------------------------- constellation

/** The square the chart and its six stars are laid out in. The stars' rings, lines and labels are sized in it (profile.css). */
export const CHART_STAGE = 900

/** How far from the middle of the stage the six stand when there are no places for them on a chart. */
const RING_RADIUS = 330

/**
 * Where each of the six stars stands on the stage. The chart is a picture of any size and proportions, 548 by 720 or 1,350 by
 * 1,350, drawn to fit the stage's box and centred (`object-fit: contain`), and the stars are in the chart's own pixels (`size`), so
 * they take the same scale and the same margin as the picture. Those depend on the picture's proportions alone: a copy of the chart
 * at any picture quality, and the page at any scale, land in the same place. With no stars or no size the six go on a ring,
 * evenly from the top (the design's section 7.9).
 */
export function chartPlaces(stars: readonly [number, number][] | null, size: readonly [number, number] | null): [number, number][] {
  if (stars === null || size === null) {
    return Array.from({ length: 6 }, (_, index) => {
      const turn = (index / 6) * 2 * Math.PI
      return [CHART_STAGE / 2 + RING_RADIUS * Math.sin(turn), CHART_STAGE / 2 - RING_RADIUS * Math.cos(turn)]
    })
  }
  const [width, height] = size
  const scale = CHART_STAGE / Math.max(width, height)
  const left = (CHART_STAGE - width * scale) / 2
  const top = (CHART_STAGE - height * scale) / 2
  return stars.map(([x, y]) => [left + x * scale, top + y * scale])
}

/**
 * The chart's box on the stage, in shares of it: as long as the stage on its longer side, and of its own proportions on the other. The
 * fade at its edge then follows the picture, and a tall chart shows no straight sides. It stands in the middle, as `chartPlaces` says.
 */
export function chartBox(size: readonly [number, number] | null): { width: string; height: string } | undefined {
  if (size === null) return undefined
  const [width, height] = size
  const longest = Math.max(width, height)
  return { width: `${(width / longest) * 100}%`, height: `${(height / longest) * 100}%` }
}

/** The line between each star she has and the one before it, on the stage. */
export function litLines(stars: readonly [number, number][], owned: number): { from: [number, number]; to: [number, number] }[] {
  const lines: { from: [number, number]; to: [number, number] }[] = []
  for (let index = 1; index < Math.min(owned, stars.length); index += 1) lines.push({ from: stars[index - 1], to: stars[index] })
  return lines
}

// ---------------------------------------------------------------------------------------------------------------- talents

/** A talent's level, with what a constellation adds shown apart: "10 + 3". Empty where she has no level. */
export function talentText(talent: { level: number | null; bonus: number }): string {
  if (talent.level === null) return ''
  return talent.bonus > 0 ? `${talent.level} + ${talent.bonus}` : String(talent.level)
}

/** What a material says: held and needed, and a chip that says Ready, how many are left to get, or that it is not known. */
export function matWords(material: MaterialRow): { held: string; chip: string; ready: boolean } {
  const needed = material.needed.toLocaleString('en-GB')
  if (material.held === null || material.state === 'unknown') {
    return { held: `Held amount not known, ${needed} needed`, chip: 'Not known', ready: false }
  }
  const held = `${material.held.toLocaleString('en-GB')} held, ${needed} needed`
  if (material.state === 'ready') return { held, chip: 'Ready', ready: true }
  return { held, chip: `${(material.needed - material.held).toLocaleString('en-GB')} to get`, ready: false }
}

// ------------------------------------------------------------------------------------------------------------------ story

/** The pill under her name: "Came at pity 71 44 62". Null when the kept history holds no pity of hers. */
export function pityPill(pity: Profile['pity']): { label: string; numbers: number[] } | null {
  const numbers = pity.flatMap((entry) => (entry.pity === null ? [] : [entry.pity]))
  return numbers.length === 0 ? null : { label: 'Came at pity', numbers }
}

/** A pity bar's fill out of 90 and its soft-pity mark at 74, in per cent, and its tip. */
export function pityBar(pity: number): { fill: number; soft: number; tip: string } {
  return { fill: Math.min(100, round((pity / 90) * 100, 1)), soft: round((74 / 90) * 100, 1), tip: `${pity} of 90; the line is soft pity, 74` }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
]

/** "2026-07-02" -> "2 July 2026" */
export function longDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return `${date} ${MONTH_NAMES[month - 1]} ${year}`
}

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth']
const COUNTS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']

const RESULT_WORDS: Record<NonNullable<Profile['pity'][number]['result']>, string> = {
  won: 'won the 50/50',
  lost: 'lost the 50/50',
  guaranteed: 'guaranteed',
  featured: 'the featured one',
}

export type StoryEntry = { when: string; pity: number | null; what: string }

/** Each copy of her, oldest first: when she came, at what pity, and what the copy was. */
export function pityStory(profile: Pick<Profile, 'pity' | 'pronouns'>): StoryEntry[] {
  const ordered = [...profile.pity].sort((a, b) => a.at.localeCompare(b.at))
  return ordered.map((entry, index) => {
    const where = entry.after === null ? entry.banner.toLowerCase() : `after losing a 50/50 to ${entry.after}`
    const tail = index === 0 ? `${agree(profile.pronouns, 'joins', 'join')} you` : `${profile.pronouns.hers} ${ORDINALS[index] ?? 'a further'} constellation`
    const result = entry.result === null ? '' : `${RESULT_WORDS[entry.result]}: `
    return { when: `${longDay(entry.at)}, ${where}`, pity: entry.pity, what: `${result}${tail}` }
  })
}

/** The wishes spent in all: "177 wishes for her three copies, plus the ones that ended in Qiqi". Null with no history. */
export function tally(profile: Pick<Profile, 'pity' | 'pronouns'>): { total: number; text: string } | null {
  if (profile.pity.length === 0) return null
  const total = profile.pity.reduce((sum, entry) => sum + (entry.pity ?? 0), 0)
  const copies = profile.pity.length
  const count = copies === 1 ? 'copy' : `${COUNTS[copies] ?? copies} copies`
  const lost = [...new Set(profile.pity.flatMap((entry) => (entry.after === null ? [] : [entry.after])))]
  const plus = lost.length === 0 ? '' : `, plus the ones that ended in ${lost.join(' and ')}`
  return { total, text: `wishes for ${profile.pronouns.hers} ${count}${plus}` }
}

// ----------------------------------------------------------------------------------------------------------------- card

/** What the readiness sheet says of her card: how sure it is, what the player edited, or that it is only defaults. */
export function cardLine(card: Pick<Profile['card'], 'edited' | 'confidence' | 'early'>, pronouns: Profile['pronouns']): string {
  if (card.confidence === 'none') return 'No researched card yet; these are defaults.'
  if (card.early) return 'Not out yet: this card is an early look.'
  if (card.edited.length > 0) return `You have edited ${card.edited.length === 1 ? 'one field' : `${card.edited.length} fields`} of ${pronouns.hers} card.`
  return `Researched, ${card.confidence} confidence.`
}

/** Above this brightness a picture stands out of the dark card, and its edges darken. */
const BRIGHT_FROM = 0.42

/** The mean brightness of a picture from 0 to 1, from its RGBA pixels; what is see-through counts as the dark card behind it. */
export function pictureLight(pixels: Uint8ClampedArray): number {
  const count = pixels.length / 4
  if (count === 0) return 0
  let sum = 0
  for (let at = 0; at < pixels.length; at += 4) {
    sum += ((0.299 * pixels[at] + 0.587 * pixels[at + 1] + 0.114 * pixels[at + 2]) / 255) * (pixels[at + 3] / 255)
  }
  return sum / count
}

/** How dark the edges around her art are, from 0 to a half: nothing on a dark picture, more the brighter it is. The middle is never touched. */
export function edgeOf(light: number): number {
  return Math.min(0.5, Math.max(0, (light - BRIGHT_FROM) * 3))
}

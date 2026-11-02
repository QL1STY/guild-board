import type { Element, Option, PlanBody, Planner, Slot, Weight } from '../../types.ts'

// ----------------------------------------------------------------------------------------------------------- steppers

/** A target moved one step, kept from `min` (what she has now) to `max` (the most). */
export function stepTarget(target: number, delta: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, target + delta))
}

/** Whether a stepper's button for this direction can be pressed: it rests at the ends of its range. */
export function canStep(target: number, delta: number, min: number, max: number): boolean {
  return stepTarget(target, delta, min, max) !== target
}

/** The levels a character is raised to: each ascension's cap, and the last 90. */
const LEVELS = [20, 40, 50, 60, 70, 80, 90]

/**
 * The level target one step up or down the levels she is raised to; a level between two goes to the next one in that
 * direction. It never goes below `floor`, the level she has now (1 when she is not owned).
 */
export function stepLevel(level: number, delta: 1 | -1, floor = 1): number {
  if (delta > 0) return LEVELS.find((one) => one > level) ?? LEVELS[LEVELS.length - 1]
  const lower = [...LEVELS].reverse().find((one) => one < level) ?? LEVELS[0]
  return Math.min(level, Math.max(lower, floor))
}

/** What the steppers start from: her build as it stands now (`Planner.now_build`), or 1 for each when she is not owned. */
export type Floors = { level: number; refinement: number; weaponLevel: number }

export function floorsOf(nowBuild: Planner['now_build']): Floors {
  if (nowBuild === null) return { level: 1, refinement: 1, weaponLevel: 1 }
  return { level: nowBuild.level, refinement: nowBuild.refinement ?? 1, weaponLevel: nowBuild.weapon_level ?? 1 }
}

// ------------------------------------------------------------------------------------------------ the plan, part by part

/** The weapons with the card's choices first, in the order the card has them, and the others after, in theirs. */
export function weaponsCardFirst(options: readonly Option[]): Option[] {
  return [...options.filter((option) => option.tag !== null), ...options.filter((option) => option.tag === null)]
}

/**
 * The sets the list shows: the card's (tagged), and the one the plan has, in the order the core gave; with nothing tagged,
 * the first two. With `all`, every set, which the game has some seventy of.
 */
export function setsShown(options: readonly Option[], chosen: string, all: boolean): Option[] {
  if (all) return [...options]
  const tagged = options.some((option) => option.tag !== null)
  const kept = options.filter((option, index) => option.tag !== null || option.key === chosen || (!tagged && index < 2))
  return kept
}

/** A main-stat chip: whether it is the stat she wears now, and whether the plan chooses it. */
export type MainChip = { key: string; label: string; now: boolean; pressed: boolean }

export function mainChips(main: Planner['mains'][number]): MainChip[] {
  return main.options.map((option) => ({ key: option.key, label: option.label, now: option.key === main.now, pressed: option.key === main.chosen }))
}

/** The plan with its Sands, Goblet or Circlet main stat chosen. A typed piece of that slot is no longer in the plan. */
export function withMain(plan: PlanBody, slot: 'sands' | 'goblet' | 'circlet', key: string): PlanBody {
  return { ...plan, mains: { ...plan.mains, [slot]: key }, typed: plan.typed !== null && plan.typed.slot === slot ? null : plan.typed }
}

export function withTalent(plan: PlanBody, kind: 'normal' | 'skill' | 'burst', level: number): PlanBody {
  return { ...plan, talents: { ...plan.talents, [kind]: level } }
}

export function withWeapon(plan: PlanBody, key: string): PlanBody {
  return { ...plan, weapon: key }
}

export function withLevelPiece(plan: PlanBody, slot: Slot, on: boolean): PlanBody {
  const others = plan.level_pieces.filter((one) => one !== slot)
  return { ...plan, level_pieces: on ? [...others, slot] : others }
}

export function withWeight(plan: PlanBody, key: string, weight: Weight): PlanBody {
  return { ...plan, weights: { ...plan.weights, [key]: weight } }
}

/** The key of a set or a pair of sets as the planner's list has it: "a", or "a+b" for two and two. */
export function setKeyOf(set: PlanBody['set']): string {
  return set === null ? '' : set.sets.join('+')
}

/** The plan with this set chosen: one set is worn whole (4 pieces), and two joined by "+" are worn two and two. */
export function withSet(plan: PlanBody, key: string): PlanBody {
  const sets = key.split('+')
  return { ...plan, set: { sets, pieces: sets.length > 1 ? '2+2' : '4' } }
}

/** A substat's next weight when it is pressed: wants, then some use, then no use, and round again. */
export function nextWeight(weight: Weight): Weight {
  return { wants: 'some', some: 'none', none: 'wants' }[weight] as Weight
}

// ------------------------------------------------------------------------------------------------------- try a piece

const STAT_LABEL: Record<string, string> = {
  hp: 'HP', atk: 'ATK', def: 'DEF', hp_pct: 'HP %', atk_pct: 'ATK %', def_pct: 'DEF %', er: 'Energy Recharge', em: 'Elemental Mastery',
  cr: 'Crit Rate', cd: 'Crit DMG', heal: 'Healing Bonus', phys: 'Physical DMG Bonus',
}

/** The main stats a slot can have, in the game's own order. `dmg` is the DMG Bonus of her element. */
const MAIN_KEYS: Record<Slot, string[]> = {
  flower: ['hp'],
  plume: ['atk'],
  sands: ['atk_pct', 'hp_pct', 'def_pct', 'er', 'em'],
  goblet: ['dmg', 'phys', 'atk_pct', 'hp_pct', 'def_pct', 'em'],
  circlet: ['cr', 'cd', 'atk_pct', 'hp_pct', 'def_pct', 'heal', 'em'],
}

/** The substats a piece can roll. */
const SUB_KEYS = ['cr', 'cd', 'atk_pct', 'atk', 'er', 'em', 'hp_pct', 'hp', 'def_pct', 'def']

export const SLOTS: readonly { key: Slot; label: string }[] = [
  { key: 'flower', label: 'Flower' },
  { key: 'plume', label: 'Plume' },
  { key: 'sands', label: 'Sands' },
  { key: 'goblet', label: 'Goblet' },
  { key: 'circlet', label: 'Circlet' },
]

export function statLabel(key: string, element: Element): string {
  return key === 'dmg' ? `${element} DMG Bonus` : (STAT_LABEL[key] ?? key)
}

export function mainOptions(slot: Slot, element: Element): { key: string; label: string }[] {
  return MAIN_KEYS[slot].map((key) => ({ key, label: statLabel(key, element) }))
}

/** The substats a piece with this main stat can have: every substat but its own. */
export function subOptionsFor(main: string): { key: string; label: string }[] {
  return SUB_KEYS.filter((key) => key !== main).map((key) => ({ key, label: STAT_LABEL[key] }))
}

/** The piece the player is typing in: a slot and its main stat, and four substats with their values as typed. */
export type Draft = { slot: Slot; main: string; subs: [string, string][] }

export function emptyDraft(slot: Slot, element: Element): Draft {
  return { slot, main: mainOptions(slot, element)[0].key, subs: [['', ''], ['', ''], ['', ''], ['', '']] }
}

/** The draft with another slot: its main stat stays if the slot can have it, and a substat that is its main stat goes. */
export function setDraftSlot(draft: Draft, slot: Slot, element: Element): Draft {
  const options = mainOptions(slot, element)
  const main = options.some((option) => option.key === draft.main) ? draft.main : options[0].key
  return { slot, main, subs: draft.subs.map(([key, value]) => (key === main ? ['', ''] : [key, value])) as [string, string][] }
}

/** The draft a plan's typed piece makes, to show it in the form again: its values as text, padded to four substats. */
export function draftFromTyped(typed: PlanBody['typed'], element: Element): Draft {
  if (typed === null) return emptyDraft('goblet', element)
  const subs = typed.subs.map(([key, value]): [string, string] => [key, String(value)])
  while (subs.length < 4) subs.push(['', ''])
  return { slot: typed.slot, main: typed.main, subs: subs.slice(0, 4) }
}

/**
 * The typed piece as the plan carries it (PlanBody.typed): its substats with a stat and a value above zero, as numbers. Null
 * while none is typed. `use` puts it in the plan; without it the core only says what the piece would do.
 */
export function draftBody(draft: Draft, use: boolean): PlanBody['typed'] {
  const subs = draft.subs.flatMap(([key, value]): [string, number][] => {
    const amount = Number.parseFloat(value)
    return key !== '' && Number.isFinite(amount) && amount > 0 ? [[key, amount]] : []
  })
  return subs.length === 0 ? null : { slot: draft.slot, main: draft.main, subs, use }
}

// ------------------------------------------------------------------------------------------------------------ the plan's meter

/** "+35%" or "−5%", with the true minus sign. */
export function signed(change: number): string {
  return `${change < 0 ? '−' : '+'}${Math.abs(Math.round(change))}%`
}

/** Whether a change reads as up, down or none: by the sign the core wrote ("+0.8", "−420", "no change"). */
export function changeClass(text: string): 'up' | 'down' | 'same' {
  if (text.startsWith('+')) return 'up'
  if (text.startsWith('−') || text.startsWith('-')) return 'down'
  return 'same'
}

/** One part of today's resin bar: what it goes on, how much, its share of the day's resin in per cent, and its colour's number. */
export type ResinPart = { label: string; resin: number; share: number; tone: number }

/** Today's resin cut into the runs it goes on and what the rest of the day's resin is ("The rest": the other characters' runs, and what is not spent), as shares of the cap or, past it, of the total. */
export function resinParts(takes: Pick<Planner['takes'], 'resin_today' | 'resin_cap'>): ResinPart[] {
  const used = takes.resin_today.reduce((sum, part) => sum + part.resin, 0)
  const whole = Math.max(takes.resin_cap, used)
  const parts: ResinPart[] = takes.resin_today
    .filter((part) => part.resin > 0)
    .map((part, index) => ({ label: part.label, resin: part.resin, share: (part.resin / whole) * 100, tone: index % 3 }))
  const free = whole - used
  if (free > 0) parts.push({ label: 'The rest', resin: free, share: (free / whole) * 100, tone: 3 })
  return parts
}

/** "About 1 in 181 runs": a piece's chance in one run, as a count of runs. */
export function findOdds(find: Pick<Planner['takes']['find'][number], 'per_run'>): string {
  return find.per_run > 0 ? `About 1 in ${Math.round(1 / find.per_run)} runs` : 'Not in a run'
}

// ------------------------------------------------------------------------------------------------------------ days to ready

/** The days curve's drawing box, in the pixels of its viewBox, and the room its axes take. */
export const DAYS_BOX = { width: 1360, height: 190, left: 44, right: 12, top: 14, bottom: 26 }

const tidy = (value: number) => String(Math.round(value * 10) / 10)

/** Where a day stands across the box: `days` is the last day on it. */
export function curveX(day: number, days: number): number {
  return DAYS_BOX.left + (days > 0 ? day / days : 0) * (DAYS_BOX.width - DAYS_BOX.left - DAYS_BOX.right)
}

/** Where a chance, from 0 to 1, stands up the box. */
export function curveY(chance: number): number {
  return DAYS_BOX.top + (1 - chance) * (DAYS_BOX.height - DAYS_BOX.top - DAYS_BOX.bottom)
}

/** The curve's line through every point, "M44,164 L...", or nothing without points. */
export function curvePath(points: readonly number[]): string {
  const last = points.length - 1
  return points.map((chance, day) => `${day === 0 ? 'M' : 'L'}${tidy(curveX(day, last))},${tidy(curveY(chance))}`).join(' ')
}

/** The area under the curve, closed along the axis. */
export function curveArea(points: readonly number[]): string {
  if (points.length === 0) return ''
  const last = points.length - 1
  return `M${tidy(curveX(0, last))},${tidy(curveY(0))} ${curvePath(points).replace(/^M/, 'L')} L${tidy(curveX(last, last))},${tidy(curveY(0))} Z`
}

/** The first day on which the chance reaches `chance`, or null where it never does. */
export function firstAt(points: readonly number[], chance: number): number | null {
  const day = points.findIndex((value) => value >= chance)
  return day < 0 ? null : day
}

/** A mark on the curve: the day it stands on and its words, with the core's own date. */
export type CurveMark = { day: number; label: string }

/** The 50% and 90% marks. A mark has the core's date, and is not drawn where the plan has none (she is ready, or it never comes). */
export function curveMarks(days: Pick<Planner['days'], 'points' | 'half' | 'most'>): CurveMark[] {
  const marks: CurveMark[] = []
  const half = days.half === null ? null : firstAt(days.points, 0.5)
  const most = days.most === null ? null : firstAt(days.points, 0.9)
  if (half !== null) marks.push({ day: half, label: `Half a chance, ${days.half}` })
  if (most !== null) marks.push({ day: most, label: `Nine in ten, ${days.most}` })
  return marks
}

/** How far off a day is, in words: "Today", "Tomorrow", "In 12 days". */
export function dayWords(day: number): string {
  return day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : `In ${day} days`
}

/** The axis ticks under the curve: today, and each week. */
export function curveTicks(days: number): { day: number; label: string }[] {
  const ticks: { day: number; label: string }[] = [{ day: 0, label: 'Today' }]
  for (let day = 7; day <= days; day += 7) ticks.push({ day, label: day === 7 ? 'In 1 week' : `In ${day / 7} weeks` })
  return ticks
}

import { localTime, num, plural } from '../format.ts'
import type { SpecialPlace } from '../route.ts'
import type {
  AchievementGroup, Achievements, AchievementStage, ImportPreview, ListCheck, ListMeta,
} from '../types.ts'

type Query = Achievements['query']

/** A counter as the count's line reads it (types.ts, AchievementGroup's counter). */
type Count = { value: number; targets: readonly number[]; unit?: string; unit_one?: string | null }

/**
 * The tier a count is heading for (spec 3: "17 of 50 kills" with the 1 and 20 stages ticked): the target of the first
 * stage, in order, that is not ticked, or the last target once every stage is. Each stage has its own target, in
 * order. A counter whose targets and stages differ in number, which the core does not give, keeps to the first target
 * above the count, or the last one once every one is reached.
 */
export function nextTarget(counter: Count, stages: readonly Pick<AchievementStage, 'status'>[]): number {
  const { value, targets } = counter
  if (targets.length !== stages.length) return targets.find((target) => target > value) ?? targets[targets.length - 1]
  const first = stages.findIndex((stage) => stage.status !== 'done')
  return targets[first === -1 ? targets.length - 1 : first]
}

/**
 * "17 of 50", or "17 of 50 kills" for a counter with a unit (spec 3). After a target of 1 the unit is the one for one,
 * when the counter names it: "0 of 1 kill".
 */
export function countText(counter: Count, stages: readonly Pick<AchievementStage, 'status'>[]): string {
  const target = nextTarget(counter, stages)
  const text = `${num(counter.value)} of ${num(target)}`
  const unit = target === 1 && counter.unit_one ? counter.unit_one : counter.unit
  return unit ? `${text} ${unit}` : text
}

type Category = Achievements['categories'][number]

/**
 * A game category's stages ticked against its stages (look pass spec 11.2), which its bar shows: "188 of 480 ticked".
 * Its bar's tip says it, on hover and on keyboard focus.
 */
export function categoryTicked(category: Pick<Category, 'stages' | 'left'>): string {
  return `${num(category.stages - category.left)} of ${num(category.stages)} ticked`
}

/**
 * A game category's button as a screen reader names it: its name, what is left, which the button shows as a number
 * (none when nothing is), and the share ticked, which its bar shows: "Wonders of the World, 292 left, 188 of 480 ticked".
 */
export function categoryName(category: Pick<Category, 'name' | 'stages' | 'left'>): string {
  const left = category.left > 0 ? `${num(category.left)} left, ` : ''
  return `${category.name}, ${left}${categoryTicked(category)}`
}

/** "a", "a and b", "a, b and c" */
function listed(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** What an import would change, in one sentence. */
export function importSummary(preview: ImportPreview): string {
  if (preview.nothing_new) return 'This file has nothing new for Guild Board.'
  const changes: string[] = []
  if (preview.done > 0) changes.push(`tick ${plural(preview.done, 'achievement')}`)
  if (preview.in_progress > 0) changes.push(`mark ${num(preview.in_progress)} as in progress`)
  if (preview.pins > 0) changes.push(`pin ${num(preview.pins)}`)
  if (preview.notes > 0) changes.push(`add ${plural(preview.notes, 'note')}`)
  if (preview.parts > 0) changes.push(`add ${plural(preview.parts, 'part')}`)
  // Ticks and marks on achievements the list does not hold are not counted.
  if (changes.length === 0) return 'This import would only add progress on achievements that are not in the list.'
  return `This import would ${listed(changes)}.`
}

/** At most this many of the achievements in a file that the list does not hold are named. */
const UNKNOWN_NAMED_AT_MOST = 20

/** Spec 8.3: the achievements in the file that the list does not hold are kept, and named. Null when there are none. */
export function unknownLine(unknown: readonly number[]): string | null {
  if (unknown.length === 0) return null
  const others = unknown.length - UNKNOWN_NAMED_AT_MOST
  const ids = unknown.slice(0, UNKNOWN_NAMED_AT_MOST).join(', ') + (others > 0 ? ` and ${num(others)} more` : '')
  return unknown.length === 1
    ? `1 achievement in the file is not in the list: ${ids}. It is kept.`
    : `${num(unknown.length)} achievements in the file are not in the list: ${ids}. They are kept.`
}

/** The line over Choose a file in the import's first step. */
export function fileLine(): string {
  return 'Choose a file: a Paimon.moe export.'
}

/** A part of the installed list's line. The date is a part of its own, which the list panel keeps on one line. */
export type LinePart = { text: string; date: boolean }

/**
 * The installed list (spec 12.5: its source, version and date), in parts: "Achievement list version 7.1, 1,854
 * achievements, from 2026-09-23 (the copy that came with Guild Board)." A downloaded list says where it came from and
 * when it was installed: "…, downloaded from Paimon.moe and installed 13 Oct, 10:00." The demo's newer list says that
 * it was made up for the demo, since nothing downloaded it.
 */
export function listLineParts(list: ListMeta): LinePart[] {
  const text = `Achievement list version ${list.version}, ${plural(list.stages, 'achievement')}`
  const said = (...parts: [string, boolean][]) => parts.map(([part, date]) => ({ text: part, date }))
  if (list.source === 'bundled') {
    if (list.dated === null) return said([`${text} (the copy that came with Guild Board).`, false])
    return said([`${text}, from `, false], [list.dated, true], [' (the copy that came with Guild Board).', false])
  }
  const from = list.source === 'demo' ? 'made up for the demo' : 'downloaded from Paimon.moe'
  if (list.installed_at === null) return said([`${text}, ${from}.`, false])
  return said([`${text}, ${from} and installed `, false], [localTime(list.installed_at), true], ['.', false])
}

/** The installed list's line in one piece (listLineParts). */
export function listLine(list: ListMeta): string {
  return listLineParts(list).map((part) => part.text).join('')
}

/**
 * Whether the list panel offers Go back to the earlier list, for the list from model read number `read`. `wentBack` is
 * the number of the newest model read asked for by the time a going back that the panel still reports was answered, or
 * null. A list read no later than that may have been read before the going back, and name the earlier list it went
 * back to, which is gone: a second press would be refused. Only a list read after it is sure to show whether there is
 * an earlier list again (as stillShown). After a going back there is none until another list is installed, and the
 * core tells the pages of that, so they read the list again.
 */
export function goBackOffered(list: ListMeta, read: number, wentBack: number | null): boolean {
  return list.previous !== null && (wentBack === null || read > wentBack)
}

/** What a check for new achievements found (spec 6.3). Nothing is installed yet. */
export function checkLine(check: ListCheck): string {
  if (check.up_to_date) return `Your list is up to date: version ${check.version}.`
  const counts = `${num(check.added.length)} new, ${num(check.changed.length)} changed`
  return `Version ${check.version}: ${counts}, ${num(check.removed.length)} no longer listed.`
}

/** At most this many new stages, and as many changed ones, are named in a list's preview. The others are counted. */
export const NAMED_AT_MOST = 50

/** A stage named in a list's preview. */
export type Named = { id: number; name: string }

/** A list's new stages under their version, and then under their category. */
export type NewStages = { version: string; categories: { category: string; stages: Named[] }[] }[]

/**
 * Spec 6.3: a list's preview shows the new stages by version, the newest first, and category. The core gives them in
 * the list's order, which keeps the stages of one category together within a version. At most 50 are named; `more`
 * counts the others.
 */
export function newStages(added: ListCheck['added']): { versions: NewStages; more: number } {
  // "7.10" after "7.9". The sort is stable, so the list's order stays within a version.
  const newestFirst = added.toSorted((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }))
  const versions: NewStages = []
  for (const stage of newestFirst.slice(0, NAMED_AT_MOST)) {
    let version = versions.at(-1)
    if (version?.version !== stage.version) {
      version = { version: stage.version, categories: [] }
      versions.push(version)
    }
    let category = version.categories.at(-1)
    if (category?.category !== stage.category) {
      category = { category: stage.category, stages: [] }
      version.categories.push(category)
    }
    category.stages.push({ id: stage.id, name: stage.name })
  }
  return { versions, more: Math.max(0, added.length - NAMED_AT_MOST) }
}

/**
 * Spec 6.3: the changed stages a list's preview names, in the order the core gives them. At most 50 are named; `more`
 * counts the others.
 */
export function changedStages(changed: ListCheck['changed']): { stages: Named[]; more: number } {
  const stages = changed.slice(0, NAMED_AT_MOST).map((stage) => ({ id: stage.id, name: stage.name }))
  return { stages, more: Math.max(0, changed.length - NAMED_AT_MOST) }
}

/** After the new or the changed stages of a list's preview, when it leaves some out: "And 12 more." Otherwise null. */
export function moreLine(more: number): string | null {
  return more > 0 ? `And ${num(more)} more.` : null
}

/**
 * Spec 7.2: Guild Board offers the tick but never ticks. For a stage that is not done (index: its place in the group),
 * the line that says its parts are all done or the count reached its target; otherwise null. A Daily commissions card,
 * whose parts are its stage's, gives no counter.
 */
export function reachedLine(
  stage: Pick<AchievementStage, 'status'> & { parts: readonly Pick<AchievementStage['parts'][number], 'done_at'>[] },
  counter: AchievementGroup['counter'],
  index: number,
): string | null {
  if (stage.status === 'done') return null
  if (stage.parts.length > 0 && stage.parts.every((part) => part.done_at !== null)) {
    return 'All parts are done. Tick it once the game shows it.'
  }
  if (counter !== null && index < counter.targets.length && counter.value >= counter.targets[index]) {
    return `The count reached ${num(counter.targets[index])}. Tick it once the game shows it.`
  }
  return null
}

/**
 * What else is kept on a stage the list does not hold, shown after its note: "Pinned · 2 parts done · Count: 3",
 * whichever apply. Null when none does.
 */
export function unlistedDetails(row: Pick<Achievements['unlisted_rows'][number], 'pinned' | 'parts' | 'count'>): string | null {
  const details: string[] = []
  if (row.pinned) details.push('Pinned')
  if (row.parts > 0) details.push(`${plural(row.parts, 'part')} done`)
  if (row.count !== null) details.push(`Count: ${num(row.count)}`)
  return details.length === 0 ? null : details.join(' · ')
}

const SPECIAL_TITLES: Record<SpecialPlace, string> = { timers: 'Timers', commissions: 'Daily commissions' }

/**
 * The heading over what the page shows: one category, a search of every category, or a special category. In Timers or
 * Daily commissions (`special`) the page still reads its model, for the categories' counts, but shows that category.
 */
export function contentTitle(
  model: Pick<Achievements, 'query' | 'categories'>,
  special: SpecialPlace | null = null,
): string {
  const { query } = model
  if (special !== null) return SPECIAL_TITLES[special]
  if (query.unlisted) return 'Not in the current list'
  if (query.pinned) return 'Pinned'
  if (query.search.trim() !== '') return 'Search results'
  return model.categories.find((category) => category.key === query.category)?.name ?? ''
}

/**
 * What the page says when it has nothing to show for the query. A search looks only within the view, or within the
 * pinned achievements, so its sentence says where it looked, and outside All that All shows every achievement.
 */
export function emptyLine(query: Query): string {
  const search = query.search.trim()
  if (query.unlisted) return 'Every achievement you have progress on is in the current list.'
  if (search !== '') {
    if (query.pinned) return `Nothing pinned matches ${search}.`
    if (query.view === 'left') return `Nothing left matches ${search}. All shows every achievement.`
    if (query.view === 'done') return `Nothing ticked matches ${search}. All shows every achievement.`
    return `No achievement matches ${search}.`
  }
  if (query.pinned) return 'Nothing is pinned yet.'
  if (query.view === 'done') return 'Nothing here is ticked yet.'
  if (query.view === 'all') return 'This category has no achievements.'
  return 'Nothing left here.'
}

/**
 * A change can take the card that has the focus off the list, as a tick does in Left. The card that takes its place
 * is the next one still shown, or else the one before it; null when none of them is left. `before` and `after` are the
 * ids of the cards shown, in order.
 */
export function takesPlace(before: number[], after: number[], gone: number): number | null {
  const shown = new Set(after)
  const at = before.indexOf(gone)
  if (at === -1) return null
  return before.slice(at + 1).find((id) => shown.has(id)) ?? before.slice(0, at).findLast((id) => shown.has(id)) ?? null
}

/**
 * A card's control as the focus sees it: its kind (its data-focus), whether it can take the focus, and whether it is
 * ticked or pressed (null for a control that is neither).
 */
export type FocusControl = { kind: string; usable: boolean; state: boolean | null }

/**
 * The control that had the focus in a card that left: its kind, which one of that kind it was, and its state when it
 * took the focus, before the change.
 */
export type LostFocus = { kind: string; ordinal: number; state: boolean | null }

/**
 * Which control of the card that took the place gets the focus: one of the same kind, in the state the lost one had
 * before the change (so after a tick, the next box to tick), else the one in the same place, else the first of that
 * kind, else the card's first Done box. -1 when none can take it.
 */
export function matchingControl(controls: FocusControl[], lost: LostFocus): number {
  const all = controls.map((control, index) => ({ ...control, index }))
  const same = all.filter((control) => control.kind === lost.kind)
  const usable = same.filter((control) => control.usable)
  const chosen =
    (lost.state === null ? undefined : usable.find((control) => control.state === lost.state)) ??
    (same[lost.ordinal]?.usable ? same[lost.ordinal] : undefined) ??
    usable[0] ??
    all.find((control) => control.kind === 'done' && control.usable)
  return chosen?.index ?? -1
}

/**
 * The search as the core gets it: without the spaces at its ends. Two searches that differ only there ask for the same
 * thing, so a change of those spaces alone is not another search.
 */
export function sentSearch(search: string): string {
  return search.trim()
}

/** The page model's address for a query. Only what is chosen or on is sent: the core refuses an empty pinned=. */
export function modelPath(query: Query): string {
  const params = new URLSearchParams({ view: query.view })
  if (query.category !== null) params.set('category', query.category)
  if (query.pinned) params.set('pinned', 'true')
  const search = sentSearch(query.search)
  if (search !== '') params.set('q', search)
  if (query.unlisted) params.set('unlisted', 'true')
  // In a fixed order, so that another change to an achievement already kept asks for nothing new.
  for (const id of [...query.keep].sort((a, b) => a - b)) params.append('keep', String(id))
  return `/api/achievements?${params}`
}

/** At most this many changed achievements stay in the list until the player moves on. */
export const KEPT_AT_MOST = 200

/**
 * The achievements the page changed since the player last moved on, the most recent last, after a change to `group`.
 * They stay in the list whatever the view or Pinned decides, so that a tick in Left does not move the next card up
 * under the pointer. At most the 200 most recent.
 */
export function keptAfter(kept: readonly number[], group: number): number[] {
  return [...kept.filter((id) => id !== group), group].slice(-KEPT_AT_MOST)
}

/**
 * Whether a change, by the body it sends to the core, can take its achievement off the list the page shows or put it
 * on: a tick, a pin, a count or a part can. A note alone cannot, so its achievement is not kept in the list for it. A
 * note saved as its panel closes, after the player moved on to another view, keeps no card in the new one.
 */
export function changesListing(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return true
  const keys = Object.keys(body)
  return !(keys.length === 1 && keys[0] === 'note')
}

/**
 * Where the player is in the categories: a category, Pinned, or Not in the current list, or else a special category
 * with an address of its own, Timers or Daily commissions (route.ts), which `special` names over the rest.
 */
export type Place = Pick<Query, 'category' | 'pinned' | 'unlisted'> & { special: SpecialPlace | null }

/**
 * Where the page asks next, after an answer. Until the player picks a category the page asks without one, and the core
 * opens on the first category with something left. The page then keeps to the category the core named, so that ticking
 * the last achievement left there does not move it on to another category without a word.
 */
export function placeAfter(place: Place, answered: Query): Place {
  return place.category === null && answered.category !== null ? { ...place, category: answered.category } : place
}

/**
 * What the player gave one control, until the model holds it: the value, the request that sent it, and once the change
 * is answered, the number of the newest model read asked for by then (null until the answer).
 */
export type Clicked = { value: unknown; request: number; answered: number | null }

/**
 * What the controls still show of the player's clicks once the model from read number `read` arrives. Only a read asked
 * for after a change's answer is sure to hold the change. One asked for before may have been read before the change was
 * made, and would show the old value again until the next read.
 */
export function stillShown(clicked: ReadonlyMap<string, Clicked>, read: number): ReadonlyMap<string, Clicked> {
  const standing = [...clicked].filter(([, entry]) => entry.answered === null || read <= entry.answered)
  return standing.length === clicked.size ? clicked : new Map(standing)
}

/**
 * The cards' groups just read, made of the ones of the read before wherever they are the same, as the roster's are
 * (characters/memory.ts, shareRoster; audit L22): a group that did not change is the same object as before, so its card is
 * not drawn again, and the whole list is the one before when nothing changed. Each read of the model is new JSON, and a
 * core event makes one, so without this every event drew every card.
 */
export function shareGroups(before: AchievementGroup[] | null, read: AchievementGroup[]): AchievementGroup[] {
  if (before === null) return read
  const known = new Map(before.map((group) => [group.id, group]))
  const groups = read.map((group) => {
    const old = known.get(group.id)
    return old !== undefined && JSON.stringify(old) === JSON.stringify(group) ? old : group
  })
  const unchanged = groups.length === before.length && groups.every((group, index) => group === before[index])
  return unchanged ? before : groups
}

/** The wiki address every stage of an achievement shares, shown once on its card; null when the stages differ. */
export function sharedWiki(group: Pick<AchievementGroup, 'stages'>): string | null {
  const [first, ...others] = group.stages
  return first !== undefined && others.every((stage) => stage.wiki === first.wiki) ? first.wiki : null
}

/**
 * The stage an achievement stands at (look pass spec 11.3 and 9.3): the first stage not ticked, whether it is in progress
 * or not started, or the last stage once every one is ticked. `index` is its place in the achievement, from 0. An
 * achievement has at least one stage.
 */
export function currentStage(
  group: Pick<AchievementGroup, 'stages'>,
): { stage: AchievementStage; index: number; allDone: boolean } {
  const first = group.stages.findIndex((stage) => stage.status !== 'done')
  const index = first === -1 ? group.stages.length - 1 : first
  return { stage: group.stages[index], index, allDone: first === -1 }
}

/** The stages of an achievement as pips: how many there are, and how many are ticked, whichever they are. */
export function pipsOf(group: Pick<AchievementGroup, 'stages'>): { total: number; done: number } {
  return { total: group.stages.length, done: group.stages.filter((stage) => stage.status === 'done').length }
}

/**
 * Whether the achievement is pinned: any of its stages is (section 2 of the look pass spec). Pin is the whole
 * achievement's, so it stays on while stages are ticked, and the stage that was pinned need not be the current one.
 */
export function pinnedAt(group: Pick<AchievementGroup, 'stages'>): boolean {
  return group.stages.some((stage) => stage.pinned)
}

/**
 * At most this many parts show on a card as chips (look pass spec 11.3); more show as a bar. The Daily commissions'
 * cards show their parts the same way (11.7, CommissionCard.tsx).
 */
export const CHIPS_AT_MOST = 4
/**
 * The room a card has for its chips, in characters of their names, where each chip also takes the room of this many
 * characters for its tick, its padding and the gap after it. Four chips of eight characters fit, as three of eleven do.
 */
const CHIP_ROOM = 64
const CHIP_FRAME = 8

/**
 * Whether a stage's checklist shows on its card as chips that tick (look pass spec 11.3): up to four, when their names
 * are short enough to fit the card's row. Otherwise the card shows a bar and "2 of 6 parts", and the parts tick in the
 * panel. The count of characters is a guide: where the card is narrower than the names need, the chips cut them short
 * (achievements.css).
 */
export function chipsFit(labels: readonly string[]): boolean {
  if (labels.length === 0 || labels.length > CHIPS_AT_MOST) return false
  return labels.reduce((room, label) => room + label.length + CHIP_FRAME, 0) <= CHIP_ROOM
}

/**
 * When an achievement was done: the latest tick of its stages, which the Done seal's day says. Null while any stage is
 * not done, or when no day was kept with a tick.
 */
export function lastTicked(group: Pick<AchievementGroup, 'stages'>): string | null {
  if (group.stages.some((stage) => stage.status !== 'done')) return null
  const days = group.stages.map((stage) => stage.done_at).filter((at): at is string => at !== null)
  if (days.length === 0) return null
  return days.reduce((latest, at) => (Date.parse(at) > Date.parse(latest) ? at : latest))
}

/**
 * The line under an achievement's name in its panel: how many stages it has, what they are worth, and how much of that
 * is earned. "3 stages · 35 primogems · 15 of them earned"; for one stage, "5 primogems", and "5 primogems, earned"
 * once it is ticked.
 */
export function panelSummary(group: Pick<AchievementGroup, 'stages'>): string {
  const { stages } = group
  const worth = plural(stages.reduce((sum, stage) => sum + stage.reward, 0), 'primogem')
  const earned = stages.filter((stage) => stage.status === 'done').reduce((sum, stage) => sum + stage.reward, 0)
  if (stages.length === 1) return earned > 0 ? `${worth}, earned` : worth
  const line = `${num(stages.length)} stages · ${worth}`
  return earned > 0 ? `${line} · ${num(earned)} of them earned` : line
}

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'],
  [5, 'V'], [4, 'IV'], [1, 'I'],
]

/** The numeral of a stage, by its place in the achievement from 0: 0 is "I", 1 is "II", 2 is "III", 3 is "IV". */
export function numeral(index: number): string {
  let rest = index + 1
  let text = ''
  for (const [value, letters] of ROMAN) {
    while (rest >= value) {
      text += letters
      rest -= value
    }
  }
  return text
}

import { dayMonth, localDay, num } from '../format.ts'
import type { Commission, CommissionsModel } from '../types.ts'

/** An instant's time of day in this PC's own time: "11:30". */
function clockTime(instant: string): string {
  const then = new Date(instant)
  return [then.getHours(), then.getMinutes()].map((part) => String(part).padStart(2, '0')).join(':')
}

/**
 * HoYoLAB's count of the day's finished commissions, as context (spec 11.1): "HoYoLAB: 2 of 4 done, at 11:30", with the
 * time it was read in this PC's own time. Null when it was not read in this game day: the model then has none.
 */
export function hoyolabLine(hoyolab: CommissionsModel['hoyolab']): string | null {
  if (hoyolab === null) return null
  return `HoYoLAB: ${num(hoyolab.done)} of ${num(hoyolab.of)} done, at ${clockTime(hoyolab.at)}`
}

/**
 * Where a chain is, from its parts done (spec 11.1): "At part 2 of 3: Leaving the pigeons alone". Only while it is
 * under way: begun, with a part done or marked in progress, and with a part still to do, on an achievement not done.
 * Null otherwise, and for parts done in any order.
 */
export function chainLine(card: Pick<Commission, 'order' | 'next_part' | 'parts' | 'status'>): string | null {
  const { parts, next_part: next } = card
  if (!card.order || next === null || card.status === 'done') return null
  const begun = card.status === 'in_progress' || parts.some((part) => part.done_at !== null)
  const at = parts.find((part) => part.index === next)
  if (!begun || at === undefined) return null
  return `At part ${num(next + 1)} of ${num(parts.length)}: ${at.name}`
}

/**
 * When the commission last came up, from the game days marked (spec 11.1): "Appeared today.", "Last appeared 15 Oct."
 * or "Not seen yet.".
 */
export function appearedLine(card: Pick<Commission, 'appeared_today' | 'last_appeared'>): string {
  if (card.appeared_today) return 'Appeared today.'
  return card.last_appeared === null ? 'Not seen yet.' : `Last appeared ${dayMonth(card.last_appeared)}.`
}

/** When a part was done, as its day in this PC's own time: "done 15 Oct". */
export function partDone(at: string): string {
  return `done ${localDay(at)}`
}

/** The cards a read of the model shows: those still to do, then the done ones, which fold away. */
export type Placed<T> = { above: T[]; fold: T[] }

/**
 * Where the cards show after a read of the model (spec 24: a changed card stays until the player moves on). A tick
 * takes a card into the fold, and the card after it would move up under the pointer, where a second click would reach
 * it. So the cards the player changed since moving on (`kept`) stay where they were shown (`before`, by id), above the
 * fold or in it, after the card shown before them there, with the model's data. Every other card is where the model
 * has it.
 */
export function placeCards<T extends { id: number }>(
  model: { cards: readonly T[]; done: readonly T[] },
  before: { above: readonly number[]; fold: readonly number[] },
  kept: readonly number[],
): Placed<T> {
  const keep = new Set(kept)
  const keptAbove = new Set(before.above.filter((id) => keep.has(id)))
  const keptFold = new Set(before.fold.filter((id) => keep.has(id)))
  // One side's cards: the model's, less those kept on the other side, and then those kept here that the model has on
  // the other side, each after the card shown before it, or first.
  const side = (
    shownBefore: readonly number[],
    own: readonly T[],
    other: readonly T[],
    here: ReadonlySet<number>,
    there: ReadonlySet<number>,
  ): T[] => {
    const cards = own.filter((card) => !there.has(card.id))
    shownBefore.forEach((id, at) => {
      const moved = here.has(id) ? other.find((card) => card.id === id) : undefined
      if (moved === undefined) return // where the model has it, or gone
      const after = shownBefore.slice(0, at).findLast((earlier) => cards.some((card) => card.id === earlier))
      cards.splice(after === undefined ? 0 : cards.findIndex((card) => card.id === after) + 1, 0, moved)
    })
    return cards
  }
  return {
    above: side(before.above, model.cards, model.done, keptAbove, keptFold),
    fold: side(before.fold, model.done, model.cards, keptFold, keptAbove),
  }
}

/**
 * The commissions to look for (spec 11.1): the model's, each once, in its order. While the cards the player changed stay
 * where they were shown (placeCards), only those that a card still to do above the fold names. A card ticked there
 * names none, as in the model, and the list's room above the cards is kept (Commissions.tsx). A card unticked in the
 * fold names its own once the player moves on and it shows above the fold, as the cards move then: a list that took
 * another line would move every card down under the pointer. When no card still to do above the fold names one, they
 * are the model's all the same: "Nothing to look for here." would not be so.
 */
export function lookingFor(
  model: Pick<CommissionsModel, 'looking_for'>,
  above: readonly Pick<Commission, 'quests' | 'status'>[],
): string[] {
  const named = new Set(above.filter((card) => card.status !== 'done').flatMap((card) => card.quests))
  const shown = model.looking_for.filter((name) => named.has(name))
  return shown.length > 0 ? shown : [...model.looking_for]
}

/**
 * What a region with no card still to do says: that Guild Board knows none there yet, or that every one is done. Null
 * while one is left.
 */
export function regionLine(model: Pick<CommissionsModel, 'region' | 'regions' | 'cards' | 'done'>): string | null {
  if (model.cards.length > 0) return null
  const name = model.regions.find((region) => region.key === model.region)?.name ?? model.region
  return model.done.length === 0
    ? `Guild Board knows no commission achievements in ${name} yet.`
    : `Every commission achievement in ${name} is done.`
}

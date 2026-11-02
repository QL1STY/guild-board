import type { CheckInModel } from '../types.ts'

/** What a day of the month's list is: claimed, today's to claim, or still to come. Rewards go by days claimed, not by date. */
export type TileState = 'claimed' | 'today' | 'coming'

export function tileState(index: number, model: Pick<CheckInModel, 'claimed_days' | 'claimed_today'>): TileState {
  if (index < model.claimed_days) return 'claimed'
  return index === model.claimed_days && !model.claimed_today ? 'today' : 'coming'
}

/** The reward to show large: today's, claimed or not. Null when the month's list has no such day. */
export function shownIndex(model: Pick<CheckInModel, 'claimed_days' | 'claimed_today' | 'rewards'>): number | null {
  const index = model.claimed_today ? model.claimed_days - 1 : model.claimed_days
  return index >= 0 && index < model.rewards.length ? index : null
}

/** The picture of a reward, or null where the demo has none and the sign shows. */
export function iconOf(icon: string): string | null {
  return icon === '' ? null : icon
}
